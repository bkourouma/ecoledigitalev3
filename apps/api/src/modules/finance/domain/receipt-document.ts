/**
 * Contenu du PDF d'un reçu (fonction PURE) : instantané figé (`content`, JSON canonique : chaînes, ENTIERS, booléens, null) et
 * contexte d'impression (`context`, chaînes déjà mises en forme) que le module `reportcards` scelle puis rend. Le reçu est
 * immuable (déclencheur SQL) : le même reçu donne toujours le même contenu.
 *
 * Le titre est PUBLIÉ par la page de vérification : il ne porte que le numéro du reçu, jamais un nom.
 */
import { Money } from "@ecoledigitale/kernel";
import type { ReceiptRecord } from "./records";
import { PAYMENT_METHOD_LABELS_FR } from "./types";

export interface ReceiptDocument {
  readonly sourceId: string;
  readonly title: string;
  readonly issuedAt: Date;
  readonly content: Record<string, unknown>;
  readonly context: Record<string, unknown>;
}

export interface ReceiptDocumentLearner {
  readonly displayName?: string | null | undefined;
  readonly registrationNumber?: string | null | undefined;
}

const text = (m: { amount: number; currency: string }): string => Money.of(m.amount, m.currency as never).format("fr-FR");

export function buildReceiptDocument(receipt: ReceiptRecord, learner: ReceiptDocumentLearner | null): ReceiptDocument {
  const s = receipt.snapshot;
  const unallocated = s.unallocated;
  const balanceAfter = s.balanceAfter;
  const content: Record<string, unknown> = {
    receiptId: receipt.id,
    number: receipt.number,
    paymentId: receipt.paymentId,
    learnerId: receipt.learnerId,
    issuedAt: receipt.issuedAt.toISOString(),
    amount: { amount: receipt.amount.amount, currency: receipt.amount.currency },
    method: s.method,
    reference: s.reference,
    payer: { kind: s.payer.kind, name: s.payer.name },
    allocations: s.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoiceNumber, installmentId: a.installmentId, label: a.label, amount: a.amount })),
    unallocated: { amount: unallocated.amount, currency: unallocated.currency },
    balanceAfter: balanceAfter ? { amount: balanceAfter.amount, currency: balanceAfter.currency } : null,
    // Identité de l'apprenant figée au moment de la demande (le PDF doit rester identique si la fiche change ensuite).
    learner: { displayName: learner?.displayName ?? null, registrationNumber: learner?.registrationNumber ?? null },
  };
  const cur = receipt.amount.currency;
  const context: Record<string, unknown> = {
    receipt: {
      number: receipt.number,
      issuedOn: receipt.issuedAt.toISOString(),
      learnerName: learner?.displayName ?? "",
      learnerRegistration: learner?.registrationNumber ?? "",
      payerName: s.payer.name ?? "",
      methodLabel: PAYMENT_METHOD_LABELS_FR[s.method],
      reference: s.reference ?? "",
      amountText: text(receipt.amount),
      allocations: s.allocations.map((a) => ({ invoiceNumber: a.invoiceNumber ?? "", label: a.label, amountText: text({ amount: a.amount, currency: cur }) })),
      unallocatedText: unallocated.amount > 0 ? text(unallocated) : "",
      balanceAfterText: balanceAfter ? text(balanceAfter) : "",
    },
  };
  return { sourceId: receipt.id, title: `Reçu de paiement ${receipt.number}`, issuedAt: receipt.issuedAt, content, context };
}
