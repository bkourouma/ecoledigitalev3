"use client";

/**
 * Hooks typés du module `councils` (`/api/v1/councils/*`). Schémas Zod de `packages/contracts/src/v2/councils.ts`.
 * AUCUN calcul ni règle côté client : quorum, faits figés (`council-facts/1`), suggestions des règles, exigence de
 * justification, déverrouillage motivé (quatre yeux), effets et PV sont décidés par l'API ; l'écran affiche ce qui revient.
 * Aucune donnée du conseil n'est stockée côté navigateur (pas de localStorage) : tout vient du cache de requêtes.
 */

import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import type { ApiError } from "@/platform/api/errors";
import {
  councilsAgendaDtoSchema,
  councilsAgendaItemDetailDtoSchema,
  councilsAgendaItemDtoSchema,
  councilsClassroomSummaryDtoSchema,
  councilsConvokeReportDtoSchema,
  councilsCouncilDetailDtoSchema,
  councilsCouncilDtoSchema,
  councilsCouncilTypeDtoSchema,
  councilsCouncilTypeInputSchema,
  councilsDecisionDtoSchema,
  councilsDecisionTypeDtoSchema,
  councilsDecisionTypeInputSchema,
  councilsEffectDtoSchema,
  councilsEffectsDtoSchema,
  councilsEventsDtoSchema,
  councilsFamilyDecisionsDtoSchema,
  councilsListDtoSchema,
  councilsMinutesDetailDtoSchema,
  councilsMinutesDtoSchema,
  councilsMinutesListDtoSchema,
  councilsMinutesPdfDtoSchema,
  councilsOrientationFileDtoSchema,
  councilsOrientationPathDtoSchema,
  councilsOrientationPathInputSchema,
  councilsParticipantDtoSchema,
  councilsParticipantRoleDtoSchema,
  councilsPrepareReportDtoSchema,
  councilsProposalDtoSchema,
  councilsProposedParticipantDtoSchema,
  councilsReferenceDtoSchema,
  councilsSeriesTransferDtoSchema,
  councilsSettingsDtoSchema,
  councilsUnlockDtoSchema,
  councilsWishInputSchema,
  type CouncilsCouncilTypeInput,
  type CouncilsCreateInput,
  type CouncilsDecisionInput,
  type CouncilsDecisionTypeInput,
  type CouncilsOrientationPathInput,
  type CouncilsParticipantInput,
  type CouncilsParticipantRoleInput,
  type CouncilsProposalInput,
  type CouncilsSeriesTransferInput,
  type CouncilsSettingsInput,
  type CouncilsUpdateInput,
  type CouncilsWishInput,
} from "@ecoledigitale/contracts/v2/councils";
import { useApiAction } from "./actions";
import { omit } from "./omit";

export const COUNCILS_BASE = "/api/v1/councils";
const KEY = ["councils"] as const;
const ALL = [KEY] as const;

type Query = Record<string, string | number | boolean | undefined>;
const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
const orientationFilesSchema = z.object({ items: z.array(councilsOrientationFileDtoSchema), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });

// ---------------------------------------------------------------------------
// Référentiels (DONNÉES d'établissement : rôles, types de conseil, types de décision, réglages)
// ---------------------------------------------------------------------------

export function useCouncilsReference(enabled = true) {
  return hooks.useApiQuery([...KEY, "reference"], `${COUNCILS_BASE}/reference`, { schema: councilsReferenceDtoSchema, enabled, staleTime: 60_000, retry: false });
}

export function useUpsertParticipantRole() {
  return useApiAction({ method: "PUT", path: `${COUNCILS_BASE}/participant-roles`, body: (v: CouncilsParticipantRoleInput) => v, schema: councilsParticipantRoleDtoSchema, invalidate: [[...KEY, "reference"]] });
}
export function useUpsertCouncilType() {
  return useApiAction({ method: "PUT", path: `${COUNCILS_BASE}/council-types`, body: (v: z.input<typeof councilsCouncilTypeInputSchema>) => v, schema: councilsCouncilTypeDtoSchema, invalidate: [[...KEY, "reference"]] });
}
export function useUpsertDecisionType() {
  return useApiAction({ method: "PUT", path: `${COUNCILS_BASE}/decision-types`, body: (v: z.input<typeof councilsDecisionTypeInputSchema>) => v, schema: councilsDecisionTypeDtoSchema, invalidate: [[...KEY, "reference"]] });
}
export function useUpsertCouncilSettings() {
  return useApiAction({ method: "PUT", path: `${COUNCILS_BASE}/settings`, body: (v: CouncilsSettingsInput) => v, schema: councilsSettingsDtoSchema, invalidate: [[...KEY, "reference"]] });
}
export type { CouncilsCouncilTypeInput, CouncilsDecisionTypeInput };

