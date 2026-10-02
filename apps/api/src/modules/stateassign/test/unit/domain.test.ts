/** Règles PURES du domaine stateassign (sans base) : états, rapprochement, créances, retards, contrôles, exports. */
import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import {
  ASSIGNMENT_ACTS,
  ASSIGNMENT_TRANSITIONS,
  FINAL_ASSIGNMENT_STATUSES,
  actAllowedFrom,
  billedFrom,
  canTransitionAssignment,
  declaredAmount,
  hasContentChange,
  isLiveAssignment,
  isOperationalAssignment,
  normalizeReference,
} from "../../domain/assignment";
import { CONTROL_TRANSITIONS, canTransitionControl, planControls } from "../../domain/controls";
import { EXPORT_CATALOG, csvCell, toCsv, validateColumns } from "../../domain/export";
import { addDays, agingBucketOf, allocateReceived, daysBetween, daysOverdue, deltaOf, receivableStatusOf, reconcile, viewReceivable } from "../../domain/reconciliation";
import { ASSIGNMENT_STATUSES } from "@ecoledigitale/contracts/src/v2/stateassign";
import type { ReceivableRecord } from "../../domain/types";

const xof = (n: number) => Money.of(n, "XOF");

describe("machine d'états du dossier", () => {
  it("couvre les 8 statuts ; les états finals n'ont aucune sortie", () => {
    expect(Object.keys(ASSIGNMENT_TRANSITIONS).sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
    for (const s of FINAL_ASSIGNMENT_STATUSES) expect(ASSIGNMENT_TRANSITIONS[s]).toEqual([]);
  });

  it("la vérification n'existe que depuis RECEIVED ; l'activation que depuis VERIFIED ; la reprise que depuis SUSPENDED", () => {
    expect(actAllowedFrom("verify", "RECEIVED")).toBe(true);
    expect(actAllowedFrom("verify", "ACTIVE")).toBe(false);
    expect(actAllowedFrom("activate", "VERIFIED")).toBe(true);
    expect(actAllowedFrom("activate", "RECEIVED")).toBe(false);
    expect(actAllowedFrom("resume", "SUSPENDED")).toBe(true);
    expect(actAllowedFrom("resume", "ACTIVE")).toBe(false);
    expect(actAllowedFrom("end", "SUSPENDED")).toBe(true);
    expect(actAllowedFrom("transfer-out", "SUSPENDED")).toBe(false); // miroir de la base : seul un dossier ACTIF est transféré
    expect(actAllowedFrom("reject", "ACTIVE")).toBe(false);
  });

  it("chaque acte du cycle de vie vise une transition permise et est un acte sensible", () => {
    for (const [act, spec] of Object.entries(ASSIGNMENT_ACTS)) {
      const from = ASSIGNMENT_STATUSES.filter((s) => actAllowedFrom(act as never, s));
      expect(from.length, act).toBeGreaterThan(0);
      for (const f of from) expect(canTransitionAssignment(f, spec.to), `${act}: ${f} -> ${spec.to}`).toBe(true);
      expect(spec.sensitive).toBe(true);
    }
  });

  it("un dossier est « vivant » jusqu'à ACTIVE/SUSPENDED ; opérationnel dès la vérification", () => {
    expect(["RECEIVED", "VERIFIED", "ACTIVE", "SUSPENDED"].every((s) => isLiveAssignment(s as never))).toBe(true);
    expect(["ENDED", "REJECTED", "TRANSFERRED", "SUPERSEDED"].some((s) => isLiveAssignment(s as never))).toBe(false);
    expect(isOperationalAssignment("RECEIVED")).toBe(false);
    expect(isOperationalAssignment("VERIFIED")).toBe(true);
  });
});

describe("saisie : référence, montants entiers", () => {
  it("nettoie la référence et refuse le vide", () => {
    expect(normalizeReference("  AFF   2026  001 ")).toBe("AFF 2026 001");
    expect(normalizeReference("   ")).toBeNull();
    expect(normalizeReference("x".repeat(121))).toBeNull();
    expect(normalizeReference(42)).toBeNull();
  });

  it("un montant déclaré est un entier positif ou nul : jamais un flottant", () => {
    expect(declaredAmount(400000, "XOF")?.amount).toBe(400000);
    expect(declaredAmount(0, "XOF")?.amount).toBe(0);
    expect(declaredAmount(null, "XOF")).toBeNull();
    expect(declaredAmount(undefined, "XOF")).toBeNull();
    expect(() => declaredAmount(100.5, "XOF")).toThrow(RangeError);
    expect(() => declaredAmount(-1, "XOF")).toThrow(RangeError);
    expect(() => declaredAmount(Number.MAX_SAFE_INTEGER + 2, "XOF")).toThrow(RangeError);
  });

  it("détecte un changement de fond (avenant) et ignore ce qui est identique", () => {
    const cur = { reference: "R", issuedOn: "2026-09-15", issuingAuthority: "A", declaredState: xof(100), declaredParent: null };
    expect(hasContentChange(cur, {})).toBe(false);
    expect(hasContentChange(cur, { reference: "R", declaredState: xof(100) })).toBe(false);
    expect(hasContentChange(cur, { declaredState: xof(101) })).toBe(true);
    expect(hasContentChange(cur, { declaredParent: xof(0) })).toBe(true);
    expect(hasContentChange(cur, { issuingAuthority: null })).toBe(true);
  });
});

describe("rapprochement : écart = facturé − déclaré, statut selon la tolérance", () => {
  it("à tolérance 0, le moindre écart est une DISCREPANCY ; l'égalité exacte est BALANCED", () => {
    expect(reconcile({ state: xof(400000), parent: xof(100000) }, { state: xof(400000), parent: xof(100000) }, 0).status).toBe("BALANCED");
    expect(reconcile({ state: xof(400000), parent: xof(100000) }, { state: xof(400000), parent: xof(100001) }, 0).status).toBe("DISCREPANCY");
  });

  it("la tolérance s'applique en valeur absolue, aux deux parts séparément", () => {
    const declared = { state: xof(400000), parent: xof(100000) };
    expect(reconcile(declared, { state: xof(400000), parent: xof(99500) }, 500).status).toBe("BALANCED");
    expect(reconcile(declared, { state: xof(400501), parent: xof(100000) }, 500).status).toBe("DISCREPANCY");
    expect(reconcile(declared, { state: xof(400500), parent: xof(100000) }, 500).status).toBe("BALANCED");
  });

  it("un montant déclaré absent compte pour 0 : tout ce qui est facturé est un écart (facture sans acte)", () => {
    const r = reconcile({ state: null, parent: xof(100000) }, { state: xof(250000), parent: xof(100000) }, 0);
    expect(r.stateDelta.amount).toBe(250000);
    expect(r.status).toBe("DISCREPANCY");
  });

  it("sans facture de l'État l'écart est le montant déclaré (négatif) ; la facture famille qui porte aussi la part de l'État se voit", () => {
    expect(reconcile({ state: xof(400000), parent: xof(100000) }, { state: xof(0), parent: xof(100000) }, 0).stateDelta.amount).toBe(-400000);
    // facture famille de 500 000 : la part de l'État n'a pas été séparée (la facture famille ne doit porter que la part parent)
    const r = reconcile({ state: xof(400000), parent: xof(100000) }, { state: xof(400000), parent: xof(500000) }, 0);
    expect(r.parentDelta.amount).toBe(400000);
    expect(r.status).toBe("DISCREPANCY");
  });

  it("facturé = déclaré + écart (aller-retour) ; deltaOf et billedFrom restent entiers", () => {
    const d = deltaOf(xof(400000), xof(399000));
    expect(d.amount).toBe(-1000);
    expect(billedFrom(xof(400000), d, "XOF")?.amount).toBe(399000);
    expect(billedFrom(null, xof(5), "XOF")?.amount).toBe(5);
    expect(billedFrom(xof(1), null, "XOF")).toBeNull();
  });
});

describe("affectation des versements de l'État aux échéances", () => {
  const schedule = [
    { id: "b", dueOn: "2027-03-01", seq: 2, expected: xof(150000), cancelled: false },
    { id: "a", dueOn: "2026-12-01", seq: 1, expected: xof(100000), cancelled: false },
    { id: "c", dueOn: "2027-06-01", seq: 3, expected: xof(100000), cancelled: false },
  ];

  it("l'échéance la plus ancienne est soldée d'abord, sans dépasser l'attendu ; le reste est non affecté", () => {
    const r = allocateReceived(schedule, xof(130000));
    expect(r.allocations.find((x) => x.id === "a")!.received.amount).toBe(100000);
    expect(r.allocations.find((x) => x.id === "b")!.received.amount).toBe(30000);
    expect(r.allocations.find((x) => x.id === "c")!.received.amount).toBe(0);
    expect(r.unallocated.amount).toBe(0);
    const over = allocateReceived(schedule, xof(400000));
    expect(over.allocations.map((x) => x.received.amount).reduce((s, n) => s + n, 0)).toBe(350000);
    expect(over.unallocated.amount).toBe(50000);
  });

  it("somme des affectations + non affecté = reçu, quels que soient le reçu et le calendrier (propriété)", () => {
    for (let received = 0; received <= 420000; received += 12345) {
      const r = allocateReceived(schedule, xof(received));
      const total = r.allocations.reduce((s, a) => s + a.received.amount, 0) + r.unallocated.amount;
      expect(total).toBe(received);
      for (const a of r.allocations) expect(a.received.amount).toBeLessThanOrEqual(schedule.find((s) => s.id === a.id)!.expected.amount);
    }
  });

  it("une échéance annulée ne reçoit rien ; un reçu négatif n'affecte rien", () => {
    const withCancelled = schedule.map((s) => (s.id === "a" ? { ...s, cancelled: true } : s));
    const r = allocateReceived(withCancelled, xof(100000));
    expect(r.allocations.find((x) => x.id === "a")!.received.amount).toBe(0);
    expect(r.allocations.find((x) => x.id === "b")!.received.amount).toBe(100000);
    expect(allocateReceived(schedule, xof(-5)).unallocated.amount).toBe(0);
  });

  it("le statut d'une échéance suit les montants", () => {
    expect(receivableStatusOf(xof(100), xof(0))).toBe("OPEN");
    expect(receivableStatusOf(xof(100), xof(40))).toBe("PARTIALLY_RECEIVED");
    expect(receivableStatusOf(xof(100), xof(100))).toBe("RECEIVED");
  });
});

describe("retards", () => {
  it("jours entiers entre deux dates civiles, sans décalage de fuseau", () => {
    expect(daysBetween("2026-12-01", "2026-12-31")).toBe(30);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("en retard au-delà de l'échéance + grâce ; jamais avant ; tranches d'ancienneté", () => {
    expect(daysOverdue("2026-12-01", "2026-12-01", 0)).toBe(0);
    expect(daysOverdue("2026-12-01", "2026-12-02", 0)).toBe(1);
    expect(daysOverdue("2026-12-01", "2026-12-10", 10)).toBe(0);
    expect(daysOverdue("2026-12-01", "2026-12-11", 10)).toBe(0);
    expect(daysOverdue("2026-12-01", "2026-12-12", 10)).toBe(1);
    expect(agingBucketOf(0)).toBe("NOT_DUE");
    expect(agingBucketOf(1)).toBe("D1_30");
    expect(agingBucketOf(30)).toBe("D1_30");
    expect(agingBucketOf(31)).toBe("D31_60");
    expect(agingBucketOf(61)).toBe("D61_90");
    expect(agingBucketOf(91)).toBe("D91_PLUS");
  });

  const base = (over: Partial<ReceivableRecord>): Pick<ReceivableRecord, "dueOn" | "expected" | "received" | "status"> => ({ dueOn: "2026-12-01", expected: xof(100000), received: xof(0), status: "OPEN", ...over });

  it("une échéance soldée ou annulée n'est jamais en retard ; le reste à recevoir est entier", () => {
    expect(viewReceivable(base({}), "2027-02-01", 0)).toMatchObject({ overdue: true, daysOverdue: 62, agingBucket: "D61_90" });
    expect(viewReceivable(base({ received: xof(100000), status: "RECEIVED" }), "2027-02-01", 0).overdue).toBe(false);
    expect(viewReceivable(base({ status: "CANCELLED" }), "2027-02-01", 0)).toMatchObject({ overdue: false, outstanding: { amount: 0 } });
    expect(viewReceivable(base({ received: xof(30000), status: "PARTIALLY_RECEIVED" }), "2026-12-05", 0).outstanding.amount).toBe(70000);
  });
});

describe("contrôles", () => {
  it("machine d'états : PENDING -> OK | ANOMALY | WAIVED ; ANOMALY -> OK seulement", () => {
    expect(CONTROL_TRANSITIONS.PENDING).toEqual(["OK", "ANOMALY", "WAIVED"]);
    expect(canTransitionControl("ANOMALY", "OK")).toBe(true);
    expect(canTransitionControl("OK", "ANOMALY")).toBe(false);
    expect(canTransitionControl("WAIVED", "OK")).toBe(false);
  });

  const periods = [
    { id: "p1", endsOn: "2026-12-20" },
    { id: "p2", endsOn: "2027-03-20" },
  ];

  it("aucun contrôle n'est planifié par défaut (aucune nature, ou aucun décalage)", () => {
    expect(planControls({ settings: { requiredControlKinds: [], controlDueOffsetDays: 15 }, verifiedOn: "2026-10-01", periods, existing: [], today: "2027-04-01" })).toEqual([]);
    expect(planControls({ settings: { requiredControlKinds: ["ATTENDANCE"], controlDueOffsetDays: null }, verifiedOn: "2026-10-01", periods, existing: [], today: "2027-04-01" })).toEqual([]);
  });

  it("planifie par période ÉCHUE pour la présence, une fois pour les autres natures ; ne recrée jamais l'existant", () => {
    const settings = { requiredControlKinds: ["ATTENDANCE", "IDENTITY"] as const, controlDueOffsetDays: 10 };
    const first = planControls({ settings: { ...settings, requiredControlKinds: [...settings.requiredControlKinds] }, verifiedOn: "2026-10-01", periods, existing: [], today: "2026-12-25" });
    expect(first).toEqual([
      { kind: "ATTENDANCE", academicPeriodId: "p1", dueOn: "2026-12-30" },
      { kind: "IDENTITY", academicPeriodId: null, dueOn: "2026-10-11" },
    ]);
    const later = planControls({ settings: { ...settings, requiredControlKinds: [...settings.requiredControlKinds] }, verifiedOn: "2026-10-01", periods, existing: first.map((c) => ({ kind: c.kind, academicPeriodId: c.academicPeriodId })), today: "2027-04-01" });
    expect(later).toEqual([{ kind: "ATTENDANCE", academicPeriodId: "p2", dueOn: "2027-03-30" }]);
  });
});

describe("exports : formats en données, anti-injection de formule", () => {
  it("neutralise les cellules texte qui commencent par = + - @ tab CR ; les nombres négatifs restent des nombres", () => {
    expect(csvCell("=SOMME(A1:A9)", ";")).toBe("'=SOMME(A1:A9)");
    expect(csvCell("+33 1 02", ";")).toBe("'+33 1 02");
    expect(csvCell("-1", ";")).toBe("'-1");
    expect(csvCell("@cmd", ";")).toBe("'@cmd");
    expect(csvCell("\tx", ";")).toBe("'\tx");
    expect(csvCell(-500, ";")).toBe("-500");
    expect(csvCell("normal", ";")).toBe("normal");
    expect(csvCell(null, ";")).toBe("");
    expect(csvCell(true, ";")).toBe("oui");
  });

  it("met entre guillemets les cellules qui contiennent le séparateur, un guillemet ou un saut de ligne", () => {
    expect(csvCell("a;b", ";")).toBe('"a;b"');
    expect(csvCell('dit "oui"', ";")).toBe('"dit ""oui"""');
    expect(csvCell("a\nb", ";")).toBe('"a\nb"');
    expect(csvCell("a;b", ",")).toBe("a;b");
  });

  it("une injection cachée dans une cellule entre guillemets est aussi neutralisée", () => {
    const csv = toCsv([{ key: "label", header: "=HYPERLINK(\"x\")" }], [{ label: '=1+1;"x"' }], { delimiter: ";", includeBom: false });
    const [header, row] = csv.trim().split("\r\n");
    expect(header!.startsWith("'=") || header!.startsWith("\"'=")).toBe(true);
    expect(row!.startsWith("\"'=")).toBe(true);
  });

  it("CSV : BOM au choix, CRLF, colonnes dans l'ordre du format", () => {
    const csv = toCsv([{ key: "b", header: "B" }, { key: "a", header: "A" }], [{ a: 1, b: "x" }, { a: 2, b: null }], { delimiter: ";", includeBom: true });
    expect(csv).toBe("﻿B;A\r\nx;1\r\n;2\r\n");
    expect(toCsv([{ key: "a", header: "A" }], [], { delimiter: ",", includeBom: false })).toBe("A\r\n");
  });

  it("le catalogue publie les colonnes de chaque jeu ; un format n'accepte que ces clés, sans doublon", () => {
    for (const dataset of ["ASSIGNMENTS", "RECEIVABLES", "CONTROLS"] as const) {
      expect(EXPORT_CATALOG[dataset].columns.length).toBeGreaterThan(5);
      expect(EXPORT_CATALOG[dataset].standardColumns.map((c) => c.key)).toEqual(EXPORT_CATALOG[dataset].columns.map((c) => c.key));
    }
    expect(validateColumns("ASSIGNMENTS", [{ key: "reference", header: " Réf " }])).toEqual([{ key: "reference", header: "Réf" }]);
    expect(() => validateColumns("ASSIGNMENTS", [{ key: "inconnue", header: "X" }])).toThrow(/n'existe pas/);
    expect(() => validateColumns("ASSIGNMENTS", [{ key: "reference", header: "A" }, { key: "reference", header: "B" }])).toThrow(/répétée/);
    expect(() => validateColumns("RECEIVABLES", [{ key: "reference", header: "A" }])).toThrow(/n'existe pas/);
  });
});
