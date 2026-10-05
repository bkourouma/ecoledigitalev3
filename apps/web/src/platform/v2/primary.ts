"use client";

/**
 * Hooks typés du pack Primary (`/api/v1/primary_school/*`, spec v2/005) : classes de l'instituteur, grille de compétences
 * (saisie en lot idempotente, validation, révision), banque d'appréciations, conseil des maîtres, bilans annuels scellés, archives
 * d'année, états, paramètres et référentiels, accès famille. Schémas Zod de `packages/contracts/src/v2/primary_school.ts`.
 *
 * AUCUN calcul côté web : ni moyenne, ni rang, ni pourcentage, ni seuil, ni décision de passage. Le web affiche des COMPTAGES
 * renvoyés par l'API et des CODES traduits par table de libellés ; il ne compare jamais un libellé.
 *
 * Clés de cache : `["primary", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import { academicYearDtoSchema } from "@ecoledigitale/contracts/v2/academic";
import {
  primaryAnnualReviewDtoSchema,
  primaryAssessmentDtoSchema,
  primaryBulkResultDtoSchema,
  primaryCompetencySheetDtoSchema,
  primaryCompetencySummaryDtoSchema,
  primaryCouncilOverviewDtoSchema,
  primaryCouncilSummaryDtoSchema,
  primaryFrameworkDetailDtoSchema,
  primaryFrameworkDtoSchema,
  primaryMyClassroomDtoSchema,
  primaryPhraseDtoSchema,
  primaryPrepareReviewsResultDtoSchema,
  primaryProgressDtoSchema,
  primaryRatingScaleDtoSchema,
  primaryReadinessDtoSchema,
  primaryReportDtoSchema,
  primaryRevisionDtoSchema,
  primaryRuleBannerDtoSchema,
  primarySettingsDtoSchema,
  primaryTemplateResultDtoSchema,
  primaryValidateResultDtoSchema,
  primaryYearArchiveDtoSchema,
  type PrimaryBulkRecordBody,
  type PrimaryCreateFrameworkBody,
  type PrimaryCreatePhraseBody,
  type PrimaryCreateScaleBody,
  type PrimaryDecideCaseBody,
  type PrimaryPrepareArchiveBody,
  type PrimaryPrepareCouncilBody,
  type PrimaryPrepareReviewsBody,
  type PrimaryPutAttendanceBody,
  type PrimaryReportKey,
  type PrimaryReportQuery,
  type PrimaryReviseBody,
  type PrimaryStructureBody,
  type PrimaryUpdateCaseBody,
  type PrimaryUpdateSettingsBody,
  type PrimaryWithdrawReadyBody,
} from "@ecoledigitale/contracts/v2/primary_school";
import { useApiAction } from "./actions";
import { omit } from "./omit";

export const PRIMARY_BASE = "/api/v1/primary_school";

type Query = Record<string, string | number | boolean | undefined>;
const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
const clean = (o: object): Query => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Query;

const KEY = ["primary"] as const;

// ---------------------------------------------------------------------------
// Réponses sans schéma dédié dans le contrat (formes lues dans `http/plugin.ts`)
// ---------------------------------------------------------------------------

/** Réponse de `PATCH /councils/:id/cases/:caseId` (champs modifiés du dossier). */
export const primaryCaseUpdateResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["OPEN", "DECIDED", "DEFERRED"]),
  proposalCode: z.string().nullable(),
  proposalNote: z.string().nullable(),
  discussionNote: z.string().nullable(),
  reasonCodes: z.array(z.string()),
});

/** Réponse de `POST /councils/:id/cases/:caseId/decide`. */
export const primaryDecisionResultSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(["OPEN", "DECIDED", "DEFERRED"]),
  decisionId: z.string().uuid(),
  finalCode: z.string(),
  ruleProposalCode: z.string().nullable(),
  changedFromProposal: z.boolean(),
  outcomeRecorded: z.string().nullable(),
});
export type PrimaryDecisionResult = z.infer<typeof primaryDecisionResultSchema>;

