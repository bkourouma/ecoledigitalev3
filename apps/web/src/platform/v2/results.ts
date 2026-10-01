"use client";

/**
 * Hooks typés du module `results` (`/api/v1/results/*`) : état d'une période, matrice de classe, explication d'un
 * résultat, cycle de période (verrouillage, délibération, clôture, réouverture, re-pin), surcharges, décisions,
 * délibérations, appréciations, résultat annuel. Schémas Zod de `packages/contracts/src/v2/results.ts`.
 *
 * AUCUN calcul ici : moyennes, rangs, mentions, décisions, crédits sont des VALEURS fournies par l'API (chaînes
 * décimales exactes + valeur d'affichage) ; les libellés des codes viennent du `label_map` de la version de règle
 * (module `rules`), jamais d'une comparaison de libellé.
 *
 * Clés de cache : `["results", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  resultsAppreciationDtoSchema,
  resultsClassMatrixDtoSchema,
  resultsDecisionDtoSchema,
  resultsDeliberationDtoSchema,
  resultsEnrollmentResultDtoSchema,
  resultsFamilyResultDtoSchema,
  resultsHeaderDtoSchema,
  resultsLevelSchema,
  resultsOverrideDtoSchema,
  resultsSettingsDtoSchema,
  resultsStateDtoSchema,
  resultsYearResultDtoSchema,
} from "@ecoledigitale/contracts/v2/results";
import { useApiAction } from "./actions";

export const RESULTS_BASE = "/api/v1/results";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;

// ---------------------------------------------------------------------------
// État de période
// ---------------------------------------------------------------------------

const ruleRefSchema = z.object({ ruleSetCode: z.string(), ruleVersionNo: z.number().int(), definitionHash: z.string() });

export const periodViewSchema = z.object({
  state: resultsStateDtoSchema,
  /** Retard de version de règle : la version épinglée n'est plus la version active à la date de début de la période. */
  ruleLag: z.object({ pinned: ruleRefSchema, active: ruleRefSchema.nullable(), behind: z.boolean() }),
  counts: z.object({ total: z.number().int(), draft: z.number().int(), final: z.number().int(), error: z.number().int() }),
  pendingAssessments: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), sessionNo: z.number().int(), curriculumNodeId: z.string() })),
  closures: z.array(z.object({ id: z.string(), resultsVersion: z.number().int(), resultsCount: z.number().int(), closureHash: z.string(), closedAt: z.string(), forcedReason: z.string().nullable() })),
  deliberations: z.array(resultsDeliberationDtoSchema),
  recompute: z.array(z.object({ id: z.string(), status: z.string(), notBefore: z.string(), blockedReason: z.string().nullable(), attempts: z.number().int() })),
});
export type PeriodView = z.infer<typeof periodViewSchema>;

export function usePeriodView(classroomId: string | null, periodId: string | null) {
  return hooks.useApiQuery(["results", "period", classroomId, periodId], `${RESULTS_BASE}/classrooms/${classroomId}/periods/${periodId}/state`, {
    schema: periodViewSchema,
    enabled: Boolean(classroomId && periodId),
  });
}

const PERIOD_KEY = ["results"] as const;

export function useLockPeriod() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string; force?: boolean; reason?: string }) => `${RESULTS_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/lock`,
    body: (v) => (v.force ? { force: true, reason: v.reason } : {}),
    schema: resultsStateDtoSchema,
    invalidate: [PERIOD_KEY, ["assess"]],
  });
}

export function useDeliberatePeriod() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string; confirmProposed?: boolean }) => `${RESULTS_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/deliberate`,
    body: (v) => (v.confirmProposed ? { confirmProposed: true } : {}),
    schema: resultsStateDtoSchema,
    invalidate: [PERIOD_KEY],
  });
}

export const closeResultSchema = z.object({
  state: resultsStateDtoSchema,
  closureId: z.string(),
  closureHash: z.string(),
  resultsVersion: z.number().int(),
  resultsCount: z.number().int(),
  excluded: z.array(z.object({ enrollmentId: z.string(), code: z.string(), message: z.string() })),
  withoutDeliberation: z.boolean(),
});

export function useClosePeriod() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string; force?: boolean; reason?: string }) => `${RESULTS_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/close`,
    body: (v) => (v.force ? { force: true, reason: v.reason } : {}),
    schema: closeResultSchema,
    invalidate: [PERIOD_KEY, ["assess"], ["reportcards"]],
  });
}

export function useReopenPeriod() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string; kind: "CORRECTION" | "RESIT_SESSION"; reason: string }) => `${RESULTS_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/reopen`,
    body: (v) => ({ kind: v.kind, reason: v.reason }),
    schema: resultsStateDtoSchema,
    invalidate: [PERIOD_KEY, ["assess"]],
  });
}

