"use client";

/**
 * Hooks typés du module `reportcards` (`/api/v1/reportcards/*`) et de la vérification publique
 * (`/api/v1/public/verify/*`) : contrôle préalable, lots d'émission, liste et détail des bulletins, publication, retrait,
 * réémission, révocation, téléchargement contrôlé, identité visuelle, signataires, gabarits, réglages, lecture famille.
 * Schémas Zod de `packages/contracts/src/v2/reportcards.ts`.
 *
 * Un bulletin est un instantané immuable déjà calculé et clôturé : le web ne calcule rien et n'affiche que ce que l'API
 * renvoie. La vérification publique n'expose ni note, ni nom, ni matricule, ni date de naissance (contrat).
 *
 * Clés de cache : `["reportcards", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  reportcardsBatchDtoSchema,
  reportcardsBrandingDtoSchema,
  reportcardsDownloadDtoSchema,
  reportcardsFileVerificationDtoSchema,
  reportcardsPreflightDtoSchema,
  reportcardsPreviewDtoSchema,
  reportcardsPublicVerificationDtoSchema,
  reportcardsPublishResultDtoSchema,
  reportcardsReportCardDetailDtoSchema,
  reportcardsReportCardDtoSchema,
  reportcardsReportCardPageDtoSchema,
  reportcardsSettingsDtoSchema,
  reportcardsSignatoryDtoSchema,
  reportcardsTemplateConfigDtoSchema,
  reportcardsTemplateDtoSchema,
  reportcardsExplainDtoSchema,
  type ReportcardsDocumentKind,
} from "@ecoledigitale/contracts/v2/reportcards";
import { useApiAction } from "./actions";

export const REPORTCARDS_BASE = "/api/v1/reportcards";
export const PUBLIC_VERIFY_BASE = "/api/v1/public/verify";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
const clean = (o: object): Record<string, string | number | boolean> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string | number | boolean>;

// ---------------------------------------------------------------------------
// Contrôle préalable et lots
// ---------------------------------------------------------------------------

export function usePreflight(query: { classroomId: string; academicPeriodId: string; kind?: ReportcardsDocumentKind; provisional?: boolean } | null) {
  return hooks.useApiQuery(["reportcards", "preflight", query], `${REPORTCARDS_BASE}/preflight`, {
    schema: reportcardsPreflightDtoSchema,
    query: query ? clean({ ...query, provisional: query.provisional ? "true" : undefined }) : undefined,
    enabled: query !== null,
    staleTime: 0,
  });
}

const RUNNING_BATCH = new Set(["PENDING", "SNAPSHOTTING", "RENDERING"]);

/** Lot d'émission ; relu toutes les 2 s tant qu'il n'est pas terminé (progression). */
export function useBatch(id: string | null) {
  return hooks.useApiQuery(["reportcards", "batch", id], `${REPORTCARDS_BASE}/batches/${id}`, {
    schema: reportcardsBatchDtoSchema,
    enabled: id !== null,
    refetchInterval: (data) => (data && !RUNNING_BATCH.has(data.status) ? false : 2000),
  });
}

const CARDS_KEY = ["reportcards"] as const;

export function useCreateBatch() {
  return useApiAction({
    path: `${REPORTCARDS_BASE}/batches`,
    body: (v: { classroomId: string; academicPeriodId: string; kind?: ReportcardsDocumentKind; provisional?: boolean; enrollmentIds?: string[]; reissueReason?: string; idempotencyKey?: string }) => ({
      classroomId: v.classroomId,
      academicPeriodId: v.academicPeriodId,
      ...(v.kind ? { kind: v.kind } : {}),
      ...(v.provisional ? { provisional: true } : {}),
      ...(v.enrollmentIds ? { enrollmentIds: v.enrollmentIds } : {}),
      ...(v.reissueReason ? { reissueReason: v.reissueReason } : {}),
      ...(v.idempotencyKey ? { idempotencyKey: v.idempotencyKey } : {}),
    }),
    schema: reportcardsBatchDtoSchema,
    invalidate: [CARDS_KEY],
  });
}

