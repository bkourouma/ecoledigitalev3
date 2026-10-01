import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import {
  daysOverdue,
  distributeCredit,
  generateInstallments,
  installmentRemaining,
  installmentStatus,
  resolveDueDate,
  singleInstallment,
  validateInstallmentsSum,
  validatePlanSteps,
  type PlanStep,
} from "../../domain/installments";
import { installment, xof } from "../support/factories";
import { forAll } from "../support/rng";

const PRD_PLAN: PlanStep[] = [
  { label: "Inscription", share: { kind: "WEIGHT", weight: 100 }, due: { type: "OFFSET_DAYS", days: 0 } },
  { label: "1re tranche", share: { kind: "WEIGHT", weight: 150 }, due: { type: "MONTH_DAY", month: 10, day: 15 } },
  { label: "2e tranche", share: { kind: "WEIGHT", weight: 150 }, due: { type: "MONTH_DAY", month: 1, day: 15 } },
  { label: "3e tranche", share: { kind: "WEIGHT", weight: 100 }, due: { type: "MONTH_DAY", month: 3, day: 15 } },
];

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

describe("generateInstallments — exemple du PRD §32", () => {
  it("500 000 = 100 000 + 150 000 + 150 000 + 100 000, dates 15/10, 15/01, 15/03", () => {
    const out = unwrap(generateInstallments(xof(500_000), PRD_PLAN, "2025-09-01"));
    expect(out.map((i) => i.amount.amount)).toEqual([100_000, 150_000, 150_000, 100_000]);
    expect(out.map((i) => i.dueDate)).toEqual(["2025-09-01", "2025-10-15", "2026-01-15", "2026-03-15"]);
    expect(out.map((i) => i.seq)).toEqual([1, 2, 3, 4]);
    expect(out.map((i) => i.label)).toEqual(["Inscription", "1re tranche", "2e tranche", "3e tranche"]);
  });

  it("la même chose avec des montants fixes", () => {
    const steps: PlanStep[] = [
      { label: "Inscription", share: { kind: "FIXED", amount: xof(100_000) }, due: { type: "DATE", date: "2025-09-01" } },
      { label: "T1", share: { kind: "FIXED", amount: xof(150_000) }, due: { type: "DATE", date: "2025-10-15" } },
      { label: "T2", share: { kind: "FIXED", amount: xof(150_000) }, due: { type: "DATE", date: "2026-01-15" } },
      { label: "T3", share: { kind: "FIXED", amount: xof(100_000) }, due: { type: "DATE", date: "2026-03-15" } },
    ];
    const out = unwrap(generateInstallments(xof(500_000), steps, "2025-09-01"));
    expect(out.map((i) => i.amount.amount)).toEqual([100_000, 150_000, 150_000, 100_000]);
  });

  it("mixte : l'inscription est fixe, le reste est réparti en deux moitiés", () => {
    const steps: PlanStep[] = [
      { label: "Inscription", share: { kind: "FIXED", amount: xof(100_000) }, due: { type: "OFFSET_DAYS", days: 0 } },
      { label: "Moitié 1", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 60 } },
      { label: "Moitié 2", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 120 } },
    ];
    const out = unwrap(generateInstallments(xof(500_001), steps, "2025-09-01"));
    // reste 400 001 → 200 001 + 200 000 (l'unité en trop va à la première part)
    expect(out.map((i) => i.amount.amount)).toEqual([100_000, 200_001, 200_000]);
    expect(out.reduce((a, i) => a + i.amount.amount, 0)).toBe(500_001);
  });

  it("répartit sans perte un total indivisible (100 000 en 3)", () => {
    const steps: PlanStep[] = ["A", "B", "C"].map((label, k) => ({
      label,
      share: { kind: "WEIGHT" as const, weight: 1 },
      due: { type: "OFFSET_DAYS" as const, days: k * 30 },
    }));
    const out = unwrap(generateInstallments(xof(100_000), steps, "2025-09-01"));
    expect(out.map((i) => i.amount.amount)).toEqual([33_334, 33_333, 33_333]);
  });

  it("trie par date d'échéance, numérote 1..n", () => {
    const steps: PlanStep[] = [
      { label: "Tard", share: { kind: "WEIGHT", weight: 1 }, due: { type: "DATE", date: "2026-06-01" } },
      { label: "Tôt", share: { kind: "WEIGHT", weight: 1 }, due: { type: "DATE", date: "2025-10-01" } },
    ];
    const out = unwrap(generateInstallments(xof(10_000), steps, "2025-09-01"));
    expect(out.map((i) => [i.seq, i.label])).toEqual([
      [1, "Tôt"],
      [2, "Tard"],
    ]);
  });

  it("écarte les étapes à montant nul (poids sur un reste de 0)", () => {
    const steps: PlanStep[] = [
      { label: "Tout", share: { kind: "FIXED", amount: xof(1_000) }, due: { type: "OFFSET_DAYS", days: 0 } },
      { label: "Rien", share: { kind: "WEIGHT", weight: 3 }, due: { type: "OFFSET_DAYS", days: 10 } },
    ];
    const out = unwrap(generateInstallments(xof(1_000), steps, "2025-09-01"));
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Tout");
  });

  it.each([
    ["total nul", xof(0), PRD_PLAN],
    [
      "montants fixes > total",
      xof(100),
      [{ label: "x", share: { kind: "FIXED", amount: xof(200) }, due: { type: "OFFSET_DAYS", days: 0 } }] as PlanStep[],
    ],
    [
      "plan fixe qui ne couvre pas le total",
      xof(1_000),
      [{ label: "x", share: { kind: "FIXED", amount: xof(200) }, due: { type: "OFFSET_DAYS", days: 0 } }] as PlanStep[],
    ],
    ["plan vide", xof(1_000), [] as PlanStep[]],
  ])("refuse : %s", (_name, total, steps) => {
    const r = generateInstallments(total, steps, "2025-09-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.installment_plan_invalid");
  });

  it("propriété : la somme des échéances égale TOUJOURS le total, aucune échéance ≤ 0", () => {
    forAll(500, (rng) => {
      const total = xof(rng.int(1, 5_000_000));
      const n = rng.int(1, 8);
      const useFixed = rng.bool(0.4);
      let fixedBudget = rng.int(0, total.amount - 1);
      const steps: PlanStep[] = [];
      for (let k = 0; k < n; k++) {
        if (useFixed && fixedBudget > 0 && rng.bool(0.5)) {
          const amount = rng.int(1, fixedBudget);
          fixedBudget -= amount;
          steps.push({ label: `F${k}`, share: { kind: "FIXED", amount: xof(amount) }, due: { type: "OFFSET_DAYS", days: rng.int(0, 400) } });
        } else {
          steps.push({ label: `W${k}`, share: { kind: "WEIGHT", weight: rng.int(1, 500) }, due: { type: "OFFSET_DAYS", days: rng.int(0, 400) } });
        }
      }
      // garantit une étape à poids pour couvrir le reste
      if (!steps.some((s) => s.share.kind === "WEIGHT")) {
        steps.push({ label: "Solde", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 500 } });
      }
      const r = generateInstallments(total, steps, "2025-09-01");
      if (!r.ok) {
        // seul échec admissible : montants fixes > total (jamais produit ici) ou aucune échéance
        throw r.error;
      }
      expect(r.value.reduce((a, i) => a + i.amount.amount, 0)).toBe(total.amount);
      expect(r.value.every((i) => i.amount.isPositive())).toBe(true);
      expect(r.value.map((i) => i.dueDate)).toEqual([...r.value.map((i) => i.dueDate)].sort());
    });
  });
});

