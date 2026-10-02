"use client";

/**
 * Hooks typés du module `admissions` (`/api/v1/admissions/*` pour le personnel, `/api/v1/public/admissions/*` pour le formulaire
 * PUBLIC). Schémas Zod de `packages/contracts/src/v2/admissions.ts`.
 *
 * AUCUNE règle métier côté client : les transitions autorisées, les motifs de refus, la capacité, la liste d'attente, les pièces
 * manquantes et les doublons sont décidés par l'API ; l'écran affiche ce qui revient et lui envoie les actions. `usePermission` /
 * `useFeature` servent seulement à AFFICHER ou masquer (l'API reste la barrière).
 *
 * Public : appels ANONYMES (aucun jeton, aucun en-tête d'établissement ; l'établissement est désigné par le lien `school`). Le code
 * de suivi et les jetons voyagent dans le CORPS des requêtes, jamais dans l'URL ; les réponses d'erreur sont neutres et affichées
 * telles quelles.
 */

import { useQuery } from "@tanstack/react-query";
import { z, type ZodTypeAny } from "zod";
import type { ApiError } from "@/platform/api/errors";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  admissionsAcceptOfferResultDtoSchema,
  admissionsAnonymizeResultDtoSchema,
  admissionsApplicationCreatedDtoSchema,
  admissionsApplicationDetailDtoSchema,
  admissionsApplicationListDtoSchema,
  admissionsBoardDtoSchema,
  admissionsCampaignDtoSchema,
  admissionsCampaignListDtoSchema,
  admissionsCapacityReportDtoSchema,
  admissionsClassroomListDtoSchema,
  admissionsConsentTextDtoSchema,
  admissionsConsentTextListDtoSchema,
  admissionsConvertProspectBodySchema,
  admissionsCreatedProspectConversionDtoSchema,
  admissionsDecisionReasonDtoSchema,
  admissionsDecisionReasonListDtoSchema,
  admissionsDeletedDtoSchema,
  admissionsDocumentListDtoSchema,
  admissionsDocumentRequirementDtoSchema,
  admissionsDocumentRequirementListDtoSchema,
  admissionsDocumentUrlDtoSchema,
  admissionsDuplicateDtoSchema,
  admissionsDuplicateListDtoSchema,
  admissionsExportDtoSchema,
  admissionsFunnelDtoSchema,
  admissionsHistoryDtoSchema,
  admissionsInitializeResultDtoSchema,
  admissionsInterviewListDtoSchema,
  admissionsIssueOfferResultDtoSchema,
  admissionsLookupsDtoSchema,
  admissionsOfferDtoSchema,
  admissionsPriorityClassDtoSchema,
  admissionsPriorityClassListDtoSchema,
  admissionsProspectDtoSchema,
  admissionsProspectListDtoSchema,
  admissionsPromoteResultDtoSchema,
  admissionsPublicFormDtoSchema,
  admissionsPublicOfferRespondDtoSchema,
  admissionsPublicOfferViewDtoSchema,
  admissionsPublicSubmitResultDtoSchema,
  admissionsPublicTrackDtoSchema,
  admissionsRejectionsReportDtoSchema,
  admissionsSettingsDtoSchema,
  admissionsSlaReportDtoSchema,
  admissionsSourcesReportDtoSchema,
  admissionsWaitlistDtoSchema,
  admissionsWorkflowListDtoSchema,
  admissionsWorkflowViewDtoSchema,
  type AdmissionsAcceptOfferResultDto,
  type AdmissionsCreateApplicationBody,
  type AdmissionsCreateCampaignBody,
  type AdmissionsCreateProspectBody,
  type AdmissionsCreateWorkflowBody,
  type AdmissionsDecisionBody,
  type AdmissionsIssueOfferBody,
  type AdmissionsListApplicationsQuery,
  type AdmissionsPublicFormDto,
  type AdmissionsPublicSubmitBody,
  type AdmissionsPublicSubmitResultDto,
  type AdmissionsPublicTrackDto,
  type AdmissionsReplaceCapacitiesBody,
  type AdmissionsReplaceStagesBody,
  type AdmissionsReplaceTransitionsBody,
  type AdmissionsTransitionBody,
  type AdmissionsUpdateApplicationBody,
  type AdmissionsUpdateProspectBody,
  type AdmissionsUpdateSettingsBody,
  type AdmissionsUpdateInterviewBody,
} from "@ecoledigitale/contracts/v2/admissions";
import { useApiAction } from "./actions";

