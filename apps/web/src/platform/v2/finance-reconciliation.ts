"use client";

/**
 * Hooks typés du RAPPROCHEMENT des paiements en attente et des résolutions manuelles (spec 015) :
 * `GET /api/v1/finance/payments/pending`, `GET|POST /api/v1/finance/resolutions…`, repli manuel des remboursements.
 *
 * Le web n'invente aucune issue : il affiche l'état du rapprochement calculé par l'API et lui transmet les actions. Les
 * résolutions manuelles exigent la permission sensible `finance.payment.reconcile` (MFA) ET une MFA RÉCENTE (Q-PAY-38 : une
 * seule personne tranche ; refus 403 `finance.mfa_required` rejoué après confirmation par code, voir `useStepUp`).
 *
 * Clés de cache : `["finance", "pending", …]`, `["finance", "resolutions", …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  financePendingPaymentsDtoSchema,
  financeRefundDtoSchema,
  financeResolutionDtoSchema,
  type FinancePendingPaymentDto,
  type FinanceResolutionDto,
} from "@ecoledigitale/contracts/v2/finance";
import { useApiAction } from "./actions";
import { FINANCE_BASE } from "./finance";

type Query = Record<string, string | number | boolean | undefined>;

const PENDING_KEY = ["finance", "pending"] as const;
const RESOLUTION_KEY = ["finance", "resolutions"] as const;
const AFTER_RESOLUTION = [PENDING_KEY, RESOLUTION_KEY, ["finance", "payments"], ["finance", "refunds"], ["finance", "invoices"], ["finance", "receipts"], ["finance", "statement"], ["finance", "reports"]] as const;

export interface PendingQuery {
  flagged?: boolean;
  provider?: string;
  olderThanMinutes?: number;
  limit?: number;
  offset?: number;
}

/** Paiements en ligne EN ATTENTE (signalés d'abord) avec l'état du rapprochement automatique. */
export function usePendingPayments(query: PendingQuery = {}) {
  return hooks.useApiQuery([...PENDING_KEY, "list"], `${FINANCE_BASE}/payments/pending`, {
    schema: financePendingPaymentsDtoSchema,
    query: query as Query,
    refetchOnWindowFocus: false,
  });
}

/** Demandes de résolution (par défaut celles qui attendent une approbation). */
export function useResolutions(query: { status?: "REQUESTED" | "APPROVED" | "REJECTED"; paymentId?: string; refundId?: string; limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery([...RESOLUTION_KEY, "list"], `${FINANCE_BASE}/resolutions`, {
    schema: z.object({ items: z.array(financeResolutionDtoSchema) }),
    select: (d: { items: FinanceResolutionDto[] }) => d.items,
    query: query as Query,
  });
}

export interface RequestResolutionVars {
  paymentId?: string;
  refundId?: string;
  outcome: "SUCCEEDED" | "FAILED";
  reason: string;
  evidenceRef: string;
}

export function useRequestResolution() {
  return useApiAction({
    path: `${FINANCE_BASE}/resolutions`,
    body: (v: RequestResolutionVars) => v,
    schema: financeResolutionDtoSchema,
    invalidate: AFTER_RESOLUTION,
  });
}

export function useApproveResolution() {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${FINANCE_BASE}/resolutions/${v.id}/approve`,
    body: (v) => (v.note ? { note: v.note } : {}),
    schema: financeResolutionDtoSchema,
    invalidate: AFTER_RESOLUTION,
  });
}

export function useRejectResolution() {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${FINANCE_BASE}/resolutions/${v.id}/reject`,
    body: (v) => (v.note ? { note: v.note } : {}),
    schema: financeResolutionDtoSchema,
    invalidate: AFTER_RESOLUTION,
  });
}

/**
 * Repli MANUEL d'un remboursement (fournisseur sans API, partiel refusé, fournisseur indisponible) : l'exécutant atteste avoir
 * remboursé à la main et fournit la référence de preuve. Refusé (409) quand le fournisseur sait rembourser lui-même.
 */
export function useCompleteRefundManually() {
  return useApiAction({
    path: (v: { id: string; reference: string; note?: string }) => `${FINANCE_BASE}/refunds/${v.id}/complete`,
    body: (v) => ({ manual: { reference: v.reference, ...(v.note ? { note: v.note } : {}) } }),
    schema: financeRefundDtoSchema,
    invalidate: [["finance", "refunds"], ["finance", "payments"], ["finance", "invoices"], ["finance", "statement"], ["finance", "cash"], ["finance", "reports"]],
  });
}

export type { FinancePendingPaymentDto, FinanceResolutionDto };