describe("resolveDueDate", () => {
  it("DATE absolue, décalage en jours, jour/mois suivant", () => {
    expect(resolveDueDate({ type: "DATE", date: "2026-02-01" }, "2025-09-01")).toBe("2026-02-01");
    expect(resolveDueDate({ type: "OFFSET_DAYS", days: 30 }, "2025-09-01")).toBe("2025-10-01");
    expect(resolveDueDate({ type: "MONTH_DAY", month: 10, day: 15 }, "2025-09-01")).toBe("2025-10-15");
    expect(resolveDueDate({ type: "MONTH_DAY", month: 1, day: 15 }, "2025-09-01")).toBe("2026-01-15");
    expect(resolveDueDate({ type: "MONTH_DAY", month: 9, day: 1 }, "2025-09-01")).toBe("2025-09-01");
    expect(resolveDueDate({ type: "MONTH_DAY", month: 8, day: 31 }, "2025-09-01")).toBe("2026-08-31");
  });

  it("ramène le 29 février au 28 les années non bissextiles", () => {
    expect(resolveDueDate({ type: "MONTH_DAY", month: 2, day: 29 }, "2025-09-01")).toBe("2026-02-28");
    expect(resolveDueDate({ type: "MONTH_DAY", month: 2, day: 29 }, "2027-09-01")).toBe("2028-02-29");
  });
});

