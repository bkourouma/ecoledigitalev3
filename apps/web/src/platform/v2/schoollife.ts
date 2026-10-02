"use client";

/**
 * Hooks typés du module `schoollife` (`/api/v1/schoollife/*`). Schémas Zod de `packages/contracts/src/v2/schoollife.ts`.
 * AUCUNE règle métier côté client : circuit de validation (quatre yeux, permission d'approbation), visibilité par niveau de
 * confidentialité (`audience_may_see`), exclusions sans chevauchement, solde de points, effets d'une exclusion sont décidés
 * par l'API ; l'écran affiche ce qui revient (un élément masqué reste masqué jusqu'à une lecture journalisée).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  schoollifeAppealDtoSchema,
  schoollifeClassroomSummaryDtoSchema,
  schoollifeConductDtoSchema,
  schoollifeConfidentialReadDtoSchema,
  schoollifeConvocationDtoSchema,
  schoollifeDashboardDtoSchema,
  schoollifeEffectDtoSchema,
  schoollifeEventTypeDtoSchema,
  schoollifeFamilyLifeDtoSchema,
  schoollifeIncidentDtoSchema,
  schoollifeMeasureDtoSchema,
  schoollifeNoteDtoSchema,
  schoollifeReferenceDtoSchema,
  schoollifeScaleDtoSchema,
  schoollifeSettingsDtoSchema,
  schoollifeSeverityDtoSchema,
  schoollifeSeverityInputSchema,
  schoollifeEventTypeInputSchema,
  schoollifeStudentLifeDtoSchema,
  type SchoolLifeConfidentialReadInput,
  type SchoolLifeConvocationCreate,
  type SchoolLifeIncidentCreate,
  type SchoolLifeManualAdjustment,
  type SchoolLifeMeasureProposeInput,
  type SchoolLifeNoteCreate,
  type SchoolLifeScaleCreate,
  type SchoolLifeSettingsInput,
} from "@ecoledigitale/contracts/v2/schoollife";
import { useApiAction } from "./actions";
import { omit } from "./omit";

export const SCHOOLLIFE_BASE = "/api/v1/schoollife";
const KEY = ["schoollife"] as const;

type Query = Record<string, string | number | boolean | undefined>;
const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;

// ---------------------------------------------------------------------------
// Paramètres (données d'établissement)
// ---------------------------------------------------------------------------

export function useSchoolLifeReference(enabled = true) {
  return hooks.useApiQuery([...KEY, "reference"], `${SCHOOLLIFE_BASE}/reference`, { schema: schoollifeReferenceDtoSchema, enabled, staleTime: 60_000, retry: false });
}

export function useUpsertSettings() {
  return useApiAction({ method: "PUT", path: `${SCHOOLLIFE_BASE}/settings`, body: (v: SchoolLifeSettingsInput) => v, schema: schoollifeSettingsDtoSchema, invalidate: [[...KEY, "reference"]] });
}

export function useUpsertSeverity() {
  return useApiAction({ method: "PUT", path: `${SCHOOLLIFE_BASE}/severity-levels`, body: (v: z.input<typeof schoollifeSeverityInputSchema>) => v, schema: schoollifeSeverityDtoSchema, invalidate: [[...KEY, "reference"]] });
}

export function useUpsertEventType() {
  return useApiAction({
    method: "PUT",
    path: `${SCHOOLLIFE_BASE}/event-types`,
    body: (v: z.input<typeof schoollifeEventTypeInputSchema>) => v,
    schema: schoollifeEventTypeDtoSchema,
    invalidate: [[...KEY, "reference"]],
  });
}

// ---------------------------------------------------------------------------
// Lectures : tableau de bord, dossier, synthèse de classe, listes
// ---------------------------------------------------------------------------

export function useDashboard(institutionId?: string) {
  return hooks.useApiQuery([...KEY, "dashboard", institutionId ?? ""], `${SCHOOLLIFE_BASE}/dashboard`, { schema: schoollifeDashboardDtoSchema, query: { institutionId } as Query, retry: false });
}

export function useStudentLife(studentId: string | null) {
  return hooks.useApiQuery([...KEY, "student", studentId], `${SCHOOLLIFE_BASE}/students/${studentId}/life`, { schema: schoollifeStudentLifeDtoSchema, enabled: studentId !== null, retry: false });
}

export function useClassroomLifeSummary(classroomId: string | null) {
  return hooks.useApiQuery([...KEY, "classroom", classroomId], `${SCHOOLLIFE_BASE}/classrooms/${classroomId}/summary`, { schema: schoollifeClassroomSummaryDtoSchema, enabled: classroomId !== null, retry: false });
}

export interface MeasuresQuery {
  status?: string;
  kind?: string;
  studentId?: string;
  classroomId?: string;
  pendingOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function useMeasures(query: MeasuresQuery, enabled = true) {
  return hooks.useApiQuery([...KEY, "measures", "list"], `${SCHOOLLIFE_BASE}/measures`, { schema: itemsOf(schoollifeMeasureDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useIncidents(query: { status?: string; studentId?: string; classroomId?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "incidents", "list"], `${SCHOOLLIFE_BASE}/incidents`, { schema: itemsOf(schoollifeIncidentDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useConvocations(query: { status?: string; studentId?: string; upcomingOnly?: boolean }, enabled = true) {
  return hooks.useApiQuery([...KEY, "convocations", "list"], `${SCHOOLLIFE_BASE}/convocations`, { schema: itemsOf(schoollifeConvocationDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useMeasureEffects(enabled = true) {
  return hooks.useApiQuery([...KEY, "effects"], `${SCHOOLLIFE_BASE}/measure-effects`, { schema: itemsOf(schoollifeEffectDtoSchema), select: pickItems, query: { status: "AWAITING_HUMAN" } as Query, enabled, retry: false });
}

export function useStudentConduct(studentId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "conduct", studentId], `${SCHOOLLIFE_BASE}/students/${studentId}/conduct`, { schema: schoollifeConductDtoSchema, enabled: enabled && studentId !== null, retry: false });
}

export function useConductScales(enabled = true) {
  return hooks.useApiQuery([...KEY, "scales"], `${SCHOOLLIFE_BASE}/conduct-scales`, { schema: itemsOf(schoollifeScaleDtoSchema), select: pickItems, enabled, retry: false });
}

// ---------------------------------------------------------------------------
// Actions : incidents, mesures, recours, notes, convocations
// ---------------------------------------------------------------------------

const ALL = [KEY] as const;

export function useDeclareIncident() {
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/incidents`, body: (v: SchoolLifeIncidentCreate) => v, schema: schoollifeIncidentDtoSchema, invalidate: ALL });
}

export function useIncidentAction(action: "review" | "confirm" | "dismiss" | "close") {
  return useApiAction({
    path: (v: { id: string; resolutionNote?: string }) => `${SCHOOLLIFE_BASE}/incidents/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: schoollifeIncidentDtoSchema,
    invalidate: ALL,
  });
}

export function useProposeMeasure() {
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/measures`, body: (v: SchoolLifeMeasureProposeInput) => v, schema: schoollifeMeasureDtoSchema, invalidate: ALL });
}

/** `validate`, `reject` (note), `cancel` (reason), `notify`, `execute`, `revoke` (reason) : le corps dépend de l'action, validé par l'API. */
export function useMeasureAction(action: "validate" | "reject" | "cancel" | "notify" | "execute" | "revoke") {
  return useApiAction({
    path: (v: { id: string; note?: string; reason?: string }) => `${SCHOOLLIFE_BASE}/measures/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: schoollifeMeasureDtoSchema,
    invalidate: ALL,
  });
}

export function useFileAppeal() {
  return useApiAction({
    path: (v: { measureId: string; reason: string }) => `${SCHOOLLIFE_BASE}/measures/${v.measureId}/appeals`,
    body: (v) => ({ reason: v.reason }),
    schema: schoollifeAppealDtoSchema,
    invalidate: ALL,
  });
}

export function useDecideAppeal(outcome: "uphold" | "overturn") {
  return useApiAction({
    path: (v: { appealId: string; decisionNote: string }) => `${SCHOOLLIFE_BASE}/appeals/${v.appealId}/${outcome}`,
    body: (v) => ({ decisionNote: v.decisionNote }),
    schema: schoollifeAppealDtoSchema,
    invalidate: ALL,
  });
}

export function useEffectAction(action: "apply" | "skip" | "revert") {
  return useApiAction({
    path: (v: { id: string; status?: "SUSPENDED" | "EXCLUDED"; reason?: string }) => `${SCHOOLLIFE_BASE}/measure-effects/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: schoollifeEffectDtoSchema,
    invalidate: ALL,
  });
}

