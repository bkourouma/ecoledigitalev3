"use client";

/**
 * Hooks typés des paramètres académiques et des paramètres « personnes » :
 *  - référentiels académiques (`PUT /api/v1/academic/reference/:kind` : UPSERT PAR CODE, jamais de suppression) ;
 *  - paramètres d'inscription / numérotation d'un établissement (`PUT /api/v1/academic/institutions/:id/settings`) ;
 *  - paramètres des personnes (`GET|PUT /api/v1/people/settings`).
 *
 * Les lectures des référentiels et des paramètres d'établissement existent déjà (`useReference`, `useAcademicSettings`
 * dans `academic.ts`) : ce fichier ne les réécrit pas. Aucune règle métier : l'API valide et refuse les entrées invalides.
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  academicPutEducationLevelsBodySchema,
  academicPutFundingTypesBodySchema,
  academicPutGradeLevelsBodySchema,
  academicPutOutcomesBodySchema,
  academicPutPeriodPlansBodySchema,
  academicPutPeriodTypesBodySchema,
  academicSettingsDtoSchema,
  type AcademicUpdateSettingsBody,
} from "@ecoledigitale/contracts/v2/academic";
import { peopleSettingsDtoSchema, type PeopleSettingsPatch } from "@ecoledigitale/contracts/v2/people";
import { useApiAction } from "./actions";
import { ACADEMIC_BASE } from "./academic";

/** Corps `items` attendu par `PUT /reference/:kind`, par référentiel modifiable depuis les paramètres. */
export interface ReferencePutItems {
  "education-levels": z.input<typeof academicPutEducationLevelsBodySchema>["items"];
  "grade-levels": z.input<typeof academicPutGradeLevelsBodySchema>["items"];
  "period-types": z.input<typeof academicPutPeriodTypesBodySchema>["items"];
  "period-plans": z.input<typeof academicPutPeriodPlansBodySchema>["items"];
  "funding-types": z.input<typeof academicPutFundingTypesBodySchema>["items"];
  "enrollment-outcomes": z.input<typeof academicPutOutcomesBodySchema>["items"];
}
export type EditableReferenceKind = keyof ReferencePutItems;

const putResultSchema = z.object({ items: z.array(z.unknown()) }).passthrough();

/** Ajoute ou met à jour (par code) des entrées d'un référentiel ; la liste est relue après succès. */
export function usePutReference<K extends EditableReferenceKind>(kind: K) {
  return useApiAction({
    method: "PUT",
    path: `${ACADEMIC_BASE}/reference/${kind}`,
    body: (items: ReferencePutItems[K]) => ({ items }),
    schema: putResultSchema,
    // Les niveaux dépendent des cycles et inversement : on relit toute la famille.
    invalidate: [["academic", "reference"]],
  });
}

export function useUpdateAcademicSettings() {
  return useApiAction({
    method: "PUT",
    path: (v: { institutionId: string; patch: AcademicUpdateSettingsBody }) => `${ACADEMIC_BASE}/institutions/${v.institutionId}/settings`,
    body: (v) => v.patch,
    schema: academicSettingsDtoSchema,
    invalidate: [["academic", "settings"]],
  });
}

const PEOPLE_SETTINGS = "/api/v1/people/settings";

/** Paramètres des personnes (motifs de matricule, doublons, conservation) : permission `people.settings.manage`. */
export function usePeopleSettings(enabled = true) {
  return hooks.useApiQuery(["people", "settings"], PEOPLE_SETTINGS, { schema: peopleSettingsDtoSchema, enabled, retry: false });
}

export function useUpdatePeopleSettings() {
  return useApiAction({ method: "PUT", path: PEOPLE_SETTINGS, body: (patch: PeopleSettingsPatch) => patch, schema: peopleSettingsDtoSchema, invalidate: [["people", "settings"]] });
}
