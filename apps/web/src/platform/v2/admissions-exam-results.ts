"use client";

/**
 * Résultat d'examen transmis aux admissions (Q-E18 : « admis / non admis » ET MOYENNE, CEPE vers l'admission en 6e).
 * Le web n'affiche que ce que l'API rend : la moyenne n'est présente que pour le personnel habilité (`admission.exam_result.read`),
 * sinon `averageHidden`. Aucun calcul, aucune décision d'admission ici.
 */

import { platformHooks as hooks } from "@/platform/api/default-client";
import { admissionsExamResultsDtoSchema } from "@ecoledigitale/contracts/v2/admissions";

export const ADMISSIONS_EXAM_RESULTS_BASE = "/api/v1/admissions";

export function useApplicationExamResults(applicationId: string, enabled: boolean) {
  return hooks.useApiQuery(["admissions", "application", applicationId, "exam-results"], `${ADMISSIONS_EXAM_RESULTS_BASE}/applications/${applicationId}/exam-results`, {
    schema: admissionsExamResultsDtoSchema,
    enabled,
    retry: false,
  });
}