export const ADMISSIONS_BASE = "/api/v1/admissions";
export const ADMISSIONS_PUBLIC_BASE = "/api/v1/public/admissions";
const KEY = ["admissions"] as const;

type Query = Record<string, string | number | boolean | undefined>;
const clean = (q: Record<string, string | number | boolean | undefined | null>): Query => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Query;

// ---------------------------------------------------------------------------
// Références (établissements, niveaux, classes, liens de parenté)
// ---------------------------------------------------------------------------

export function useAdmissionsLookups(institutionId?: string, enabled = true) {
  return hooks.useApiQuery([...KEY, "lookups", institutionId ?? "default"], `${ADMISSIONS_BASE}/lookups`, { query: clean({ institutionId }), schema: admissionsLookupsDtoSchema, enabled, staleTime: 60_000, retry: false });
}

export function useClassrooms(input: { institutionId: string; academicYearId: string; gradeLevelCode: string } | null) {
  return hooks.useApiQuery([...KEY, "classrooms", input?.institutionId, input?.academicYearId, input?.gradeLevelCode], `${ADMISSIONS_BASE}/lookups/classrooms`, {
    query: input ? clean(input) : undefined,
    schema: admissionsClassroomListDtoSchema,
    enabled: input !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Paramètres, lien public, données d'établissement
// ---------------------------------------------------------------------------

export function useAdmissionsSettings(institutionId?: string) {
  return hooks.useApiQuery([...KEY, "settings", institutionId ?? "default"], `${ADMISSIONS_BASE}/settings`, { query: clean({ institutionId }), schema: admissionsSettingsDtoSchema, retry: false });
}

export function useUpdateAdmissionsSettings() {
  return useApiAction({ method: "PUT", path: `${ADMISSIONS_BASE}/settings`, body: (v: AdmissionsUpdateSettingsBody) => v, schema: admissionsSettingsDtoSchema, invalidate: [[...KEY, "settings"], [...KEY, "lookups"]] });
}

export function usePublicLinkAction() {
  return useApiAction({
    path: `${ADMISSIONS_BASE}/settings/public-link`,
    body: (v: { institutionId?: string; enabled?: boolean; rotate?: boolean }) => v,
    schema: admissionsSettingsDtoSchema,
    invalidate: [[...KEY, "settings"]],
  });
}

export function useInitializeInstitution() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/settings/initialize`, body: (v: { institutionId?: string }) => v, schema: admissionsInitializeResultDtoSchema, invalidate: [[...KEY, "workflows"], [...KEY, "settings"], [...KEY, "reasons"]] });
}

export function usePriorityClasses(institutionId?: string) {
  return hooks.useApiQuery([...KEY, "priority", institutionId ?? "default"], `${ADMISSIONS_BASE}/priority-classes`, { query: clean({ institutionId }), schema: admissionsPriorityClassListDtoSchema, retry: false });
}
export function useUpsertPriorityClass() {
  return useApiAction({ method: "PUT", path: `${ADMISSIONS_BASE}/priority-classes`, body: (v: { institutionId?: string; code: string; label: string; rank: number; active?: boolean }) => v, schema: admissionsPriorityClassDtoSchema, invalidate: [[...KEY, "priority"]] });
}

export function useDecisionReasons(institutionId?: string, enabled = true) {
  return hooks.useApiQuery([...KEY, "reasons", institutionId ?? "default"], `${ADMISSIONS_BASE}/decision-reasons`, { query: clean({ institutionId }), schema: admissionsDecisionReasonListDtoSchema, enabled, retry: false });
}
export function useUpsertDecisionReason() {
  return useApiAction({ method: "PUT", path: `${ADMISSIONS_BASE}/decision-reasons`, body: (v: { institutionId?: string; code: string; kind: string; label: string; active?: boolean }) => v, schema: admissionsDecisionReasonDtoSchema, invalidate: [[...KEY, "reasons"]] });
}

export function useRequirements(institutionId?: string) {
  return hooks.useApiQuery([...KEY, "requirements", institutionId ?? "default"], `${ADMISSIONS_BASE}/document-requirements`, { query: clean({ institutionId }), schema: admissionsDocumentRequirementListDtoSchema, retry: false });
}
export function useUpsertRequirement() {
  return useApiAction({
    method: "PUT",
    path: `${ADMISSIONS_BASE}/document-requirements`,
    body: (v: { institutionId?: string; code: string; label: string; gradeLevelCode?: string | null; appliesToFunding?: string | null; required?: boolean; acceptsMime?: string[]; maxSizeKb?: number; sortOrder?: number; active?: boolean }) => v,
    schema: admissionsDocumentRequirementDtoSchema,
    invalidate: [[...KEY, "requirements"], [...KEY, "application"]],
  });
}

export function useConsentTexts(institutionId?: string) {
  return hooks.useApiQuery([...KEY, "consents", institutionId ?? "default"], `${ADMISSIONS_BASE}/consent-texts`, { query: clean({ institutionId }), schema: admissionsConsentTextListDtoSchema, retry: false });
}
export function usePublishConsentText() {
  return useApiAction({
    path: `${ADMISSIONS_BASE}/consent-texts`,
    query: (v: { designate: boolean }) => ({ designate: v.designate }),
    body: (v: { designate: boolean; institutionId?: string; kind: string; version: string; language: string; body: string }) => {
      const { designate: _designate, ...rest } = v;
      void _designate;
      return rest;
    },
    schema: admissionsConsentTextDtoSchema,
    invalidate: [[...KEY, "consents"], [...KEY, "settings"]],
  });
}
export function useRetireConsentText() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/consent-texts/retire`, body: (v: { institutionId?: string; kind: string; version: string }) => v, schema: admissionsConsentTextDtoSchema, invalidate: [[...KEY, "consents"]] });
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export function useWorkflows(institutionId?: string) {
  return hooks.useApiQuery([...KEY, "workflows", institutionId ?? "default"], `${ADMISSIONS_BASE}/workflows`, { query: clean({ institutionId }), schema: admissionsWorkflowListDtoSchema, retry: false });
}
export function useWorkflow(id: string | null) {
  return hooks.useApiQuery([...KEY, "workflow", id], `${ADMISSIONS_BASE}/workflows/${id}`, { schema: admissionsWorkflowViewDtoSchema, enabled: id !== null, retry: false });
}
const WORKFLOW_KEYS = [[...KEY, "workflows"], [...KEY, "workflow"]] as const;
export function useCreateWorkflow() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/workflows`, body: (v: AdmissionsCreateWorkflowBody) => v, schema: admissionsWorkflowViewDtoSchema, invalidate: WORKFLOW_KEYS });
}
export function useReplaceStages(id: string) {
  return useApiAction({ method: "PUT", path: `${ADMISSIONS_BASE}/workflows/${id}/stages`, body: (v: AdmissionsReplaceStagesBody) => v, schema: admissionsWorkflowViewDtoSchema, invalidate: WORKFLOW_KEYS });
}
export function useReplaceTransitions(id: string) {
  return useApiAction({ method: "PUT", path: `${ADMISSIONS_BASE}/workflows/${id}/transitions`, body: (v: AdmissionsReplaceTransitionsBody) => v, schema: admissionsWorkflowViewDtoSchema, invalidate: WORKFLOW_KEYS });
}
export function usePublishWorkflow(id: string) {
  return useApiAction({ path: `${ADMISSIONS_BASE}/workflows/${id}/publish`, schema: admissionsWorkflowViewDtoSchema, invalidate: [...WORKFLOW_KEYS, [...KEY, "campaigns"]] });
}
export function useNewWorkflowVersion() {
  return useApiAction({ path: (id: string) => `${ADMISSIONS_BASE}/workflows/${id}/new-version`, schema: admissionsWorkflowViewDtoSchema, invalidate: WORKFLOW_KEYS });
}
export function useDeleteWorkflow() {
  return useApiAction({ method: "DELETE", path: (id: string) => `${ADMISSIONS_BASE}/workflows/${id}`, schema: admissionsDeletedDtoSchema, invalidate: WORKFLOW_KEYS });
}

// ---------------------------------------------------------------------------
// Campagnes et capacités
// ---------------------------------------------------------------------------

export function useCampaigns(institutionId?: string, enabled = true) {
  return hooks.useApiQuery([...KEY, "campaigns", institutionId ?? "default"], `${ADMISSIONS_BASE}/campaigns`, { query: clean({ institutionId }), schema: admissionsCampaignListDtoSchema, enabled, retry: false });
}
const CAMPAIGN_KEYS = [[...KEY, "campaigns"], [...KEY, "board"], [...KEY, "waitlist"]] as const;
export function useCreateCampaign() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/campaigns`, body: (v: AdmissionsCreateCampaignBody) => v, schema: admissionsCampaignDtoSchema, invalidate: CAMPAIGN_KEYS });
}
export function useCampaignAction() {
  return useApiAction({ path: (v: { id: string; action: "open" | "close" }) => `${ADMISSIONS_BASE}/campaigns/${v.id}/${v.action}`, schema: admissionsCampaignDtoSchema, invalidate: CAMPAIGN_KEYS });
}
export function useUpsertCapacities(id: string) {
  return useApiAction({ method: "PUT", path: `${ADMISSIONS_BASE}/campaigns/${id}/capacities`, body: (v: AdmissionsReplaceCapacitiesBody) => v, schema: admissionsCampaignDtoSchema, invalidate: CAMPAIGN_KEYS });
}

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export function useProspects(query: { institutionId?: string; status?: string; q?: string; page: number; pageSize: number }) {
  return hooks.useApiQuery([...KEY, "prospects", query], `${ADMISSIONS_BASE}/prospects`, { query: clean(query), schema: admissionsProspectListDtoSchema, retry: false, keepPreviousData: true });
}
export function useCreateProspect() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/prospects`, body: (v: AdmissionsCreateProspectBody) => v, schema: admissionsProspectDtoSchema, invalidate: [[...KEY, "prospects"]] });
}
export function useUpdateProspect() {
  return useApiAction({ method: "PATCH", path: (v: { id: string; patch: AdmissionsUpdateProspectBody }) => `${ADMISSIONS_BASE}/prospects/${v.id}`, body: (v: { id: string; patch: AdmissionsUpdateProspectBody }) => v.patch, schema: admissionsProspectDtoSchema, invalidate: [[...KEY, "prospects"]] });
}
export function useConvertProspect() {
  return useApiAction({
    path: (v: { id: string; body: z.input<typeof admissionsConvertProspectBodySchema> }) => `${ADMISSIONS_BASE}/prospects/${v.id}/convert`,
    body: (v: { id: string; body: z.input<typeof admissionsConvertProspectBodySchema> }) => v.body,
    schema: admissionsCreatedProspectConversionDtoSchema,
    invalidate: [[...KEY, "prospects"], [...KEY, "board"], [...KEY, "applications"]],
  });
}

// ---------------------------------------------------------------------------
// Candidatures
// ---------------------------------------------------------------------------

const APPLICATION_KEYS = [[...KEY, "applications"], [...KEY, "application"], [...KEY, "board"], [...KEY, "waitlist"], [...KEY, "reports"]] as const;

export function useBoard(query: { campaignId: string | null; grade?: string }) {
  return hooks.useApiQuery([...KEY, "board", query.campaignId, query.grade ?? ""], `${ADMISSIONS_BASE}/applications/board`, {
    query: clean({ campaignId: query.campaignId ?? undefined, grade: query.grade }),
    schema: admissionsBoardDtoSchema,
    enabled: query.campaignId !== null,
    retry: false,
    keepPreviousData: true,
  });
}

export function useApplications(query: Partial<Omit<AdmissionsListApplicationsQuery, "page" | "pageSize">> & { page: number; pageSize: number }) {
  return hooks.useApiQuery([...KEY, "applications", query], `${ADMISSIONS_BASE}/applications`, { query: clean(query as Query), schema: admissionsApplicationListDtoSchema, retry: false, keepPreviousData: true });
}

export function useApplication(id: string | null) {
  return hooks.useApiQuery([...KEY, "application", id], `${ADMISSIONS_BASE}/applications/${id}`, { schema: admissionsApplicationDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useApplicationHistory(id: string, enabled: boolean) {
  return hooks.useApiQuery([...KEY, "application", id, "history"], `${ADMISSIONS_BASE}/applications/${id}/history`, { schema: admissionsHistoryDtoSchema, enabled, retry: false });
}

export function useCreateApplication() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/applications`, body: (v: AdmissionsCreateApplicationBody) => v, schema: admissionsApplicationCreatedDtoSchema, invalidate: APPLICATION_KEYS });
}
export function useUpdateApplication(id: string) {
  return useApiAction({ method: "PATCH", path: `${ADMISSIONS_BASE}/applications/${id}`, body: (v: AdmissionsUpdateApplicationBody) => v, schema: admissionsApplicationDetailDtoSchema, invalidate: APPLICATION_KEYS });
}
/** Changement d'étape hors décision : l'API contrôle la permission PORTÉE PAR LA TRANSITION du workflow. */
export function useTransitionApplication() {
  return useApiAction({
    path: (v: { id: string; body: AdmissionsTransitionBody }) => `${ADMISSIONS_BASE}/applications/${v.id}/transition`,
    body: (v: { id: string; body: AdmissionsTransitionBody }) => v.body,
    schema: admissionsApplicationDetailDtoSchema,
    invalidate: APPLICATION_KEYS,
  });
}
export function useDecideApplication() {
  return useApiAction({
    path: (v: { id: string; body: AdmissionsDecisionBody }) => `${ADMISSIONS_BASE}/applications/${v.id}/decisions`,
    body: (v: { id: string; body: AdmissionsDecisionBody }) => v.body,
    schema: admissionsApplicationDetailDtoSchema,
    invalidate: APPLICATION_KEYS,
  });
}