// ---------------------------------------------------------------------------
// Calendrier et séances
// ---------------------------------------------------------------------------

export interface CouncilsListFilters {
  classroomId?: string;
  academicYearId?: string;
  academicPeriodId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function useCouncilsList(query: CouncilsListFilters, enabled = true) {
  return hooks.useApiQuery([...KEY, "list"], `${COUNCILS_BASE}/councils`, { schema: councilsListDtoSchema, query: query as Query, enabled, retry: false });
}

export function useCouncil(councilId: string | null) {
  return hooks.useApiQuery([...KEY, "council", councilId], `${COUNCILS_BASE}/councils/${councilId}`, { schema: councilsCouncilDetailDtoSchema, enabled: councilId !== null, retry: false });
}

export function useClassroomCouncilSummary(classroomId: string | null) {
  return hooks.useApiQuery([...KEY, "classroom-summary", classroomId], `${COUNCILS_BASE}/classrooms/${classroomId}/council-summary`, { schema: councilsClassroomSummaryDtoSchema, enabled: classroomId !== null, retry: false });
}

export function useCreateCouncil() {
  return useApiAction({ path: `${COUNCILS_BASE}/councils`, body: (v: CouncilsCreateInput) => v, schema: councilsCouncilDtoSchema, invalidate: ALL });
}

export function useUpdateCouncil() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: CouncilsUpdateInput }) => `${COUNCILS_BASE}/councils/${v.id}`,
    body: (v) => v.patch,
    schema: councilsCouncilDtoSchema,
    invalidate: ALL,
  });
}

export function usePrepareCouncil() {
  return useApiAction({ path: (v: { id: string }) => `${COUNCILS_BASE}/councils/${v.id}/prepare`, body: () => ({}), schema: councilsPrepareReportDtoSchema, invalidate: ALL });
}

export function useConvokeCouncil() {
  return useApiAction({
    path: (v: { id: string; participantIds?: string[] }) => `${COUNCILS_BASE}/councils/${v.id}/convoke`,
    body: (v) => (v.participantIds ? { participantIds: v.participantIds } : {}),
    schema: councilsConvokeReportDtoSchema,
    invalidate: ALL,
  });
}

/** Ouverture : le motif de dérogation au quorum n'est envoyé que si l'API a signalé `waiverAllowed` et un quorum non atteint. */
export function useOpenCouncil() {
  return useApiAction({
    path: (v: { id: string; quorumWaiverReason?: string }) => `${COUNCILS_BASE}/councils/${v.id}/open`,
    body: (v) => (v.quorumWaiverReason ? { quorumWaiverReason: v.quorumWaiverReason } : {}),
    schema: councilsCouncilDetailDtoSchema,
    invalidate: ALL,
  });
}

export function useCloseCouncil() {
  return useApiAction({ path: (v: { id: string }) => `${COUNCILS_BASE}/councils/${v.id}/close`, body: () => ({}), schema: councilsCouncilDetailDtoSchema, invalidate: ALL });
}