export const repinResultSchema = z.object({
  state: resultsStateDtoSchema,
  changed: z.boolean(),
  /** Effet du changement de version de règle sur les résultats courants (rejeu sans écriture). */
  simulation: z
    .object({
      from: ruleRefSchema,
      to: ruleRefSchema,
      computed: z.number().int(),
      changed: z.number().int(),
      unchanged: z.number().int(),
      errors: z.number().int(),
      samples: z.array(z.object({ enrollmentId: z.string(), field: z.string(), before: z.union([z.string(), z.number(), z.boolean(), z.null()]), after: z.union([z.string(), z.number(), z.boolean(), z.null()]) })),
    })
    .nullable(),
});
export type RepinResult = z.infer<typeof repinResultSchema>;

export function useRepinPeriod() {
  return useApiAction({
    path: (v: { stateId: string }) => `${RESULTS_BASE}/periods/${v.stateId}/repin`,
    schema: repinResultSchema,
    invalidate: [PERIOD_KEY],
  });
}

export function useRecompute() {
  return useApiAction({
    path: `${RESULTS_BASE}/recompute`,
    body: (v: { classroomId: string; periodId: string }) => ({ classroomId: v.classroomId, periodId: v.periodId }),
    schema: z.unknown(),
    invalidate: [PERIOD_KEY],
  });
}

// ---------------------------------------------------------------------------
// Lecture : matrice, explication, résultat d'inscription et d'année
// ---------------------------------------------------------------------------

export const classMatrixSchema = resultsClassMatrixDtoSchema.extend({ decisions: z.array(resultsDecisionDtoSchema) });
export type ClassMatrix = z.infer<typeof classMatrixSchema>;

export function useClassMatrix(classroomId: string | null, periodId: string | null, options: { lines?: boolean } = {}) {
  return hooks.useApiQuery(["results", "matrix", classroomId, periodId, Boolean(options.lines)], `${RESULTS_BASE}/classrooms/${classroomId}/periods/${periodId}`, {
    schema: classMatrixSchema,
    query: options.lines ? { lines: "true" } : undefined,
    enabled: Boolean(classroomId && periodId),
  });
}

const traceRecordSchema = z
  .object({
    ruleKey: z.string(),
    value: z.union([z.string(), z.boolean(), z.null()]).optional(),
    inputsHash: z.string().optional(),
    outputsHash: z.string().optional(),
    nodesEvaluated: z.number().optional(),
    trace: z.unknown().optional(),
    variables: z.record(z.unknown()).optional(),
    overridden: z.object({ overrideId: z.string(), original: z.union([z.string(), z.boolean(), z.null()]) }).optional(),
  })
  .passthrough();
export type TraceRecordDto = z.infer<typeof traceRecordSchema>;

export const explainSchema = z.object({
  header: resultsHeaderDtoSchema,
  source: z.enum(["STORED", "REPLAY"]),
  lines: z.array(
    z.object({
      level: resultsLevelSchema,
      curriculumNodeId: z.string().nullable(),
      value: z.string().nullable(),
      statusCode: z.string().nullable(),
      overridden: z.boolean(),
      trace: z.unknown().nullable(),
    }),
  ),
});
export type Explanation = z.infer<typeof explainSchema>;

