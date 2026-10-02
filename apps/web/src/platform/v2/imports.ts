"use client";

/**
 * Hooks typés du module `imports` (`/api/v1/imports/*`). Schémas Zod de `packages/contracts/src/v2/imports.ts`.
 * AUCUNE règle d'autorisation ni de validation métier côté client : quels importeurs sont utilisables, quelles lignes sont
 * valides, ce qui sera créé ou ignoré sont décidés par l'API (et, pour l'écriture, par les modules cibles). L'écran affiche
 * ce qui revient. Le fichier est envoyé BRUT (`Blob`) : le serveur contrôle son type réel sur les octets.
 */

import { z } from "zod";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  importJobDtoSchema,
  importJobPageSchema,
  importMappingTemplateDtoSchema,
  importPreviewSchema,
  importReportSchema,
  importRowPageSchema,
  importSettingsDtoSchema,
  importUploadResultSchema,
  importerDescriptorSchema,
  importChoiceSchema,
  type ImportCreateTemplateBody,
  type ImportJobDto,
  type ImportMappingBody,
  type ImportRunBody,
  type ImportUpdateSettingsBody,
  type ImporterKey,
} from "@ecoledigitale/contracts/v2/imports";
import { useApiAction } from "./actions";

export const IMPORTS_BASE = "/api/v1/imports";
const KEY = ["imports"] as const;

type Query = Record<string, string | number | boolean | undefined>;

/** Un import est « en mouvement » tant que le worker travaille : l'écran se relit alors toutes les 1,5 s (progression en direct). */
export const IMPORT_MOVING_STATUSES: readonly ImportJobDto["status"][] = ["VALIDATING", "QUEUED", "RUNNING"];
export const isMoving = (status: ImportJobDto["status"] | undefined): boolean => status !== undefined && IMPORT_MOVING_STATUSES.includes(status);

export function useImporters() {
  return hooks.useApiQuery([...KEY, "importers"], `${IMPORTS_BASE}/importers`, { schema: z.object({ items: z.array(importerDescriptorSchema) }), staleTime: 60_000, retry: false });
}

export function useOptionChoices(importer: ImporterKey | null, option: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "choices", importer, option], `${IMPORTS_BASE}/importers/${importer}/options/${option}/choices`, {
    schema: z.object({ items: z.array(importChoiceSchema) }),
    enabled: enabled && importer !== null && option !== null,
    staleTime: 30_000,
    retry: false,
  });
}

export interface ImportJobsQuery {
  importer?: ImporterKey;
  status?: ImportJobDto["status"];
  mine?: boolean;
  limit?: number;
  offset?: number;
}

export function useImportJobs(query: ImportJobsQuery) {
  return hooks.useApiQuery([...KEY, "jobs", "list", query], `${IMPORTS_BASE}/jobs`, {
    query: { importer: query.importer, status: query.status, mine: query.mine === undefined ? undefined : String(query.mine), limit: query.limit ?? 20, offset: query.offset ?? 0 } as Query,
    schema: importJobPageSchema,
    keepPreviousData: true,
    retry: false,
  });
}

/** Un import ; relu toutes les 1,5 s tant qu'un worker le traite (progression en direct). */
export function useImportJob(id: string | null) {
  return hooks.useApiQuery([...KEY, "jobs", "one", id], `${IMPORTS_BASE}/jobs/${id}`, {
    schema: importJobDtoSchema,
    enabled: id !== null,
    staleTime: 0,
    refetchInterval: (data) => (isMoving(data?.status) ? 1500 : false),
    retry: false,
  });
}

export function useImportPreview(id: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "jobs", "preview", id], `${IMPORTS_BASE}/jobs/${id}/preview`, { schema: importPreviewSchema, enabled: enabled && id !== null, staleTime: 0, retry: false });
}

export function useImportSummary(id: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "jobs", "summary", id], `${IMPORTS_BASE}/jobs/${id}/summary`, { schema: importReportSchema, enabled: enabled && id !== null, staleTime: 0, retry: false });
}

export interface ImportRowsQuery {
  validation?: "PENDING" | "VALID" | "INVALID";
  outcome?: "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
  action?: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
  onlyProblems?: boolean;
  column?: string;
  code?: string;
  limit?: number;
  offset?: number;
}

export function useImportRows(id: string | null, query: ImportRowsQuery, enabled = true) {
  return hooks.useApiQuery([...KEY, "jobs", "rows", id, query], `${IMPORTS_BASE}/jobs/${id}/rows`, {
    query: { ...query, onlyProblems: query.onlyProblems === undefined ? undefined : String(query.onlyProblems), limit: query.limit ?? 25, offset: query.offset ?? 0 } as Query,
    schema: importRowPageSchema,
    enabled: enabled && id !== null,
    keepPreviousData: true,
    staleTime: 0,
    retry: false,
  });
}

