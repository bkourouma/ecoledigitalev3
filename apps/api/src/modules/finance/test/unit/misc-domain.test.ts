import { describe, expect, it } from "vitest";
import { ManualClock, Money } from "@ecoledigitale/kernel";
import { addDays, compareDates, diffDays, nextMonthDayOnOrAfter, yearOf, assertIsoDate } from "../../domain/dates";
import { DOCUMENT_PREFIX, formatDocumentNumber, numberingYear, parseDocumentNumber } from "../../domain/numbering";
import {
  assertCashSessionTransition,
  expectedCash,
  requiresJustification,
  settleSession,
  validateOpeningFloat,
} from "../../domain/cash-register";
import {
  AGING_BUCKETS,
  agingBucket,
  collectionRateBps,
  computeAgedBalance,
  summarizeReceivables,
  type ReceivableInstallment,
} from "../../domain/reporting";
import { validateFeeDraft } from "../../domain/fee";
import {
  resolveFeeSchedule,
  scopeSpecificity,
  scheduleMatches,
  schedulesOverlap,
  validateFeeScheduleDraft,
  EMPTY_SCOPE,
  type FeeSchedule,
} from "../../domain/fee-schedule";
import { parseMoney, subtractFloor } from "../../domain/money-utils";
import { installment, xof } from "../support/factories";
import { forAll } from "../support/rng";

describe("dates", () => {
  it("addDays / diffDays / compare", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-01-01", "2026-03-01")).toBe(59);
    expect(diffDays("2026-03-01", "2026-01-01")).toBe(-59);
    expect(compareDates("2026-01-01", "2026-01-02")).toBe(-1);
    expect(yearOf("2026-12-31")).toBe(2026);
  });
  it("refuse les dates invalides", () => {
    expect(() => assertIsoDate("2026-02-30")).toThrow();
    expect(() => addDays("nope", 1)).toThrow();
    expect(() => addDays("2026-01-01", 1.5)).toThrow();
  });
  it("PROPRIÉTÉ : addDays puis diffDays redonne n", () => {
    forAll(200, (rng) => {
      const d = `20${rng.int(20, 35)}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`;
      const n = rng.int(-800, 800);
      expect(diffDays(d, addDays(d, n))).toBe(n);
    });
  });
  it("nextMonthDayOnOrAfter est toujours ≥ base", () => {
    forAll(200, (rng) => {
      const base = `20${rng.int(20, 35)}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`;
      const r = nextMonthDayOnOrAfter(base, rng.int(1, 12), rng.int(1, 31));
      expect(r >= base).toBe(true);
      expect(diffDays(base, r)).toBeLessThan(366);
    });
  });
});

describe("numérotation", () => {
  it("format REC-yyyy-nnnnnn / FAC / AV", () => {
    expect(formatDocumentNumber("RECEIPT", 2026, 1)).toBe("REC-2026-000001");
    expect(formatDocumentNumber("INVOICE", 2026, 123456)).toBe("FAC-2026-123456");
    expect(formatDocumentNumber("CREDIT_NOTE", 2027, 42)).toBe("AV-2027-000042");
    expect(formatDocumentNumber("RECEIPT", 2026, 1_234_567)).toBe("REC-2026-1234567");
  });
  it("aller-retour parse/format", () => {
    for (const kind of Object.keys(DOCUMENT_PREFIX) as Array<keyof typeof DOCUMENT_PREFIX>) {
      const n = formatDocumentNumber(kind, 2026, 77);
      expect(parseDocumentNumber(n)).toEqual({ kind, year: 2026, sequence: 77 });
    }
    expect(parseDocumentNumber("REC-PRO-2026-000001")).toBeNull();
    expect(parseDocumentNumber("XXX-2026-000001")).toBeNull();
  });
  it("refuse séquence ou année invalides", () => {
    expect(() => formatDocumentNumber("RECEIPT", 2026, 0)).toThrow();
    expect(() => formatDocumentNumber("RECEIPT", 1999, 1)).toThrow();
  });
  it("année de numérotation = année civile à Abidjan (UTC+0)", () => {
    expect(numberingYear(new ManualClock("2026-12-31T23:59:59.999Z"))).toBe(2026);
    expect(numberingYear(new ManualClock("2027-01-01T00:00:00.000Z"))).toBe(2027);
  });
});

