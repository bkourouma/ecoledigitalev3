"use client";

/**
 * Hooks typés du calendrier national des jours fériés (décision O-10) :
 * `GET /api/v1/academic/national-holidays`, `PUT /national-holidays/:code`, `GET /holidays/effective`.
 * Schémas Zod de `packages/contracts/src/v2/academic.ts`. Aucune date n'est calculée ni inventée ici : tout vient de l'API.
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { academicEffectiveHolidayDtoSchema, academicNationalHolidayDtoSchema } from "@ecoledigitale/contracts/v2/academic";
import { useApiAction } from "./actions";
import { ACADEMIC_BASE } from "./academic";

const NATIONAL_KEY = ["academic", "national-holidays"] as const;
const HOLIDAYS_KEY = ["academic", "holidays"] as const;

export function useNationalHolidays(institutionId: string | null) {
  return hooks.useApiQuery(["academic", "national-holidays", "list", institutionId], `${ACADEMIC_BASE}/national-holidays`, {
    schema: z.object({ items: z.array(academicNationalHolidayDtoSchema) }),
    select: (d) => d.items,
    query: { institutionId: institutionId ?? undefined } as Record<string, string | undefined>,
    enabled: institutionId !== null,
    retry: false,
  });
}

export function useSetNationalHolidayEnabled() {
  return useApiAction({
    method: "PUT",
    path: (v: { code: string; institutionId: string; enabled: boolean }) => `${ACADEMIC_BASE}/national-holidays/${v.code}`,
    body: (v) => ({ institutionId: v.institutionId, enabled: v.enabled }),
    schema: academicNationalHolidayDtoSchema,
    invalidate: [NATIONAL_KEY, HOLIDAYS_KEY],
  });
}

/** Jours fériés effectifs (nationaux non désactivés + ceux de l'établissement) sur une plage. */
export function useEffectiveHolidays(query: { institutionId: string | null; from?: string; to?: string }) {
  return hooks.useApiQuery(["academic", "holidays", "effective", query], `${ACADEMIC_BASE}/holidays/effective`, {
    schema: z.object({ items: z.array(academicEffectiveHolidayDtoSchema) }),
    select: (d) => d.items,
    query: { institutionId: query.institutionId ?? undefined, from: query.from, to: query.to } as Record<string, string | undefined>,
    enabled: query.institutionId !== null && Boolean(query.from) && Boolean(query.to),
    retry: false,
  });
}
