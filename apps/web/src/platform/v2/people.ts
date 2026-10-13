"use client";

/**
 * Hooks typés du module `people` (`/api/v1/people/*`) : élèves, tuteurs, personnel, affectations d'enseignement.
 * Schémas Zod de `packages/contracts/src/v2/people.ts`. Le contrôle d'accès fin (parent -> SES enfants, enseignant ->
 * ses classes, champs sensibles masqués) est appliqué par l'API : l'écran affiche ce qui est renvoyé, rien de plus.
 */

import { z } from "zod";
import { ApiError } from "@/platform/api/errors";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  peopleAssignmentDtoSchema,
  peopleAvailabilityDtoSchema,
  peopleChildDtoSchema,
  peopleCompetencyDtoSchema,
  peopleContractDtoSchema,
  peopleContractTypeDtoSchema,
  peopleCreateAssignmentResultDtoSchema,
  peopleDuplicateCandidateDtoSchema,
  peopleEmergencyContactDtoSchema,
  peopleExpiringQualificationDtoSchema,
  peopleGuardianDtoSchema,
  peopleGuardianLinkDtoSchema,
  peopleListStaffQuerySchema,
  peopleListStudentsQuerySchema,
  peopleMyClassDtoSchema,
  peoplePriorEducationDtoSchema,
  peopleQualificationDtoSchema,
  peopleRelationshipTypeDtoSchema,
  peopleStaffCategoryDtoSchema,
  peopleStaffDetailDtoSchema,
  peopleStaffStatusHistoryDtoSchema,
  peopleStaffSummaryDtoSchema,
  peopleStatusHistoryDtoSchema,
  peopleStudentDetailDtoSchema,
  peopleStudentEnrollmentDtoSchema,
  peopleStudentGuardianDtoSchema,
  peopleStudentSensitiveDtoSchema,
  peopleStudentSummaryDtoSchema,
  peopleTeachingLoadDtoSchema,
  peopleUnstaffedNodeDtoSchema,
  type PeopleChangeStatusBody,
  type PeopleCreateAssignmentBody,
  type PeopleCreateGuardianBody,
  type PeopleCreateStaffBody,
  type PeopleCreateStudentBody,
  type PeopleLinkGuardianBody,
  type PeopleUpdateLinkBody,
} from "@ecoledigitale/contracts/v2/people";
import { useApiAction } from "./actions";

export const PEOPLE_BASE = "/api/v1/people";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
const listOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });

type Query = Record<string, string | number | boolean | undefined>;

// ---------------------------------------------------------------------------
// Élèves
// ---------------------------------------------------------------------------

export type StudentsQuery = Partial<z.input<typeof peopleListStudentsQuerySchema>>;

export function useStudents(query: StudentsQuery, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["people", "students", "list"], `${PEOPLE_BASE}/students`, { schema: listOf(peopleStudentSummaryDtoSchema), query: query as Query, enabled: options.enabled });
}

export function useStudent(id: string | null) {
  return hooks.useApiQuery(["people", "students", "one", id], `${PEOPLE_BASE}/students/${id}`, { schema: peopleStudentDetailDtoSchema, enabled: id !== null });
}

