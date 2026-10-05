"use client";

/**
 * Hooks des CANDIDATS LIBRES (Q-E15) du module `examinations` : saisie, import en lot, profil restreint (lecture auditée),
 * mise à jour, anonymisation. Fichier distinct de `examinations.ts` (même client API, mêmes conventions).
 *
 * Aucune règle côté client : l'éligibilité d'un libre se calcule côté API à partir des faits saisis ; le web n'envoie que la saisie.
 */

import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  examCandidateDtoSchema,
  examExternalBatchReportSchema,
  examExternalProfileDtoSchema,
  type ExamCandidateDto,
} from "@ecoledigitale/contracts/v2/examinations";
import type { z } from "zod";
import type { examCreateExternalCandidateBodySchema, examUpdateExternalCandidateBodySchema } from "@ecoledigitale/contracts/v2/examinations";
import { useApiAction } from "./actions";
import { EXAMINATIONS_BASE } from "./examinations";

const KEY = ["examinations"] as const;
const CANDIDATES = [...KEY, "candidates"] as const;

export type ExternalCandidateInput = z.input<typeof examCreateExternalCandidateBodySchema>;
export type ExternalCandidateUpdate = z.input<typeof examUpdateExternalCandidateBodySchema>;

export function useCreateExternalCandidate(sessionId: string) {
  return useApiAction({
    path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/external-candidates`,
    body: (v: ExternalCandidateInput) => v,
    schema: examCandidateDtoSchema,
    invalidate: [CANDIDATES, [...KEY, "sessions"]],
  });
}

export function useCreateExternalBatch(sessionId: string) {
  return useApiAction({
    path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/external-candidates/batch`,
    body: (v: { source: "ENTERED" | "IMPORTED"; items: ExternalCandidateInput[] }) => v,
    schema: examExternalBatchReportSchema,
    invalidate: [CANDIDATES, [...KEY, "sessions"]],
  });
}

/** Profil restreint : la lecture est AUDITÉE côté API ; `reveal` (numéro de pièce entier) l'est aussi, comme acte sensible. */
export function useExternalProfile(candidateId: string | null, reveal: boolean, enabled: boolean) {
  return hooks.useApiQuery([...KEY, "external-profile", candidateId, reveal], `${EXAMINATIONS_BASE}/candidates/${candidateId}/external-profile`, {
    query: { reveal: reveal ? "true" : "false" },
    schema: examExternalProfileDtoSchema,
    enabled: enabled && candidateId !== null,
    retry: false,
  });
}

export function useUpdateExternalCandidate(candidateId: string) {
  return useApiAction({
    method: "PUT",
    path: `${EXAMINATIONS_BASE}/candidates/${candidateId}/external-profile`,
    body: (v: ExternalCandidateUpdate) => v,
    schema: examCandidateDtoSchema,
    invalidate: [CANDIDATES, [...KEY, "external-profile"]],
  });
}

export function useAnonymizeCandidate() {
  return useApiAction<ExamCandidateDto, { id: string; reason: string }>({
    path: (v) => `${EXAMINATIONS_BASE}/candidates/${v.id}/anonymize`,
    body: (v) => ({ reason: v.reason }),
    schema: examCandidateDtoSchema,
    invalidate: [CANDIDATES, [...KEY, "external-profile"]],
  });
}