export function useUploadApplicationDocument(id: string) {
  return useApiAction({
    path: `${ADMISSIONS_BASE}/applications/${id}/documents`,
    body: (v: { requirementId: string; file: File }) => {
      const form = new FormData();
      form.append("requirementId", v.requirementId);
      form.append("file", v.file, v.file.name);
      return form;
    },
    schema: admissionsDocumentListDtoSchema,
    invalidate: [[...KEY, "application"], [...KEY, "applications"]],
    timeoutMs: 120_000,
  });
}
export function useReviewApplicationDocument(id: string) {
  return useApiAction({
    path: (v: { requirementId: string; decision: "ACCEPT" | "REJECT"; reason?: string }) => `${ADMISSIONS_BASE}/applications/${id}/documents/${v.requirementId}/review`,
    body: (v: { requirementId: string; decision: "ACCEPT" | "REJECT"; reason?: string }) => ({ decision: v.decision, ...(v.reason ? { reason: v.reason } : {}) }),
    schema: admissionsDocumentListDtoSchema,
    invalidate: [[...KEY, "application"], [...KEY, "applications"]],
  });
}
export async function fetchDocumentUrl(applicationId: string, requirementId: string) {
  return platformApi.get(`${ADMISSIONS_BASE}/applications/${applicationId}/documents/${requirementId}/url`, { schema: admissionsDocumentUrlDtoSchema });
}

