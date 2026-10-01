"use client";

/**
 * Hooks typés du module `academic` (`/api/v1/academic/*`) : une fonction par ressource, schémas Zod de
 * `packages/contracts/src/v2/academic.ts`. Aucune règle métier ici : les écrans affichent ce que l'API renvoie et lui
 * transmettent les actions (la décision — transition d'état, éligibilité, capacité — appartient au serveur).
 *
 * Clés de cache : `["academic", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  academicAmendmentDtoSchema,
  academicCatalogItemDtoSchema,
  academicClassroomDtoSchema,
  academicCurriculumNodeDtoSchema,
  academicCurriculumTreeDtoSchema,
  academicCurriculumVersionDtoSchema,
  academicEducationLevelDtoSchema,
  academicEnrollmentCourseDtoSchema,
  academicEnrollmentNodeViewSchema,
  academicEnrollmentDetailDtoSchema,
  academicEnrollmentDtoSchema,
  academicEnrollmentOutcomeDtoSchema,
  academicFundingTypeDtoSchema,
  academicGradeLevelDtoSchema,
  academicHistoryEntryDtoSchema,
  academicNodeTypeDtoSchema,
  academicOfferingDtoSchema,
  academicOpenPeriodOfferingsResultSchema,
  academicPageSchema,
  academicPeriodDtoSchema,
  academicPeriodPlanDtoSchema,
  academicPeriodTypeDtoSchema,
  academicProgramDtoSchema,
  academicRosterDtoSchema,
  academicSettingsDtoSchema,
  academicSubjectDtoSchema,
  academicValidationReportSchema,
  academicYearDtoSchema,
  type AcademicAmendBody,
  type AcademicCreateClassroomBody,
  type AcademicCreateNodeBody,
  type AcademicCreateOfferingBody,
  type AcademicCreatePeriodBody,
  type AcademicCreateProgramBody,
  type AcademicCreateSubjectBody,
  type AcademicCreateYearBody,
  type AcademicEnrollStudentBody,
  type AcademicOpenPeriodOfferingsBody,
  type AcademicReferenceKind,
  type AcademicUpdateNodeBody,
} from "@ecoledigitale/contracts/v2/academic";
import { useApiAction } from "./actions";

export const ACADEMIC_BASE = "/api/v1/academic";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

const REFERENCE_SCHEMAS = {
  "education-levels": academicEducationLevelDtoSchema,
  "grade-levels": academicGradeLevelDtoSchema,
  "period-types": academicPeriodTypeDtoSchema,
  "period-plans": academicPeriodPlanDtoSchema,
  "funding-types": academicFundingTypeDtoSchema,
  "enrollment-outcomes": academicEnrollmentOutcomeDtoSchema,
  "node-types": academicNodeTypeDtoSchema,
} as const satisfies Record<AcademicReferenceKind, z.ZodTypeAny>;

type ReferenceItem<K extends AcademicReferenceKind> = z.infer<(typeof REFERENCE_SCHEMAS)[K]>;

export function useReference<K extends AcademicReferenceKind>(kind: K, options: { enabled?: boolean } = {}) {
  const schema = itemsOf(REFERENCE_SCHEMAS[kind]) as unknown as z.ZodType<{ items: ReferenceItem<K>[] }, z.ZodTypeDef, unknown>;
  return hooks.useApiQuery(["academic", "reference", kind], `${ACADEMIC_BASE}/reference/${kind}`, { schema, select: pickItems, staleTime: 5 * 60_000, enabled: options.enabled });
}

export function useAcademicSettings(institutionId: string | null) {
  return hooks.useApiQuery(["academic", "settings", institutionId], `${ACADEMIC_BASE}/institutions/${institutionId}/settings`, {
    schema: academicSettingsDtoSchema,
    enabled: institutionId !== null,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Années et périodes
// ---------------------------------------------------------------------------

const yearsSchema = itemsOf(academicYearDtoSchema);

export function useAcademicYears(query: { institutionId?: string; status?: string } = {}) {
  return hooks.useApiQuery(["academic", "years", "list"], `${ACADEMIC_BASE}/years`, { schema: yearsSchema, select: pickItems, query });
}

export function useAcademicYear(id: string | null) {
  return hooks.useApiQuery(["academic", "years", "one", id], `${ACADEMIC_BASE}/years/${id}`, { schema: academicYearDtoSchema, enabled: id !== null });
}

export function useYearPeriods(yearId: string | null) {
  return hooks.useApiQuery(["academic", "years", "periods", yearId], `${ACADEMIC_BASE}/years/${yearId}/periods`, {
    schema: itemsOf(academicPeriodDtoSchema),
    select: pickItems,
    enabled: yearId !== null,
  });
}

const YEARS_KEY = ["academic", "years"] as const;

export function useCreateYear() {
  return useApiAction({ path: `${ACADEMIC_BASE}/years`, body: (v: AcademicCreateYearBody) => v, schema: academicYearDtoSchema, invalidate: [YEARS_KEY] });
}

export function useUpdateYear() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ACADEMIC_BASE}/years/${v.id}`,
    body: (v) => v.patch,
    schema: academicYearDtoSchema,
    invalidate: [YEARS_KEY],
  });
}

export type YearAction = "open" | "set-current" | "archive";
export function useYearAction(action: YearAction) {
  return useApiAction({ path: (v: { id: string }) => `${ACADEMIC_BASE}/years/${v.id}/${action}`, schema: academicYearDtoSchema, invalidate: [YEARS_KEY] });
}

export function useCloseYear() {
  return useApiAction({
    path: (v: { id: string; reason?: string }) => `${ACADEMIC_BASE}/years/${v.id}/close`,
    body: (v) => (v.reason ? { reason: v.reason } : {}),
    schema: academicYearDtoSchema,
    invalidate: [YEARS_KEY],
  });
}

export function useCreatePeriod() {
  return useApiAction({
    path: (v: { yearId: string; body: AcademicCreatePeriodBody }) => `${ACADEMIC_BASE}/years/${v.yearId}/periods`,
    body: (v) => v.body,
    schema: academicPeriodDtoSchema,
    invalidate: [YEARS_KEY],
  });
}

export function useApplyPeriodPlan() {
  return useApiAction({
    path: (v: { yearId: string; planCode: string }) => `${ACADEMIC_BASE}/years/${v.yearId}/period-plan`,
    body: (v) => ({ planCode: v.planCode }),
    schema: itemsOf(academicPeriodDtoSchema),
    invalidate: [YEARS_KEY],
  });
}

export function useUpdatePeriod() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ACADEMIC_BASE}/periods/${v.id}`,
    body: (v) => v.patch,
    schema: academicPeriodDtoSchema,
    invalidate: [YEARS_KEY],
  });
}

export function useDeletePeriod() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${ACADEMIC_BASE}/periods/${v.id}`, invalidate: [YEARS_KEY] });
}

export type PeriodAction = "open" | "close-grading" | "close";
export function usePeriodAction(action: PeriodAction) {
  return useApiAction({ path: (v: { id: string }) => `${ACADEMIC_BASE}/periods/${v.id}/${action}`, schema: academicPeriodDtoSchema, invalidate: [YEARS_KEY] });
}

export function useReopenPeriod() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${ACADEMIC_BASE}/periods/${v.id}/reopen`,
    body: (v) => ({ reason: v.reason }),
    schema: academicPeriodDtoSchema,
    invalidate: [YEARS_KEY],
  });
}

// ---------------------------------------------------------------------------
// Programmes et matières
// ---------------------------------------------------------------------------

export function usePrograms(query: { institutionId?: string; status?: string; educationLevelId?: string } = {}) {
  return hooks.useApiQuery(["academic", "programs", "list"], `${ACADEMIC_BASE}/programs`, { schema: itemsOf(academicProgramDtoSchema), select: pickItems, query });
}

export function useCreateProgram() {
  return useApiAction({ path: `${ACADEMIC_BASE}/programs`, body: (v: AcademicCreateProgramBody) => v, schema: academicProgramDtoSchema, invalidate: [["academic", "programs"]] });
}

export function useUpdateProgram() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ACADEMIC_BASE}/programs/${v.id}`,
    body: (v) => v.patch,
    schema: academicProgramDtoSchema,
    invalidate: [["academic", "programs"]],
  });
}

export function useSetProgramGradeLevels() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; gradeLevelIds: string[] }) => `${ACADEMIC_BASE}/programs/${v.id}/grade-levels`,
    body: (v) => ({ gradeLevelIds: v.gradeLevelIds }),
    schema: academicProgramDtoSchema,
    invalidate: [["academic", "programs"]],
  });
}

export function useSubjects(query: { institutionId?: string; status?: string; search?: string } = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["academic", "subjects", "list"], `${ACADEMIC_BASE}/subjects`, { schema: itemsOf(academicSubjectDtoSchema), select: pickItems, query, enabled: options.enabled });
}

export function useCreateSubject() {
  return useApiAction({ path: `${ACADEMIC_BASE}/subjects`, body: (v: AcademicCreateSubjectBody) => v, schema: academicSubjectDtoSchema, invalidate: [["academic", "subjects"]] });
}

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

const CURRICULUM_KEY = ["academic", "curriculum"] as const;

export function useCurriculumVersions(query: { programId?: string; yearId?: string; status?: string }, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["academic", "curriculum", "versions"], `${ACADEMIC_BASE}/curriculum-versions`, {
    schema: itemsOf(academicCurriculumVersionDtoSchema),
    select: pickItems,
    query,
    enabled: options.enabled,
  });
}

export function useCurriculumTree(versionId: string | null) {
  return hooks.useApiQuery(["academic", "curriculum", "tree", versionId], `${ACADEMIC_BASE}/curriculum-versions/${versionId}`, {
    schema: academicCurriculumTreeDtoSchema,
    enabled: versionId !== null,
  });
}

export function useCurriculumValidation(versionId: string | null, enabled = true) {
  return hooks.useApiQuery(["academic", "curriculum", "validation", versionId], `${ACADEMIC_BASE}/curriculum-versions/${versionId}/validate`, {
    schema: academicValidationReportSchema,
    enabled: versionId !== null && enabled,
  });
}

export function useCurriculumAmendments(versionId: string | null, enabled = true) {
  return hooks.useApiQuery(["academic", "curriculum", "amendments", versionId], `${ACADEMIC_BASE}/curriculum-versions/${versionId}/amendments`, {
    schema: itemsOf(academicAmendmentDtoSchema),
    select: pickItems,
    enabled: versionId !== null && enabled,
  });
}

export function useCreateCurriculumVersion() {
  return useApiAction({
    path: `${ACADEMIC_BASE}/curriculum-versions`,
    body: (v: { programId: string; academicYearId: string; cloneFromVersionId?: string; note?: string }) => v,
    schema: academicCurriculumVersionDtoSchema,
    invalidate: [CURRICULUM_KEY],
  });
}

export function useCloneCurriculumVersion() {
  return useApiAction({
    path: (v: { sourceVersionId: string; academicYearId: string; note?: string }) => `${ACADEMIC_BASE}/curriculum-versions/${v.sourceVersionId}/clone`,
    body: (v) => ({ academicYearId: v.academicYearId, ...(v.note ? { note: v.note } : {}) }),
    schema: academicCurriculumVersionDtoSchema,
    invalidate: [CURRICULUM_KEY],
  });
}

export function useAddCurriculumNode() {
  return useApiAction({
    path: (v: { versionId: string; node: AcademicCreateNodeBody }) => `${ACADEMIC_BASE}/curriculum-versions/${v.versionId}/nodes`,
    body: (v) => v.node,
    schema: academicCurriculumNodeDtoSchema,
    invalidate: [CURRICULUM_KEY],
  });
}

export function useUpdateCurriculumNode() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: AcademicUpdateNodeBody }) => `${ACADEMIC_BASE}/curriculum-nodes/${v.id}`,
    body: (v) => v.patch,
    schema: academicCurriculumNodeDtoSchema,
    invalidate: [CURRICULUM_KEY],
  });
}

export function useRemoveCurriculumNode() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${ACADEMIC_BASE}/curriculum-nodes/${v.id}`, invalidate: [CURRICULUM_KEY] });
}

export function useMoveCurriculumNode() {
  return useApiAction({
    path: (v: { id: string; parentId: string | null; ordinal?: number }) => `${ACADEMIC_BASE}/curriculum-nodes/${v.id}/move`,
    body: (v) => ({ parentId: v.parentId, ...(v.ordinal !== undefined ? { ordinal: v.ordinal } : {}) }),
    schema: academicCurriculumNodeDtoSchema,
    invalidate: [CURRICULUM_KEY],
  });
}

export function useSetNodePrerequisites() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; requiredLineageIds: string[] }) => `${ACADEMIC_BASE}/curriculum-nodes/${v.id}/prerequisites`,
    body: (v) => ({ requiredLineageIds: v.requiredLineageIds }),
    invalidate: [CURRICULUM_KEY],
  });
}

export function usePublishCurriculumVersion() {
  return useApiAction({
    path: (v: { id: string }) => `${ACADEMIC_BASE}/curriculum-versions/${v.id}/publish`,
    schema: academicCurriculumVersionDtoSchema,
    invalidate: [CURRICULUM_KEY],
  });
}

export function useAmendCurriculumVersion() {
  return useApiAction({
    path: (v: { id: string; body: AcademicAmendBody }) => `${ACADEMIC_BASE}/curriculum-versions/${v.id}/amend`,
    body: (v) => v.body,
    invalidate: [CURRICULUM_KEY],
  });
}

// ---------------------------------------------------------------------------
// Classes et offres
// ---------------------------------------------------------------------------

export interface ClassroomsQuery {
  institutionId?: string;
  academicYearId?: string;
  programId?: string;
  gradeLevelId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export function useClassrooms(query: ClassroomsQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["academic", "classrooms", "list"], `${ACADEMIC_BASE}/classrooms`, {
    schema: academicPageSchema(academicClassroomDtoSchema),
    query: query as Record<string, string | number | undefined>,
    enabled: options.enabled,
  });
}

export function useClassroom(id: string | null) {
  return hooks.useApiQuery(["academic", "classrooms", "one", id], `${ACADEMIC_BASE}/classrooms/${id}`, { schema: academicClassroomDtoSchema, enabled: id !== null });
}

export function useClassroomRoster(id: string | null) {
  return hooks.useApiQuery(["academic", "classrooms", "roster", id], `${ACADEMIC_BASE}/classrooms/${id}/roster`, { schema: academicRosterDtoSchema, enabled: id !== null });
}

const CLASSROOMS_KEY = ["academic", "classrooms"] as const;

export function useCreateClassroom() {
  return useApiAction({ path: `${ACADEMIC_BASE}/classrooms`, body: (v: AcademicCreateClassroomBody) => v, schema: academicClassroomDtoSchema, invalidate: [CLASSROOMS_KEY] });
}

export function useUpdateClassroom() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ACADEMIC_BASE}/classrooms/${v.id}`,
    body: (v) => v.patch,
    schema: academicClassroomDtoSchema,
    invalidate: [CLASSROOMS_KEY],
  });
}

export type ClassroomAction = "activate" | "complete" | "cancel";
export function useClassroomAction() {
  return useApiAction({
    path: (v: { id: string; action: ClassroomAction; reason?: string }) => `${ACADEMIC_BASE}/classrooms/${v.id}/${v.action}`,
    body: (v) => (v.reason ? { reason: v.reason } : {}),
    schema: academicClassroomDtoSchema,
    invalidate: [CLASSROOMS_KEY],
  });
}

export function useClassroomOfferings(classroomId: string | null, status?: string) {
  return hooks.useApiQuery(["academic", "offerings", "list", classroomId], `${ACADEMIC_BASE}/classrooms/${classroomId}/offerings`, {
    schema: itemsOf(academicOfferingDtoSchema),
    select: pickItems,
    query: status ? { status } : undefined,
    enabled: classroomId !== null,
    retry: false,
  });
}

const OFFERINGS_KEY = ["academic", "offerings"] as const;

export function useCreateOffering() {
  return useApiAction({
    path: (v: { classroomId: string; body: AcademicCreateOfferingBody }) => `${ACADEMIC_BASE}/classrooms/${v.classroomId}/offerings`,
    body: (v) => v.body,
    schema: academicOfferingDtoSchema,
    invalidate: [OFFERINGS_KEY],
  });
}

export function useOpenPeriodOfferings() {
  return useApiAction({
    path: (v: { classroomId: string; body: AcademicOpenPeriodOfferingsBody }) => `${ACADEMIC_BASE}/classrooms/${v.classroomId}/offerings/open-period`,
    body: (v) => v.body,
    schema: academicOpenPeriodOfferingsResultSchema,
    invalidate: [OFFERINGS_KEY],
  });
}

export type OfferingAction = "open" | "start" | "complete" | "cancel";
export function useOfferingAction() {
  return useApiAction({
    path: (v: { id: string; action: OfferingAction; reason?: string }) => `${ACADEMIC_BASE}/offerings/${v.id}/${v.action}`,
    body: (v) => (v.reason ? { reason: v.reason } : {}),
    schema: academicOfferingDtoSchema,
    invalidate: [OFFERINGS_KEY],
  });
}

export function useUpdateOffering() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${ACADEMIC_BASE}/offerings/${v.id}`,
    body: (v) => v.patch,
    schema: academicOfferingDtoSchema,
    invalidate: [OFFERINGS_KEY],
  });
}

// ---------------------------------------------------------------------------
// Inscriptions
// ---------------------------------------------------------------------------

export interface EnrollmentsQuery {
  institutionId?: string;
  academicYearId?: string;
  classroomId?: string;
  studentId?: string;
  status?: string;
  mode?: string;
  fundingType?: string;
  registrationNumber?: string;
  page?: number;
  pageSize?: number;
}

export function useEnrollments(query: EnrollmentsQuery = {}) {
  return hooks.useApiQuery(["academic", "enrollments", "list"], `${ACADEMIC_BASE}/enrollments`, {
    schema: academicPageSchema(academicEnrollmentDtoSchema),
    query: query as Record<string, string | number | undefined>,
  });
}

export function useEnrollmentDetail(id: string | null) {
  return hooks.useApiQuery(["academic", "enrollments", "one", id], `${ACADEMIC_BASE}/enrollments/${id}`, { schema: academicEnrollmentDetailDtoSchema, enabled: id !== null });
}

export function useEnrollmentHistory(id: string | null) {
  return hooks.useApiQuery(["academic", "enrollments", "history", id], `${ACADEMIC_BASE}/enrollments/${id}/history`, {
    schema: itemsOf(academicHistoryEntryDtoSchema),
    select: pickItems,
    enabled: id !== null,
  });
}

export function useEnrollmentCourses(id: string | null) {
  return hooks.useApiQuery(["academic", "enrollments", "courses", id], `${ACADEMIC_BASE}/enrollments/${id}/courses`, {
    schema: itemsOf(academicEnrollmentCourseDtoSchema),
    select: pickItems,
    enabled: id !== null,
    retry: false,
  });
}

/** Mes inscriptions (élève) / inscriptions d'un enfant (parent). */
export function useMyEnrollments(enabled = true) {
  return hooks.useApiQuery(["academic", "enrollments", "mine"], `${ACADEMIC_BASE}/me/enrollments`, { schema: itemsOf(academicEnrollmentDtoSchema), select: pickItems, enabled });
}

