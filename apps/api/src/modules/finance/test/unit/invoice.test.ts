import { describe, expect, it } from "vitest";
import { Money, newId } from "@ecoledigitale/kernel";
import {
  INVOICE_TRANSITIONS,
  applyAdjustments,
  assertInvoiceTransition,
  buildInvoiceLines,
  canCancelInvoice,
  canIssueInvoice,
  canTransitionInvoice,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  invoiceBalance,
  nextInvoiceStatus,
  validateInvoiceAmounts,
  type InvoiceLineInput,
} from "../../domain/invoice";
import { INVOICE_STATUSES, FEE_CATEGORIES, type InvoiceStatus } from "../../domain/types";
import { xof } from "../support/factories";
import { forAll } from "../support/rng";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

const input = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  category: "TUITION",
  description: "Scolarité 2025-2026",
  quantity: 1,
  unitAmount: xof(500_000),
  ...over,
});

describe("buildInvoiceLines", () => {
  it("brut = quantité × prix unitaire ; total initial = brut", () => {
    const lines = unwrap(buildInvoiceLines([input({ quantity: 3, unitAmount: xof(15_000) })], newId, "XOF"));
    expect(lines[0]!.gross.amount).toBe(45_000);
    expect(lines[0]!.total.amount).toBe(45_000);
    expect(lines[0]!.position).toBe(1);
  });

  it.each([
    ["aucune ligne", []],
    ["quantité 0", [input({ quantity: 0 })]],
    ["quantité décimale", [input({ quantity: 1.5 })]],
    ["description vide", [input({ description: "  " })]],
    ["catégorie inconnue", [input({ category: "NOPE" as never })]],
    ["devise différente", [input({ unitAmount: Money.of(10, "EUR") })]],
    ["prix négatif", [input({ unitAmount: xof(-1) })]],
  ])("refuse : %s", (_n, lines) => {
    expect(buildInvoiceLines(lines as InvoiceLineInput[], newId, "XOF").ok).toBe(false);
  });

  it("applyAdjustments : total de ligne = brut − remise − bourse, jamais négatif", () => {
    const lines = unwrap(buildInvoiceLines([input({ unitAmount: xof(100_000) })], newId, "XOF"));
    const id = lines[0]!.id;
    const adjusted = unwrap(applyAdjustments(lines, new Map([[id, xof(10_000)]]), new Map([[id, xof(60_000)]])));
    expect(adjusted[0]!.total.amount).toBe(30_000);
    const tooMuch = applyAdjustments(lines, new Map([[id, xof(60_000)]]), new Map([[id, xof(60_000)]]));
    expect(tooMuch.ok).toBe(false);
  });

  it("PROPRIÉTÉ : total facture = Σ totaux de lignes = brut − remises − bourses", () => {
    forAll(500, (rng) => {
      const inputs = Array.from({ length: rng.int(1, 10) }, () =>
        input({ category: rng.pick(FEE_CATEGORIES), quantity: rng.int(1, 12), unitAmount: xof(rng.int(0, 400_000)) }),
      );
      const lines = unwrap(buildInvoiceLines(inputs, newId, "XOF"));
      const disc = new Map<string, Money>();
      const sch = new Map<string, Money>();
      for (const l of lines) {
        const d = rng.int(0, l.gross.amount);
        const s = rng.int(0, l.gross.amount - d);
        disc.set(l.id, xof(d));
        sch.set(l.id, xof(s));
      }
      const adjusted = unwrap(applyAdjustments(lines, disc, sch));
      const t = computeInvoiceTotals(adjusted, "XOF");
      expect(t.total.amount).toBe(adjusted.reduce((a, l) => a + l.total.amount, 0));
      expect(t.total.amount).toBe(t.subtotal.amount - t.discount.amount - t.scholarship.amount);
      expect(adjusted.every((l) => !l.total.isNegative())).toBe(true);
    });
  });
});

describe("machine d'états des factures", () => {
  it("exemple légal : DRAFT→ISSUED→PARTIALLY_PAID→PAID", () => {
    let s: InvoiceStatus = "DRAFT";
    for (const next of ["ISSUED", "PARTIALLY_PAID", "PAID"] as const) {
      s = unwrap(assertInvoiceTransition(s, next));
    }
    expect(s).toBe("PAID");
  });

  it("matrice exhaustive : toute paire (from, to) est refusée sauf celles de la table", () => {
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        const allowed = INVOICE_TRANSITIONS[from].includes(to);
        expect(canTransitionInvoice(from, to), `${from} → ${to}`).toBe(allowed);
        const r = assertInvoiceTransition(from, to);
        expect(r.ok, `${from} → ${to}`).toBe(allowed);
        if (!r.ok) expect(r.error.code).toBe("finance.invalid_transition");
      }
    }
  });

  it("CANCELLED et CREDITED sont terminaux ; DRAFT ne saute pas à PAID", () => {
    expect(INVOICE_TRANSITIONS.CANCELLED).toEqual([]);
    expect(INVOICE_TRANSITIONS.CREDITED).toEqual([]);
    expect(canTransitionInvoice("DRAFT", "PAID")).toBe(false);
    expect(canTransitionInvoice("PAID", "CANCELLED")).toBe(false);
    expect(canTransitionInvoice("PARTIALLY_PAID", "CANCELLED")).toBe(false);
  });
});