export function useStudentSensitive(id: string | null, enabled: boolean) {
  return hooks.useApiQuery(["people", "students", "sensitive", id], `${PEOPLE_BASE}/students/${id}/sensitive`, {
    schema: peopleStudentSensitiveDtoSchema,
    enabled: id !== null && enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useStudentStatusHistory(id: string | null, enabled = true) {
  return hooks.useApiQuery(["people", "students", "history", id], `${PEOPLE_BASE}/students/${id}/history`, {
    schema: itemsOf(peopleStatusHistoryDtoSchema),
    select: pickItems,
    enabled: id !== null && enabled,
    retry: false,
  });
}

export function useStudentEnrollments(id: string | null, enabled = true) {
  return hooks.useApiQuery(["people", "students", "enrollments", id], `${PEOPLE_BASE}/students/${id}/enrollments`, {
    schema: itemsOf(peopleStudentEnrollmentDtoSchema),
    select: pickItems,
    enabled: id !== null && enabled,
    retry: false,
  });
}

export function useStudentEmergencyContacts(id: string | null) {
  return hooks.useApiQuery(["people", "students", "emergency", id], `${PEOPLE_BASE}/students/${id}/emergency-contacts`, {
    schema: itemsOf(peopleEmergencyContactDtoSchema),
    select: pickItems,
    enabled: id !== null,
    retry: false,
  });
}

export function useStudentPriorEducation(id: string | null, enabled = true) {
  return hooks.useApiQuery(["people", "students", "prior", id], `${PEOPLE_BASE}/students/${id}/prior-education`, {
    schema: itemsOf(peoplePriorEducationDtoSchema),
    select: pickItems,
    enabled: id !== null && enabled,
    retry: false,
  });
}

export function useStudentGuardians(id: string | null, enabled = true) {
  return hooks.useApiQuery(["people", "students", "guardians", id], `${PEOPLE_BASE}/students/${id}/guardians`, {
    schema: itemsOf(peopleStudentGuardianDtoSchema),
    select: pickItems,
    enabled: id !== null && enabled,
    retry: false,
  });
}

/** Doublons possibles AVANT la création (nom + date de naissance) : avertissement, jamais un blocage. */
export function useDuplicateStudents(query: { lastName: string; firstName: string; birthDate?: string }, enabled: boolean) {
  return hooks.useApiQuery(["people", "students", "duplicates"], `${PEOPLE_BASE}/students/duplicates`, {
    schema: itemsOf(peopleDuplicateCandidateDtoSchema),
    select: pickItems,
    query,
    enabled,
    retry: false,
    staleTime: 0,
  });
}

const STUDENTS_KEY = ["people", "students"] as const;

export const createStudentResultSchema = z.union([
  z.object({ valid: z.literal(true), duplicates: z.array(peopleDuplicateCandidateDtoSchema) }),
  z.object({ student: peopleStudentDetailDtoSchema, replayed: z.boolean() }),
]);

export function useCreateStudent() {
  return useApiAction({ path: `${PEOPLE_BASE}/students`, body: (v: PeopleCreateStudentBody) => v, schema: createStudentResultSchema, invalidate: [STUDENTS_KEY] });
}

export function useUpdateStudent() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${PEOPLE_BASE}/students/${v.id}`,
    body: (v) => v.patch,
    schema: peopleStudentDetailDtoSchema,
    invalidate: [STUDENTS_KEY],
  });
}

export function useChangeStudentStatus() {
  return useApiAction({
    path: (v: { id: string; body: PeopleChangeStatusBody }) => `${PEOPLE_BASE}/students/${v.id}/status`,
    body: (v) => v.body,
    invalidate: [STUDENTS_KEY],
  });
}

export function useAddEmergencyContact() {
  return useApiAction({
    path: (v: { studentId: string; body: Record<string, unknown> }) => `${PEOPLE_BASE}/students/${v.studentId}/emergency-contacts`,
    body: (v) => v.body,
    schema: peopleEmergencyContactDtoSchema,
    invalidate: [["people", "students", "emergency"]],
  });
}

export function useRemoveEmergencyContact() {
  return useApiAction({
    method: "DELETE",
    path: (v: { studentId: string; contactId: string }) => `${PEOPLE_BASE}/students/${v.studentId}/emergency-contacts/${v.contactId}`,
    invalidate: [["people", "students", "emergency"]],
  });
}

export function useAddPriorEducation() {
  return useApiAction({
    path: (v: { studentId: string; body: Record<string, unknown> }) => `${PEOPLE_BASE}/students/${v.studentId}/prior-education`,
    body: (v) => v.body,
    schema: peoplePriorEducationDtoSchema,
    invalidate: [["people", "students", "prior"]],
  });
}

export function useRemovePriorEducation() {
  return useApiAction({
    method: "DELETE",
    path: (v: { studentId: string; entryId: string }) => `${PEOPLE_BASE}/students/${v.studentId}/prior-education/${v.entryId}`,
    invalidate: [["people", "students", "prior"]],
  });
}

// ---------------------------------------------------------------------------
// Tuteurs
// ---------------------------------------------------------------------------

export function useGuardians(query: { q?: string; studentId?: string; limit?: number; offset?: number }, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["people", "guardians", "list"], `${PEOPLE_BASE}/guardians`, { schema: listOf(peopleGuardianDtoSchema), query: query as Query, enabled: options.enabled });
}

export function useGuardian(id: string | null) {
  return hooks.useApiQuery(["people", "guardians", "one", id], `${PEOPLE_BASE}/guardians/${id}`, { schema: peopleGuardianDtoSchema, enabled: id !== null });
}

const GUARDIANS_KEY = ["people", "guardians"] as const;

export function useCreateGuardian() {
  return useApiAction({
    path: `${PEOPLE_BASE}/guardians`,
    body: (v: PeopleCreateGuardianBody) => v,
    schema: z.object({ guardian: peopleGuardianDtoSchema, duplicates: z.array(peopleDuplicateCandidateDtoSchema) }),
    invalidate: [GUARDIANS_KEY],
  });
}

export function useUpdateGuardian() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${PEOPLE_BASE}/guardians/${v.id}`,
    body: (v) => v.patch,
    schema: peopleGuardianDtoSchema,
    invalidate: [GUARDIANS_KEY, ["people", "students", "guardians"]],
  });
}

