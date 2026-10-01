import { describe, expect, it } from "vitest";
import {
  PAYMENT_TRANSITIONS,
  assertPaymentTransition,
  canTransitionPayment,
  idempotencyConflict,
  paymentFingerprint,
  refundableAmount,
  statusAfterRefund,
  unallocatedAmount,
  validateIdempotencyKey,
  validateManualPaymentRules,
  validatePaymentAmounts,
} from "../../domain/payment";
import {
  REFUND_TRANSITIONS,
  assertRefundTransition,
  canTransitionRefund,
  validateReason,
  validateRefundApproval,
  validateRefundRequest,
} from "../../domain/refund";
import { validateCreditNote } from "../../domain/credit-note";
import { PAYMENT_STATUSES, REFUND_STATUSES } from "../../domain/types";
import { xof } from "../support/factories";
import { forAll } from "../support/rng";

const pay = (amount: number, allocated = 0, refunded = 0) => ({ amount: xof(amount), allocated: xof(allocated), refunded: xof(refunded) });

describe("machine d'états des paiements", () => {
  it("matrice exhaustive", () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        const allowed = PAYMENT_TRANSITIONS[from].includes(to);
        expect(canTransitionPayment(from, to), `${from}→${to}`).toBe(allowed);
        expect(assertPaymentTransition(from, to).ok).toBe(allowed);
      }
    }
  });
  it("transitions attendues", () => {
    expect(canTransitionPayment("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransitionPayment("PENDING", "FAILED")).toBe(true);
    expect(canTransitionPayment("CONFIRMED", "REFUNDED")).toBe(true);
    expect(canTransitionPayment("CONFIRMED", "PENDING")).toBe(false);
    expect(canTransitionPayment("FAILED", "CONFIRMED")).toBe(false);
    expect(canTransitionPayment("REFUNDED", "CONFIRMED")).toBe(false);
    expect(canTransitionPayment("PENDING", "REFUNDED")).toBe(false);
  });
});

describe("montants d'un paiement", () => {
  it("non imputé = montant − imputé − remboursé", () => {
    expect(unallocatedAmount(pay(100_000, 60_000, 10_000)).amount).toBe(30_000);
  });
  it("remboursable = montant − remboursé − demandes ouvertes (borné à 0)", () => {
    expect(refundableAmount(pay(100_000, 0, 10_000), xof(20_000)).amount).toBe(70_000);
    expect(refundableAmount(pay(100_000, 0, 100_000), xof(0)).amount).toBe(0);
    expect(refundableAmount(pay(100_000, 0, 50_000), xof(60_000)).amount).toBe(0);
  });
  it("statut après remboursement : REFUNDED seulement si total", () => {
    expect(statusAfterRefund(xof(100), xof(99))).toBe("CONFIRMED");
    expect(statusAfterRefund(xof(100), xof(100))).toBe("REFUNDED");
  });
  it("validatePaymentAmounts : imputé + remboursé ≤ montant, jamais négatif, montant > 0", () => {
    expect(validatePaymentAmounts(pay(100, 60, 40)).ok).toBe(true);
    expect(validatePaymentAmounts(pay(100, 61, 40)).ok).toBe(false);
    expect(validatePaymentAmounts(pay(0)).ok).toBe(false);
    expect(validatePaymentAmounts(pay(100, -1, 0)).ok).toBe(false);
  });
});

describe("règles par mode de paiement", () => {
  it("espèces, carte, mobile money : pas de référence imposée", () => {
    for (const method of ["CASH", "CARD", "MOBILE_MONEY"]) expect(validateManualPaymentRules({ method }).ok).toBe(true);
  });
  it("chèque et virement exigent une référence", () => {
    expect(validateManualPaymentRules({ method: "CHEQUE" }).ok).toBe(false);
    expect(validateManualPaymentRules({ method: "CHEQUE", reference: "  " }).ok).toBe(false);
    expect(validateManualPaymentRules({ method: "CHEQUE", reference: "CHQ 0042" }).ok).toBe(true);
    expect(validateManualPaymentRules({ method: "TRANSFER" }).ok).toBe(false);
    expect(validateManualPaymentRules({ method: "TRANSFER", reference: "VIR-2026-1" }).ok).toBe(true);
  });
  it("ONLINE et modes inconnus ne se saisissent pas à la main", () => {
    expect(validateManualPaymentRules({ method: "ONLINE" }).ok).toBe(false);
    expect(validateManualPaymentRules({ method: "BITCOIN" }).ok).toBe(false);
  });
});