export function useRetryBatch() {
  return useApiAction({
    path: (v: { id: string }) => `${REPORTCARDS_BASE}/batches/${v.id}/retry`,
    schema: z.unknown(),
    invalidate: [CARDS_KEY],
  });
}

// ---------------------------------------------------------------------------
// Liste, détail, actions
// ---------------------------------------------------------------------------

export interface ReportCardsQuery {
  classroomId?: string;
  academicPeriodId?: string;
  studentId?: string;
  status?: string;
  kind?: string;
  live?: boolean;
  needsReissue?: boolean;
  limit?: number;
}

export function useReportCards(query: ReportCardsQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiInfiniteQuery(["reportcards", "cards", "list"], `${REPORTCARDS_BASE}/report-cards`, {
    schema: reportcardsReportCardPageDtoSchema,
    query: clean({ limit: 50, ...query }),
    getNextCursor: (page) => page.nextCursor,
    enabled: options.enabled,
  });
}

export function useReportCard(id: string | null) {
  return hooks.useApiQuery(["reportcards", "cards", "one", id], `${REPORTCARDS_BASE}/report-cards/${id}`, { schema: reportcardsReportCardDetailDtoSchema, enabled: id !== null });
}

export function useReportCardExplain(id: string | null, enabled: boolean) {
  return hooks.useApiQuery(["reportcards", "cards", "explain", id], `${REPORTCARDS_BASE}/report-cards/${id}/explain`, { schema: reportcardsExplainDtoSchema, enabled: id !== null && enabled, retry: false });
}

export function usePublishCard() {
  return useApiAction({ path: (v: { id: string }) => `${REPORTCARDS_BASE}/report-cards/${v.id}/publish`, schema: reportcardsReportCardDtoSchema, invalidate: [CARDS_KEY] });
}

export function useWithdrawCard() {
  return useApiAction({ path: (v: { id: string }) => `${REPORTCARDS_BASE}/report-cards/${v.id}/withdraw`, schema: reportcardsReportCardDtoSchema, invalidate: [CARDS_KEY] });
}

export function usePublishMany() {
  return useApiAction({
    path: `${REPORTCARDS_BASE}/publish`,
    body: (v: { reportCardIds?: string[]; batchId?: string }) => v,
    schema: reportcardsPublishResultDtoSchema,
    invalidate: [CARDS_KEY],
  });
}

export function useReissueCard() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${REPORTCARDS_BASE}/report-cards/${v.id}/reissue`,
    body: (v) => ({ reason: v.reason }),
    schema: reportcardsReportCardDtoSchema,
    invalidate: [CARDS_KEY],
  });
}

export function useRevokeCard() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${REPORTCARDS_BASE}/report-cards/${v.id}/revoke`,
    body: (v) => ({ reason: v.reason }),
    schema: reportcardsReportCardDtoSchema,
    invalidate: [CARDS_KEY],
  });
}

export function useRenderCard() {
  return useApiAction({ path: (v: { id: string }) => `${REPORTCARDS_BASE}/report-cards/${v.id}/render`, schema: reportcardsReportCardDtoSchema, invalidate: [CARDS_KEY] });
}

export function useCreateTranscript() {
  return useApiAction({
    path: `${REPORTCARDS_BASE}/transcripts`,
    body: (v: { studentId: string; academicYearIds?: string[] }) => v,
    schema: reportcardsReportCardDtoSchema,
    invalidate: [CARDS_KEY],
  });
}

/**
 * Téléchargement CONTRÔLÉ : l'API vérifie le droit (gestion, élève ou tuteur lié) puis renvoie une URL signée de courte durée
 * (5 minutes) ; l'accès des familles est journalisé. On ne conserve jamais cette URL.
 */
