import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import {
  applyDiscounts,
  computeDiscountAmount,
  validateDiscountDraft,
  type Discount,
  type DiscountableLine,
} from "../../domain/discount";
import {
  computeScholarshipAmount,
  hasActiveStateAssignment,
  splitFunding,
  summarizeStateSplit,
  validateScholarshipDraft,
  type FundableLine,
  type Scholarship,
} from "../../domain/scholarship";
import { checkFundingConsistency, validateFundingType } from "../../domain/funding";
import { FEE_CATEGORIES } from "../../domain/types";
import { xof } from "../support/factories";
import { forAll } from "../support/rng";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

const disc = (over: Partial<Discount> & { code: string }): Discount => ({
  id: `d-${over.code}`,
  name: over.code,
  kind: "PERCENT",
  bps: 1000,
  amount: null,
  capAmount: null,
  categories: null,
  stackable: true,
  active: true,
  ...over,
});

const L = (id: string, category: DiscountableLine["category"], gross: number): DiscountableLine => ({ id, category, gross: xof(gross) });

describe("computeDiscountAmount", () => {
  it("pourcentage en points de base, arrondi HALF_UP", () => {
    expect(computeDiscountAmount(xof(100_000), disc({ code: "A", bps: 1000 })).amount).toBe(10_000);
    expect(computeDiscountAmount(xof(12_345), disc({ code: "A", bps: 1000 })).amount).toBe(1_235); // 1234,5 → 1235
    expect(computeDiscountAmount(xof(12_344), disc({ code: "A", bps: 1000 })).amount).toBe(1_234);
  });
  it("montant fixe plafonné à la base", () => {
    const d = disc({ code: "F", kind: "AMOUNT", bps: null, amount: xof(50_000) });
    expect(computeDiscountAmount(xof(80_000), d).amount).toBe(50_000);
    expect(computeDiscountAmount(xof(20_000), d).amount).toBe(20_000);
  });
  it("plafond propre à la remise", () => {
    const d = disc({ code: "C", bps: 5000, capAmount: xof(30_000) });
    expect(computeDiscountAmount(xof(200_000), d).amount).toBe(30_000);
  });
});