describe("idempotence", () => {
  const f = { learnerId: "l1", amount: xof(5_000), method: "CASH" as const, payerKind: "LEARNER" as const };
  it("empreinte stable et sensible à chaque champ", () => {
    const base = paymentFingerprint(f);
    expect(paymentFingerprint({ ...f })).toBe(base);
    expect(paymentFingerprint({ ...f, reference: "  " })).toBe(base); // blanc ≡ absent
    expect(paymentFingerprint({ ...f, amount: xof(5_001) })).not.toBe(base);
    expect(paymentFingerprint({ ...f, learnerId: "l2" })).not.toBe(base);
    expect(paymentFingerprint({ ...f, method: "CARD" })).not.toBe(base);
    expect(paymentFingerprint({ ...f, invoiceId: "inv" })).not.toBe(base);
    expect(paymentFingerprint({ ...f, provider: "wave" })).not.toBe(base);
  });
  it("clé d'idempotence : format borné", () => {
    expect(validateIdempotencyKey("pay-2026-0001").ok).toBe(true);
    for (const bad of ["court", "x".repeat(121), "espace interdit!", 42, undefined]) {
      expect(validateIdempotencyKey(bad).ok).toBe(false);
    }
  });
  it("conflit d'idempotence : code stable", () => {
    expect(idempotencyConflict("k").code).toBe("finance.idempotency_key_reused");
  });
});

describe("machine d'états des remboursements", () => {
  it("matrice exhaustive", () => {
    for (const from of REFUND_STATUSES) {
      for (const to of REFUND_STATUSES) {
        const allowed = REFUND_TRANSITIONS[from].includes(to);
        expect(canTransitionRefund(from, to), `${from}→${to}`).toBe(allowed);
        expect(assertRefundTransition(from, to).ok).toBe(allowed);
      }
    }
    expect(canTransitionRefund("REQUESTED", "COMPLETED")).toBe(false); // l'approbation est obligatoire
  });
});

