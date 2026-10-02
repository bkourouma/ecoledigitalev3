"use client";

/**
 * Hooks « libre-service » de l'élève connecté (`/api/v1/people/me/student`). La lecture (`useMyStudentRecord`) existe déjà
 * dans `people.ts` ; ce fichier ajoute la mise à jour des coordonnées que l'API autorise (`student.self.update`) :
 * adresse électronique, téléphones, adresse, ville, résidence. Aucun autre champ n'est modifiable par l'élève.
 */

import { z } from "zod";
import type { PeopleOwnContactPatch } from "@ecoledigitale/contracts/v2/people";
import { useApiAction } from "./actions";
import { PEOPLE_BASE } from "./people";

const updateResultSchema = z.object({ personId: z.string(), fields: z.array(z.string()) });

export function useUpdateMyStudentContact() {
  return useApiAction({
    method: "PATCH",
    path: `${PEOPLE_BASE}/me/student`,
    body: (patch: PeopleOwnContactPatch) => patch,
    schema: updateResultSchema,
    invalidate: [["people", "me"]],
  });
}