/** Étapes de calcul d'une ligne : tableau de `TraceRecord` quand la trace existe (sinon vide). */
export function traceRecordsOf(trace: unknown): TraceRecordDto[] {
  if (!Array.isArray(trace)) return [];
  const out: TraceRecordDto[] = [];
  for (const item of trace) {
    const parsed = traceRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function useExplain(resultId: string | null) {
  return hooks.useApiQuery(["results", "explain", resultId], `${RESULTS_BASE}/results/${resultId}/explain`, { schema: explainSchema, enabled: resultId !== null, retry: false });
}

const enrollmentResultSchema = resultsEnrollmentResultDtoSchema.extend({ decisions: z.array(resultsDecisionDtoSchema) });

export function useEnrollmentResult(enrollmentId: string | null, periodId: string | null) {
  return hooks.useApiQuery(["results", "enrollment", enrollmentId, periodId], `${RESULTS_BASE}/enrollments/${enrollmentId}/periods/${periodId}`, {
    schema: enrollmentResultSchema,
    enabled: Boolean(enrollmentId && periodId),
  });
}

export function useYearResult(enrollmentId: string | null, yearId: string | null) {
  return hooks.useApiQuery(["results", "year", enrollmentId, yearId], `${RESULTS_BASE}/enrollments/${enrollmentId}/years/${yearId}`, {
    schema: resultsYearResultDtoSchema,
    enabled: Boolean(enrollmentId && yearId),
  });
}

// ---------------------------------------------------------------------------
// Surcharges (quatre yeux)
// ---------------------------------------------------------------------------

export function useOverrides(query: { stateId?: string; enrollmentId?: string; status?: string } = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["results", "overrides", query], `${RESULTS_BASE}/overrides`, {
    schema: itemsOf(resultsOverrideDtoSchema),
    select: pickItems,
    query: Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>,
    enabled: options.enabled,
  });
}

const OVERRIDES_KEY = ["results", "overrides"] as const;

export function useRequestOverride() {
  return useApiAction({ path: `${RESULTS_BASE}/overrides`, body: (v: Record<string, unknown>) => v, schema: resultsOverrideDtoSchema, invalidate: [OVERRIDES_KEY] });
}

export function useApproveOverride() {
  return useApiAction({
    path: (v: { id: string; comment?: string }) => `${RESULTS_BASE}/overrides/${v.id}/approve`,
    body: (v) => (v.comment ? { comment: v.comment } : {}),
    schema: resultsOverrideDtoSchema,
    invalidate: [OVERRIDES_KEY, PERIOD_KEY],
  });
}

export function useRejectOverride() {
  return useApiAction({
    path: (v: { id: string; comment: string }) => `${RESULTS_BASE}/overrides/${v.id}/reject`,
    body: (v) => ({ comment: v.comment }),
    schema: resultsOverrideDtoSchema,
    invalidate: [OVERRIDES_KEY],
  });
}

export function useRevokeOverride() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${RESULTS_BASE}/overrides/${v.id}/revoke`,
    body: (v) => ({ reason: v.reason }),
    schema: resultsOverrideDtoSchema,
    invalidate: [OVERRIDES_KEY, PERIOD_KEY],
  });
}

// ---------------------------------------------------------------------------
// Décisions, délibérations, appréciations
// ---------------------------------------------------------------------------

export function useDecisions(stateId: string | null) {
  return hooks.useApiQuery(["results", "decisions", stateId], `${RESULTS_BASE}/decisions`, {
    schema: itemsOf(resultsDecisionDtoSchema),
    select: pickItems,
    query: { stateId: stateId ?? undefined },
    enabled: stateId !== null,
  });
}

export function useConfirmDecision() {
  return useApiAction({
    path: (v: { id: string; finalCode?: string; justification?: string; deliberationId?: string }) => `${RESULTS_BASE}/decisions/${v.id}/confirm`,
    body: (v) => ({ ...(v.finalCode ? { finalCode: v.finalCode } : {}), ...(v.justification ? { justification: v.justification } : {}), ...(v.deliberationId ? { deliberationId: v.deliberationId } : {}) }),
    schema: resultsDecisionDtoSchema,
    invalidate: [["results", "decisions"], ["results", "matrix"]],
  });
}

export function useDeliberations(stateId: string | null, enabled = true) {
  return hooks.useApiQuery(["results", "deliberations", stateId], `${RESULTS_BASE}/deliberations`, {
    schema: itemsOf(resultsDeliberationDtoSchema),
    select: pickItems,
    query: { stateId: stateId ?? undefined },
    enabled: stateId !== null && enabled,
    retry: false,
  });
}

export function useCreateDeliberation() {
  return useApiAction({
    path: `${RESULTS_BASE}/deliberations`,
    body: (v: { stateId: string; kind: "COUNCIL" | "JURY"; heldOn?: string; participants?: Array<{ staffId: string; role: string }> }) => v,
    schema: resultsDeliberationDtoSchema,
    invalidate: [["results", "deliberations"], PERIOD_KEY],
  });
}

export function useUpdateDeliberation() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${RESULTS_BASE}/deliberations/${v.id}`,
    body: (v) => v.patch,
    schema: resultsDeliberationDtoSchema,
    invalidate: [["results", "deliberations"], PERIOD_KEY],
  });
}

export function useAppreciations(stateId: string | null, enrollmentId?: string) {
  return hooks.useApiQuery(["results", "appreciations", stateId, enrollmentId ?? null], `${RESULTS_BASE}/appreciations`, {
    schema: itemsOf(resultsAppreciationDtoSchema),
    select: pickItems,
    query: { stateId: stateId ?? undefined, enrollmentId },
    enabled: stateId !== null,
  });
}

export function useWriteAppreciation() {
  return useApiAction({
    method: "PUT",
    path: `${RESULTS_BASE}/appreciations`,
    body: (v: { stateId: string; enrollmentId: string; curriculumNodeId?: string; authorRole: "TEACHER" | "COUNCIL" | "DIRECTOR"; body: string }) => v,
    schema: resultsAppreciationDtoSchema,
    invalidate: [["results", "appreciations"]],
  });
}

// ---------------------------------------------------------------------------
// Réglages et lecture famille
// ---------------------------------------------------------------------------

export function useResultsSettings(enabled = true) {
  return hooks.useApiQuery(["results", "settings"], `${RESULTS_BASE}/settings`, { schema: resultsSettingsDtoSchema, enabled, retry: false });
}

export function useUpdateResultsSettings() {
  return useApiAction({
    method: "PUT",
    path: `${RESULTS_BASE}/settings`,
    body: (v: { requireDeliberation?: boolean; requireSeparateApprover?: boolean; recomputeDelaySeconds?: number }) => v,
    schema: resultsSettingsDtoSchema,
    invalidate: [["results", "settings"]],
  });
}

export function useMyResults(enabled = true) {
  return hooks.useApiQuery(["results", "me"], `${RESULTS_BASE}/me/results`, { schema: itemsOf(resultsFamilyResultDtoSchema), select: pickItems, enabled, retry: false });
}

export function useChildResults(studentId: string | null) {
  return hooks.useApiQuery(["results", "child", studentId], `${RESULTS_BASE}/children/${studentId}/results`, { schema: itemsOf(resultsFamilyResultDtoSchema), select: pickItems, enabled: studentId !== null, retry: false });
}
