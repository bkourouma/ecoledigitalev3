"use client";

/**
 * Hooks typés du module `documents` (`/api/v1/documents/*`). Schémas Zod de `packages/contracts/src/v2/documents.ts`.
 * AUCUNE règle d'autorisation côté client : qui voit quel document, qui dépose où, qui partage sont décidés par l'API ; l'écran
 * affiche ce qui revient (`/me/context`, `access` de chaque document, `canUpload` des catégories). `usePermission` / `useFeature`
 * servent seulement à AFFICHER ou masquer.
 *
 * Dépôt : `multipart/form-data` (FormData : le navigateur fixe le Content-Type et la frontière). Téléchargement : l'API renvoie
 * une URL signée COURTE ; le navigateur la suit aussitôt. Prévisualisation : l'API sert les octets (en-têtes restrictifs), lus
 * en `blob` puis affichés par l'écran (jamais d'HTML ni de SVG servis par l'application).
 */

import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  documentArchiveResultDtoSchema,
  documentCategoryDtoSchema,
  documentCategoryGrantDtoSchema,
  documentCategoryGrantListDtoSchema,
  documentCategoryListDtoSchema,
  documentDetailDtoSchema,
  documentGuardianListDtoSchema,
  documentHistoryPageDtoSchema,
  documentMyContextDtoSchema,
  documentPageDtoSchema,
  documentPersonListDtoSchema,
  documentQuarantinePageDtoSchema,
  documentSettingsDtoSchema,
  documentShareDtoSchema,
  documentShareListDtoSchema,
  documentSignedUrlDtoSchema,
  documentSummaryCountsDtoSchema,
  documentUsageDtoSchema,
  type DocumentArchiveBody,
  type DocumentCreateCategoryBody,
  type DocumentGrantBody,
  type DocumentKind,
  type DocumentListQuery,
  type DocumentQuarantineDecisionBody,
  type DocumentShareBody,
  type DocumentUpdateBody,
  type DocumentUpdateCategoryBody,
  type DocumentUpdateSettingsBody,
} from "@ecoledigitale/contracts/v2/documents";
import { useApiAction } from "./actions";

export const DOCUMENTS_BASE = "/api/v1/documents";
const KEY = ["documents"] as const;

type Query = Record<string, string | number | boolean | undefined>;

// ---------------------------------------------------------------------------
// Moi, paramètres, usage
// ---------------------------------------------------------------------------

export function useMyDocumentsContext(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "context"], `${DOCUMENTS_BASE}/me/context`, { schema: documentMyContextDtoSchema, enabled, staleTime: 60_000, retry: false });
}

export function useDocumentSettings(enabled = true) {
  return hooks.useApiQuery([...KEY, "settings"], `${DOCUMENTS_BASE}/settings`, { schema: documentSettingsDtoSchema, enabled, retry: false });
}

export function useUpdateDocumentSettings() {
  return useApiAction({
    method: "PUT",
    path: `${DOCUMENTS_BASE}/settings`,
    body: (v: DocumentUpdateSettingsBody) => v,
    schema: documentSettingsDtoSchema,
    invalidate: [[...KEY, "settings"], [...KEY, "usage"], [...KEY, "me"]],
  });
}

export function useDocumentUsage(enabled = true) {
  return hooks.useApiQuery([...KEY, "usage"], `${DOCUMENTS_BASE}/usage`, { schema: documentUsageDtoSchema, enabled, retry: false });
}

export function useDocumentSummary(withinDays: number, enabled = true) {
  return hooks.useApiQuery([...KEY, "summary", withinDays], `${DOCUMENTS_BASE}/summary`, { query: { withinDays }, schema: documentSummaryCountsDtoSchema, enabled, retry: false });
}

// ---------------------------------------------------------------------------
// Catégories et droits de catégorie
// ---------------------------------------------------------------------------

