"use client";

/**
 * Hooks typés du module `higher` (`/api/v1/higher/*`) : diplômes et exigences, éligibilité et octrois (forcé, ré-octroi sur
 * décision écrite), révocation, documents officiels (diplômes, attestations), signataires datés, registre de crédits, dettes
 * d'UE, fenêtres de rattrapage (session 2). Schémas Zod de `packages/contracts/src/v2/higher.ts`.
 *
 * AUCUN seuil, AUCUNE formule : l'éligibilité, la moyenne de cycle, la mention et l'état d'UE viennent des règles (module
 * `rules`) ; le web affiche la décision et la version de règle qui l'a produite.
 *
 * Clés de cache : `["higher", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  higherAttestationRosterRowDtoSchema,
  higherAwardsPageDtoSchema,
  higherAwardOutcomeDtoSchema,
  higherCandidateDtoSchema,
  higherDiplomaDetailDtoSchema,
  higherDiplomaDtoSchema,
  higherDiplomaProgressViewDtoSchema,
  higherDocumentDetailDtoSchema,
  higherDocumentDtoSchema,
  higherDocumentsPageDtoSchema,
  higherIssuedDocumentDtoSchema,
  higherOpenResitWindowResultDtoSchema,
  higherRecomputeReportDtoSchema,
  higherRequirementDtoSchema,
  higherResitCandidatesDtoSchema,
  higherResitWindowDetailDtoSchema,
  higherResitWindowDtoSchema,
  higherSettingsDtoSchema,
  higherSlotDtoSchema,
  higherStudentCreditsDtoSchema,
  higherPathwayDtoSchema,
  higherSyncReportDtoSchema,
} from "@ecoledigitale/contracts/v2/higher";
import { useApiAction } from "./actions";

export const HIGHER_BASE = "/api/v1/higher";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
const clean = (o: object): Record<string, string | number | boolean> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string | number | boolean>;

// ---------------------------------------------------------------------------
// Diplômes et exigences
// ---------------------------------------------------------------------------

export function useDiplomas(query: { status?: string; q?: string } = {}, enabled = true) {
  return hooks.useApiQuery(["higher", "diplomas", "list", query], `${HIGHER_BASE}/diplomas`, { schema: itemsOf(higherDiplomaDtoSchema), select: pickItems, query: clean(query), enabled });
}

export function useDiploma(id: string | null) {
  return hooks.useApiQuery(["higher", "diplomas", "one", id], `${HIGHER_BASE}/diplomas/${id}`, { schema: higherDiplomaDetailDtoSchema, enabled: id !== null });
}

export function useCreateDiplomaFromCurriculum() {
  return useApiAction({
    path: `${HIGHER_BASE}/diplomas/from-curriculum`,
    body: (v: Record<string, unknown>) => v,
    schema: higherDiplomaDetailDtoSchema,
    invalidate: [["higher", "diplomas"]],
  });
}

export function useUpdateDiploma() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${HIGHER_BASE}/diplomas/${v.id}`,
    body: (v) => v.patch,
    schema: higherDiplomaDtoSchema,
    invalidate: [["higher", "diplomas"]],
  });
}

export function useDeleteDiploma() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${HIGHER_BASE}/diplomas/${v.id}`, invalidate: [["higher", "diplomas"]] });
}

export function useSyncDiploma() {
  return useApiAction({ path: (v: { id: string }) => `${HIGHER_BASE}/diplomas/${v.id}/sync`, schema: higherSyncReportDtoSchema, invalidate: [["higher", "diplomas"]] });
}

export const requirementsSchema = itemsOf(higherRequirementDtoSchema);

// ---------------------------------------------------------------------------
// Candidats, progression, octrois
// ---------------------------------------------------------------------------

export function useCandidates(diplomaId: string | null) {
  return hooks.useApiQuery(["higher", "diplomas", "candidates", diplomaId], `${HIGHER_BASE}/diplomas/${diplomaId}/candidates`, { schema: itemsOf(higherCandidateDtoSchema), select: pickItems, enabled: diplomaId !== null });
}

export function useStudentProgress(diplomaId: string | null, studentId: string | null) {
  return hooks.useApiQuery(["higher", "diplomas", "progress", diplomaId, studentId], `${HIGHER_BASE}/diplomas/${diplomaId}/students/${studentId}/progress`, {
    schema: higherDiplomaProgressViewDtoSchema,
    enabled: diplomaId !== null && studentId !== null,
  });
}

export function useAwards(diplomaId: string | null, query: { status?: string } = {}) {
  return hooks.useApiInfiniteQuery(["higher", "awards", diplomaId], `${HIGHER_BASE}/diplomas/${diplomaId}/awarded`, {
    schema: higherAwardsPageDtoSchema,
    query: clean({ limit: 50, ...query }),
    getNextCursor: (page) => page.nextCursor,
    enabled: diplomaId !== null,
  });
}

const AWARDS_KEYS = [["higher", "awards"], ["higher", "diplomas"], ["higher", "documents"]] as const;

/** Octroi manuel. `force` (non éligible : droit sensible + motif de 20 caractères) et `reawardDecision` (ré-octroi : décision écrite) sont des choix explicites. */
export function useAwardDiploma() {
  return useApiAction({
    path: (v: { diplomaId: string; studentId: string; force?: boolean; reason?: string; reawardDecision?: string }) => `${HIGHER_BASE}/diplomas/${v.diplomaId}/awards`,
    body: (v) => ({ studentId: v.studentId, ...(v.force ? { force: true, reason: v.reason } : {}), ...(v.reawardDecision ? { reawardDecision: v.reawardDecision } : {}) }),
    schema: higherAwardOutcomeDtoSchema,
    invalidate: AWARDS_KEYS,
  });
}