describe("applyDiscounts", () => {
  it("ventile une remise en pourcentage ligne par ligne, sans perte", () => {
    const lines = [L("a", "TUITION", 100_000), L("b", "CANTEEN", 30_001)];
    const r = unwrap(applyDiscounts(lines, [disc({ code: "FR", bps: 1000 })]));
    expect(r.total.amount).toBe(13_000); // 130 001 × 10 % = 13 000,1 → 13 000
    expect(r.perLine.reduce((a, x) => a + x.amount.amount, 0)).toBe(r.total.amount);
  });

  it("une remise limitée à une catégorie ne touche pas les autres lignes", () => {
    const lines = [L("a", "TUITION", 100_000), L("b", "CANTEEN", 50_000)];
    const r = unwrap(applyDiscounts(lines, [disc({ code: "T", bps: 2000, categories: ["TUITION"] })]));
    expect(r.perLine.find((x) => x.lineId === "a")!.amount.amount).toBe(20_000);
    expect(r.perLine.find((x) => x.lineId === "b")!.amount.amount).toBe(0);
  });

  it("remises cumulables : appliquées successivement sur le RESTE (10 % puis 10 % de 90 %)", () => {
    const r = unwrap(applyDiscounts([L("a", "TUITION", 100_000)], [disc({ code: "A" }), disc({ code: "B" })]));
    expect(r.applied.map((x) => x.amount.amount)).toEqual([10_000, 9_000]);
    expect(r.total.amount).toBe(19_000);
  });

  it("remises NON cumulables : seule la plus avantageuse s'applique", () => {
    const big = disc({ code: "BIG", bps: 3000, stackable: false });
    const small = disc({ code: "SMALL", bps: 1000, stackable: false });
    const r = unwrap(applyDiscounts([L("a", "TUITION", 100_000)], [small, big]));
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]!.discountId).toBe("d-BIG");
    expect(r.total.amount).toBe(30_000);
  });

  it("non cumulable + cumulable : la meilleure exclusive d'abord, puis les cumulables sur le reste", () => {
    const r = unwrap(
      applyDiscounts(
        [L("a", "TUITION", 100_000)],
        [disc({ code: "EXCL", bps: 2000, stackable: false }), disc({ code: "STACK", bps: 1000, stackable: true })],
      ),
    );
    expect(r.applied.map((x) => x.amount.amount)).toEqual([20_000, 8_000]);
  });

  it("plafond global : le cumul ne dépasse pas maxTotalBps du brut", () => {
    const r = unwrap(
      applyDiscounts([L("a", "TUITION", 100_000)], [disc({ code: "A", bps: 4000 }), disc({ code: "B", bps: 4000 })], { maxTotalBps: 5000 }),
    );
    expect(r.total.amount).toBe(50_000);
    expect(r.applied.map((x) => x.amount.amount)).toEqual([40_000, 10_000]);
  });

  it("une remise inactive est ignorée ; liste vide → zéro", () => {
    expect(unwrap(applyDiscounts([L("a", "TUITION", 1_000)], [disc({ code: "X", active: false })])).total.amount).toBe(0);
    expect(unwrap(applyDiscounts([], [disc({ code: "X" })])).total.amount).toBe(0);
  });

  it("refuse des devises mixtes et un plafond hors bornes", () => {
    const mixed: DiscountableLine[] = [L("a", "TUITION", 100), { id: "b", category: "TUITION", gross: Money.of(100, "EUR") }];
    expect(applyDiscounts(mixed, []).ok).toBe(false);
    expect(applyDiscounts([L("a", "TUITION", 100)], [], { maxTotalBps: 10_001 }).ok).toBe(false);
  });

  it("PROPRIÉTÉS : 0 ≤ remise de ligne ≤ brut, Σ lignes = Σ remises appliquées ≤ plafond", () => {
    forAll(600, (rng) => {
      const lines = Array.from({ length: rng.int(1, 6) }, (_, k) => L(`l${k}`, rng.pick(FEE_CATEGORIES), rng.int(0, 900_000)));
      const discounts = Array.from({ length: rng.int(0, 5) }, (_, k) =>
        rng.bool()
          ? disc({ code: `P${k}`, bps: rng.int(1, 10_000), stackable: rng.bool(), categories: rng.bool(0.4) ? [rng.pick(FEE_CATEGORIES)] : null, capAmount: rng.bool(0.3) ? xof(rng.int(1, 500_000)) : null })
          : disc({ code: `A${k}`, kind: "AMOUNT", bps: null, amount: xof(rng.int(1, 600_000)), stackable: rng.bool() }),
      );
      const maxTotalBps = rng.pick([10_000, 5_000, 2_500, 0]);
      const r = unwrap(applyDiscounts(lines, discounts, { maxTotalBps }));
      const gross = lines.reduce((a, l) => a + l.gross.amount, 0);
      const sumLines = r.perLine.reduce((a, x) => a + x.amount.amount, 0);
      const sumApplied = r.applied.reduce((a, x) => a + x.amount.amount, 0);
      expect(sumLines).toBe(r.total.amount);
      expect(sumApplied).toBe(r.total.amount);
      expect(r.total.amount).toBeLessThanOrEqual(Math.floor((gross * maxTotalBps) / 10_000));
      for (const [i, p] of r.perLine.entries()) {
        expect(p.amount.amount).toBeGreaterThanOrEqual(0);
        expect(p.amount.amount).toBeLessThanOrEqual(lines[i]!.gross.amount);
      }
    });
  });
});