export async function requestDownload(path: string) {
  return hooks.client.get(path, { schema: reportcardsDownloadDtoSchema });
}

export const cardDownloadPath = (id: string) => `${REPORTCARDS_BASE}/report-cards/${id}/pdf`;
export const combinedDownloadPath = (classroomId: string, periodId: string) => `${REPORTCARDS_BASE}/classrooms/${classroomId}/periods/${periodId}/pdf`;

// ---------------------------------------------------------------------------
// Lecture famille
// ---------------------------------------------------------------------------

export function useFamilyReportCards(enabled = true) {
  return hooks.useApiInfiniteQuery(["reportcards", "family"], `${REPORTCARDS_BASE}/me/report-cards`, {
    schema: reportcardsReportCardPageDtoSchema,
    query: { limit: 50 },
    getNextCursor: (page) => page.nextCursor,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Identité, signataires, gabarits, réglages
// ---------------------------------------------------------------------------

export function useBranding(institutionId?: string, enabled = true) {
  return hooks.useApiQuery(["reportcards", "branding", institutionId ?? null], `${REPORTCARDS_BASE}/branding`, {
    schema: itemsOf(reportcardsBrandingDtoSchema),
    select: pickItems,
    query: institutionId ? { institutionId } : undefined,
    enabled,
    retry: false,
  });
}

export function usePutBranding() {
  return useApiAction({ method: "PUT", path: `${REPORTCARDS_BASE}/branding`, body: (v: Record<string, unknown>) => v, schema: reportcardsBrandingDtoSchema, invalidate: [["reportcards", "branding"]] });
}

const uploadSchema = z.object({ objectKey: z.string(), uploadUrl: z.string(), method: z.literal("PUT"), headers: z.record(z.string()), expiresAt: z.string(), maxBytes: z.number() });
export type AssetUpload = z.infer<typeof uploadSchema>;

export function useAssetUpload() {
  return useApiAction({
    path: `${REPORTCARDS_BASE}/branding/assets`,
    body: (v: { kind: "logo" | "emblem" | "signature"; contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }) => v,
    schema: uploadSchema,
  });
}

export const ASSET_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/**
 * Dépôt d'une image (logo, emblème, signature) : l'API fournit une URL signée à usage unique, le navigateur y téléverse
 * directement le fichier. Le CONTENU est contrôlé par ses octets côté serveur à l'enregistrement (jamais de SVG).
 */
export async function putAsset(upload: AssetUpload, file: Blob, fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file });
  } catch (cause) {
    throw new ApiError({ code: ClientErrorCode.NETWORK, message: "Téléversement impossible : connexion au stockage refusée.", cause });
  }
  if (!response.ok) throw new ApiError({ code: "HTTP_ERROR", message: "Le stockage a refusé le fichier.", status: response.status });
}

export function useSignatories(enabled = true) {
  return hooks.useApiQuery(["reportcards", "signatories"], `${REPORTCARDS_BASE}/signatories`, { schema: itemsOf(reportcardsSignatoryDtoSchema), select: pickItems, enabled, retry: false });
}

export function useCreateSignatory() {
  return useApiAction({ path: `${REPORTCARDS_BASE}/signatories`, body: (v: Record<string, unknown>) => v, schema: reportcardsSignatoryDtoSchema, invalidate: [["reportcards", "signatories"]] });
}