export function useCancelCouncil() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${COUNCILS_BASE}/councils/${v.id}/cancel`, body: (v) => ({ reason: v.reason }), schema: councilsCouncilDtoSchema, invalidate: ALL });
}

// ---------------------------------------------------------------------------
// Participants et présence
// ---------------------------------------------------------------------------

export function useProposedParticipants(councilId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "proposed-participants", councilId], `${COUNCILS_BASE}/councils/${councilId}/proposed-participants`, {
    schema: itemsOf(councilsProposedParticipantDtoSchema),
    select: pickItems,
    enabled: enabled && councilId !== null,
    retry: false,
  });
}

export function useAddParticipant() {
  return useApiAction({
    path: (v: { councilId: string; input: CouncilsParticipantInput }) => `${COUNCILS_BASE}/councils/${v.councilId}/participants`,
    body: (v) => v.input,
    schema: councilsParticipantDtoSchema,
    invalidate: ALL,
  });
}

export function useRemoveParticipant() {
  return useApiAction({ method: "DELETE", path: (v: { councilId: string; participantId: string }) => `${COUNCILS_BASE}/councils/${v.councilId}/participants/${v.participantId}`, invalidate: ALL });
}

export function usePatchParticipant() {
  return useApiAction({
    method: "PATCH",
    path: (v: { councilId: string; participantId: string; patch: { councilFunction?: "PRESIDENT" | "SECRETARY" | null; isVoting?: boolean } }) => `${COUNCILS_BASE}/councils/${v.councilId}/participants/${v.participantId}`,
    body: (v) => v.patch,
    schema: councilsParticipantDtoSchema,
    invalidate: ALL,
  });
}

export function useSetPresence() {
  return useApiAction({
    path: (v: { councilId: string; participantId: string; presence: "INVITED" | "PRESENT" | "ABSENT" | "EXCUSED" }) => `${COUNCILS_BASE}/councils/${v.councilId}/participants/${v.participantId}/presence`,
    body: (v) => ({ presence: v.presence }),
    schema: councilsParticipantDtoSchema,
    invalidate: ALL,
  });
}

// ---------------------------------------------------------------------------
// Ordre du jour, fiche élève, propositions, décisions
// ---------------------------------------------------------------------------

export function useAgenda(councilId: string | null) {
  return hooks.useApiQuery([...KEY, "agenda", councilId], `${COUNCILS_BASE}/councils/${councilId}/agenda`, { schema: councilsAgendaDtoSchema, enabled: councilId !== null, retry: false });
}

export function useAgendaItem(itemId: string | null) {
  return hooks.useApiQuery([...KEY, "agenda-item", itemId], `${COUNCILS_BASE}/agenda/${itemId}`, { schema: councilsAgendaItemDetailDtoSchema, enabled: itemId !== null, retry: false });
}

export function useRebuildAgendaItem() {
  return useApiAction({ path: (v: { itemId: string }) => `${COUNCILS_BASE}/agenda/${v.itemId}/rebuild`, body: () => ({}), schema: councilsAgendaItemDetailDtoSchema, invalidate: ALL });
}

export function useReviewAgendaItem() {
  return useApiAction({ path: (v: { itemId: string }) => `${COUNCILS_BASE}/agenda/${v.itemId}/review`, body: () => ({}), schema: councilsAgendaItemDtoSchema, invalidate: ALL });
}

export function useCreateProposal() {
  return useApiAction({
    path: (v: { itemId: string; input: CouncilsProposalInput }) => `${COUNCILS_BASE}/agenda/${v.itemId}/proposals`,
    body: (v) => v.input,
    schema: councilsProposalDtoSchema,
    invalidate: ALL,
  });
}

export function useResolveProposal(action: "accept" | "reject" | "withdraw") {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${COUNCILS_BASE}/proposals/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: councilsProposalDtoSchema,
    invalidate: ALL,
  });
}

export function useRecordDecision() {
  return useApiAction({
    path: (v: { itemId: string; input: CouncilsDecisionInput }) => `${COUNCILS_BASE}/agenda/${v.itemId}/decisions`,
    body: (v) => v.input,
    schema: councilsDecisionDtoSchema,
    invalidate: ALL,
  });
}

export function useWithdrawDecision() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${COUNCILS_BASE}/decisions/${v.id}/withdraw`, body: (v) => ({ reason: v.reason }), schema: councilsDecisionDtoSchema, invalidate: ALL });
}

// ---------------------------------------------------------------------------
// Procès-verbal, signatures, déverrouillage motivé
// ---------------------------------------------------------------------------

export function useMinutesList(councilId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "minutes", councilId], `${COUNCILS_BASE}/councils/${councilId}/minutes`, { schema: councilsMinutesListDtoSchema, select: pickItems, enabled: enabled && councilId !== null, retry: false });
}

export function useMinutesDetail(minutesId: string | null) {
  return hooks.useApiQuery([...KEY, "minutes-detail", minutesId], `${COUNCILS_BASE}/minutes/${minutesId}`, { schema: councilsMinutesDetailDtoSchema, enabled: minutesId !== null, retry: false });
}