describe("validatePlanSteps", () => {
  const ok: PlanStep = { label: "a", share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 0 } };
  it("accepte un plan valide", () => expect(validatePlanSteps([ok], "XOF").ok).toBe(true));
  it.each([
    ["poids 0", { ...ok, share: { kind: "WEIGHT", weight: 0 } }],
    ["poids décimal", { ...ok, share: { kind: "WEIGHT", weight: 1.5 } }],
    ["montant fixe nul", { ...ok, share: { kind: "FIXED", amount: xof(0) } }],
    ["devise différente", { ...ok, share: { kind: "FIXED", amount: Money.of(100, "EUR") } }],
    ["libellé vide", { ...ok, label: "  " }],
    ["décalage négatif", { ...ok, due: { type: "OFFSET_DAYS", days: -1 } }],
    ["mois 13", { ...ok, due: { type: "MONTH_DAY", month: 13, day: 1 } }],
    ["date invalide", { ...ok, due: { type: "DATE", date: "2026-02-30" } }],
  ] as Array<[string, PlanStep]>)("refuse : %s", (_n, step) => {
    expect(validatePlanSteps([step], "XOF").ok).toBe(false);
  });
});

describe("échéance : statut, retard, reste", () => {
  const today = "2026-02-01";
  it("PENDING, PARTIALLY_PAID, PAID, OVERDUE, CREDITED", () => {
    expect(installmentStatus(installment({ dueDate: "2026-03-01" }), today)).toBe("PENDING");
    expect(installmentStatus(installment({ dueDate: "2026-03-01", paid: 10 }), today)).toBe("PARTIALLY_PAID");
    expect(installmentStatus(installment({ dueDate: "2026-03-01", paid: 100_000 }), today)).toBe("PAID");
    expect(installmentStatus(installment({ dueDate: "2026-01-31" }), today)).toBe("OVERDUE");
    expect(installmentStatus(installment({ dueDate: "2026-01-31", paid: 10 }), today)).toBe("OVERDUE");
    expect(installmentStatus(installment({ dueDate: "2026-01-31", paid: 100_000 }), today)).toBe("PAID");
    expect(installmentStatus(installment({ dueDate: "2026-01-31", credited: 100_000 }), today)).toBe("CREDITED");
  });
  it("le jour même de l'échéance n'est pas en retard", () => {
    expect(installmentStatus(installment({ dueDate: today }), today)).toBe("PENDING");
    expect(daysOverdue(installment({ dueDate: today }), today)).toBe(0);
  });
  it("jours de retard", () => {
    expect(daysOverdue(installment({ dueDate: "2026-01-22" }), today)).toBe(10);
    expect(daysOverdue(installment({ dueDate: "2026-01-22", paid: 100_000 }), today)).toBe(0);
  });
  it("reste = montant − payé − crédité", () => {
    expect(installmentRemaining(installment({ amount: 100, paid: 30, credited: 20 })).amount).toBe(50);
  });
});

describe("échéance unique et somme", () => {
  it("échéance unique = tout le total", () => {
    const [i] = singleInstallment(xof(42_000), "2026-01-01");
    expect(i!.amount.amount).toBe(42_000);
    expect(i!.seq).toBe(1);
  });
  it("validateInstallmentsSum", () => {
    expect(validateInstallmentsSum(xof(300), [{ amount: xof(100) }, { amount: xof(200) }]).ok).toBe(true);
    const bad = validateInstallmentsSum(xof(300), [{ amount: xof(100) }, { amount: xof(199) }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("finance.installments_sum_mismatch");
  });
});

describe("distributeCredit — avoir réparti sur les échéances les plus tardives", () => {
  const a = installment({ id: "a", seq: 1, dueDate: "2025-10-01", amount: 100_000, paid: 100_000 });
  const b = installment({ id: "b", seq: 2, dueDate: "2026-01-01", amount: 100_000, paid: 40_000 });
  const c = installment({ id: "c", seq: 3, dueDate: "2026-03-01", amount: 100_000 });

  it("commence par la dernière échéance et déborde sur la précédente", () => {
    const r = distributeCredit([a, b, c], xof(130_000));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((x) => [x.installmentId, x.amount.amount])).toEqual([["c", 100_000], ["b", 30_000]]);
  });
  it("ne touche jamais une échéance soldée", () => {
    const r = distributeCredit([a, b, c], xof(160_000));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.find((x) => x.installmentId === "a")).toBeUndefined();
  });
  it("refuse un avoir supérieur au reste dû total (160 000 + 1)", () => {
    const r = distributeCredit([a, b, c], xof(160_001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.credit_exceeds_balance");
  });
});