export function useCreateNote() {
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/notes`, body: (v: SchoolLifeNoteCreate) => v, schema: schoollifeNoteDtoSchema, invalidate: ALL });
}

export function useWithdrawNote() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${SCHOOLLIFE_BASE}/notes/${v.id}/withdraw`,
    body: (v) => ({ reason: v.reason }),
    schema: schoollifeNoteDtoSchema,
    invalidate: ALL,
  });
}

export function useCreateConvocation() {
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/convocations`, body: (v: SchoolLifeConvocationCreate) => v, schema: schoollifeConvocationDtoSchema, invalidate: ALL });
}

export function useConvocationAction(action: "send" | "hold" | "no-show" | "cancel" | "reschedule" | "acknowledge") {
  return useApiAction({
    path: (v: { id: string; channels?: string[]; outcomeNote?: string; reason?: string; scheduledAt?: string; location?: string; guardianId?: string }) => `${SCHOOLLIFE_BASE}/convocations/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: schoollifeConvocationDtoSchema,
    invalidate: ALL,
  });
}

// ---------------------------------------------------------------------------
// Barèmes de conduite (paramètres) et ajustement manuel
// ---------------------------------------------------------------------------

export function useCreateScale() {
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/conduct-scales`, body: (v: SchoolLifeScaleCreate) => v, schema: schoollifeScaleDtoSchema, invalidate: ALL });
}

export function useSetScaleItems() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; items: Array<{ eventTypeId: string; pointsDelta: number }> }) => `${SCHOOLLIFE_BASE}/conduct-scales/${v.id}/items`,
    body: (v) => ({ items: v.items }),
    schema: schoollifeScaleDtoSchema,
    invalidate: ALL,
  });
}

export function useScaleAction(action: "activate" | "retire") {
  return useApiAction({ path: (v: { id: string }) => `${SCHOOLLIFE_BASE}/conduct-scales/${v.id}/${action}`, body: () => ({}), schema: schoollifeScaleDtoSchema, invalidate: ALL });
}

export function useAdjustConduct() {
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/conduct-movements`, body: (v: SchoolLifeManualAdjustment) => v, schema: z.object({ movementId: z.string().uuid() }), invalidate: ALL });
}

