"use client";

/**
 * Hooks typés des décisions métier O-11 (UE annuelle) et O-14 (dispense d'UE) du module `higher` :
 * `/api/v1/higher/annual-ues`, `/exemptions`, `/exemption-settings`. Schémas Zod de `packages/contracts/src/v2/higher.ts`.
 *
 * AUCUNE formule, AUCUN seuil : le résultat commun d'une UE annuelle est décidé par les règles (RuleSet) ; l'impact d'une
 * dispense sur les crédits est un paramètre de l'établissement, jamais une règle du web.
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { higherAnnualUeDtoSchema, higherExemptionDtoSchema, higherExemptionSettingsDtoSchema } from "@ecoledigitale/contracts/v2/higher";
import { useApiAction } from "./actions";
import { HIGHER_BASE } from "./higher";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;

const ANNUAL_KEY = ["higher", "annual-ues"] as const;
const EXEMPTIONS_KEY = ["higher", "exemptions"] as const;
// Une dispense accordée peut inscrire des crédits au registre : les vues de crédits et de parcours sont relues.
const CREDITS_KEYS = [["higher", "credits"], ["higher", "pathway"], ["higher", "diplomas"]] as const;

export type ExemptionCreditPolicy = z.infer<typeof higherExemptionSettingsDtoSchema>["exemptionCreditPolicy"];

// --- O-11 : UE annuelle ------------------------------------------------------------------------------------------------

export function useAnnualUes(enabled = true) {
  return hooks.useApiQuery([...ANNUAL_KEY, "list"], `${HIGHER_BASE}/annual-ues`, { schema: itemsOf(higherAnnualUeDtoSchema), select: pickItems, enabled });
}

export function useDeclareAnnualUe() {
  return useApiAction({
    path: `${HIGHER_BASE}/annual-ues`,
    body: (v: { ueNodeId: string; memberNodeIds?: string[]; partsExpected?: number; reason: string }) => v,
    schema: higherAnnualUeDtoSchema,
    invalidate: [ANNUAL_KEY, ["higher", "diplomas"]],
  });
}

export function useRemoveAnnualUe() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${HIGHER_BASE}/annual-ues/${v.id}/remove`,
    body: (v) => ({ reason: v.reason }),
    invalidate: [ANNUAL_KEY],
  });
}

// --- O-14 : dispense d'UE ----------------------------------------------------------------------------------------------

export function useExemptions(query: { studentId?: string; status?: "ACTIVE" | "REVOKED" } = {}, enabled = true) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
  return hooks.useApiQuery([...EXEMPTIONS_KEY, "list", query], `${HIGHER_BASE}/exemptions`, { schema: itemsOf(higherExemptionDtoSchema), select: pickItems, query: clean, enabled });
}

export function useGrantExemption() {
  return useApiAction({
    path: `${HIGHER_BASE}/exemptions`,
    body: (v: { studentId: string; enrollmentId: string; ueNodeId: string; academicPeriodId: string; reason: string }) => v,
    schema: higherExemptionDtoSchema,
    invalidate: [EXEMPTIONS_KEY, ...CREDITS_KEYS],
  });
}

export function useRevokeExemption() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${HIGHER_BASE}/exemptions/${v.id}/revoke`,
    body: (v) => ({ reason: v.reason }),
    schema: higherExemptionDtoSchema,
    invalidate: [EXEMPTIONS_KEY, ...CREDITS_KEYS],
  });
}

export function useExemptionSettings(enabled = true) {
  return hooks.useApiQuery([...EXEMPTIONS_KEY, "settings"], `${HIGHER_BASE}/exemption-settings`, { schema: higherExemptionSettingsDtoSchema, enabled, retry: false });
}

export function useSetExemptionPolicy() {
  return useApiAction({
    method: "PUT",
    path: `${HIGHER_BASE}/exemption-settings`,
    body: (v: { exemptionCreditPolicy: ExemptionCreditPolicy }) => v,
    schema: higherExemptionSettingsDtoSchema,
    invalidate: [[...EXEMPTIONS_KEY, "settings"]],
  });
}