describe("caisse", () => {
  const m = (float: number, inn: number, out: number) => ({ openingFloat: xof(float), cashReceived: xof(inn), cashRefunded: xof(out) });
  it("attendu = fonds + encaissé − remboursé ; écart = compté − attendu", () => {
    expect(expectedCash(m(50_000, 300_000, 20_000)).amount).toBe(330_000);
    const s = settleSession(m(50_000, 300_000, 20_000), xof(329_000));
    expect(s.ok && s.value.variance.amount).toBe(-1_000);
    const over = settleSession(m(50_000, 300_000, 20_000), xof(331_500));
    expect(over.ok && over.value.variance.amount).toBe(1_500);
    const exact = settleSession(m(0, 0, 0), xof(0));
    expect(exact.ok && exact.value.variance.amount).toBe(0);
  });
  it("accepte un attendu négatif (remboursement d'une session antérieure)", () => {
    const s = settleSession(m(0, 0, 10_000), xof(0));
    expect(s.ok && s.value.expected.amount).toBe(-10_000);
    expect(s.ok && s.value.variance.amount).toBe(10_000);
  });
  it("refuse un comptage négatif ou d'une autre devise", () => {
    expect(settleSession(m(0, 0, 0), xof(-1)).ok).toBe(false);
    expect(settleSession(m(0, 0, 0), Money.of(1, "EUR")).ok).toBe(false);
  });
  it("machine d'états OPEN → CLOSED uniquement", () => {
    expect(assertCashSessionTransition("OPEN", "CLOSED").ok).toBe(true);
    expect(assertCashSessionTransition("CLOSED", "OPEN").ok).toBe(false);
    expect(assertCashSessionTransition("OPEN", "OPEN").ok).toBe(false);
  });
  it("fonds de caisse non négatif ; justification au-delà de la tolérance", () => {
    expect(validateOpeningFloat(xof(0)).ok).toBe(true);
    expect(validateOpeningFloat(xof(-1)).ok).toBe(false);
    expect(requiresJustification(xof(-1_001), xof(1_000))).toBe(true);
    expect(requiresJustification(xof(1_000), xof(1_000))).toBe(false);
  });
});

describe("reporting (règles pures)", () => {
  it("taux de recouvrement en points de base, arrondi HALF_UP, borné", () => {
    expect(collectionRateBps(xof(750), xof(1_000))).toBe(7_500);
    expect(collectionRateBps(xof(1), xof(3))).toBe(3_333);
    expect(collectionRateBps(xof(2), xof(3))).toBe(6_667);
    expect(collectionRateBps(xof(0), xof(1_000))).toBe(0);
    expect(collectionRateBps(xof(1_000), xof(1_000))).toBe(10_000);
    expect(collectionRateBps(xof(5), xof(0))).toBeNull();
  });
  it("tranches d'ancienneté", () => {
    expect(agingBucket(-5)).toBe("NOT_DUE");
    expect(agingBucket(0)).toBe("NOT_DUE");
    expect(agingBucket(1)).toBe("D1_30");
    expect(agingBucket(30)).toBe("D1_30");
    expect(agingBucket(31)).toBe("D31_60");
    expect(agingBucket(60)).toBe("D31_60");
    expect(agingBucket(61)).toBe("D61_90");
    expect(agingBucket(90)).toBe("D61_90");
    expect(agingBucket(91)).toBe("D91_PLUS");
    expect(agingBucket(1000)).toBe("D91_PLUS");
    expect(AGING_BUCKETS).toHaveLength(5);
  });
  it("balance âgée : reste dû de chaque échéance, factures actives seulement", () => {
    const rows: ReceivableInstallment[] = [
      { invoiceId: "a", status: "OVERDUE", installment: installment({ dueDate: "2026-01-20", amount: 100, paid: 40 }) }, // 12 jours → D1_30 : 60
      { invoiceId: "a", status: "OVERDUE", installment: installment({ dueDate: "2025-10-01", amount: 50 }) }, // 123 jours → D91_PLUS : 50
      { invoiceId: "b", status: "ISSUED", installment: installment({ dueDate: "2026-03-01", amount: 70 }) }, // NOT_DUE : 70
      { invoiceId: "c", status: "CANCELLED", installment: installment({ dueDate: "2025-01-01", amount: 999 }) }, // ignorée
      { invoiceId: "d", status: "PAID", installment: installment({ dueDate: "2025-01-01", amount: 10, paid: 10 }) }, // ignorée
      { invoiceId: "e", status: "PARTIALLY_PAID", installment: installment({ dueDate: "2025-12-15", amount: 20 }) }, // 48 jours → D31_60 : 20
    ];
    const aged = computeAgedBalance(rows, "2026-02-01", "XOF");
    expect(Object.fromEntries(Object.entries(aged).map(([k, v]) => [k, v.amount]))).toEqual({
      NOT_DUE: 70,
      D1_30: 60,
      D31_60: 20,
      D61_90: 0,
      D91_PLUS: 50,
    });
  });
  it("synthèse : facturé, encaissé, restant dû (brouillons et annulées exclus)", () => {
    const s = summarizeReceivables(
      [
        { status: "ISSUED", total: xof(1_000), paid: xof(0), credited: xof(0) },
        { status: "PAID", total: xof(500), paid: xof(500), credited: xof(0) },
        { status: "PARTIALLY_PAID", total: xof(800), paid: xof(300), credited: xof(100) },
        { status: "CREDITED", total: xof(200), paid: xof(0), credited: xof(200) },
        { status: "CANCELLED", total: xof(9_999), paid: xof(0), credited: xof(0) },
        { status: "DRAFT", total: xof(7_777), paid: xof(0), credited: xof(0) },
      ],
      "XOF",
    );
    expect(s.billed.amount).toBe(2_500);
    expect(s.credited.amount).toBe(300);
    expect(s.netBilled.amount).toBe(2_200);
    expect(s.collected.amount).toBe(800);
    expect(s.outstanding.amount).toBe(1_400);
    expect(s.collectionRateBps).toBe(3_636); // 800 / 2 200
  });
});