// ---------------------------------------------------------------------------
// Lecture confidentielle journalisée
// ---------------------------------------------------------------------------

const confidentialContentSchema = z.union([
  z.object({ entityKind: z.literal("INCIDENT"), incident: schoollifeIncidentDtoSchema }),
  z.object({ entityKind: z.literal("MEASURE"), measure: schoollifeMeasureDtoSchema }),
  z.object({ entityKind: z.literal("NOTE"), note: schoollifeNoteDtoSchema }),
  z.object({ entityKind: z.literal("CONVOCATION"), convocation: schoollifeConvocationDtoSchema }),
]);
export type ConfidentialContent = z.infer<typeof confidentialContentSchema>;

export function useReadConfidential() {
  // Pas d'invalidation : la lecture ne modifie pas le dossier ; le journal est tenu par l'API.
  return useApiAction({ path: `${SCHOOLLIFE_BASE}/confidential-reads`, body: (v: SchoolLifeConfidentialReadInput) => v, schema: confidentialContentSchema });
}

export function useConfidentialReads(entityId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "reads", entityId], `${SCHOOLLIFE_BASE}/confidential-reads`, { schema: itemsOf(schoollifeConfidentialReadDtoSchema), select: pickItems, query: { entityId: entityId ?? undefined } as Query, enabled: enabled && entityId !== null, retry: false });
}

// ---------------------------------------------------------------------------
// Portails : famille et élève
// ---------------------------------------------------------------------------

export function useMyChildren(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "children"], `${SCHOOLLIFE_BASE}/me/children`, { schema: itemsOf(z.object({ studentId: z.string().uuid(), studentName: z.string().nullable() })), select: pickItems, enabled, retry: false });
}

export function useChildLife(studentId: string | null) {
  return hooks.useApiQuery([...KEY, "child", studentId], `${SCHOOLLIFE_BASE}/children/${studentId}/life`, { schema: schoollifeFamilyLifeDtoSchema, enabled: studentId !== null, retry: false });
}

export function useMyLife(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "life"], `${SCHOOLLIFE_BASE}/me/life`, { schema: schoollifeFamilyLifeDtoSchema, enabled, retry: false });
}
