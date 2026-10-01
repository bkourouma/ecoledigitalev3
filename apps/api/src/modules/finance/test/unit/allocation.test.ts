import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import {
  planAutoAllocation,
  planReversals,
  splitRefund,
  validateManualAllocations,
  type AllocationRecord,
  type AllocationTarget,
} from "../../domain/allocation";
import { ALLOCATION_ORDERS, type AllocationOrder } from "../../domain/types";
import { target, xof } from "../support/factories";
import { forAll } from "../support/rng";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

const three = (): AllocationTarget[] => [
  target({ id: "i3", dueDate: "2026-03-15", seq: 3, remaining: 100_000 }),
  target({ id: "i1", dueDate: "2025-10-15", seq: 1, remaining: 150_000 }),
  target({ id: "i2", dueDate: "2026-01-15", seq: 2, remaining: 150_000 }),
];

describe("planAutoAllocation — plus ancienne échéance d'abord (défaut)", () => {
  it("impute dans l'ordre des dates et s'arrête quand le paiement est épuisé", () => {
    const plan = unwrap(planAutoAllocation(xof(200_000), three(), "OLDEST_DUE_FIRST"));
    expect(plan.allocations.map((a) => [a.installmentId, a.amount.amount])).toEqual([
      ["i1", 150_000],
      ["i2", 50_000],
    ]);
    expect(plan.allocated.amount).toBe(200_000);
    expect(plan.unallocated.amount).toBe(0);
  });

  it("un paiement supérieur au dû laisse un non-imputé (jamais de sur-imputation)", () => {
    const plan = unwrap(planAutoAllocation(xof(500_000), three(), "OLDEST_DUE_FIRST"));
    expect(plan.allocated.amount).toBe(400_000);
    expect(plan.unallocated.amount).toBe(100_000);
  });

  it("aucune cible ouverte : tout reste non imputé", () => {
    const plan = unwrap(planAutoAllocation(xof(10_000), [target({ remaining: 0 })], "OLDEST_DUE_FIRST"));
    expect(plan.allocations).toEqual([]);
    expect(plan.unallocated.amount).toBe(10_000);
  });

  it("départage deux échéances de même date par émission de la facture, puis rang", () => {
    const t = [
      target({ id: "late", dueDate: "2026-01-01", issuedAt: "2025-10-02T00:00:00.000Z", remaining: 10 }),
      target({ id: "early", dueDate: "2026-01-01", issuedAt: "2025-10-01T00:00:00.000Z", remaining: 10 }),
    ];
    const plan = unwrap(planAutoAllocation(xof(10), t, "OLDEST_DUE_FIRST"));
    expect(plan.allocations.map((a) => a.installmentId)).toEqual(["early"]);
  });

  it("ordres configurables", () => {
    const newest = unwrap(planAutoAllocation(xof(100_000), three(), "NEWEST_DUE_FIRST"));
    expect(newest.allocations.map((a) => a.installmentId)).toEqual(["i3"]);
    const smallest = unwrap(planAutoAllocation(xof(120_000), three(), "SMALLEST_REMAINING_FIRST"));
    expect(smallest.allocations.map((a) => [a.installmentId, a.amount.amount])).toEqual([
      ["i3", 100_000],
      ["i1", 20_000],
    ]);
    const largest = unwrap(planAutoAllocation(xof(160_000), three(), "LARGEST_REMAINING_FIRST"));
    expect(largest.allocations.map((a) => [a.installmentId, a.amount.amount])).toEqual([
      ["i1", 150_000],
      ["i2", 10_000],
    ]);
  });

  it("PROPORTIONAL répartit au prorata sans perte", () => {
    const plan = unwrap(planAutoAllocation(xof(100_000), three(), "PROPORTIONAL"));
    expect(plan.allocated.amount).toBe(100_000);
    // 100 000 × (100 / 150 / 150 sur 400) = 25 000 / 37 500 / 37 500
    const byId = Object.fromEntries(plan.allocations.map((a) => [a.installmentId, a.amount.amount]));
    expect(byId).toEqual({ i3: 25_000, i1: 37_500, i2: 37_500 });
  });

  it("refuse un montant nul/négatif et une devise différente", () => {
    expect(planAutoAllocation(xof(0), three(), "OLDEST_DUE_FIRST").ok).toBe(false);
    const eur = { ...target({ remaining: 10 }), remaining: Money.of(10, "EUR") };
    const r = planAutoAllocation(xof(10), [eur], "OLDEST_DUE_FIRST");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.currency_mismatch");
  });

  it("PROPRIÉTÉS (tous ordres) : Σ imputations ≤ paiement, chaque part ≤ reste, rien de négatif, imputé + non imputé = paiement", () => {
    forAll(800, (rng) => {
      const n = rng.int(0, 12);
      const targets = Array.from({ length: n }, (_, k) =>
        target({
          id: `t${k}`,
          dueDate: `2026-0${rng.int(1, 9)}-${String(rng.int(10, 28))}`,
          seq: k + 1,
          remaining: rng.int(0, 400_000),
        }),
      );
      const amount = xof(rng.int(1, 3_000_000));
      const order: AllocationOrder = rng.pick(ALLOCATION_ORDERS);
      const plan = unwrap(planAutoAllocation(amount, targets, order));
      const sum = plan.allocations.reduce((a, x) => a + x.amount.amount, 0);
      expect(sum).toBeLessThanOrEqual(amount.amount);
      expect(sum + plan.unallocated.amount).toBe(amount.amount);
      expect(plan.allocated.amount).toBe(sum);
      const remaining = new Map(targets.map((t) => [t.installmentId, t.remaining.amount]));
      for (const a of plan.allocations) {
        expect(a.amount.amount).toBeGreaterThan(0);
        expect(a.amount.amount).toBeLessThanOrEqual(remaining.get(a.installmentId)!);
      }
      // optimalité : si du non-imputé subsiste, TOUT le dû ouvert a été imputé
      if (plan.unallocated.isPositive()) {
        expect(sum).toBe(targets.reduce((a, t) => a + t.remaining.amount, 0));
      }
      // une échéance n'apparaît qu'une fois
      expect(new Set(plan.allocations.map((a) => a.installmentId)).size).toBe(plan.allocations.length);
    });
  });
});