export function useUpdateSignatory() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${REPORTCARDS_BASE}/signatories/${v.id}`,
    body: (v) => v.patch,
    schema: reportcardsSignatoryDtoSchema,
    invalidate: [["reportcards", "signatories"]],
  });
}

export function useTemplates(enabled = true) {
  return hooks.useApiQuery(["reportcards", "templates"], `${REPORTCARDS_BASE}/templates`, { schema: itemsOf(reportcardsTemplateDtoSchema), select: pickItems, enabled, staleTime: 60_000, retry: false });
}

export function useTemplateConfigs(query: { documentKind?: string; history?: boolean } = {}, enabled = true) {
  return hooks.useApiQuery(["reportcards", "template-configs", query], `${REPORTCARDS_BASE}/template-configs`, {
    schema: itemsOf(reportcardsTemplateConfigDtoSchema),
    select: pickItems,
    query: clean({ documentKind: query.documentKind, history: query.history ? "true" : undefined }),
    enabled,
    retry: false,
  });
}

export function usePutTemplateConfig() {
  return useApiAction({ method: "PUT", path: `${REPORTCARDS_BASE}/template-configs`, body: (v: Record<string, unknown>) => v, schema: reportcardsTemplateConfigDtoSchema, invalidate: [["reportcards", "template-configs"]] });
}

export function usePreviewTemplate() {
  return useApiAction({ path: `${REPORTCARDS_BASE}/template-configs/preview`, body: (v: Record<string, unknown>) => v, schema: reportcardsPreviewDtoSchema });
}

export function useReportcardsSettings(enabled = true) {
  return hooks.useApiQuery(["reportcards", "settings"], `${REPORTCARDS_BASE}/settings`, { schema: reportcardsSettingsDtoSchema, enabled, retry: false });
}

export function useUpdateReportcardsSettings() {
  return useApiAction({
    method: "PUT",
    path: `${REPORTCARDS_BASE}/settings`,
    body: (v: { blockIfUnpaid?: boolean; requireDeliberation?: boolean; verificationShowsMention?: boolean }) => v,
    schema: reportcardsSettingsDtoSchema,
    invalidate: [["reportcards", "settings"]],
  });
}

// ---------------------------------------------------------------------------
// Vérification publique (sans authentification ni établissement)
// ---------------------------------------------------------------------------

/**
 * Vérifie un code. Un code inexistant, mal formé ou trop long reçoit EXACTEMENT la même réponse (404) : l'écran ne
 * distingue pas ces cas. Appel anonyme : aucun jeton, aucun en-tête d'établissement.
 */
export function useVerifyCode(code: string | null) {
  return useQuery<z.infer<typeof reportcardsPublicVerificationDtoSchema>, ApiError>({
    queryKey: ["reportcards", "verify", code],
    queryFn: ({ signal }) => hooks.client.get(`${PUBLIC_VERIFY_BASE}/${encodeURIComponent(code ?? "")}`, { anonymous: true, schema: reportcardsPublicVerificationDtoSchema, signal }),
    enabled: code !== null && code !== "",
    retry: false,
    staleTime: 0,
  });
}

/**
 * Comparaison d'un PDF téléversé à l'empreinte enregistrée. Le corps est le fichier BRUT (`Content-Type: application/pdf`),
 * ce que le client JSON ne sait pas envoyer : appel `fetch` direct, réponse validée par le même schéma Zod.
 */
export async function verifyFile(file: Blob, fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)): Promise<z.infer<typeof reportcardsFileVerificationDtoSchema>> {
  let response: Response;
  try {
    response = await fetchImpl(`${hooks.client.baseUrl}${PUBLIC_VERIFY_BASE}/upload`, { method: "POST", headers: { "Content-Type": "application/pdf", Accept: "application/json" }, body: file });
  } catch (cause) {
    throw new ApiError({ code: ClientErrorCode.NETWORK, message: "Connexion au serveur impossible.", cause });
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as { code?: unknown; message?: unknown }) : {};
    throw new ApiError({ code: typeof record.code === "string" ? record.code : "HTTP_ERROR", message: typeof record.message === "string" ? record.message : "Vérification impossible.", status: response.status });
  }
  const parsed = reportcardsFileVerificationDtoSchema.safeParse(body);
  if (!parsed.success) throw new ApiError({ code: ClientErrorCode.RESPONSE_INVALID, message: "Réponse de l'API invalide.", status: response.status });
  return parsed.data;
}
