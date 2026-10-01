import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { validateManualAllocations } from "../../domain/allocation";
import { validateCreditNote } from "../../domain/credit-note";
import { validateDiscountDraft } from "../../domain/discount";
import { validateFeeDraft } from "../../domain/fee";
import { generateInstallments, validatePlanSteps } from "../../domain/installments";
import { validateRefundRequest } from "../../domain/refund";
import { splitFunding, validateScholarshipDraft } from "../../domain/scholarship";
import { diffDays, nextMonthDayOnOrAfter, toUtcMs } from "../../domain/dates";
import { target, xof } from "../support/factories";

const eur = (n: number) => Money.of(n, "EUR");

describe("devises : aucune opération ne mélange XOF et EUR", () => {
  it("imputation manuelle", () => {
    const r = validateManualAllocations([{ installmentId: "i", amount: eur(10) }], new Map([["i", target({ id: "i", remaining: 100 })]]), xof(100));
    expect(!r.ok && r.error.code).toBe("finance.currency_mismatch");
  });
  it("avoir", () => {
    const r = validateCreditNote({ invoice: { status: "ISSUED", amounts: { total: xof(100), paid: xof(0), credited: xof(0) } }, amount: eur(10), reason: "motif valable" });
    expect(!r.ok && r.error.code).toBe("finance.currency_mismatch");
  });
  it("remboursement", () => {
    const r = validateRefundRequest({
      payment: { status: "CONFIRMED", amount: xof(100), allocated: xof(0), refunded: xof(0) },
      openRefunds: xof(0),
      amount: eur(10),
      reason: "motif valable",
    });
    expect(!r.ok && r.error.code).toBe("finance.currency_mismatch");
  });
  it("bourses sur des lignes de devises mixtes", () => {
    const r = splitFunding(
      [
        { id: "a", category: "TUITION", amount: xof(100) },
        { id: "b", category: "TUITION", amount: eur(100) },
      ],
      [],
    );
    expect(r.ok).toBe(false);
  });
  it("plan d'échéancier : montant fixe dans une autre devise", () => {
    const r = generateInstallments(xof(1_000), [{ label: "x", share: { kind: "FIXED", amount: eur(1_000) }, due: { type: "OFFSET_DAYS", days: 0 } }], "2025-09-01");
    expect(r.ok).toBe(false);
  });
});

describe("brouillons : validations de bord", () => {
  it("remise : plafond non positif, montant fixe + pourcentage mélangés", () => {
    expect(validateDiscountDraft({ code: "A", name: "A", kind: "PERCENT", bps: 100, capAmount: xof(0) }).ok).toBe(false);
    expect(validateDiscountDraft({ code: "A", name: "A", kind: "AMOUNT", amount: xof(5), bps: 100 }).ok).toBe(false);
    const ok = validateDiscountDraft({ code: "a", name: "A", kind: "PERCENT", bps: 100, categories: ["TUITION"], capAmount: xof(10), stackable: true });
    expect(ok.ok && ok.value).toMatchObject({ code: "A", categories: ["TUITION"], stackable: true });
  });
  it("bourse : plafond non positif, catégories vides = toutes", () => {
    const base = { learnerId: "l", academicYear: "2025-2026", funderKind: "STATE", funderName: "État", coverage: { kind: "PERCENT", bps: 100 } };
    expect(validateScholarshipDraft({ ...base, capAmount: xof(0) }).ok).toBe(false);
    const ok = validateScholarshipDraft({ ...base, categories: [], priority: 3, reference: "  AFF  " });
    expect(ok.ok && ok.value).toMatchObject({ categories: null, priority: 3, reference: "AFF" });
  });
  it("frais : libellé trop long, code trop long, devise connue", () => {
    expect(validateFeeDraft({ code: "A".repeat(41), name: "x", category: "TUITION" }).ok).toBe(false);
    expect(validateFeeDraft({ code: "A", name: "x".repeat(201), category: "TUITION" }).ok).toBe(false);
    const ok = validateFeeDraft({ code: "a", name: " Frais ", category: "TUITION", description: "  d  ", currency: "EUR" });
    expect(ok.ok && ok.value).toMatchObject({ code: "A", name: "Frais", description: "d", currency: "EUR" });
  });
  it("plan : trop d'étapes, type de part ou d'échéance inconnu, étape à décalage excessif", () => {
    const step = { label: "a", share: { kind: "WEIGHT" as const, weight: 1 }, due: { type: "OFFSET_DAYS" as const, days: 0 } };
    expect(validatePlanSteps(Array.from({ length: 61 }, () => step), "XOF").ok).toBe(false);
    expect(validatePlanSteps([{ ...step, share: { kind: "???" } as never }], "XOF").ok).toBe(false);
    expect(validatePlanSteps([{ ...step, due: { type: "???" } as never }], "XOF").ok).toBe(false);
    expect(validatePlanSteps([{ ...step, due: { type: "OFFSET_DAYS", days: 4000 } }], "XOF").ok).toBe(false);
    expect(validatePlanSteps([{ ...step, label: "x".repeat(121) }], "XOF").ok).toBe(false);
  });
});

describe("dates : bornes", () => {
  it("jours impossibles et mois invalides refusés", () => {
    expect(() => nextMonthDayOnOrAfter("2025-09-01", 13, 1)).toThrow();
    expect(() => nextMonthDayOnOrAfter("2025-09-01", 5, 0)).toThrow();
    expect(() => toUtcMs("2025-02-29")).toThrow();
    expect(diffDays("2024-02-28", "2024-03-01")).toBe(2); // année bissextile
    expect(diffDays("2025-02-28", "2025-03-01")).toBe(1);
  });
  it("le 31 d'un mois court est ramené au dernier jour", () => {
    expect(nextMonthDayOnOrAfter("2025-09-01", 4, 31)).toBe("2026-04-30");
    expect(nextMonthDayOnOrAfter("2025-09-01", 2, 31)).toBe("2026-02-28");
  });
});