export function useRecomputeDiploma() {
  return useApiAction({ path: (v: { id: string }) => `${HIGHER_BASE}/diplomas/${v.id}/recompute`, schema: higherRecomputeReportDtoSchema, invalidate: AWARDS_KEYS });
}

export function useRevokeAward() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${HIGHER_BASE}/awards/${v.id}/revoke`,
    body: (v) => ({ reason: v.reason }),
    schema: higherAwardOutcomeDtoSchema,
    invalidate: AWARDS_KEYS,
  });
}

// ---------------------------------------------------------------------------
// Documents officiels, attestations, signataires datés
// ---------------------------------------------------------------------------

export function useIssueAwardDocument() {
  return useApiAction({
    path: (v: { awardId: string; kind: "DIPLOMA" | "ATTESTATION_AUTHENTICITY"; duplicate?: boolean }) => `${HIGHER_BASE}/awards/${v.awardId}/documents`,
    body: (v) => ({ kind: v.kind, ...(v.duplicate ? { duplicate: true } : {}) }),
    schema: higherIssuedDocumentDtoSchema,
    invalidate: [["higher", "documents"]],
  });
}

export function useDocuments(query: { kind?: string; status?: string; studentId?: string } = {}, enabled = true) {
  return hooks.useApiInfiniteQuery(["higher", "documents", "list"], `${HIGHER_BASE}/documents`, {
    schema: higherDocumentsPageDtoSchema,
    query: clean({ limit: 50, ...query }),
    getNextCursor: (page) => page.nextCursor,
    enabled,
  });
}

export function useDocument(id: string | null) {
  return hooks.useApiQuery(["higher", "documents", "one", id], `${HIGHER_BASE}/documents/${id}`, { schema: higherDocumentDetailDtoSchema, enabled: id !== null });
}

export function usePublishDocument() {
  return useApiAction({ path: (v: { id: string }) => `${HIGHER_BASE}/documents/${v.id}/publish`, schema: higherDocumentDtoSchema, invalidate: [["higher", "documents"]] });
}

export function useRevokeDocument() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${HIGHER_BASE}/documents/${v.id}/revoke`,
    body: (v) => ({ reason: v.reason }),
    schema: higherDocumentDtoSchema,
    invalidate: [["higher", "documents"]],
  });
}

export function useAttestationRoster(query: { programNodeId: string; classroomId?: string } | null) {
  return hooks.useApiQuery(["higher", "attestations", "roster", query], `${HIGHER_BASE}/attestations/roster`, {
    schema: itemsOf(higherAttestationRosterRowDtoSchema),
    select: pickItems,
    query: query ? clean(query) : undefined,
    enabled: query !== null,
  });
}