describe("deriveInvoiceStatus", () => {
  const inst = (due: string, amount: number, paid = 0, credited = 0) => ({ dueDate: due, amount: xof(amount), paid: xof(paid), credited: xof(credited) });
  const amounts = (total: number, paid = 0, credited = 0) => ({ total: xof(total), paid: xof(paid), credited: xof(credited) });
  const base = { today: "2026-02-01" };

  it("ISSUED tant que rien n'est payé et rien n'est échu", () => {
    expect(deriveInvoiceStatus({ ...base, current: "ISSUED", amounts: amounts(100), installments: [inst("2026-03-01", 100)] })).toBe("ISSUED");
  });
  it("PARTIALLY_PAID dès le premier encaissement non échu", () => {
    expect(deriveInvoiceStatus({ ...base, current: "ISSUED", amounts: amounts(100, 30), installments: [inst("2026-03-01", 100, 30)] })).toBe("PARTIALLY_PAID");
  });
  it("OVERDUE si une échéance échue a un reste, même avec un paiement partiel", () => {
    expect(
      deriveInvoiceStatus({ ...base, current: "PARTIALLY_PAID", amounts: amounts(200, 100), installments: [inst("2026-01-15", 100, 50), inst("2026-04-01", 100, 50)] }),
    ).toBe("OVERDUE");
  });
  it("redevient non-OVERDUE quand l'échéance échue est payée", () => {
    expect(
      deriveInvoiceStatus({ ...base, current: "OVERDUE", amounts: amounts(200, 100), installments: [inst("2026-01-15", 100, 100), inst("2026-04-01", 100, 0)] }),
    ).toBe("PARTIALLY_PAID");
  });
  it("PAID quand le reste est nul, y compris avec un avoir partiel", () => {
    expect(deriveInvoiceStatus({ ...base, current: "ISSUED", amounts: amounts(100, 100), installments: [inst("2026-01-01", 100, 100)] })).toBe("PAID");
    expect(deriveInvoiceStatus({ ...base, current: "ISSUED", amounts: amounts(100, 60, 40), installments: [inst("2026-01-01", 100, 60, 40)] })).toBe("PAID");
  });
  it("CREDITED quand l'avoir couvre tout et que rien n'est encaissé net", () => {
    expect(deriveInvoiceStatus({ ...base, current: "ISSUED", amounts: amounts(100, 0, 100), installments: [inst("2026-01-01", 100, 0, 100)] })).toBe("CREDITED");
  });
  it("DRAFT et CANCELLED ne sont jamais dérivés", () => {
    expect(deriveInvoiceStatus({ ...base, current: "DRAFT", amounts: amounts(100, 100), installments: [] })).toBe("DRAFT");
    expect(deriveInvoiceStatus({ ...base, current: "CANCELLED", amounts: amounts(100), installments: [] })).toBe("CANCELLED");
  });
  it("un remboursement total d'une facture PAID la ramène à ISSUED / OVERDUE", () => {
    expect(deriveInvoiceStatus({ ...base, current: "PAID", amounts: amounts(100, 0), installments: [inst("2026-03-01", 100)] })).toBe("ISSUED");
    expect(deriveInvoiceStatus({ ...base, current: "PAID", amounts: amounts(100, 0), installments: [inst("2026-01-01", 100)] })).toBe("OVERDUE");
  });
  it("nextInvoiceStatus refuse une dérivation illégale (incohérence)", () => {
    // CREDITED → PAID n'existe pas : si les données le suggéraient, on le signale.
    const r = nextInvoiceStatus({ ...base, current: "CREDITED", amounts: amounts(100, 100), installments: [inst("2026-01-01", 100, 100)] });
    expect(r.ok).toBe(false);
    expect(nextInvoiceStatus({ ...base, current: "ISSUED", amounts: amounts(100, 100), installments: [inst("2026-01-01", 100, 100)] }).ok).toBe(true);
  });
});

describe("règles d'annulation, d'émission, montants", () => {
  it("annulation : seulement sans encaissement ni avoir", () => {
    expect(canCancelInvoice({ status: "ISSUED", amounts: { total: xof(10), paid: xof(0), credited: xof(0) } }).ok).toBe(true);
    expect(canCancelInvoice({ status: "DRAFT", amounts: { total: xof(10), paid: xof(0), credited: xof(0) } }).ok).toBe(true);
    const paid = canCancelInvoice({ status: "OVERDUE", amounts: { total: xof(10), paid: xof(1), credited: xof(0) } });
    expect(paid.ok).toBe(false);
    if (!paid.ok) expect(paid.error.code).toBe("finance.invoice_has_payments");
    expect(canCancelInvoice({ status: "ISSUED", amounts: { total: xof(10), paid: xof(0), credited: xof(1) } }).ok).toBe(false);
    expect(canCancelInvoice({ status: "PAID", amounts: { total: xof(10), paid: xof(10), credited: xof(0) } }).ok).toBe(false);
  });

  it("émission : brouillon avec lignes et total > 0", () => {
    expect(canIssueInvoice({ status: "DRAFT", total: xof(1), lineCount: 1 }).ok).toBe(true);
    expect(canIssueInvoice({ status: "ISSUED", total: xof(1), lineCount: 1 }).ok).toBe(false);
    expect(canIssueInvoice({ status: "DRAFT", total: xof(0), lineCount: 1 }).ok).toBe(false);
    expect(canIssueInvoice({ status: "DRAFT", total: xof(1), lineCount: 0 }).ok).toBe(false);
  });

  it("montants : payé + crédité ≤ total, aucun négatif ; reste dû", () => {
    expect(validateInvoiceAmounts({ total: xof(100), paid: xof(60), credited: xof(40) }).ok).toBe(true);
    expect(validateInvoiceAmounts({ total: xof(100), paid: xof(61), credited: xof(40) }).ok).toBe(false);
    expect(validateInvoiceAmounts({ total: xof(100), paid: xof(-1), credited: xof(0) }).ok).toBe(false);
    expect(invoiceBalance({ total: xof(100), paid: xof(60), credited: xof(10) }).amount).toBe(30);
  });
});
