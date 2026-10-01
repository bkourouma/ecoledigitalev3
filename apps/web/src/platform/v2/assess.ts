"use client";

/**
 * Hooks typés du module `assess` (`/api/v1/assess/*`) : types d'évaluation, évaluations, feuille de notes, circuit de
 * validation, révisions de notes publiées, verrous de période. Schémas Zod de `packages/contracts/src/v2/assess.ts`.
 *
 * AUCUN calcul ici ni dans les écrans : une moyenne, un rang ou une mention vient de `results` (via `rules`). Le web
 * transmet des saisies, affiche les états renvoyés et laisse l'API décider (transitions légales, séparation des tâches,
 * verrou de période, immutabilité après publication).
 *
 * Clés de cache : `["assess", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  assessGradeDtoSchema,
  assessPeriodLockDtoSchema,
  assessRevisionDtoSchema,
  assessGradeHistoryDtoSchema,
  assessSettingsDtoSchema,
  assessStatusSchema,
  assessTypeDtoSchema,
  assessmentDtoSchema,
  assessSaveGradesResultDtoSchema,
  assessPublishedGradesPageDtoSchema,
  type AssessmentDto,
  type AssessmentCreateBody,
  type AssessTypeCreateBody,
} from "@ecoledigitale/contracts/v2/assess";
import { useApiAction } from "./actions";

export const ASSESS_BASE = "/api/v1/assess";

/** Ligne de lot envoyée à l'API (la normalisation décimale est faite par le contrat côté serveur). */
export interface GradeEntryInput {
  enrollmentId: string;
  score?: string | number | null;
  entryStatus?: "ENTERED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED" | "EXEMPT" | "NOT_GRADED";
  comment?: string | null;
  rowVersion?: number;
}

export interface AssessAdditionInput {
  enrollmentId: string;
  newScore?: string | number | null;
  newEntryStatus?: string;
  reason: string;
}

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
const pageOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });

type Query = Record<string, string | number | boolean | undefined>;

// ---------------------------------------------------------------------------
// Types d'évaluation et réglages
// ---------------------------------------------------------------------------

export function useAssessmentTypes(options: { includeInactive?: boolean; enabled?: boolean } = {}) {
  return hooks.useApiQuery(["assess", "types"], `${ASSESS_BASE}/assessment-types`, {
    schema: itemsOf(assessTypeDtoSchema),
    select: pickItems,
    query: options.includeInactive ? { includeInactive: "true" } : undefined,
    enabled: options.enabled,
    staleTime: 60_000,
  });
}

export function useCreateAssessmentType() {
  return useApiAction({ path: `${ASSESS_BASE}/assessment-types`, body: (v: AssessTypeCreateBody) => v, schema: assessTypeDtoSchema, invalidate: [["assess", "types"]] });
}

export function useUpdateAssessmentType() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ASSESS_BASE}/assessment-types/${v.id}`,
    body: (v) => v.patch,
    schema: assessTypeDtoSchema,
    invalidate: [["assess", "types"]],
  });
}

export function useAssessSettings(enabled = true) {
  return hooks.useApiQuery(["assess", "settings"], `${ASSESS_BASE}/settings`, { schema: assessSettingsDtoSchema, enabled, staleTime: 60_000 });
}

export function useUpdateAssessSettings() {
  return useApiAction({
    method: "PUT",
    path: `${ASSESS_BASE}/settings`,
    body: (v: { requireSeparateReviewer?: boolean; requireSeparateApprover?: boolean; maxScoreDecimals?: number }) => v,
    schema: assessSettingsDtoSchema,
    invalidate: [["assess", "settings"]],
  });
}

// ---------------------------------------------------------------------------
// Évaluations
// ---------------------------------------------------------------------------

export interface AssessmentsQuery {
  classroomId?: string;
  academicPeriodId?: string;
  curriculumNodeId?: string;
  teacherId?: string;
  status?: string;
  sessionNo?: number;
  mine?: boolean;
  limit?: number;
}

const assessmentPageSchema = pageOf(assessmentDtoSchema);

export function useAssessments(query: AssessmentsQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiInfiniteQuery(["assess", "assessments", "list"], `${ASSESS_BASE}/assessments`, {
    schema: assessmentPageSchema,
    query: { limit: 50, ...stripUndefined(query) } as Query,
    getNextCursor: (page) => page.nextCursor,
    enabled: options.enabled,
  });
}

function stripUndefined(o: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (v !== undefined && v !== "") out[k] = v as string | number | boolean;
  return out;
}

export function useAssessment(id: string | null) {
  return hooks.useApiQuery(["assess", "assessments", "one", id], `${ASSESS_BASE}/assessments/${id}`, { schema: assessmentDtoSchema, enabled: id !== null });
}

const transitionDtoSchema = z.object({
  id: z.string(),
  from: assessStatusSchema.nullable(),
  to: assessStatusSchema,
  actorId: z.string().nullable(),
  actorName: z.string().nullable().optional(),
  comment: z.string().nullable(),
  fourEyesWaived: z.boolean().optional(),
  at: z.string(),
});
export type AssessTransitionDto = z.infer<typeof transitionDtoSchema>;

export function useAssessmentTransitions(id: string | null) {
  return hooks.useApiQuery(["assess", "assessments", "transitions", id], `${ASSESS_BASE}/assessments/${id}/transitions`, {
    schema: itemsOf(transitionDtoSchema),
    select: pickItems,
    enabled: id !== null,
  });
}

const ASSESSMENTS_KEY = ["assess", "assessments"] as const;
const GRADES_KEY = ["assess", "grades"] as const;

export function useCreateAssessment() {
  return useApiAction({ path: `${ASSESS_BASE}/assessments`, body: (v: AssessmentCreateBody) => v, schema: assessmentDtoSchema, invalidate: [ASSESSMENTS_KEY] });
}

export function useBulkCreateAssessments() {
  return useApiAction({
    path: `${ASSESS_BASE}/assessments/bulk`,
    body: (v: Record<string, unknown>) => v,
    schema: itemsOf(assessmentDtoSchema),
    invalidate: [ASSESSMENTS_KEY],
  });
}

export function useUpdateAssessment() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ASSESS_BASE}/assessments/${v.id}`,
    body: (v) => v.patch,
    schema: assessmentDtoSchema,
    invalidate: [ASSESSMENTS_KEY],
  });
}