export function useIssueAttestation() {
  return useApiAction({
    path: `${HIGHER_BASE}/attestations`,
    body: (v: { studentId: string; programNodeId: string }) => v,
    schema: higherIssuedDocumentDtoSchema,
    invalidate: [["higher", "attestations"], ["higher", "documents"]],
  });
}

export function useSlots(enabled = true) {
  return hooks.useApiQuery(["higher", "slots"], `${HIGHER_BASE}/document-slots`, { schema: itemsOf(higherSlotDtoSchema), select: pickItems, enabled });
}

export function useAssignSlot() {
  return useApiAction({
    method: "PUT",
    path: `${HIGHER_BASE}/document-slots`,
    body: (v: { slotKey: string; signatoryId: string; validFrom: string; validTo?: string | null }) => ({ slotKey: v.slotKey, signatoryId: v.signatoryId, validFrom: v.validFrom, ...(v.validTo !== undefined ? { validTo: v.validTo } : {}) }),
    schema: higherSlotDtoSchema,
    invalidate: [["higher", "slots"]],
  });
}

// ---------------------------------------------------------------------------
// Crédits et parcours
// ---------------------------------------------------------------------------

export function useStudentCredits(studentId: string | null) {
  return hooks.useApiQuery(["higher", "credits", studentId], `${HIGHER_BASE}/students/${studentId}/credits`, { schema: higherStudentCreditsDtoSchema, enabled: studentId !== null });
}

export function useStudentPathway(studentId: string | null) {
  return hooks.useApiQuery(["higher", "pathway", studentId], `${HIGHER_BASE}/students/${studentId}/pathway`, { schema: higherPathwayDtoSchema, enabled: studentId !== null });
}

export function useHigherSettings(enabled = true) {
  return hooks.useApiQuery(["higher", "settings"], `${HIGHER_BASE}/settings`, { schema: higherSettingsDtoSchema, enabled, retry: false });
}

export function useUpdateHigherSettings() {
  return useApiAction({
    method: "PUT",
    path: `${HIGHER_BASE}/settings`,
    body: (v: { creditValidityMonths: number | null }) => v,
    schema: higherSettingsDtoSchema,
    invalidate: [["higher", "settings"]],
  });
}

// ---------------------------------------------------------------------------
// Rattrapage (session 2)
// ---------------------------------------------------------------------------

export function useResitWindows(query: { classroomId?: string; periodId?: string; status?: string }, enabled = true) {
  return hooks.useApiInfiniteQuery(["higher", "resit", "windows"], `${HIGHER_BASE}/resit-windows`, {
    schema: z.object({ items: z.array(higherResitWindowDtoSchema), nextCursor: z.string().nullable() }),
    query: clean({ limit: 50, ...query }),
    getNextCursor: (page) => page.nextCursor,
    enabled,
  });
}

export function useResitWindow(id: string | null) {
  return hooks.useApiQuery(["higher", "resit", "window", id], `${HIGHER_BASE}/resit-windows/${id}`, { schema: higherResitWindowDetailDtoSchema, enabled: id !== null });
}

export function useResitCandidates(classroomId: string | null, periodId: string | null) {
  return hooks.useApiQuery(["higher", "resit", "candidates", classroomId, periodId], `${HIGHER_BASE}/resit-candidates`, {
    schema: higherResitCandidatesDtoSchema,
    query: { classroomId: classroomId ?? undefined, periodId: periodId ?? undefined },
    enabled: Boolean(classroomId && periodId),
  });
}

export function useOpenResitWindow() {
  return useApiAction({
    path: `${HIGHER_BASE}/resit-windows`,
    body: (v: { classroomId: string; academicPeriodId: string; opensOn: string; closesOn: string; nodeIds?: string[] }) => v,
    schema: higherOpenResitWindowResultDtoSchema,
    invalidate: [["higher", "resit"], ["results"], ["assess"]],
  });
}

export function useCloseResitWindow() {
  return useApiAction({
    path: (v: { id: string }) => `${HIGHER_BASE}/resit-windows/${v.id}/close`,
    schema: higherResitWindowDtoSchema,
    invalidate: [["higher", "resit"], ["results"], ["assess"]],
  });
}