export function useMappingTemplates(importer: ImporterKey | null) {
  return hooks.useApiQuery([...KEY, "templates", importer], `${IMPORTS_BASE}/templates`, {
    query: { importer: importer ?? undefined },
    schema: z.object({ items: z.array(importMappingTemplateDtoSchema) }),
    retry: false,
  });
}

export function useImportSettings() {
  return hooks.useApiQuery([...KEY, "settings"], `${IMPORTS_BASE}/settings`, { schema: importSettingsDtoSchema, retry: false });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface UploadVars {
  importer: ImporterKey;
  file: File;
  sheet?: string;
}

/** Étape 1 : le fichier est envoyé en corps BRUT (jamais en JSON ni en multipart). */
export function useUploadImport() {
  return useApiAction<z.infer<typeof importUploadResultSchema>, UploadVars>({
    method: "POST",
    path: `${IMPORTS_BASE}/jobs`,
    query: (v) => ({ importer: v.importer, fileName: v.file.name, ...(v.sheet ? { sheet: v.sheet } : {}) }),
    body: (v) => v.file,
    // Corps brut : le type annoncé ne fait pas foi (le serveur contrôle le type réel sur les octets).
    headers: () => ({ "Content-Type": "application/octet-stream" }),
    schema: importUploadResultSchema,
    invalidate: [[...KEY, "jobs"]],
  });
}

export function useSetMapping(id: string) {
  return useApiAction<ImportJobDto, ImportMappingBody>({ method: "PUT", path: `${IMPORTS_BASE}/jobs/${id}/mapping`, body: (v) => v, schema: importJobDtoSchema, invalidate: [[...KEY, "jobs"]] });
}

export function useValidateImport(id: string) {
  return useApiAction<ImportJobDto, void>({ method: "POST", path: `${IMPORTS_BASE}/jobs/${id}/validate`, schema: importJobDtoSchema, invalidate: [[...KEY, "jobs"]] });
}

export function useRunImport(id: string) {
  return useApiAction<ImportJobDto, ImportRunBody>({ method: "POST", path: `${IMPORTS_BASE}/jobs/${id}/run`, body: (v) => v, schema: importJobDtoSchema, invalidate: [[...KEY, "jobs"]] });
}

export function useCancelImport(id: string) {
  return useApiAction<ImportJobDto, { reason?: string } | void>({ method: "POST", path: `${IMPORTS_BASE}/jobs/${id}/cancel`, body: (v) => v ?? {}, schema: importJobDtoSchema, invalidate: [[...KEY, "jobs"]] });
}

export function useDeleteImport() {
  return useApiAction<unknown, { id: string }>({ method: "DELETE", path: (v) => `${IMPORTS_BASE}/jobs/${v.id}`, invalidate: [[...KEY, "jobs"]] });
}

export function useCreateTemplate() {
  return useApiAction<z.infer<typeof importMappingTemplateDtoSchema>, ImportCreateTemplateBody>({ method: "POST", path: `${IMPORTS_BASE}/templates`, body: (v) => v, schema: importMappingTemplateDtoSchema, invalidate: [[...KEY, "templates"]] });
}

export function useDeleteTemplate() {
  return useApiAction<unknown, { id: string }>({ method: "DELETE", path: (v) => `${IMPORTS_BASE}/templates/${v.id}`, invalidate: [[...KEY, "templates"]] });
}

export function useUpdateImportSettings() {
  return useApiAction<z.infer<typeof importSettingsDtoSchema>, ImportUpdateSettingsBody>({ method: "PUT", path: `${IMPORTS_BASE}/settings`, body: (v) => v, schema: importSettingsDtoSchema, invalidate: [[...KEY, "settings"]] });
}

// ---------------------------------------------------------------------------
// Téléchargements (le jeton passe par l'en-tête : pas de lien direct)
// ---------------------------------------------------------------------------

/** Télécharge un fichier servi par l'API (rapport, modèle) et le fait enregistrer par le navigateur. */
export async function downloadImportFile(path: string, query: Query, fileName: string): Promise<void> {
  const blob = await platformApi.request<Blob>("GET", path, { query, responseType: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const reportPath = (id: string): string => `${IMPORTS_BASE}/jobs/${id}/report`;
export const templatePath = (importer: ImporterKey): string => `${IMPORTS_BASE}/importers/${importer}/template`;
