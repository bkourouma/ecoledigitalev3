"use client";

/**
 * Hooks des FRAIS D'EXAMEN (Q-E13) du module `examinations` : barème d'un type (les frais du catalogue de la comptabilité), obligation
 * d'un candidat (statut de facturation + paiement relu en direct), reprise de la facturation, confirmation d'un remboursement manuel.
 *
 * Aucun montant n'est décidé ici : le web affiche ce que `finance` a facturé (entiers en unités mineures, via `useMoney`).
 */

import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  examCandidateFeeDtoSchema,
  examFeeCatalogEntryDtoSchema,
  examFeeItemDtoSchema,
  examFeeSyncReportSchema,
  examItemsSchema,
  type ExamFeeAppliesTo,
} from "@ecoledigitale/contracts/v2/examinations";
import { useApiAction } from "./actions";
import { EXAMINATIONS_BASE } from "./examinations";

const KEY = ["examinations"] as const;
const FEES = [...KEY, "fees"] as const;

export function useFeeItems(typeId: string | null, enabled = true) {
  return hooks.useApiQuery([...FEES, "items", typeId], `${EXAMINATIONS_BASE}/exam-types/${typeId}/fee-items`, {
    schema: examItemsSchema(examFeeItemDtoSchema),
    select: (d) => d.items,
    enabled: enabled && typeId !== null,
    retry: false,
  });
}

export function useSetFeeItems(typeId: string) {
  return useApiAction({
    method: "PUT",
    path: `${EXAMINATIONS_BASE}/exam-types/${typeId}/fee-items`,
    body: (v: { items: Array<{ feeId: string; appliesTo: ExamFeeAppliesTo; active: boolean }> }) => v,
    schema: examItemsSchema(examFeeItemDtoSchema),
    invalidate: [[...FEES, "items"]],
  });
}

export function useFeeCatalog(enabled: boolean) {
  return hooks.useApiQuery([...FEES, "catalog"], `${EXAMINATIONS_BASE}/fee-catalog`, { schema: examItemsSchema(examFeeCatalogEntryDtoSchema), select: (d) => d.items, enabled, retry: false });
}

/** Obligation d'un candidat : 404 `examinations.fee_not_found` pour un candidat sans obligation (examen blanc, inscription antérieure à Q-E13). */
export function useCandidateFee(candidateId: string | null, enabled: boolean) {
  return hooks.useApiQuery([...FEES, "candidate", candidateId], `${EXAMINATIONS_BASE}/candidates/${candidateId}/fee`, { schema: examCandidateFeeDtoSchema, enabled: enabled && candidateId !== null, retry: false });
}

export function useSyncCandidateFee(candidateId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/candidates/${candidateId}/fee/sync`, schema: examCandidateFeeDtoSchema, invalidate: [FEES] });
}

export function useConfirmRefund(candidateId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/candidates/${candidateId}/fee/refund-done`, body: (v: { note: string }) => v, schema: examCandidateFeeDtoSchema, invalidate: [FEES] });
}

export function useSyncSessionFees(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/fees/sync`, schema: examFeeSyncReportSchema, invalidate: [FEES] });
}
