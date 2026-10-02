"use client";

/**
 * Hooks typés de la reconduction annuelle (`/api/v1/academic/years/:id/rollover/*`, `/rollover/runs/*`) et du calendrier de
 * l'établissement (`/api/v1/academic/holidays`). Schémas Zod de `packages/contracts/src/v2/academic.ts`.
 *
 * Aucune règle métier : l'aperçu (`plan`) est calculé par l'API SANS écriture ; l'exécution est une tâche de fond côté
 * serveur dont l'écran relit l'état toutes les 2 s tant qu'elle est en attente ou en cours.
 *
 * Clés de cache : `["academic", "rollover", …]` et `["academic", "holidays", …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  academicHolidayDtoSchema,
  academicRolloverPlanDtoSchema,
  academicRolloverRunDtoSchema,
  type AcademicCreateHolidayBody,
  type AcademicRolloverRunBody,
  type AcademicRolloverRunDto,
  type AcademicRolloverStep,
  type AcademicUpdateHolidayBody,
} from "@ecoledigitale/contracts/v2/academic";
import { useApiAction } from "./actions";
import { ACADEMIC_BASE } from "./academic";

/** Intervalle de relecture d'une exécution vivante (ms). */
export const ROLLOVER_POLL_MS = 2000;

const ROLLOVER_KEY = ["academic", "rollover"] as const;
const HOLIDAYS_KEY = ["academic", "holidays"] as const;

export const isLiveRun = (run: Pick<AcademicRolloverRunDto, "status"> | undefined): boolean => run?.status === "PENDING" || run?.status === "RUNNING";

export interface RolloverPlanQuery {
  toAcademicYearId: string;
  steps: ReadonlyArray<AcademicRolloverStep>;
  createMissingClassrooms?: boolean;
}

/** Aperçu complet (sans écriture) ; relu à la demande (le résultat dépend de l'état courant des deux années). */
export function useRolloverPlan(fromYearId: string | null, query: RolloverPlanQuery | null) {
  return hooks.useApiQuery(["academic", "rollover", "plan", fromYearId, query], `${ACADEMIC_BASE}/years/${fromYearId}/rollover/plan`, {
    schema: academicRolloverPlanDtoSchema,
    query: query ? { toAcademicYearId: query.toAcademicYearId, steps: query.steps.join(","), ...(query.createMissingClassrooms !== undefined ? { createMissingClassrooms: query.createMissingClassrooms } : {}) } : undefined,
    enabled: fromYearId !== null && query !== null && query.steps.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export interface StartRolloverVariables {
  fromYearId: string;
  body: AcademicRolloverRunBody;
  /** Clé d'idempotence de l'intention (rejouée telle quelle après un échec réseau). */
  idempotencyKey?: string;
}

export function useStartRollover() {
  return useApiAction({
    path: (v: StartRolloverVariables) => `${ACADEMIC_BASE}/years/${v.fromYearId}/rollover/runs`,
    body: (v) => v.body,
    idempotencyKey: (v) => v.idempotencyKey,
    schema: academicRolloverRunDtoSchema,
    invalidate: [ROLLOVER_KEY],
  });
}

/** Historique des exécutions d'une année source. */
export function useRolloverRuns(fromYearId: string | null) {
  return hooks.useApiQuery(["academic", "rollover", "runs", fromYearId], `${ACADEMIC_BASE}/years/${fromYearId}/rollover/runs`, {
    schema: z.object({ items: z.array(academicRolloverRunDtoSchema) }),
    select: (d) => d.items,
    enabled: fromYearId !== null,
    retry: false,
  });
}

/** Exécution suivie : relue toutes les 2 s tant qu'elle est PENDING ou RUNNING (tâche de fond côté API). */
export function useRolloverRun(runId: string | null) {
  return hooks.useApiQuery(["academic", "rollover", "run", runId], `${ACADEMIC_BASE}/rollover/runs/${runId}`, {
    schema: academicRolloverRunDtoSchema,
    enabled: runId !== null,
    retry: false,
    refetchInterval: (data) => (data === undefined || isLiveRun(data) ? ROLLOVER_POLL_MS : false),
  });
}

/** Relance d'une exécution en échec (FAILED -> PENDING) ; l'API reprend où elle s'était arrêtée (étapes idempotentes). */
export function useRetryRollover() {
  return useApiAction({
    path: (v: { runId: string }) => `${ACADEMIC_BASE}/rollover/runs/${v.runId}/retry`,
    schema: academicRolloverRunDtoSchema,
    invalidate: [ROLLOVER_KEY],
  });
}

// ---------------------------------------------------------------------------
// Calendrier de l'établissement (jours fériés, vacances, fermetures)
// ---------------------------------------------------------------------------

export function useHolidays(query: { institutionId: string | null; from?: string; to?: string }) {
  return hooks.useApiQuery(["academic", "holidays", "list", query], `${ACADEMIC_BASE}/holidays`, {
    schema: z.object({ items: z.array(academicHolidayDtoSchema) }),
    select: (d) => d.items,
    query: { institutionId: query.institutionId ?? undefined, from: query.from, to: query.to } as Record<string, string | undefined>,
    enabled: query.institutionId !== null,
    retry: false,
  });
}

export function useCreateHoliday() {
  return useApiAction({ path: `${ACADEMIC_BASE}/holidays`, body: (v: AcademicCreateHolidayBody) => v, schema: academicHolidayDtoSchema, invalidate: [HOLIDAYS_KEY] });
}

export function useUpdateHoliday() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: AcademicUpdateHolidayBody }) => `${ACADEMIC_BASE}/holidays/${v.id}`,
    body: (v) => v.patch,
    schema: academicHolidayDtoSchema,
    invalidate: [HOLIDAYS_KEY],
  });
}

export function useDeleteHoliday() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${ACADEMIC_BASE}/holidays/${v.id}`, invalidate: [HOLIDAYS_KEY] });
}