export function useLinkGuardian() {
  return useApiAction({
    path: (v: { studentId: string; body: PeopleLinkGuardianBody }) => `${PEOPLE_BASE}/students/${v.studentId}/guardians`,
    body: (v) => v.body,
    schema: peopleGuardianLinkDtoSchema,
    invalidate: [GUARDIANS_KEY, STUDENTS_KEY],
  });
}

export function useUpdateGuardianLink() {
  return useApiAction({
    method: "PATCH",
    path: (v: { studentId: string; linkId: string; patch: PeopleUpdateLinkBody }) => `${PEOPLE_BASE}/students/${v.studentId}/guardians/${v.linkId}`,
    body: (v) => v.patch,
    schema: peopleGuardianLinkDtoSchema,
    invalidate: [GUARDIANS_KEY, STUDENTS_KEY],
  });
}

export function useUnlinkGuardian() {
  return useApiAction({
    method: "DELETE",
    path: (v: { studentId: string; linkId: string; effectiveOn?: string; reason?: string }) => `${PEOPLE_BASE}/students/${v.studentId}/guardians/${v.linkId}`,
    query: (v) => ({ effectiveOn: v.effectiveOn, reason: v.reason }),
    schema: peopleGuardianLinkDtoSchema,
    invalidate: [GUARDIANS_KEY, STUDENTS_KEY],
  });
}

export function useInvitePortalAccess() {
  return useApiAction({
    path: (v: { personId: string; quality?: "STUDENT" | "GUARDIAN" | "STAFF" }) => `${PEOPLE_BASE}/persons/${v.personId}/portal-invitation`,
    body: (v) => ({ ...(v.quality ? { quality: v.quality } : {}), channel: "EMAIL" }),
    invalidate: [GUARDIANS_KEY, STUDENTS_KEY, ["people", "staff"]],
  });
}

/** Relie une personne à un compte DÉJÀ ouvert dans l'établissement (identité connue du tenant) : refus si déjà liée (L-04). */
export function useLinkPersonIdentity() {
  return useApiAction({
    path: (v: { personId: string; identityId: string }) => `${PEOPLE_BASE}/persons/${v.personId}/identity`,
    body: (v) => ({ identityId: v.identityId }),
    invalidate: [GUARDIANS_KEY, STUDENTS_KEY, ["people", "staff"]],
  });
}