describe("validateDiscountDraft", () => {
  it("accepte pourcentage et montant", () => {
    expect(validateDiscountDraft({ code: "fr10", name: "Fratrie", kind: "PERCENT", bps: 1000 }).ok).toBe(true);
    expect(validateDiscountDraft({ code: "geste", name: "Geste", kind: "AMOUNT", amount: xof(5000) }).ok).toBe(true);
  });
  it.each([
    [{ code: "x", name: "x", kind: "PERCENT", bps: 0 }],
    [{ code: "x", name: "x", kind: "PERCENT", bps: 10_001 }],
    [{ code: "x", name: "x", kind: "PERCENT", bps: 1.5 }],
    [{ code: "x", name: "x", kind: "AMOUNT" }],
    [{ code: "x", name: "x", kind: "AMOUNT", amount: xof(0) }],
    [{ code: "x", name: "x", kind: "WEIRD" }],
    [{ code: "x y", name: "x", kind: "PERCENT", bps: 100 }],
    [{ code: "x", name: " ", kind: "PERCENT", bps: 100 }],
    [{ code: "x", name: "x", kind: "PERCENT", bps: 100, amount: xof(10) }],
  ])("refuse %j", (draft) => {
    expect(validateDiscountDraft(draft as never).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
const sch = (over: Partial<Scholarship> & { id: string }): Scholarship => ({
  learnerId: "learner",
  academicYear: "2025-2026",
  funderKind: "STATE",
  funderName: "État",
  reference: "AFF-1",
  coverage: { kind: "PERCENT", bps: 5000 },
  capAmount: null,
  categories: null,
  status: "ACTIVE",
  priority: 100,
  ...over,
});
const F = (id: string, category: FundableLine["category"], amount: number): FundableLine => ({ id, category, amount: xof(amount) });

describe("splitFunding — bourses, part État / part parent", () => {
  it("élève affecté : l'État couvre 60 %, le parent le reste (sans perte)", () => {
    const lines = [F("t", "TUITION", 500_000), F("r", "REGISTRATION", 10_001)];
    const split = unwrap(splitFunding(lines, [sch({ id: "s1", coverage: { kind: "PERCENT", bps: 6000 } })]));
    expect(split.fundedTotal.amount + split.parentTotal.amount).toBe(510_001);
    expect(split.fundedTotal.amount).toBe(306_001); // 510 001 × 60 % = 306 000,6 → 306 001 (HALF_UP)
    const st = summarizeStateSplit(split);
    expect(st.state.amount).toBe(306_001);
    expect(st.parent.amount).toBe(204_000);
    expect(st.otherFunders.amount).toBe(0);
  });

  it("montant fixe État + part parent", () => {
    const split = unwrap(splitFunding([F("t", "TUITION", 400_000)], [sch({ id: "s", coverage: { kind: "FIXED", amount: xof(300_000) } })]));
    expect(split.fundedTotal.amount).toBe(300_000);
    expect(split.parentTotal.amount).toBe(100_000);
  });

  it("un montant fixe supérieur à la facture est plafonné (le parent ne devient jamais créditeur)", () => {
    const split = unwrap(splitFunding([F("t", "TUITION", 100_000)], [sch({ id: "s", coverage: { kind: "FIXED", amount: xof(300_000) } })]));
    expect(split.fundedTotal.amount).toBe(100_000);
    expect(split.parentTotal.amount).toBe(0);
  });

  it("une bourse limitée à une catégorie ne finance que celle-ci", () => {
    const split = unwrap(
      splitFunding([F("t", "TUITION", 100_000), F("c", "CANTEEN", 40_000)], [sch({ id: "s", categories: ["TUITION"], coverage: { kind: "PERCENT", bps: 10_000 } })]),
    );
    expect(split.fundedPerLine.find((x) => x.lineId === "t")!.amount.amount).toBe(100_000);
    expect(split.parentPerLine.find((x) => x.lineId === "c")!.amount.amount).toBe(40_000);
  });

  it("plusieurs financeurs, par priorité, chacun sur le reste", () => {
    const split = unwrap(
      splitFunding(
        [F("t", "TUITION", 100_000)],
        [
          sch({ id: "b", funderKind: "COMPANY", funderName: "ACME", priority: 2, coverage: { kind: "PERCENT", bps: 5000 } }),
          sch({ id: "a", funderKind: "STATE", priority: 1, coverage: { kind: "PERCENT", bps: 5000 } }),
        ],
      ),
    );
    expect(split.shares.map((s) => [s.funderKind, s.total.amount])).toEqual([["STATE", 50_000], ["COMPANY", 25_000]]);
    expect(split.parentTotal.amount).toBe(25_000);
    expect(summarizeStateSplit(split).otherFunders.amount).toBe(25_000);
  });

  it("plafond de la bourse", () => {
    expect(computeScholarshipAmount(xof(1_000_000), sch({ id: "s", capAmount: xof(200_000) })).amount).toBe(200_000);
  });

  it("une bourse suspendue ou terminée est ignorée", () => {
    const split = unwrap(splitFunding([F("t", "TUITION", 100_000)], [sch({ id: "s", status: "SUSPENDED" }), sch({ id: "e", status: "ENDED" })]));
    expect(split.fundedTotal.amount).toBe(0);
    expect(split.parentTotal.amount).toBe(100_000);
  });

  it("PROPRIÉTÉS : Σ parts financeurs + part parent = total ; aucune part négative ; par ligne ≤ montant", () => {
    forAll(600, (rng) => {
      const lines = Array.from({ length: rng.int(1, 6) }, (_, k) => F(`l${k}`, rng.pick(FEE_CATEGORIES), rng.int(0, 800_000)));
      const schols = Array.from({ length: rng.int(0, 4) }, (_, k) =>
        sch({
          id: `s${k}`,
          priority: rng.int(1, 3),
          funderKind: rng.pick(["STATE", "COMPANY", "OTHER"] as const),
          coverage: rng.bool() ? { kind: "PERCENT", bps: rng.int(1, 10_000) } : { kind: "FIXED", amount: xof(rng.int(1, 900_000)) },
          capAmount: rng.bool(0.3) ? xof(rng.int(1, 400_000)) : null,
          categories: rng.bool(0.4) ? [rng.pick(FEE_CATEGORIES)] : null,
        }),
      );
      const split = unwrap(splitFunding(lines, schols));
      const total = lines.reduce((a, l) => a + l.amount.amount, 0);
      expect(split.fundedTotal.amount + split.parentTotal.amount).toBe(total);
      expect(split.shares.reduce((a, s) => a + s.total.amount, 0)).toBe(split.fundedTotal.amount);
      for (const [i, l] of lines.entries()) {
        const f = split.fundedPerLine[i]!.amount.amount;
        const p = split.parentPerLine[i]!.amount.amount;
        expect(f).toBeGreaterThanOrEqual(0);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(f + p).toBe(l.amount.amount);
      }
      for (const s of split.shares) expect(s.perLine.reduce((a, x) => a + x.amount.amount, 0)).toBe(s.total.amount);
    });
  });
});

describe("validateScholarshipDraft / financement", () => {
  const base = { learnerId: "l", academicYear: "2025-2026", funderKind: "STATE", funderName: "État de Côte d'Ivoire" };
  it("accepte un pourcentage et un montant fixe", () => {
    expect(validateScholarshipDraft({ ...base, coverage: { kind: "PERCENT", bps: 7000 } }).ok).toBe(true);
    expect(validateScholarshipDraft({ ...base, coverage: { kind: "FIXED", amount: xof(100_000) } }).ok).toBe(true);
  });
  it.each([
    [{ ...base, funderKind: "X", coverage: { kind: "PERCENT", bps: 100 } }],
    [{ ...base, funderName: " ", coverage: { kind: "PERCENT", bps: 100 } }],
    [{ ...base, coverage: { kind: "PERCENT", bps: 0 } }],
    [{ ...base, coverage: { kind: "FIXED" } }],
    [{ ...base, coverage: { kind: "???" } }],
    [{ ...base, academicYear: "", coverage: { kind: "PERCENT", bps: 100 } }],
  ])("refuse %j", (d) => expect(validateScholarshipDraft(d as never).ok).toBe(false));

  it("STATE_ASSIGNED exige une prise en charge de l'État active pour l'année", () => {
    expect(hasActiveStateAssignment([sch({ id: "s" })], "2025-2026")).toBe(true);
    expect(hasActiveStateAssignment([sch({ id: "s" })], "2026-2027")).toBe(false);
    expect(hasActiveStateAssignment([sch({ id: "s", status: "ENDED" })], "2025-2026")).toBe(false);
    expect(hasActiveStateAssignment([sch({ id: "s", funderKind: "COMPANY" })], "2025-2026")).toBe(false);

    const missing = checkFundingConsistency({ fundingType: "STATE_ASSIGNED" }, [], "2025-2026");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("finance.funding_assignment_missing");
    expect(checkFundingConsistency({ fundingType: "STATE_ASSIGNED" }, [sch({ id: "s" })], "2025-2026").ok).toBe(true);
  });

  it("SCHOLARSHIP / COMPANY exigent leur prise en charge ; PRIVATE, STAFF_CHILD, OTHER non", () => {
    expect(checkFundingConsistency({ fundingType: "SCHOLARSHIP" }, [], "2025-2026").ok).toBe(false);
    expect(checkFundingConsistency({ fundingType: "SCHOLARSHIP" }, [sch({ id: "s", funderKind: "FOUNDATION" })], "2025-2026").ok).toBe(true);
    expect(checkFundingConsistency({ fundingType: "COMPANY" }, [sch({ id: "s" })], "2025-2026").ok).toBe(false);
    expect(checkFundingConsistency({ fundingType: "COMPANY" }, [sch({ id: "s", funderKind: "COMPANY" })], "2025-2026").ok).toBe(true);
    for (const t of ["PRIVATE", "STAFF_CHILD", "OTHER"] as const) {
      expect(checkFundingConsistency({ fundingType: t }, [], "2025-2026").ok).toBe(true);
    }
  });

  it("validateFundingType", () => {
    expect(validateFundingType("STATE_ASSIGNED").ok).toBe(true);
    expect(validateFundingType("nope").ok).toBe(false);
  });
});