describe("catalogue de frais", () => {
  it("normalise le code et valide la catégorie", () => {
    const r = validateFeeDraft({ code: " scol-1 ", name: "Scolarité", category: "TUITION" });
    expect(r.ok && r.value.code).toBe("SCOL-1");
    expect(r.ok && r.value.currency).toBe("XOF");
  });
  it.each([
    [{ code: "", name: "x", category: "TUITION" }],
    [{ code: "a b", name: "x", category: "TUITION" }],
    [{ code: "A", name: "", category: "TUITION" }],
    [{ code: "A", name: "x", category: "MISC" }],
    [{ code: "A", name: "x", category: "TUITION", currency: "ZZZ" }],
  ])("refuse %j", (d) => expect(validateFeeDraft(d).ok).toBe(false));
});

describe("barèmes (FeeSchedule)", () => {
  const sched = (over: Partial<FeeSchedule> & { id: string }): FeeSchedule => ({
    feeId: "fee",
    academicYear: "2025-2026",
    scope: { ...EMPTY_SCOPE },
    amount: xof(100_000),
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    planId: null,
    active: true,
    ...over,
  });
  const q = { feeId: "fee", academicYear: "2025-2026", onDate: "2025-10-01" };

  it("le barème le plus spécifique l'emporte (filière > niveau > campus > type > établissement)", () => {
    const general = sched({ id: "gen" });
    const campus = sched({ id: "campus", scope: { ...EMPTY_SCOPE, campusId: "c1" }, amount: xof(120_000) });
    const level = sched({ id: "level", scope: { ...EMPTY_SCOPE, levelKey: "L1" }, amount: xof(130_000) });
    const track = sched({ id: "track", scope: { ...EMPTY_SCOPE, trackKey: "GRH" }, amount: xof(140_000) });
    const r = resolveFeeSchedule([general, campus, level, track], { ...q, campusId: "c1", levelKey: "L1", trackKey: "GRH" });
    expect(r.ok && r.value.id).toBe("track");
    const r2 = resolveFeeSchedule([general, campus, level], { ...q, campusId: "c1", levelKey: "L1" });
    expect(r2.ok && r2.value.id).toBe("level");
    const r3 = resolveFeeSchedule([general, campus, level], { ...q, campusId: "c1" });
    expect(r3.ok && r3.value.id).toBe("campus");
    const r4 = resolveFeeSchedule([general, campus, level], q);
    expect(r4.ok && r4.value.id).toBe("gen");
  });

  it("un barème ciblé ne s'applique pas si la dimension de la requête diffère ou manque", () => {
    const campus = sched({ id: "campus", scope: { ...EMPTY_SCOPE, campusId: "c1" } });
    expect(scheduleMatches(campus, { ...q, campusId: "c2" })).toBe(false);
    expect(scheduleMatches(campus, q)).toBe(false);
    expect(scheduleMatches(campus, { ...q, campusId: "c1" })).toBe(true);
  });

  it("dates d'effet : bornes incluses ; le plus récent l'emporte à spécificité égale", () => {
    const old = sched({ id: "old", effectiveFrom: "2025-09-01", effectiveTo: "2025-12-31" });
    const fresh = sched({ id: "fresh", effectiveFrom: "2025-11-01", amount: xof(110_000) });
    expect(resolveFeeSchedule([old, fresh], { ...q, onDate: "2025-10-15" }).ok && (resolveFeeSchedule([old, fresh], { ...q, onDate: "2025-10-15" }) as { value: FeeSchedule }).value.id).toBe("old");
    const both = resolveFeeSchedule([old, fresh], { ...q, onDate: "2025-12-31" });
    expect(both.ok && both.value.id).toBe("fresh");
    const before = resolveFeeSchedule([old], { ...q, onDate: "2025-08-31" });
    expect(before.ok).toBe(false);
    const after = resolveFeeSchedule([old], { ...q, onDate: "2026-01-01" });
    expect(after.ok).toBe(false);
  });

  it("introuvable → erreur explicite ; ambigu → erreur (on ne devine pas)", () => {
    const none = resolveFeeSchedule([], q);
    expect(!none.ok && none.error.code).toBe("finance.fee_schedule_not_found");
    const a = sched({ id: "a" });
    const b = sched({ id: "b", amount: xof(1) });
    const amb = resolveFeeSchedule([a, b], q);
    expect(!amb.ok && amb.error.code).toBe("finance.fee_schedule_ambiguous");
  });

  it("ignore les barèmes inactifs, d'un autre frais ou d'une autre année", () => {
    expect(resolveFeeSchedule([sched({ id: "x", active: false })], q).ok).toBe(false);
    expect(resolveFeeSchedule([sched({ id: "x", feeId: "other" })], q).ok).toBe(false);
    expect(resolveFeeSchedule([sched({ id: "x", academicYear: "2024-2025" })], q).ok).toBe(false);
  });

  it("spécificités distinctes pour chaque combinaison de dimensions", () => {
    const dims = ["institutionId", "campusId", "levelKey", "trackKey", "learnerType"] as const;
    const seen = new Set<number>();
    for (let mask = 0; mask < 32; mask++) {
      const scope = { ...EMPTY_SCOPE } as Record<string, string | null>;
      dims.forEach((d, i) => {
        if (mask & (1 << i)) scope[d] = "x";
      });
      seen.add(scopeSpecificity(scope as never));
    }
    expect(seen.size).toBe(32);
  });

  it("chevauchement : même périmètre + périodes qui s'intersectent", () => {
    const a = sched({ id: "a", effectiveFrom: "2025-09-01", effectiveTo: "2025-12-31" });
    expect(schedulesOverlap(a, sched({ id: "b", effectiveFrom: "2025-12-31" }))).toBe(true);
    expect(schedulesOverlap(a, sched({ id: "b", effectiveFrom: "2026-01-01" }))).toBe(false);
    expect(schedulesOverlap(a, sched({ id: "b", scope: { ...EMPTY_SCOPE, campusId: "c" } }))).toBe(false);
    expect(schedulesOverlap(a, sched({ id: "b", feeId: "z" }))).toBe(false);
  });

  it("validation d'un nouveau barème", () => {
    const existing = [sched({ id: "a" })];
    const draft = { feeId: "fee", academicYear: "2025-2026", amount: xof(1), effectiveFrom: "2025-09-01" };
    expect(validateFeeScheduleDraft(draft, existing).ok).toBe(false); // chevauche
    expect(validateFeeScheduleDraft({ ...draft, scope: { campusId: "c9" } }, existing).ok).toBe(true);
    expect(validateFeeScheduleDraft({ ...draft, effectiveTo: "2025-08-01" }, []).ok).toBe(false);
    expect(validateFeeScheduleDraft({ ...draft, amount: xof(-1) }, []).ok).toBe(false);
    expect(validateFeeScheduleDraft({ ...draft, academicYear: " " }, []).ok).toBe(false);
  });
});

describe("money-utils", () => {
  it("parseMoney accepte entier, bigint et chaîne entière ; refuse décimal/négatif/nul", () => {
    expect(parseMoney(1500, "XOF", "m").ok).toBe(true);
    expect(parseMoney("1500", "XOF", "m").ok).toBe(true);
    expect(parseMoney(1500n, "XOF", "m").ok).toBe(true);
    expect(parseMoney(15.5, "XOF", "m").ok).toBe(false);
    expect(parseMoney("12.5", "XOF", "m").ok).toBe(false);
    expect(parseMoney(-1, "XOF", "m").ok).toBe(false);
    expect(parseMoney(0, "XOF", "m").ok).toBe(false);
    expect(parseMoney(0, "XOF", "m", { allowZero: true }).ok).toBe(true);
    expect(parseMoney(undefined, "XOF", "m").ok).toBe(false);
    expect(parseMoney(Number.MAX_SAFE_INTEGER + 2, "XOF", "m").ok).toBe(false);
  });
  it("subtractFloor ne descend jamais sous zéro", () => {
    expect(subtractFloor(xof(5), xof(9)).amount).toBe(0);
    expect(subtractFloor(xof(9), xof(5)).amount).toBe(4);
  });
});
