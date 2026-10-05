/**
 * Frais d'examen intégrés à l'inscription (décision métier Q-E13) : types et règles PURES (aucun montant, aucun tarif).
 * Les montants viennent du catalogue et des barèmes de `finance` ; le module ne fait que désigner QUELS frais s'appliquent à un type
 * d'examen et suivre l'obligation de chaque candidat.
 */
import type { CandidateKind } from "./types";

export const FEE_APPLIES_TO = ["ALL", "STUDENT", "EXTERNAL"] as const;
export type FeeAppliesTo = (typeof FEE_APPLIES_TO)[number];

export const FEE_STATUSES = ["NOT_APPLICABLE", "PENDING_INVOICE", "INVOICED", "AWAITING_MANUAL_INVOICE", "CANCELLED", "REFUND_DUE", "REFUND_DONE"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

/** Transitions autorisées (miroir du déclencheur `candidate_fees_guard`). */
export const FEE_TRANSITIONS: Readonly<Record<FeeStatus, readonly FeeStatus[]>> = Object.freeze({
  NOT_APPLICABLE: [],
  PENDING_INVOICE: ["INVOICED", "AWAITING_MANUAL_INVOICE", "CANCELLED"],
  AWAITING_MANUAL_INVOICE: ["CANCELLED"],
  INVOICED: ["CANCELLED", "REFUND_DUE"],
  CANCELLED: [],
  REFUND_DUE: ["REFUND_DONE"],
  REFUND_DONE: [],
});

export const canTransitionFee = (from: FeeStatus, to: FeeStatus): boolean => FEE_TRANSITIONS[from].includes(to);

/** Un frais du barème s'applique-t-il à ce régime de candidat ? */
export const feeAppliesTo = (appliesTo: FeeAppliesTo, kind: CandidateKind): boolean => appliesTo === "ALL" || (appliesTo === "STUDENT" && kind === "STUDENT") || (appliesTo === "EXTERNAL" && kind === "EXTERNAL");

export interface FeeLine {
  feeId: string;
  /** Libellé du catalogue de `finance`, complété à la facturation. */
  label: string | null;
  /** Montant en unités mineures (entier), complété à la facturation ; `null` tant que non facturé (aucun tarif n'est inventé). */
  amountMinor: number | null;
}

export interface FeeItemRow {
  id: string;
  examTypeId: string;
  feeId: string;
  appliesTo: FeeAppliesTo;
  active: boolean;
  createdAt: Date;
}

export interface CandidateFeeRow {
  id: string;
  sessionId: string;
  candidateId: string;
  status: FeeStatus;
  payerKind: CandidateKind;
  currency: string | null;
  totalMinor: number | null;
  lines: FeeLine[];
  invoiceId: string | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  note: string | null;
  refundConfirmedBy: string | null;
  refundConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Clé d'idempotence de la facture d'un candidat auprès de `finance` : une facture au plus par candidat, quel que soit le nombre de rejeux. */
export const feeIdempotencyKey = (candidateId: string): string => `exam-fee-${candidateId}`;