export function useChildEnrollments(studentId: string | null) {
  return hooks.useApiQuery(["academic", "enrollments", "child", studentId], `${ACADEMIC_BASE}/children/${studentId}/enrollments`, {
    schema: itemsOf(academicEnrollmentDtoSchema),
    select: pickItems,
    enabled: studentId !== null,
  });
}

const ENROLLMENTS_KEY = ["academic", "enrollments"] as const;

export function useEnrollStudent() {
  return useApiAction({
    path: `${ACADEMIC_BASE}/enrollments`,
    body: (v: AcademicEnrollStudentBody) => v,
    schema: academicEnrollmentDtoSchema,
    invalidate: [ENROLLMENTS_KEY, CLASSROOMS_KEY, ["people", "students"]],
  });
}

export type EnrollmentAction = "confirm" | "resume" | "reopen" | "suspend" | "complete" | "withdraw" | "cancel";
export function useEnrollmentAction() {
  return useApiAction({
    path: (v: { id: string; action: EnrollmentAction; reason?: string }) => `${ACADEMIC_BASE}/enrollments/${v.id}/${v.action}`,
    body: (v) => (v.reason ? { reason: v.reason } : {}),
    schema: academicEnrollmentDtoSchema,
    invalidate: [ENROLLMENTS_KEY, CLASSROOMS_KEY],
  });
}