export function useRecordConsent(id: string) {
  return useApiAction({
    path: `${ADMISSIONS_BASE}/applications/${id}/consents`,
    body: (v: { guardianId: string; kind?: string; textVersion: string; givenVia: "STAFF_ON_BEHALF" | "PAPER"; evidenceRef: string }) => v,
    schema: admissionsApplicationDetailDtoSchema,
    invalidate: APPLICATION_KEYS,
  });
}

export function useCreateInterview(id: string) {
  return useApiAction({ path: `${ADMISSIONS_BASE}/applications/${id}/interviews`, body: (v: { kind: "TEST" | "INTERVIEW"; scheduledAt: string; venue?: string | null; conductedByStaffId?: string | null }) => v, schema: admissionsInterviewListDtoSchema, invalidate: [[...KEY, "application"]] });
}
export function useUpdateInterview(id: string) {
  return useApiAction({
    method: "PATCH",
    path: (v: { interviewId: string; patch: AdmissionsUpdateInterviewBody }) => `${ADMISSIONS_BASE}/applications/${id}/interviews/${v.interviewId}`,
    body: (v: { interviewId: string; patch: AdmissionsUpdateInterviewBody }) => v.patch,
    schema: admissionsInterviewListDtoSchema,
    invalidate: [[...KEY, "application"]],
  });
}