/** `POST /councils/:id/minutes` : le contrat (`primaryMinutesResultDtoSchema`) exige un `documentId` ; l'API peut le renvoyer `null` tant que le document n'est pas rendu. */
export const primaryMinutesViewSchema = z.object({
  documentId: z.string().uuid().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.number().int().optional(),
  alreadyRequested: z.boolean().optional(),
});
export type PrimaryMinutesView = z.infer<typeof primaryMinutesViewSchema>;

export const primaryRevisionResultSchema = z.object({ assessment: primaryAssessmentDtoSchema, revision: primaryRevisionDtoSchema });

/** Manques renvoyés en `details.blockers` par un refus 409 (scellement, publication). */
export const primaryBlockersSchema = z.array(z.object({ code: z.string(), message: z.string() }));

// ---------------------------------------------------------------------------
// Accès et vues
// ---------------------------------------------------------------------------

/** Bandeau « règles de démonstration » : `isPlaceholder` tant que le RuleSet lié est fictif. */
export function usePrimaryRuleBanner(classroomId?: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "rule-banner", classroomId ?? null], `${PRIMARY_BASE}/rule-banner`, {
    schema: primaryRuleBannerDtoSchema,
    query: clean({ classroomId: classroomId ?? undefined }),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** « Ma classe » : classes visibles (affectées, ou toutes avec `primary.class.read_all`), effectif, titulaire, périodes et verrous. */
export function useMyPrimaryClassrooms(enabled = true) {
  return hooks.useApiQuery([...KEY, "classrooms"], `${PRIMARY_BASE}/my-classrooms`, { schema: itemsOf(primaryMyClassroomDtoSchema), select: pickItems, enabled, retry: false });
}

/** Libellés des années académiques (lecture académique requise ; sans elle l'écran retombe sur un identifiant court). */
export function usePrimaryYearLabels(enabled = true) {
  return hooks.useApiQuery([...KEY, "years"], "/api/v1/academic/years", {
    schema: itemsOf(academicYearDtoSchema),
    select: (d) => new Map(d.items.map((y) => [y.id, y.label] as const)),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Paramètres et modèle de pack
// ---------------------------------------------------------------------------

export function usePrimarySettings(enabled = true) {
  return hooks.useApiQuery([...KEY, "settings"], `${PRIMARY_BASE}/settings`, { schema: primarySettingsDtoSchema, enabled, retry: false });
}

export function useUpdatePrimarySettings() {
  return useApiAction({
    method: "PUT",
    path: `${PRIMARY_BASE}/settings`,
    body: (v: PrimaryUpdateSettingsBody) => v,
    schema: primarySettingsDtoSchema,
    invalidate: [[...KEY, "settings"]],
  });
}

/** Acte SENSIBLE (MFA) : (ré)instancie le modèle de pack ; ne remplace jamais une donnée personnalisée. */
export function useApplyPrimaryTemplate() {
  return useApiAction({
    path: `${PRIMARY_BASE}/template/apply`,
    body: () => ({}),
    schema: primaryTemplateResultDtoSchema,
    invalidate: [[...KEY, "scales"], [...KEY, "frameworks"], [...KEY, "phrases"], [...KEY, "settings"]],
  });
}

// ---------------------------------------------------------------------------
// Échelles et référentiels
// ---------------------------------------------------------------------------

export function usePrimaryScales(enabled = true) {
  return hooks.useApiQuery([...KEY, "scales"], `${PRIMARY_BASE}/rating-scales`, { schema: itemsOf(primaryRatingScaleDtoSchema), select: pickItems, enabled, retry: false });
}

export function useCreatePrimaryScale() {
  return useApiAction({ path: `${PRIMARY_BASE}/rating-scales`, body: (v: PrimaryCreateScaleBody) => v, schema: primaryRatingScaleDtoSchema, invalidate: [[...KEY, "scales"]] });
}

export function usePrimaryFrameworks(query: { status?: string; gradeLevelCode?: string } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "frameworks", "list", query], `${PRIMARY_BASE}/frameworks`, {
    schema: itemsOf(primaryFrameworkDtoSchema),
    select: pickItems,
    query: clean(query),
    enabled,
    retry: false,
  });
}

export function usePrimaryFramework(id: string | null) {
  return hooks.useApiQuery([...KEY, "frameworks", "one", id], `${PRIMARY_BASE}/frameworks/${id}`, { schema: primaryFrameworkDetailDtoSchema, enabled: id !== null, retry: false });
}

const FRAMEWORKS = [[...KEY, "frameworks"]] as const;

export function useCreatePrimaryFramework() {
  return useApiAction({ path: `${PRIMARY_BASE}/frameworks`, body: (v: PrimaryCreateFrameworkBody) => v, schema: primaryFrameworkDetailDtoSchema, invalidate: FRAMEWORKS });
}

export function usePutPrimaryStructure() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; structure: PrimaryStructureBody }) => `${PRIMARY_BASE}/frameworks/${v.id}/structure`,
    body: (v) => v.structure,
    schema: primaryFrameworkDetailDtoSchema,
    invalidate: FRAMEWORKS,
  });
}