export function useDocumentCategories(query: { kind?: DocumentKind | undefined; includeArchived?: boolean } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "categories"], `${DOCUMENTS_BASE}/categories`, {
    query: { kind: query.kind, includeArchived: query.includeArchived ? "true" : undefined } as Query,
    schema: documentCategoryListDtoSchema,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

const CATEGORY_KEYS = [[...KEY, "categories"], [...KEY, "summary"]] as const;

export function useCreateCategory() {
  return useApiAction({ path: `${DOCUMENTS_BASE}/categories`, body: (v: DocumentCreateCategoryBody) => v, schema: documentCategoryDtoSchema, invalidate: CATEGORY_KEYS });
}

export function useUpdateCategory(id: string) {
  return useApiAction({ method: "PATCH", path: `${DOCUMENTS_BASE}/categories/${id}`, body: (v: DocumentUpdateCategoryBody) => v, schema: documentCategoryDtoSchema, invalidate: CATEGORY_KEYS });
}

export function useSetCategoryArchived() {
  return useApiAction({
    path: (v: { id: string; archived: boolean }) => `${DOCUMENTS_BASE}/categories/${v.id}/${v.archived ? "archive" : "restore"}`,
    schema: documentCategoryDtoSchema,
    invalidate: CATEGORY_KEYS,
  });
}

export function useCategoryGrants(categoryId: string | null) {
  return hooks.useApiQuery([...KEY, "categories", "grants", categoryId], `${DOCUMENTS_BASE}/categories/${categoryId}/grants`, { schema: documentCategoryGrantListDtoSchema, enabled: categoryId !== null, retry: false });
}

export function useGrantCategory(categoryId: string) {
  return useApiAction({ path: `${DOCUMENTS_BASE}/categories/${categoryId}/grants`, body: (v: DocumentGrantBody) => v, schema: documentCategoryGrantDtoSchema, invalidate: [[...KEY, "categories", "grants"]] });
}

export function useRevokeCategoryGrant(categoryId: string) {
  return useApiAction({ method: "DELETE", path: (grantId: string) => `${DOCUMENTS_BASE}/categories/${categoryId}/grants/${grantId}`, invalidate: [[...KEY, "categories", "grants"]] });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type DocumentFilters = Pick<DocumentListQuery, "q" | "categoryId" | "kind" | "ownerType" | "ownerId" | "status" | "expiry" | "withinDays" | "scope" | "sort" | "dir">;

export function useDocumentsInfinite(filters: DocumentFilters, enabled = true) {
  const query: Query = { ...filters, limit: 30 };
  return hooks.useApiInfiniteQuery([...KEY, "list"], `${DOCUMENTS_BASE}/documents`, {
    query,
    schema: documentPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

export function useDocument(id: string | null) {
  return hooks.useApiQuery([...KEY, "one", id], `${DOCUMENTS_BASE}/documents/${id}`, { schema: documentDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useDocumentHistory(id: string | null, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "history", id], `${DOCUMENTS_BASE}/documents/${id}/history`, {
    query: { limit: 30 },
    schema: documentHistoryPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled: enabled && id !== null,
    retry: false,
  });
}

const DOCUMENT_KEYS = [[...KEY, "list"], [...KEY, "one"], [...KEY, "history"], [...KEY, "summary"], [...KEY, "usage"]] as const;

/** Champs de dépôt : les listes et objets partent en TEXTE (JSON), comme l'attend l'API multipart. */
export interface UploadFields {
  categoryId: string;
  title: string;
  description?: string;
  ownerType: "STUDENT" | "STAFF" | "NONE";
  ownerId?: string | null;
  visibility?: "INHERIT" | "STAFF_ONLY" | "PRIVATE";
  tags?: readonly string[];
  expiresOn?: string | null;
  alertDays?: readonly number[] | null;
  note?: string;
}

export function buildUploadForm(fields: UploadFields, file: File): FormData {
  const form = new FormData();
  form.append("categoryId", fields.categoryId);
  form.append("title", fields.title);
  if (fields.description?.trim()) form.append("description", fields.description.trim());
  form.append("ownerType", fields.ownerType);
  if (fields.ownerType !== "NONE" && fields.ownerId) form.append("ownerId", fields.ownerId);
  if (fields.visibility) form.append("visibility", fields.visibility);
  if (fields.tags && fields.tags.length > 0) form.append("tags", JSON.stringify(fields.tags));
  if (fields.expiresOn) form.append("expiresOn", fields.expiresOn);
  if (fields.alertDays && fields.alertDays.length > 0) form.append("alertDays", JSON.stringify(fields.alertDays));
  if (fields.note?.trim()) form.append("note", fields.note.trim());
  form.append("file", file, file.name);
  return form;
}

export function useUploadDocument() {
  return useApiAction({
    path: `${DOCUMENTS_BASE}/documents`,
    body: (v: { fields: UploadFields; file: File }) => buildUploadForm(v.fields, v.file),
    schema: documentDetailDtoSchema,
    invalidate: DOCUMENT_KEYS,
  });
}

export function useAddVersion(documentId: string) {
  return useApiAction({
    path: `${DOCUMENTS_BASE}/documents/${documentId}/versions`,
    body: (v: { file: File; note?: string; expiresOn?: string; baseVersion?: number }) => {
      const form = new FormData();
      if (v.note?.trim()) form.append("note", v.note.trim());
      if (v.expiresOn) form.append("expiresOn", v.expiresOn);
      if (v.baseVersion !== undefined) form.append("baseVersion", String(v.baseVersion));
      form.append("file", v.file, v.file.name);
      return form;
    },
    schema: documentDetailDtoSchema,
    invalidate: DOCUMENT_KEYS,
  });
}

export function useUpdateDocument(documentId: string) {
  return useApiAction({ method: "PATCH", path: `${DOCUMENTS_BASE}/documents/${documentId}`, body: (v: DocumentUpdateBody) => v, schema: documentDetailDtoSchema, invalidate: DOCUMENT_KEYS });
}

export function useArchiveDocument(documentId: string) {
  return useApiAction({ path: `${DOCUMENTS_BASE}/documents/${documentId}/archive`, body: (v: DocumentArchiveBody) => v, schema: documentArchiveResultDtoSchema, invalidate: DOCUMENT_KEYS });
}

export function useRestoreDocument(documentId: string) {
  return useApiAction({ path: `${DOCUMENTS_BASE}/documents/${documentId}/restore`, schema: documentDetailDtoSchema, invalidate: DOCUMENT_KEYS });
}

// ---------------------------------------------------------------------------
// Partages
// ---------------------------------------------------------------------------

export function useDocumentShares(documentId: string, enabled: boolean) {
  return hooks.useApiQuery([...KEY, "one", documentId, "shares"], `${DOCUMENTS_BASE}/documents/${documentId}/shares`, { schema: documentShareListDtoSchema, enabled, retry: false });
}

export function useShareDocument(documentId: string) {
  return useApiAction({ path: `${DOCUMENTS_BASE}/documents/${documentId}/shares`, body: (v: DocumentShareBody) => v, schema: documentShareDtoSchema, invalidate: DOCUMENT_KEYS });
}

export function useUnshareDocument(documentId: string) {
  return useApiAction({ method: "DELETE", path: (shareId: string) => `${DOCUMENTS_BASE}/documents/${documentId}/shares/${shareId}`, invalidate: DOCUMENT_KEYS });
}

// ---------------------------------------------------------------------------
// Personnes (sélecteurs)
// ---------------------------------------------------------------------------

export function usePeopleOptions(kind: "USER" | "STUDENT" | "STAFF", search: string, enabled: boolean) {
  const q = hooks.useApiQuery([...KEY, "people", kind, search], `${DOCUMENTS_BASE}/people`, {
    query: { q: search, kind, limit: 10 },
    schema: documentPersonListDtoSchema,
    enabled: enabled && search.trim().length >= 2,
    staleTime: 15_000,
    retry: false,
  });
  return { options: (q.data?.items ?? []).map((p) => ({ value: p.id, label: p.displayName, ...(p.detail ? { description: p.detail } : {}) })), isLoading: q.isFetching, error: q.error ?? undefined };
}

export function useGuardianUsers(studentId: string | null) {
  return hooks.useApiQuery([...KEY, "guardians", studentId], `${DOCUMENTS_BASE}/students/${studentId}/guardians`, { schema: documentGuardianListDtoSchema, enabled: studentId !== null, retry: false });
}

// ---------------------------------------------------------------------------
// Quarantaine
// ---------------------------------------------------------------------------

export function useQuarantine(status: "HELD" | "RELEASED" | "DELETED" | "ALL", enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "quarantine", status], `${DOCUMENTS_BASE}/quarantine`, {
    query: { ...(status === "ALL" ? {} : { status }), limit: 30 },
    schema: documentQuarantinePageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

const QUARANTINE_KEYS = [[...KEY, "quarantine"], [...KEY, "summary"], [...KEY, "usage"], [...KEY, "list"]] as const;

export function useReleaseQuarantine() {
  return useApiAction({
    path: (v: { id: string }) => `${DOCUMENTS_BASE}/quarantine/${v.id}/release`,
    body: (v: { id: string } & DocumentQuarantineDecisionBody) => ({ note: v.note }),
    schema: documentDetailDtoSchema,
    invalidate: QUARANTINE_KEYS,
  });
}

export function useDeleteQuarantine() {
  return useApiAction({
    method: "DELETE",
    path: (v: { id: string; note: string }) => `${DOCUMENTS_BASE}/quarantine/${v.id}`,
    body: (v: { id: string; note: string }) => ({ note: v.note }),
    invalidate: QUARANTINE_KEYS,
  });
}

// ---------------------------------------------------------------------------
// Téléchargement (URL signée courte) et prévisualisation (octets servis par l'API)
// ---------------------------------------------------------------------------

/** URL signée de téléchargement ; l'appelant la suit immédiatement (durée de vie d'une minute). */
export async function fetchDownloadUrl(documentId: string, versionNo?: number) {
  const path = versionNo === undefined ? `${DOCUMENTS_BASE}/documents/${documentId}/download-url` : `${DOCUMENTS_BASE}/documents/${documentId}/versions/${versionNo}/download-url`;
  return platformApi.request("GET", path, { schema: documentSignedUrlDtoSchema });
}

/** Octets de prévisualisation d'une version (image, PDF, texte) lus en blob : l'écran les affiche, jamais l'API en iframe. */
export async function fetchPreviewBlob(documentId: string, versionNo?: number): Promise<Blob> {
  const path = versionNo === undefined ? `${DOCUMENTS_BASE}/documents/${documentId}/preview` : `${DOCUMENTS_BASE}/documents/${documentId}/versions/${versionNo}/preview`;
  return platformApi.request<Blob>("GET", path, { responseType: "blob", headers: { Accept: "*/*" } });
}