export function useIssueOffer(id: string) {
  return useApiAction({ path: `${ADMISSIONS_BASE}/applications/${id}/offers`, body: (v: AdmissionsIssueOfferBody) => v, schema: admissionsIssueOfferResultDtoSchema, invalidate: APPLICATION_KEYS });
}
export function useWithdrawOffer() {
  return useApiAction({ path: (v: { offerId: string; reason: string }) => `${ADMISSIONS_BASE}/offers/${v.offerId}/withdraw`, body: (v: { offerId: string; reason: string }) => ({ reason: v.reason }), schema: admissionsOfferDtoSchema, invalidate: APPLICATION_KEYS });
}
export function useSetOfferClassroom() {
  return useApiAction({ path: (v: { offerId: string; classroomId: string }) => `${ADMISSIONS_BASE}/offers/${v.offerId}/classroom`, body: (v: { offerId: string; classroomId: string }) => ({ classroomId: v.classroomId }), schema: admissionsOfferDtoSchema, invalidate: APPLICATION_KEYS });
}
export function useAcceptOnBehalf() {
  return useApiAction<AdmissionsAcceptOfferResultDto, { offerId: string; guardianId: string; evidenceRef: string; classroomId?: string }>({
    path: (v) => `${ADMISSIONS_BASE}/offers/${v.offerId}/accept-on-behalf`,
    body: (v) => ({ guardianId: v.guardianId, evidenceRef: v.evidenceRef, ...(v.classroomId ? { classroomId: v.classroomId } : {}) }),
    schema: admissionsAcceptOfferResultDtoSchema,
    invalidate: APPLICATION_KEYS,
  });
}