/** Publication : le référentiel publié devient IMMUABLE (nouvelle version pour le modifier). */
export function usePublishPrimaryFramework() {
  return useApiAction({ path: (v: { id: string }) => `${PRIMARY_BASE}/frameworks/${v.id}/publish`, schema: primaryFrameworkDetailDtoSchema, invalidate: [...FRAMEWORKS, [...KEY, "sheet"]] });
}

export function useNewPrimaryFrameworkVersion() {
  return useApiAction({ path: (v: { id: string }) => `${PRIMARY_BASE}/frameworks/${v.id}/new-version`, schema: primaryFrameworkDetailDtoSchema, invalidate: FRAMEWORKS });
}

export function useDeletePrimaryFramework() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${PRIMARY_BASE}/frameworks/${v.id}`, invalidate: FRAMEWORKS });
}

// ---------------------------------------------------------------------------
// Compétences : grille, saisie en lot, validation, révision, synthèse
// ---------------------------------------------------------------------------

export function usePrimaryCompetencySheet(classroomId: string | null, periodId: string | null, frameworkId: string | null) {
  return hooks.useApiQuery([...KEY, "sheet", classroomId, periodId, frameworkId], `${PRIMARY_BASE}/classrooms/${classroomId}/competency-sheet`, {
    schema: primaryCompetencySheetDtoSchema,
    query: clean({ periodId: periodId ?? undefined, frameworkId: frameworkId ?? undefined }),
    enabled: classroomId !== null && periodId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Saisie en lot (≤ 500 lignes, TOUT OU RIEN). `idempotencyKey` : UNE clé par lot ; rejouer le MÊME lot après un échec réseau
 * reprend la même clé (l'API converge : rien n'est écrit deux fois). Aucune invalidation de la grille : l'écran fusionne la réponse.
 */
export function useBulkRecordCompetencies() {
  return useApiAction({
    method: "PUT",
    path: `${PRIMARY_BASE}/competency-assessments/bulk`,
    body: (v: { body: PrimaryBulkRecordBody; idempotencyKey: string }) => v.body,
    idempotencyKey: (v) => v.idempotencyKey,
    schema: primaryBulkResultDtoSchema,
    invalidate: [[...KEY, "progress"], [...KEY, "reports"]],
  });
}

export function useValidatePrimaryCompetencies() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string; frameworkId?: string }) => `${PRIMARY_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/competencies/validate`,
    body: (v) => (v.frameworkId ? { frameworkId: v.frameworkId } : {}),
    schema: primaryValidateResultDtoSchema,
    invalidate: [[...KEY, "progress"], [...KEY, "competency-summary"]],
  });
}

/**
 * Q-P18 : marque la classe × période « prêtes » (visibles des familles ; la saisie est alors gelée). Réversible tant que le bulletin
 * n'est pas publié (`useWithdrawPrimaryReady`, motif de 10 caractères au moins).
 */
export function useMarkPrimaryPeriodReady() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string }) => `${PRIMARY_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/ready`,
    body: () => ({}),
    schema: primaryReadinessDtoSchema,
    invalidate: [[...KEY, "classrooms"], [...KEY, "competency-sheet"], [...KEY, "competency-summary"]],
  });
}

export function useWithdrawPrimaryReady() {
  return useApiAction({
    path: (v: { classroomId: string; periodId: string } & PrimaryWithdrawReadyBody) => `${PRIMARY_BASE}/classrooms/${v.classroomId}/periods/${v.periodId}/ready/withdraw`,
    body: (v) => ({ reason: v.reason }),
    schema: primaryReadinessDtoSchema,
    invalidate: [[...KEY, "classrooms"], [...KEY, "competency-sheet"], [...KEY, "competency-summary"]],
  });
}

/** Acte SENSIBLE (MFA) : corrige une ligne VALIDÉE ; motif de 10 caractères au moins, trace conservée côté API. */
export function useRevisePrimaryAssessment() {
  return useApiAction({
    path: (v: { assessmentId: string } & PrimaryReviseBody) => `${PRIMARY_BASE}/competency-assessments/${v.assessmentId}/revisions`,
    body: (v) => omit(v, "assessmentId"),
    schema: primaryRevisionResultSchema,
    invalidate: [[...KEY, "revisions"], [...KEY, "competency-summary"]],
  });
}

export function usePrimaryAssessmentRevisions(assessmentId: string | null) {
  return hooks.useApiQuery([...KEY, "revisions", assessmentId], `${PRIMARY_BASE}/competency-assessments/${assessmentId}/revisions`, {
    schema: itemsOf(primaryRevisionDtoSchema),
    select: pickItems,
    enabled: assessmentId !== null,
    retry: false,
  });
}

/** Synthèse par COMPTEURS `{domaine: {niveau: n}}` des lignes validées (personnel). */
export function usePrimaryCompetencySummary(enrollmentId: string | null, periodIds: readonly string[] | null) {
  return hooks.useApiQuery([...KEY, "competency-summary", "staff", enrollmentId, periodIds ?? null], `${PRIMARY_BASE}/enrollments/${enrollmentId}/competency-summary`, {
    schema: primaryCompetencySummaryDtoSchema,
    query: clean({ periodIds: periodIds && periodIds.length > 0 ? periodIds.join(",") : undefined }),
    enabled: enrollmentId !== null,
    retry: false,
  });
}

/** Synthèse d'un enfant (parent) : périodes prêtes, validées ou publiées seulement, jamais une saisie en cours (filtre appliqué par l'API, Q-P18). */
export function usePrimaryChildCompetencySummary(studentId: string | null, enrollmentId: string | null) {
  return hooks.useApiQuery([...KEY, "competency-summary", "child", studentId, enrollmentId], `${PRIMARY_BASE}/children/${studentId}/enrollments/${enrollmentId}/competency-summary`, {
    schema: primaryCompetencySummaryDtoSchema,
    enabled: studentId !== null && enrollmentId !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Banque d'appréciations
// ---------------------------------------------------------------------------

export interface PhraseFilters {
  scope?: string;
  ratingLevelCode?: string;
  gradeLevelCode?: string;
  includeInactive?: boolean;
}

export function usePrimaryPhrases(filters: PhraseFilters = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "phrases", filters], `${PRIMARY_BASE}/phrases`, {
    schema: itemsOf(primaryPhraseDtoSchema),
    select: pickItems,
    query: clean({ ...filters, includeInactive: filters.includeInactive ? "true" : undefined }),
    enabled,
    retry: false,
  });
}

export function useCreatePrimaryPhrase() {
  return useApiAction({ path: `${PRIMARY_BASE}/phrases`, body: (v: PrimaryCreatePhraseBody) => v, schema: primaryPhraseDtoSchema, invalidate: [[...KEY, "phrases"]] });
}

export function useUpdatePrimaryPhrase() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; active?: boolean; body?: string }) => `${PRIMARY_BASE}/phrases/${v.id}`,
    body: (v) => omit(v, "id"),
    schema: primaryPhraseDtoSchema,
    invalidate: [[...KEY, "phrases"]],
  });
}

// ---------------------------------------------------------------------------
// Conseil des maîtres
// ---------------------------------------------------------------------------

export function usePrimaryCouncils(query: { classroomId?: string; periodId?: string } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "councils", "list", query], `${PRIMARY_BASE}/councils`, { schema: itemsOf(primaryCouncilSummaryDtoSchema), select: pickItems, query: clean(query), enabled, retry: false });
}

export function usePrimaryCouncil(deliberationId: string | null) {
  return hooks.useApiQuery([...KEY, "councils", "one", deliberationId], `${PRIMARY_BASE}/councils/${deliberationId}`, { schema: primaryCouncilOverviewDtoSchema, enabled: deliberationId !== null, retry: false });
}

const COUNCILS = [[...KEY, "councils"]] as const;

export function usePreparePrimaryCouncil() {
  return useApiAction({ path: `${PRIMARY_BASE}/councils/prepare`, body: (v: PrimaryPrepareCouncilBody) => v, schema: primaryCouncilOverviewDtoSchema, invalidate: COUNCILS });
}

export function useUpdatePrimaryCouncilCase() {
  return useApiAction({
    method: "PATCH",
    path: (v: { deliberationId: string; caseId: string; patch: PrimaryUpdateCaseBody }) => `${PRIMARY_BASE}/councils/${v.deliberationId}/cases/${v.caseId}`,
    body: (v) => v.patch,
    schema: primaryCaseUpdateResultSchema,
    invalidate: COUNCILS,
  });
}

/** Absence de `finalCode` : la proposition de la règle est confirmée telle quelle ; sinon justification de 20 caractères au moins. */
export function useDecidePrimaryCouncilCase() {
  return useApiAction({
    path: (v: { deliberationId: string; caseId: string } & PrimaryDecideCaseBody) => `${PRIMARY_BASE}/councils/${v.deliberationId}/cases/${v.caseId}/decide`,
    body: (v) => omit(v, "deliberationId", "caseId"),
    schema: primaryDecisionResultSchema,
    invalidate: [...COUNCILS, [...KEY, "reviews"]],
  });
}

export function usePutPrimaryCouncilAttendance() {
  return useApiAction({
    method: "PUT",
    path: (v: { deliberationId: string; attendance: PrimaryPutAttendanceBody }) => `${PRIMARY_BASE}/councils/${v.deliberationId}/attendance`,
    body: (v) => v.attendance,
    schema: primaryCouncilOverviewDtoSchema,
    invalidate: COUNCILS,
  });
}

export function useRequestPrimaryCouncilMinutes() {
  return useApiAction({
    path: (v: { deliberationId: string; heldOn?: string }) => `${PRIMARY_BASE}/councils/${v.deliberationId}/minutes`,
    body: (v) => (v.heldOn ? { heldOn: v.heldOn } : {}),
    schema: primaryMinutesViewSchema,
    invalidate: COUNCILS,
  });
}

// ---------------------------------------------------------------------------
// Bilans annuels
// ---------------------------------------------------------------------------

export function usePrimaryAnnualReviews(query: { classroomId?: string; yearId?: string; status?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "reviews", "list", query], `${PRIMARY_BASE}/annual-reviews`, { schema: itemsOf(primaryAnnualReviewDtoSchema), select: pickItems, query: clean(query), enabled, retry: false });
}

const REVIEWS = [[...KEY, "reviews"], [...KEY, "progress"], [...KEY, "archives"]] as const;

export function usePreparePrimaryReviews() {
  return useApiAction({ path: `${PRIMARY_BASE}/annual-reviews/prepare`, body: (v: PrimaryPrepareReviewsBody) => v, schema: primaryPrepareReviewsResultDtoSchema, invalidate: REVIEWS });
}

/** Acte SENSIBLE (MFA) : le bilan devient IMMUABLE. Un refus 409 porte `details.blockers` (manques à corriger). */
export function useSealPrimaryReview() {
  return useApiAction({ path: (v: { id: string }) => `${PRIMARY_BASE}/annual-reviews/${v.id}/seal`, schema: primaryAnnualReviewDtoSchema, invalidate: REVIEWS });
}

/** Acte SENSIBLE (MFA) : crée la version n+1 ; motif de 10 caractères au moins. */
export function useReissuePrimaryReview() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${PRIMARY_BASE}/annual-reviews/${v.id}/reissue`,
    body: (v) => ({ reason: v.reason }),
    schema: primaryAnnualReviewDtoSchema,
    invalidate: REVIEWS,
  });
}