export function useRelationshipTypes() {
  return hooks.useApiQuery(["people", "reference", "relationship-types"], `${PEOPLE_BASE}/reference/relationship-types`, {
    schema: itemsOf(peopleRelationshipTypeDtoSchema),
    select: pickItems,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Portails parent / élève
// ---------------------------------------------------------------------------

/** « Mes enfants » : l'API ne renvoie que les enfants dont l'utilisateur est tuteur (lien vivant, accès portail). */
export function useMyChildren(enabled = true) {
  return hooks.useApiQuery(["people", "children", "list"], `${PEOPLE_BASE}/children`, { schema: itemsOf(peopleStudentSummaryDtoSchema), select: pickItems, enabled });
}

export function useMyChild(studentId: string | null) {
  return hooks.useApiQuery(["people", "children", "one", studentId], `${PEOPLE_BASE}/children/${studentId}`, { schema: peopleChildDtoSchema, enabled: studentId !== null });
}

export function useUpdateChildEmergencyContact() {
  return useApiAction({
    method: "PATCH",
    path: (v: { studentId: string; contactId: string; patch: Record<string, unknown> }) => `${PEOPLE_BASE}/children/${v.studentId}/emergency-contacts/${v.contactId}`,
    body: (v) => v.patch,
    schema: peopleEmergencyContactDtoSchema,
    invalidate: [["people", "children"]],
  });
}

export function useMyStudentRecord(enabled = true) {
  return hooks.useApiQuery(["people", "me", "student"], `${PEOPLE_BASE}/me/student`, { schema: peopleStudentDetailDtoSchema, enabled, retry: false });
}

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export type StaffQuery = Partial<z.input<typeof peopleListStaffQuerySchema>>;

export function useStaffList(query: StaffQuery, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["people", "staff", "list"], `${PEOPLE_BASE}/staff`, { schema: listOf(peopleStaffSummaryDtoSchema), query: query as Query, enabled: options.enabled });
}

export function useStaff(id: string | null) {
  return hooks.useApiQuery(["people", "staff", "one", id], `${PEOPLE_BASE}/staff/${id}`, { schema: peopleStaffDetailDtoSchema, enabled: id !== null });
}

export function useStaffHistory(id: string | null, enabled = true) {
  return hooks.useApiQuery(["people", "staff", "history", id], `${PEOPLE_BASE}/staff/${id}/history`, {
    schema: itemsOf(peopleStaffStatusHistoryDtoSchema),
    select: pickItems,
    enabled: id !== null && enabled,
  });
}

export function useStaffContracts(id: string | null, enabled = true) {
  return hooks.useApiQuery(["people", "staff", "contracts", id], `${PEOPLE_BASE}/staff/${id}/contracts`, {
    schema: itemsOf(peopleContractDtoSchema),
    select: pickItems,
    enabled: id !== null && enabled,
    retry: false,
  });
}

export function useStaffQualifications(id: string | null) {
  return hooks.useApiQuery(["people", "staff", "qualifications", id], `${PEOPLE_BASE}/staff/${id}/qualifications`, {
    schema: itemsOf(peopleQualificationDtoSchema),
    select: pickItems,
    enabled: id !== null,
  });
}

export function useExpiringQualifications(enabled = true) {
  return hooks.useApiQuery(["people", "staff", "expiring"], `${PEOPLE_BASE}/staff/expiring-qualifications`, {
    schema: itemsOf(peopleExpiringQualificationDtoSchema),
    select: pickItems,
    enabled,
    retry: false,
  });
}

export function useStaffCompetencies(id: string | null) {
  return hooks.useApiQuery(["people", "staff", "competencies", id], `${PEOPLE_BASE}/staff/${id}/competencies`, {
    schema: itemsOf(peopleCompetencyDtoSchema),
    select: pickItems,
    enabled: id !== null,
  });
}

export function useStaffAvailabilities(id: string | null) {
  return hooks.useApiQuery(["people", "staff", "availabilities", id], `${PEOPLE_BASE}/staff/${id}/availabilities`, {
    schema: itemsOf(peopleAvailabilityDtoSchema),
    select: pickItems,
    enabled: id !== null,
  });
}

export function useStaffAssignments(id: string | null, yearId?: string) {
  return hooks.useApiQuery(["people", "assignments", "staff", id], `${PEOPLE_BASE}/staff/${id}/assignments`, {
    schema: itemsOf(peopleAssignmentDtoSchema),
    select: pickItems,
    query: yearId ? { yearId } : undefined,
    enabled: id !== null,
    retry: false,
  });
}

export function useStaffLoad(id: string | null, yearId: string | null) {
  return hooks.useApiQuery(["people", "staff", "load", id, yearId], `${PEOPLE_BASE}/staff/${id}/load`, {
    schema: peopleTeachingLoadDtoSchema,
    query: { yearId: yearId ?? undefined },
    enabled: id !== null && yearId !== null,
    retry: false,
  });
}

export function useStaffCategories() {
  return hooks.useApiQuery(["people", "reference", "staff-categories"], `${PEOPLE_BASE}/reference/staff-categories`, {
    schema: itemsOf(peopleStaffCategoryDtoSchema),
    select: pickItems,
    staleTime: 5 * 60_000,
  });
}

export function useContractTypes() {
  return hooks.useApiQuery(["people", "reference", "contract-types"], `${PEOPLE_BASE}/reference/contract-types`, {
    schema: itemsOf(peopleContractTypeDtoSchema),
    select: pickItems,
    staleTime: 5 * 60_000,
  });
}

const STAFF_KEY = ["people", "staff"] as const;

export const createStaffResultSchema = z.union([
  z.object({ valid: z.literal(true), duplicates: z.array(peopleDuplicateCandidateDtoSchema) }),
  z.object({ staff: peopleStaffDetailDtoSchema, replayed: z.boolean() }),
]);

export function useCreateStaff() {
  return useApiAction({ path: `${PEOPLE_BASE}/staff`, body: (v: PeopleCreateStaffBody) => v, schema: createStaffResultSchema, invalidate: [STAFF_KEY] });
}

export function useUpdateStaff() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${PEOPLE_BASE}/staff/${v.id}`,
    body: (v) => v.patch,
    schema: peopleStaffDetailDtoSchema,
    invalidate: [STAFF_KEY],
  });
}

export function useChangeStaffStatus() {
  return useApiAction({
    path: (v: { id: string; body: { status: string; reasonText?: string; effectiveOn?: string; leftOn?: string } }) => `${PEOPLE_BASE}/staff/${v.id}/status`,
    body: (v) => v.body,
    invalidate: [STAFF_KEY],
  });
}

export function useCreateContract() {
  return useApiAction({
    path: (v: { staffId: string; body: Record<string, unknown> }) => `${PEOPLE_BASE}/staff/${v.staffId}/contracts`,
    body: (v) => v.body,
    schema: peopleContractDtoSchema,
    invalidate: [["people", "staff", "contracts"], ["people", "staff", "load"]],
  });
}

export function useEndContract() {
  return useApiAction({
    path: (v: { staffId: string; contractId: string; endsOn?: string }) => `${PEOPLE_BASE}/staff/${v.staffId}/contracts/${v.contractId}/end`,
    body: (v) => (v.endsOn ? { endsOn: v.endsOn } : {}),
    schema: peopleContractDtoSchema,
    invalidate: [["people", "staff", "contracts"], ["people", "staff", "load"]],
  });
}

export function useAddQualification() {
  return useApiAction({
    path: (v: { staffId: string; body: Record<string, unknown> }) => `${PEOPLE_BASE}/staff/${v.staffId}/qualifications`,
    body: (v) => v.body,
    schema: peopleQualificationDtoSchema,
    invalidate: [["people", "staff", "qualifications"], ["people", "staff", "expiring"]],
  });
}

export function useRemoveQualification() {
  return useApiAction({
    method: "DELETE",
    path: (v: { staffId: string; qualificationId: string }) => `${PEOPLE_BASE}/staff/${v.staffId}/qualifications/${v.qualificationId}`,
    invalidate: [["people", "staff", "qualifications"], ["people", "staff", "expiring"]],
  });
}

export function useSetCompetencies() {
  return useApiAction({
    method: "PUT",
    path: (v: { staffId: string; competencies: Array<{ subjectId: string; gradeLevelCodes?: string[] }> }) => `${PEOPLE_BASE}/staff/${v.staffId}/competencies`,
    body: (v) => ({ competencies: v.competencies }),
    invalidate: [["people", "staff", "competencies"]],
  });
}

export function useSetAvailabilities() {
  return useApiAction({
    method: "PUT",
    path: (v: { staffId: string; availabilities: Array<Record<string, unknown>> }) => `${PEOPLE_BASE}/staff/${v.staffId}/availabilities`,
    body: (v) => ({ availabilities: v.availabilities }),
    invalidate: [["people", "staff", "availabilities"]],
  });
}

// ---------------------------------------------------------------------------
// Affectations d'enseignement
// ---------------------------------------------------------------------------

export function useClassroomAssignments(classroomId: string | null, query: { yearId?: string; status?: string } = {}) {
  return hooks.useApiQuery(["people", "assignments", "classroom", classroomId], `${PEOPLE_BASE}/classrooms/${classroomId}/assignments`, {
    schema: itemsOf(peopleAssignmentDtoSchema),
    select: pickItems,
    query,
    enabled: classroomId !== null,
    retry: false,
  });
}

export function useUnstaffedNodes(query: { yearId: string | null; classroomId?: string; programId?: string }) {
  return hooks.useApiQuery(["people", "assignments", "unstaffed"], `${PEOPLE_BASE}/teaching-assignments/unstaffed`, {
    schema: itemsOf(peopleUnstaffedNodeDtoSchema),
    select: pickItems,
    query: { yearId: query.yearId ?? undefined, classroomId: query.classroomId, programId: query.programId },
    enabled: query.yearId !== null,
    retry: false,
  });
}

export function useMyClasses(enabled = true) {
  return hooks.useApiQuery(["people", "me", "classes"], `${PEOPLE_BASE}/me/classes`, { schema: itemsOf(peopleMyClassDtoSchema), select: pickItems, enabled, retry: false });
}

const ASSIGNMENTS_KEY = ["people", "assignments"] as const;

export function useCreateAssignment() {
  return useApiAction({
    path: `${PEOPLE_BASE}/teaching-assignments`,
    body: (v: PeopleCreateAssignmentBody) => v,
    schema: peopleCreateAssignmentResultDtoSchema,
    invalidate: [ASSIGNMENTS_KEY, ["people", "staff", "load"]],
  });
}

export function useEndAssignment() {
  return useApiAction({
    path: (v: { id: string; endsOn?: string; reason?: string }) => `${PEOPLE_BASE}/teaching-assignments/${v.id}/end`,
    body: (v) => ({ ...(v.endsOn ? { endsOn: v.endsOn } : {}), ...(v.reason ? { reason: v.reason } : {}) }),
    schema: peopleAssignmentDtoSchema,
    invalidate: [ASSIGNMENTS_KEY, ["people", "staff", "load"]],
  });
}

export function useReplaceAssignment() {
  return useApiAction({
    path: (v: { id: string; newStaffId: string; effectiveOn: string; reason: string }) => `${PEOPLE_BASE}/teaching-assignments/${v.id}/replace`,
    body: (v) => ({ newStaffId: v.newStaffId, effectiveOn: v.effectiveOn, reason: v.reason }),
    invalidate: [ASSIGNMENTS_KEY, ["people", "staff", "load"]],
  });
}

/** Candidats d'un doublon signalé par l'API (409 `people.possible_duplicate`, `details.candidates`). Vide pour toute autre erreur. */
export function duplicateCandidatesOf(error: unknown): z.infer<typeof peopleDuplicateCandidateDtoSchema>[] {
  if (!(error instanceof ApiError) || error.code !== "people.possible_duplicate") return [];
  const raw = (error.details as { candidates?: unknown } | null | undefined)?.candidates;
  const parsed = z.array(peopleDuplicateCandidateDtoSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Ma fiche de personnel (enseignant) et mes disponibilités. */
export function useMyStaff(enabled = true) {
  return hooks.useApiQuery(["people", "me", "staff"], `${PEOPLE_BASE}/me/staff`, { schema: peopleStaffDetailDtoSchema, enabled, retry: false });
}

export function useMyAssignments(enabled = true) {
  return hooks.useApiQuery(["people", "me", "assignments"], `${PEOPLE_BASE}/me/assignments`, { schema: itemsOf(peopleAssignmentDtoSchema), select: pickItems, enabled, retry: false });
}

export function useUpdateMyAvailabilities() {
  return useApiAction({
    method: "PATCH",
    path: `${PEOPLE_BASE}/me/staff`,
    body: (v: { availabilities: Array<Record<string, unknown>> }) => ({ availabilities: v.availabilities }),
    schema: peopleStaffDetailDtoSchema,
    invalidate: [["people", "me"], ["people", "staff", "availabilities"]],
  });
}