export function useDuplicates(id: string, enabled = true) {
  return hooks.useApiQuery([...KEY, "application", id, "duplicates"], `${ADMISSIONS_BASE}/applications/${id}/duplicates`, { schema: admissionsDuplicateListDtoSchema, enabled, retry: false });
}
export function useDetectDuplicates(id: string) {
  return useApiAction({ path: `${ADMISSIONS_BASE}/applications/${id}/duplicates/detect`, schema: admissionsDuplicateListDtoSchema, invalidate: [[...KEY, "application"]] });
}
export function useResolveDuplicate(id: string) {
  return useApiAction({
    path: (v: { duplicateId: string; resolution: "CONFIRMED_DUPLICATE" | "DISMISSED" }) => `${ADMISSIONS_BASE}/applications/${id}/duplicates/${v.duplicateId}/resolve`,
    body: (v: { duplicateId: string; resolution: "CONFIRMED_DUPLICATE" | "DISMISSED" }) => ({ resolution: v.resolution }),
    schema: admissionsDuplicateDtoSchema,
    invalidate: [[...KEY, "application"]],
  });
}

export function useAnonymizeApplication(id: string) {
  return useApiAction({ path: `${ADMISSIONS_BASE}/applications/${id}/anonymize`, body: (v: { reason: string }) => v, schema: admissionsAnonymizeResultDtoSchema, invalidate: APPLICATION_KEYS });
}
export async function fetchApplicationExport(id: string) {
  return platformApi.get(`${ADMISSIONS_BASE}/applications/${id}/export`, { schema: admissionsExportDtoSchema });
}

// ---------------------------------------------------------------------------
// Liste d'attente
// ---------------------------------------------------------------------------

export function useWaitlist(query: { campaignId: string | null; grade: string | null }) {
  return hooks.useApiQuery([...KEY, "waitlist", query.campaignId, query.grade], `${ADMISSIONS_BASE}/waitlist`, {
    query: clean({ campaignId: query.campaignId ?? undefined, grade: query.grade ?? undefined }),
    schema: admissionsWaitlistDtoSchema,
    enabled: query.campaignId !== null && query.grade !== null,
    retry: false,
  });
}
export function usePromoteFromWaitlist() {
  return useApiAction({ path: `${ADMISSIONS_BASE}/waitlist/promote`, body: (v: { campaignId: string; grade: string; classroomId?: string; applicationId?: string }) => v, schema: admissionsPromoteResultDtoSchema, invalidate: APPLICATION_KEYS });
}

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

