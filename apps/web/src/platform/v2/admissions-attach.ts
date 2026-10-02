"use client";

/**
 * Rattachement des pièces ACCEPTÉES d'un dossier inscrit à la GED de l'élève
 * (`POST /api/v1/admissions/applications/:id/documents/attach-to-student-file`, permissions `admission.document.attach` ET
 * `documents.upload`). Action DIFFÉRÉE et CONFIRMÉE PAR UN HUMAIN : la personne qui confirme devient le déposant dans la GED.
 * Le web n'envoie que la catégorie choisie ; le rapport (rattachées / déjà présentes / en échec) vient de l'API.
 */

import { admissionsAttachToStudentFileResultDtoSchema, type AdmissionsAttachToStudentFileResultDto } from "@ecoledigitale/contracts/v2/admissions";
import { useApiAction } from "./actions";
import { ADMISSIONS_BASE } from "./admissions";

export function useAttachToStudentFile(applicationId: string) {
  return useApiAction({
    path: `${ADMISSIONS_BASE}/applications/${applicationId}/documents/attach-to-student-file`,
    body: (v: { categoryId: string }) => ({ categoryId: v.categoryId }),
    schema: admissionsAttachToStudentFileResultDtoSchema,
    invalidate: [["admissions", "application"], ["admissions", "applications"], ["documents"]],
  });
}

export type { AdmissionsAttachToStudentFileResultDto };