describe("demande de remboursement", () => {
  const confirmed = (amount: number, refunded = 0) => ({ ...pay(amount, 0, refunded), status: "CONFIRMED" as const });
  it("partiel : accepté dans la limite du remboursable", () => {
    const r = validateRefundRequest({ payment: confirmed(100_000), openRefunds: xof(0), amount: xof(30_000), reason: "Erreur de saisie" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.refundableAfter.amount).toBe(70_000);
  });
  it("total : accepté", () => {
    expect(validateRefundRequest({ payment: confirmed(100_000), openRefunds: xof(0), amount: xof(100_000), reason: "Retrait de l'élève" }).ok).toBe(true);
  });
  it("tient compte des remboursements déjà faits et des demandes ouvertes", () => {
    const r = validateRefundRequest({ payment: confirmed(100_000, 40_000), openRefunds: xof(30_000), amount: xof(30_001), reason: "Trop perçu" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.refund_exceeds_refundable");
    expect(validateRefundRequest({ payment: confirmed(100_000, 40_000), openRefunds: xof(30_000), amount: xof(30_000), reason: "Trop perçu" }).ok).toBe(true);
  });
  it("exige un paiement CONFIRMÉ, un montant > 0, un motif", () => {
    for (const status of ["PENDING", "FAILED", "REFUNDED"] as const) {
      const r = validateRefundRequest({ payment: { ...pay(100), status }, openRefunds: xof(0), amount: xof(10), reason: "motif ok" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.payment_not_confirmed");
    }
    expect(validateRefundRequest({ payment: confirmed(100), openRefunds: xof(0), amount: xof(0), reason: "motif ok" }).ok).toBe(false);
    expect(validateRefundRequest({ payment: confirmed(100), openRefunds: xof(0), amount: xof(10), reason: "  " }).ok).toBe(false);
    expect(validateRefundRequest({ payment: confirmed(100), openRefunds: xof(0), amount: xof(10), reason: "abc" }).ok).toBe(false);
  });
  it("approbation à quatre yeux", () => {
    const self = validateRefundApproval({ requestedBy: "u1", approvedBy: "u1", allowSelfApproval: false });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe("finance.refund_self_approval");
    expect(validateRefundApproval({ requestedBy: "u1", approvedBy: "u2", allowSelfApproval: false }).ok).toBe(true);
    expect(validateRefundApproval({ requestedBy: "u1", approvedBy: "u1", allowSelfApproval: true }).ok).toBe(true);
    expect(validateRefundApproval({ requestedBy: "u1", approvedBy: null, allowSelfApproval: true }).ok).toBe(false);
  });
  it("motif obligatoire", () => {
    expect(validateReason("ok ok").ok).toBe(true);
    expect(validateReason("").ok).toBe(false);
    expect(validateReason(undefined).ok).toBe(false);
    expect(validateReason("x".repeat(501)).ok).toBe(false);
  });

  it("PROPRIÉTÉ : une suite de remboursements acceptés ne dépasse jamais le montant payé", () => {
    forAll(300, (rng) => {
      const amount = rng.int(1, 1_000_000);
      let refunded = 0;
      for (let k = 0; k < 15; k++) {
        const ask = rng.int(1, amount);
        const before = refunded;
        const r = validateRefundRequest({ payment: confirmed(amount, before), openRefunds: xof(0), amount: xof(ask), reason: "remboursement" });
        if (r.ok) refunded += ask;
        expect(r.ok).toBe(ask <= amount - before);
        expect(refunded).toBeLessThanOrEqual(amount);
      }
    });
  });
});

describe("avoirs", () => {
  const inv = (status: "ISSUED" | "PAID" | "PARTIALLY_PAID" | "OVERDUE" | "CANCELLED" | "DRAFT", total: number, paid = 0, credited = 0) => ({
    status,
    amounts: { total: xof(total), paid: xof(paid), credited: xof(credited) },
  });
  it("accepte un avoir dans le reste dû", () => {
    const r = validateCreditNote({ invoice: inv("PARTIALLY_PAID", 500_000, 200_000), amount: xof(300_000), reason: "Bourse accordée" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.balanceAfter.amount).toBe(0);
  });
  it("refuse un avoir au-delà du reste dû (le déjà encaissé se rembourse d'abord)", () => {
    const r = validateCreditNote({ invoice: inv("PARTIALLY_PAID", 500_000, 200_000), amount: xof(300_001), reason: "Bourse accordée" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.credit_exceeds_balance");
  });
  it("refuse sur brouillon, annulée, soldée ; exige motif et montant > 0", () => {
    for (const s of ["DRAFT", "CANCELLED", "PAID"] as const) {
      expect(validateCreditNote({ invoice: inv(s, 100, s === "PAID" ? 100 : 0), amount: xof(1), reason: "motif valable" }).ok).toBe(false);
    }
    expect(validateCreditNote({ invoice: inv("ISSUED", 100), amount: xof(0), reason: "motif valable" }).ok).toBe(false);
    expect(validateCreditNote({ invoice: inv("ISSUED", 100), amount: xof(1), reason: "" }).ok).toBe(false);
  });
  it("tient compte des avoirs précédents", () => {
    expect(validateCreditNote({ invoice: inv("OVERDUE", 100, 0, 70), amount: xof(30), reason: "motif valable" }).ok).toBe(true);
    expect(validateCreditNote({ invoice: inv("OVERDUE", 100, 0, 70), amount: xof(31), reason: "motif valable" }).ok).toBe(false);
  });
});