// ---------------------------------------------------------------------------
// Feuille de notes
// ---------------------------------------------------------------------------

/** Feuille de notes : contrat + `pending` (inscrits sans note encore, renvoyés par l'API). */
export const gradeSheetSchema = z.object({
  assessment: assessmentDtoSchema,
  grades: z.array(assessGradeDtoSchema),
  pending: z.array(z.object({ enrollmentId: z.string(), studentId: z.string() })).default([]),
});
export type GradeSheet = z.infer<typeof gradeSheetSchema>;

export function useGradeSheet(assessmentId: string | null) {
  return hooks.useApiQuery(["assess", "grades", "sheet", assessmentId], `${ASSESS_BASE}/assessments/${assessmentId}/grades`, {
    schema: gradeSheetSchema,
    enabled: assessmentId !== null,
    // Aucune relecture automatique pendant la saisie : l'écran gère ses lignes et ses versions (`rowVersion`).
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

/**
 * Enregistrement d'un lot. `idempotencyKey` identifie CE lot : le rejouer (réseau instable) n'écrit rien de plus et
 * l'API renvoie le résultat déjà enregistré (`replayed: true`).
 */
export function useSaveGrades() {
  return useApiAction({
    method: "PUT",
    path: (v: { assessmentId: string; entries: GradeEntryInput[]; idempotencyKey: string }) => `${ASSESS_BASE}/assessments/${v.assessmentId}/grades`,
    body: (v) => ({ entries: v.entries }),
    idempotencyKey: (v) => v.idempotencyKey,
    schema: assessSaveGradesResultDtoSchema,
    // Pas d'invalidation de la feuille : l'écran fusionne le résultat (évite d'écraser les cellules en cours de saisie).
    invalidate: [ASSESSMENTS_KEY],
  });
}

export type AssessTransitionTarget = "SUBMITTED" | "REVIEWED" | "APPROVED" | "PUBLISHED" | "DRAFT";

const transitionResultSchema = z.object({ assessment: assessmentDtoSchema, autoPublished: z.boolean() });

export function useTransitionAssessment() {
  return useApiAction({
    path: (v: { id: string; to: AssessTransitionTarget; comment?: string; rowVersion?: number }) => `${ASSESS_BASE}/assessments/${v.id}/transitions`,
    body: (v) => ({ to: v.to, ...(v.comment ? { comment: v.comment } : {}), ...(v.rowVersion !== undefined ? { rowVersion: v.rowVersion } : {}) }),
    schema: transitionResultSchema,
    invalidate: [ASSESSMENTS_KEY, GRADES_KEY],
  });
}

const cancelResultSchema = z.object({ assessment: assessmentDtoSchema.nullable(), revisions: z.array(assessRevisionDtoSchema) });

export function useCancelAssessment() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${ASSESS_BASE}/assessments/${v.id}/cancel`,
    body: (v) => ({ reason: v.reason }),
    schema: cancelResultSchema,
    invalidate: [ASSESSMENTS_KEY, GRADES_KEY, ["assess", "revisions"]],
  });
}

// ---------------------------------------------------------------------------
// Révisions de notes publiées
// ---------------------------------------------------------------------------

export function useRequestRevision() {
  return useApiAction({
    path: (v: { gradeId: string; body: { newScore?: string | number | null; newEntryStatus?: string; reason: string } }) => `${ASSESS_BASE}/grades/${v.gradeId}/revisions`,
    body: (v) => v.body,
    schema: assessRevisionDtoSchema,
    invalidate: [["assess", "revisions"], GRADES_KEY],
  });
}

export function useRequestAddition() {
  return useApiAction({
    path: (v: { assessmentId: string; body: AssessAdditionInput }) => `${ASSESS_BASE}/assessments/${v.assessmentId}/additions`,
    body: (v) => v.body,
    schema: assessRevisionDtoSchema,
    invalidate: [["assess", "revisions"], GRADES_KEY],
  });
}

export function useGradeHistory(gradeId: string | null) {
  return hooks.useApiQuery(["assess", "grades", "history", gradeId], `${ASSESS_BASE}/grades/${gradeId}/history`, { schema: assessGradeHistoryDtoSchema, enabled: gradeId !== null });
}

export interface RevisionsQuery {
  status?: string;
  assessmentId?: string;
  classroomId?: string;
  limit?: number;
}

export function useRevisions(query: RevisionsQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiInfiniteQuery(["assess", "revisions", "list"], `${ASSESS_BASE}/revisions`, {
    schema: pageOf(assessRevisionDtoSchema),
    query: { limit: 50, ...stripUndefined(query) } as Query,
    getNextCursor: (page) => page.nextCursor,
    enabled: options.enabled,
  });
}

const REVISIONS_KEY = ["assess", "revisions"] as const;
const approveResultSchema = z.object({ revisions: z.array(assessRevisionDtoSchema), applied: z.boolean().optional(), cancelled: assessmentDtoSchema.nullable().optional() });

export function useApproveRevision() {
  return useApiAction({
    path: (v: { id: string; comment?: string }) => `${ASSESS_BASE}/revisions/${v.id}/approve`,
    body: (v) => (v.comment ? { comment: v.comment } : {}),
    schema: approveResultSchema,
    invalidate: [REVISIONS_KEY, GRADES_KEY, ASSESSMENTS_KEY],
  });
}

export function useRejectRevision() {
  return useApiAction({
    path: (v: { id: string; comment: string }) => `${ASSESS_BASE}/revisions/${v.id}/reject`,
    body: (v) => ({ comment: v.comment }),
    schema: z.object({ revisions: z.array(assessRevisionDtoSchema) }),
    invalidate: [REVISIONS_KEY],
  });
}

export function useApplyRevision() {
  return useApiAction({
    path: (v: { id: string }) => `${ASSESS_BASE}/revisions/${v.id}/apply`,
    schema: assessRevisionDtoSchema,
    invalidate: [REVISIONS_KEY, GRADES_KEY],
  });
}

// ---------------------------------------------------------------------------
// Verrou de période, lecture famille
// ---------------------------------------------------------------------------

export function usePeriodLock(classroomId: string | null, periodId: string | null) {
  return hooks.useApiQuery(["assess", "lock", classroomId, periodId], `${ASSESS_BASE}/classrooms/${classroomId}/periods/${periodId}/lock`, {
    schema: z.object({ lock: assessPeriodLockDtoSchema.nullable() }),
    select: (d) => d.lock,
    enabled: classroomId !== null && periodId !== null,
  });
}

export function useMyPublishedGrades(options: { enabled?: boolean; academicPeriodId?: string } = {}) {
  return hooks.useApiQuery(["assess", "me", "grades", options.academicPeriodId ?? null], `${ASSESS_BASE}/me/grades`, {
    schema: assessPublishedGradesPageDtoSchema,
    query: options.academicPeriodId ? { academicPeriodId: options.academicPeriodId } : undefined,
    enabled: options.enabled,
  });
}

export function useChildPublishedGrades(studentId: string | null, options: { academicPeriodId?: string } = {}) {
  return hooks.useApiQuery(["assess", "child", "grades", studentId, options.academicPeriodId ?? null], `${ASSESS_BASE}/children/${studentId}/grades`, {
    schema: assessPublishedGradesPageDtoSchema,
    query: options.academicPeriodId ? { academicPeriodId: options.academicPeriodId } : undefined,
    enabled: studentId !== null,
  });
}

export type { AssessmentDto };