describe("validateManualAllocations", () => {
  const map = (ts: AllocationTarget[]) => new Map(ts.map((t) => [t.installmentId, t]));

  it("accepte une imputation conforme et calcule le non-imputé", () => {
    const plan = unwrap(
      validateManualAllocations(
        [
          { installmentId: "i1", amount: xof(100_000) },
          { installmentId: "i3", amount: xof(20_000) },
        ],
        map(three()),
        xof(150_000),
      ),
    );
    expect(plan.allocated.amount).toBe(120_000);
    expect(plan.unallocated.amount).toBe(30_000);
  });

  it("refuse le dépassement du reste d'une échéance (y compris en cumulant deux lignes)", () => {
    const r = validateManualAllocations(
      [
        { installmentId: "i3", amount: xof(60_000) },
        { installmentId: "i3", amount: xof(60_000) },
      ],
      map(three()),
      xof(1_000_000),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.allocation_exceeds_remaining");
  });

  it("refuse le dépassement du paiement", () => {
    const r = validateManualAllocations([{ installmentId: "i1", amount: xof(100_000) }], map(three()), xof(99_999));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.allocation_exceeds_payment");
  });

  it("refuse une échéance inconnue, un montant nul/négatif, une liste vide", () => {
    const m = map(three());
    const unknown = validateManualAllocations([{ installmentId: "zzz", amount: xof(1) }], m, xof(10));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("finance.allocation_invalid_target");
    expect(validateManualAllocations([{ installmentId: "i1", amount: xof(0) }], m, xof(10)).ok).toBe(false);
    expect(validateManualAllocations([], m, xof(10)).ok).toBe(false);
  });
});

describe("remboursement : reprise des imputations", () => {
  const records: AllocationRecord[] = [
    { id: "a1", invoiceId: "inv", installmentId: "i1", net: xof(150_000), dueDate: "2025-10-15", createdAt: "2025-10-01T10:00:00.000Z" },
    { id: "a2", invoiceId: "inv", installmentId: "i2", net: xof(50_000), dueDate: "2026-01-15", createdAt: "2025-10-01T10:00:01.000Z" },
    { id: "a3", invoiceId: "inv", installmentId: "i3", net: xof(0), dueDate: "2026-03-15", createdAt: "2025-10-01T10:00:02.000Z" },
  ];

  it("splitRefund prélève d'abord le non imputé", () => {
    expect(splitRefund(xof(30_000), xof(100_000))).toMatchObject({ fromUnallocated: xof(30_000), fromAllocations: xof(0) });
    const s = splitRefund(xof(130_000), xof(100_000));
    expect(s.fromUnallocated.amount).toBe(100_000);
    expect(s.fromAllocations.amount).toBe(30_000);
  });

  it("LATEST_DUE_FIRST reprend d'abord la dernière échéance payée", () => {
    const r = unwrap(planReversals(records, xof(60_000), "LATEST_DUE_FIRST"));
    expect(r.map((x) => [x.allocationId, x.amount.amount])).toEqual([["a2", 50_000], ["a1", 10_000]]);
  });

  it("EARLIEST_DUE_FIRST et MOST_RECENT_FIRST", () => {
    const e = unwrap(planReversals(records, xof(160_000), "EARLIEST_DUE_FIRST"));
    expect(e.map((x) => [x.allocationId, x.amount.amount])).toEqual([["a1", 150_000], ["a2", 10_000]]);
    const m = unwrap(planReversals(records, xof(10), "MOST_RECENT_FIRST"));
    expect(m.map((x) => x.allocationId)).toEqual(["a2"]);
  });

  it("refuse de reprendre plus que l'imputé net", () => {
    const r = planReversals(records, xof(200_001), "LATEST_DUE_FIRST");
    expect(r.ok).toBe(false);
  });

  it("montant nul : aucune reprise", () => {
    expect(unwrap(planReversals(records, xof(0)))).toEqual([]);
  });

  it("PROPRIÉTÉ : Σ reprises = montant, chaque reprise ≤ net de l'imputation", () => {
    forAll(300, (rng) => {
      const recs: AllocationRecord[] = Array.from({ length: rng.int(1, 8) }, (_, k) => ({
        id: `r${k}`,
        invoiceId: "inv",
        installmentId: `i${k}`,
        net: xof(rng.int(0, 200_000)),
        dueDate: `2026-0${rng.int(1, 9)}-15`,
        createdAt: `2026-01-0${rng.int(1, 9)}T00:00:00.000Z`,
      }));
      const total = recs.reduce((a, r) => a + r.net.amount, 0);
      const amount = xof(rng.int(0, total));
      const out = unwrap(planReversals(recs, amount, rng.pick(["LATEST_DUE_FIRST", "EARLIEST_DUE_FIRST", "MOST_RECENT_FIRST"] as const)));
      expect(out.reduce((a, x) => a + x.amount.amount, 0)).toBe(amount.amount);
      const net = new Map(recs.map((r) => [r.id, r.net.amount]));
      for (const x of out) {
        expect(x.amount.amount).toBeGreaterThan(0);
        expect(x.amount.amount).toBeLessThanOrEqual(net.get(x.allocationId)!);
      }
    });
  });
});