export function useTransferEnrollment() {
  return useApiAction({
    path: (v: { id: string; toClassroomId: string; effectiveOn?: string; reason: string }) => `${ACADEMIC_BASE}/enrollments/${v.id}/transfer`,
    body: (v) => ({ toClassroomId: v.toClassroomId, reason: v.reason, ...(v.effectiveOn ? { effectiveOn: v.effectiveOn } : {}) }),
    schema: academicEnrollmentDtoSchema,
    invalidate: [ENROLLMENTS_KEY, CLASSROOMS_KEY],
  });
}

export function useChangeEnrollmentFunding() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; body: Record<string, unknown> }) => `${ACADEMIC_BASE}/enrollments/${v.id}/funding`,
    body: (v) => v.body,
    schema: academicEnrollmentDtoSchema,
    invalidate: [ENROLLMENTS_KEY],
  });
}

export function useConfirmEnrollmentCourse() {
  return useApiAction({ path: (v: { id: string }) => `${ACADEMIC_BASE}/enrollment-courses/${v.id}/confirm`, body: () => ({}), invalidate: [ENROLLMENTS_KEY] });
}

export function useCancelEnrollmentCourse() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${ACADEMIC_BASE}/enrollment-courses/${v.id}/cancel`,
    body: (v) => ({ reason: v.reason }),
    invalidate: [ENROLLMENTS_KEY],
  });
}

/** Catalogue des offres ouvertes (inscription à la carte), avec l'éligibilité de l'étudiant évaluée par le serveur. */
export function useCatalog(query: { studentId?: string; programId?: string }, enabled = true) {
  return hooks.useApiQuery(["academic", "catalog"], `${ACADEMIC_BASE}/catalog`, { schema: itemsOf(academicCatalogItemDtoSchema), select: pickItems, query, enabled, retry: false });
}

export function useAddEnrollmentCourse() {
  return useApiAction({
    path: (v: { enrollmentId: string; offeringId?: string; curriculumNodeId?: string; override?: { reason: string } }) => `${ACADEMIC_BASE}/enrollments/${v.enrollmentId}/courses`,
    body: (v) => ({ ...(v.offeringId ? { offeringId: v.offeringId } : {}), ...(v.curriculumNodeId ? { curriculumNodeId: v.curriculumNodeId } : {}), ...(v.override ? { override: v.override } : {}) }),
    schema: academicEnrollmentCourseDtoSchema,
    invalidate: [ENROLLMENTS_KEY, OFFERINGS_KEY],
  });
}

/** Nœuds du curriculum d'une classe (matières, UE…), vus par l'inscription : sert de lignes à la matrice des affectations. */
export function useClassroomNodes(classroomId: string | null) {
  return hooks.useApiQuery(["academic", "classrooms", "nodes", classroomId], `${ACADEMIC_BASE}/classrooms/${classroomId}/nodes`, {
    schema: itemsOf(academicEnrollmentNodeViewSchema),
    select: pickItems,
    enabled: classroomId !== null,
    retry: false,
  });
}