export function useFunnelReport(campaignId: string | null, grade?: string) {
  return hooks.useApiQuery([...KEY, "reports", "funnel", campaignId, grade ?? ""], `${ADMISSIONS_BASE}/reports/funnel`, { query: clean({ campaignId: campaignId ?? undefined, grade }), schema: admissionsFunnelDtoSchema, enabled: campaignId !== null, retry: false });
}
export function useCapacityReport(campaignId: string | null) {
  return hooks.useApiQuery([...KEY, "reports", "capacity", campaignId], `${ADMISSIONS_BASE}/reports/capacity`, { query: clean({ campaignId: campaignId ?? undefined }), schema: admissionsCapacityReportDtoSchema, enabled: campaignId !== null, retry: false });
}
export function useSlaReport(campaignId: string | null) {
  return hooks.useApiQuery([...KEY, "reports", "sla", campaignId], `${ADMISSIONS_BASE}/reports/sla`, { query: clean({ campaignId: campaignId ?? undefined }), schema: admissionsSlaReportDtoSchema, enabled: campaignId !== null, retry: false });
}
export function useSourcesReport(campaignId: string | null) {
  return hooks.useApiQuery([...KEY, "reports", "sources", campaignId], `${ADMISSIONS_BASE}/reports/sources`, { query: clean({ campaignId: campaignId ?? undefined }), schema: admissionsSourcesReportDtoSchema, enabled: campaignId !== null, retry: false });
}
export function useRejectionsReport(campaignId: string | null) {
  return hooks.useApiQuery([...KEY, "reports", "rejections", campaignId], `${ADMISSIONS_BASE}/reports/rejections`, { query: clean({ campaignId: campaignId ?? undefined }), schema: admissionsRejectionsReportDtoSchema, enabled: campaignId !== null, retry: false });
}

// ---------------------------------------------------------------------------
// PUBLIC (sans authentification) : formulaire, suivi, pièces, offre
//
// Appels ANONYMES : ni jeton, ni en-tête d'établissement (l'établissement est désigné par le lien `school`). Les codes et jetons
// voyagent dans le CORPS des requêtes ; les réponses d'erreur de l'API sont neutres et affichées telles quelles.
// ---------------------------------------------------------------------------

/**
 * Formulaire public d'un établissement. Chaque lecture émet un jeton de formulaire à usage unique : aucune relecture automatique
 * (ni au retour de fenêtre, ni à la reconnexion) pour ne pas consommer ni invalider le jeton du visiteur.
 */
export function usePublicForm(school: string) {
  return useQuery<AdmissionsPublicFormDto, ApiError>({
    queryKey: ["admissions-public", "form", school],
    queryFn: ({ signal }) => platformApi.get(`${ADMISSIONS_PUBLIC_BASE}/forms/${encodeURIComponent(school)}`, { anonymous: true, schema: admissionsPublicFormDtoSchema, signal, retries: 0 }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

function publicPost<S extends ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.output<S>> {
  return platformApi.request("POST", `${ADMISSIONS_PUBLIC_BASE}${path}`, { body, schema, anonymous: true, retries: 0 }) as Promise<z.output<S>>;
}

export const publicSubmit = (school: string, body: AdmissionsPublicSubmitBody): Promise<AdmissionsPublicSubmitResultDto> =>
  publicPost(`/forms/${encodeURIComponent(school)}/applications`, body, admissionsPublicSubmitResultDtoSchema);
export const publicTrack = (school: string, trackingCode: string): Promise<AdmissionsPublicTrackDto> => publicPost("/track", { school, trackingCode }, admissionsPublicTrackDtoSchema);
export const publicViewOffer = (school: string, token: string): Promise<z.output<typeof admissionsPublicOfferViewDtoSchema>> => publicPost("/offers/view", { school, token }, admissionsPublicOfferViewDtoSchema);
export const publicRespondOffer = (school: string, token: string, accept: boolean): Promise<z.output<typeof admissionsPublicOfferRespondDtoSchema>> =>
  publicPost("/offers/respond", { school, token, accept }, admissionsPublicOfferRespondDtoSchema);

/** Dépôt d'une pièce par la famille : multipart, code de suivi dans le CORPS. */
export function publicUploadDocument(input: { school: string; trackingCode: string; requirementId: string; file: File }): Promise<{ received: true }> {
  const form = new FormData();
  form.append("school", input.school);
  form.append("trackingCode", input.trackingCode);
  form.append("requirementId", input.requirementId);
  form.append("file", input.file, input.file.name);
  return platformApi.request("POST", `${ADMISSIONS_PUBLIC_BASE}/track/documents`, { body: form, anonymous: true, timeoutMs: 120_000, retries: 0, schema: z.object({ received: z.literal(true) }) }) as Promise<{ received: true }>;
}