export function useGenerateMinutes() {
  return useApiAction({ path: (v: { councilId: string }) => `${COUNCILS_BASE}/councils/${v.councilId}/minutes`, body: () => ({}), schema: councilsMinutesDtoSchema, invalidate: ALL });
}

export function useSignMinutes() {
  return useApiAction({ path: (v: { id: string }) => `${COUNCILS_BASE}/minutes/${v.id}/sign`, body: () => ({}), schema: councilsMinutesDtoSchema, invalidate: ALL });
}

export function useSignMinutesOnPaper() {
  return useApiAction({
    path: (v: { id: string; participantId: string; evidenceObjectKey: string }) => `${COUNCILS_BASE}/minutes/${v.id}/signatures/paper`,
    body: (v) => omit(v, "id"),
    schema: councilsMinutesDtoSchema,
    invalidate: ALL,
  });
}

export function useRevokeMinutes() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${COUNCILS_BASE}/minutes/${v.id}/revoke`, body: (v) => ({ reason: v.reason }), schema: councilsMinutesDtoSchema, invalidate: ALL });
}

/**
 * Lien de téléchargement du PDF (URL signée de quelques minutes, obtenue APRÈS contrôle de permission) : déclenché à la
 * demande, jamais mis en cache. 409 `councils.minutes_not_rendered` tant que le rendu n'est pas prêt.
 */
export function useMinutesPdfLink() {
  return useMutation<z.infer<typeof councilsMinutesPdfDtoSchema>, ApiError, { id: string }>({
    mutationFn: (v) => hooks.client.request("GET", `${COUNCILS_BASE}/minutes/${v.id}/pdf`, { schema: councilsMinutesPdfDtoSchema }) as Promise<z.infer<typeof councilsMinutesPdfDtoSchema>>,
  });
}

export function useUnlockRequests(councilId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "unlock", councilId], `${COUNCILS_BASE}/councils/${councilId}/unlock-requests`, { schema: itemsOf(councilsUnlockDtoSchema), select: pickItems, enabled: enabled && councilId !== null, retry: false });
}

export function useRequestUnlock() {
  return useApiAction({ path: (v: { councilId: string; reason: string }) => `${COUNCILS_BASE}/councils/${v.councilId}/unlock-requests`, body: (v) => ({ reason: v.reason }), schema: councilsUnlockDtoSchema, invalidate: ALL });
}

/** `approve` : note facultative ; `reject` : note (motif du refus) obligatoire. */
export function useDecideUnlock(action: "approve" | "reject") {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${COUNCILS_BASE}/unlock-requests/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: councilsUnlockDtoSchema,
    invalidate: ALL,
  });
}

export function useReopenCouncil() {
  return useApiAction({ path: (v: { id: string }) => `${COUNCILS_BASE}/councils/${v.id}/reopen`, body: () => ({}), schema: councilsCouncilDetailDtoSchema, invalidate: ALL });
}

// ---------------------------------------------------------------------------
// Effets et journal
// ---------------------------------------------------------------------------

export interface CouncilsEffectsQuery {
  status?: string;
  councilId?: string;
  kind?: string;
  page?: number;
  pageSize?: number;
}

export function useEffects(query: CouncilsEffectsQuery, enabled = true) {
  return hooks.useApiQuery([...KEY, "effects", "list"], `${COUNCILS_BASE}/effects`, { schema: councilsEffectsDtoSchema, query: query as Query, enabled, retry: false });
}

export function useCouncilEffects(councilId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "effects", "council", councilId], `${COUNCILS_BASE}/councils/${councilId}/effects`, { schema: councilsEffectsDtoSchema, enabled: enabled && councilId !== null, retry: false });
}

export function usePlanEffects() {
  return useApiAction({ path: (v: { councilId: string }) => `${COUNCILS_BASE}/councils/${v.councilId}/effects/plan`, body: () => ({}), schema: councilsEffectsDtoSchema, invalidate: ALL });
}

/** `retry`, `apply`, `skip` : motif facultatif (≥ 5) ; `revert` : motif obligatoire. */
export function useEffectAction(action: "retry" | "apply" | "skip" | "revert") {
  return useApiAction({
    path: (v: { id: string; reason?: string }) => `${COUNCILS_BASE}/effects/${v.id}/${action}`,
    body: (v) => omit(v, "id"),
    schema: councilsEffectDtoSchema,
    invalidate: ALL,
  });
}

export function useCouncilEvents(councilId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "events", councilId], `${COUNCILS_BASE}/councils/${councilId}/events`, { schema: councilsEventsDtoSchema, select: pickItems, enabled: enabled && councilId !== null, retry: false });
}

// ---------------------------------------------------------------------------
// Orientation et transferts de série
// ---------------------------------------------------------------------------

export function useOrientationPaths(enabled = true) {
  return hooks.useApiQuery([...KEY, "orientation-paths"], `${COUNCILS_BASE}/orientation-paths`, { schema: itemsOf(councilsOrientationPathDtoSchema), select: pickItems, enabled, retry: false });
}

export function useUpsertOrientationPath() {
  return useApiAction({
    method: "PUT",
    path: `${COUNCILS_BASE}/orientation-paths`,
    body: (v: z.input<typeof councilsOrientationPathInputSchema>) => v,
    schema: councilsOrientationPathDtoSchema,
    invalidate: [[...KEY, "orientation-paths"]],
  });
}
export type { CouncilsOrientationPathInput };

export function useOrientationFiles(query: { academicYearId?: string; status?: string; studentId?: string; page?: number; pageSize?: number }, enabled = true) {
  return hooks.useApiQuery([...KEY, "orientation-files"], `${COUNCILS_BASE}/orientation-files`, { schema: orientationFilesSchema, query: query as Query, enabled, retry: false });
}

export function useCreateOrientationFile() {
  return useApiAction({ path: `${COUNCILS_BASE}/orientation-files`, body: (v: { enrollmentId: string; notes?: string }) => v, schema: councilsOrientationFileDtoSchema, invalidate: ALL });
}

export function useAddWish() {
  return useApiAction({
    path: (v: { id: string; wish: z.input<typeof councilsWishInputSchema> }) => `${COUNCILS_BASE}/orientation-files/${v.id}/wishes`,
    body: (v) => v.wish,
    schema: councilsOrientationFileDtoSchema,
    invalidate: ALL,
  });
}
export type { CouncilsWishInput };

export function useRecordConsent() {
  return useApiAction({
    path: (v: { id: string; state: "GIVEN" | "REFUSED" }) => `${COUNCILS_BASE}/orientation-files/${v.id}/consent`,
    body: (v) => ({ state: v.state }),
    schema: councilsOrientationFileDtoSchema,
    invalidate: ALL,
  });
}

export function useSeriesTransfers(enabled = true) {
  return hooks.useApiQuery([...KEY, "series-transfers"], `${COUNCILS_BASE}/series-transfers`, { schema: itemsOf(councilsSeriesTransferDtoSchema), select: pickItems, enabled, retry: false });
}

export function useCreateSeriesTransfer() {
  return useApiAction({ path: `${COUNCILS_BASE}/series-transfers`, body: (v: CouncilsSeriesTransferInput) => v, schema: councilsSeriesTransferDtoSchema, invalidate: ALL });
}

export function useApplySeriesTransfer() {
  return useApiAction({
    path: (v: { id: string; toClassroomId?: string }) => `${COUNCILS_BASE}/series-transfers/${v.id}/apply`,
    body: (v) => (v.toClassroomId ? { toClassroomId: v.toClassroomId } : {}),
    schema: councilsSeriesTransferDtoSchema,
    invalidate: ALL,
  });
}

export function useCancelSeriesTransfer() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${COUNCILS_BASE}/series-transfers/${v.id}/cancel`, body: (v) => ({ reason: v.reason }), schema: councilsSeriesTransferDtoSchema, invalidate: ALL });
}

// ---------------------------------------------------------------------------
// Portails : famille et élève (jamais de suggestion, de vote ni de justification interne)
// ---------------------------------------------------------------------------

export function useChildDecisions(studentId: string | null) {
  return hooks.useApiQuery([...KEY, "child", studentId], `${COUNCILS_BASE}/children/${studentId}/decisions`, { schema: councilsFamilyDecisionsDtoSchema, enabled: studentId !== null, retry: false });
}

export function useMyDecisions(enabled = true) {
  return hooks.useApiQuery([...KEY, "me"], `${COUNCILS_BASE}/me/decisions`, { schema: councilsFamilyDecisionsDtoSchema, enabled, retry: false });
}