/** Bilans scellés ET publiés : de l'élève connecté. */
export function useMyPrimaryAnnualReviews(enabled = true) {
  return hooks.useApiQuery([...KEY, "reviews", "me"], `${PRIMARY_BASE}/me/annual-reviews`, { schema: itemsOf(primaryAnnualReviewDtoSchema), select: pickItems, enabled, retry: false });
}

/** Bilans scellés ET publiés d'un enfant lié (404 hors lien de tutelle). */
export function useChildPrimaryAnnualReviews(studentId: string | null) {
  return hooks.useApiQuery([...KEY, "reviews", "child", studentId], `${PRIMARY_BASE}/children/${studentId}/annual-reviews`, {
    schema: itemsOf(primaryAnnualReviewDtoSchema),
    select: pickItems,
    enabled: studentId !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Archives d'année
// ---------------------------------------------------------------------------

export function usePrimaryYearArchives(yearId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "archives", yearId], `${PRIMARY_BASE}/year-archives`, {
    schema: itemsOf(primaryYearArchiveDtoSchema),
    select: pickItems,
    query: clean({ yearId: yearId ?? undefined }),
    enabled,
    retry: false,
  });
}

export function usePreparePrimaryArchive() {
  return useApiAction({ path: `${PRIMARY_BASE}/year-archives/prepare`, body: (v: PrimaryPrepareArchiveBody) => v, schema: primaryYearArchiveDtoSchema, invalidate: [[...KEY, "archives"]] });
}

/** Acte SENSIBLE (MFA) et IRRÉVERSIBLE : plus aucun bilan de l'année ne pourra être écrit. */
export function useFreezePrimaryArchive() {
  return useApiAction({ path: (v: { id: string }) => `${PRIMARY_BASE}/year-archives/${v.id}/freeze`, schema: primaryYearArchiveDtoSchema, invalidate: [[...KEY, "archives"], ...REVIEWS] });
}

// ---------------------------------------------------------------------------
// Avancement et rapports
// ---------------------------------------------------------------------------

/** Comptages bruts par classe (direction) : les feux vert / orange / rouge sont calculés à l'AFFICHAGE à partir de ces nombres. */
export function usePrimaryProgress(yearId: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "progress", yearId], `${PRIMARY_BASE}/progress`, {
    schema: itemsOf(primaryProgressDtoSchema),
    select: pickItems,
    query: clean({ yearId: yearId ?? undefined }),
    enabled,
    retry: false,
  });
}

export type PrimaryReportParams = Partial<Omit<PrimaryReportQuery, "format">>;

export function usePrimaryReport(key: PrimaryReportKey | null, params: PrimaryReportParams) {
  return hooks.useApiQuery([...KEY, "reports", key, params], `${PRIMARY_BASE}/reports/${key}`, {
    schema: primaryReportDtoSchema,
    query: clean({ ...params, format: "json" }),
    enabled: key !== null,
    retry: false,
  });
}

/** Export CSV : renvoie le texte du fichier (téléchargé par l'écran, jamais une URL affichée). */
export function fetchPrimaryReportCsv(key: PrimaryReportKey, params: PrimaryReportParams): Promise<string> {
  return platformApi.get<string>(`${PRIMARY_BASE}/reports/${key}`, { query: clean({ ...params, format: "csv" }), responseType: "text" });
}
