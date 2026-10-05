"use client";

/**
 * Transmission du résultat ET de la moyenne aux admissions (Q-E18), paramètre PAR TYPE D'EXAMEN (désactivé par défaut).
 * Le web envoie le paramètre ; l'API décide de ce qui part (candidats-élèves d'une session officielle seulement).
 */

import { examTypeDtoSchema } from "@ecoledigitale/contracts/v2/examinations";
import { useApiAction } from "./actions";
import { EXAMINATIONS_BASE } from "./examinations";

export function useSetTransmitsToAdmission(typeId: string) {
  return useApiAction({
    method: "PATCH",
    path: `${EXAMINATIONS_BASE}/exam-types/${typeId}`,
    body: (v: { transmitsToAdmission: boolean }) => v,
    schema: examTypeDtoSchema,
    invalidate: [["examinations", "types"]],
  });
}
