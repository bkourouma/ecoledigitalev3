"use client";

/**
 * Hooks typés du module `stateassign` (`/api/v1/stateassign/*`) : élèves affectés par l'État. Schémas Zod de
 * `packages/contracts/src/v2/stateassign.ts`.
 *
 * AUCUNE logique métier côté client : statuts, écarts, retards, ancienneté, reste à recevoir, totaux sont CALCULÉS par l'API (et la
 * base) ; l'écran les affiche. Les actes humains (vérifier, rejeter, activer, suspendre, terminer, amender, planifier ou annuler une
 * échéance, réaliser un contrôle) sont des mutations que l'API peut refuser (403 `stateassign.human_actor_required`,
 * `stateassign.four_eyes_required`…). `usePermission` / `useFeature` servent seulement à AFFICHER ou masquer.
 *
 * Montants : `{ amount, currency }` en unités mineures (entiers), jamais un flottant ; l'écran les formate avec `useMoney`.
 */

import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  amendAssignmentResponseSchema,
  assignmentDetailDtoSchema,
  assignmentDocumentDtoSchema,
  assignmentDtoSchema,
  assignmentListResponseSchema,
  childAssignmentDtoSchema,
  controlDtoSchema,
  controlsDueResponseSchema,
  exportCatalogResponseSchema,
  exportFormatDtoSchema,
  exportMetaSchema,
  receivableDtoSchema,
  receivableEventDtoSchema,
  receivableListResponseSchema,
  receivablesAgingResponseSchema,
  reconcileAssignmentResultSchema,
  reconciliationReportResponseSchema,
  stateGatewayStatusSchema,
  stateassignSettingsDtoSchema,
  stateassignSummaryResponseSchema,
  type AmendAssignmentBody,
  type AssignmentListQuery,
  type CreateExportFormatBody,
  type ExportDataset,
  type ExportMeta,
  type RecordAssignmentBody,
  type ScheduleReceivableBody,
  type StateassignUpdateSettingsBody,
} from "@ecoledigitale/contracts/v2/stateassign";
import { z } from "zod";
import { useApiAction } from "./actions";

export const STATEASSIGN_BASE = "/api/v1/stateassign";
const KEY = ["stateassign"] as const;

type Query = Record<string, string | number | boolean | undefined>;

const itemsOf = <S extends z.ZodTypeAny>(schema: S) => z.object({ items: z.array(schema) });

/** Liste des clés à invalider après une écriture sur un dossier : liste, détail, créances, états, tableau de bord. */
const ALL = [[...KEY, "assignments"], [...KEY, "assignment"], [...KEY, "receivables"], [...KEY, "reports"], [...KEY, "controls"]] as const;

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export function useStateassignSettings(institutionId: string | null) {
  return hooks.useApiQuery([...KEY, "settings", institutionId], `${STATEASSIGN_BASE}/settings`, {
    query: { institutionId: institutionId ?? undefined },
    schema: stateassignSettingsDtoSchema,
    enabled: institutionId !== null,
    retry: false,
  });
}

export function useUpdateStateassignSettings(institutionId: string) {
  return useApiAction({
    method: "PUT",
    path: `${STATEASSIGN_BASE}/settings?institutionId=${encodeURIComponent(institutionId)}`,
    body: (v: StateassignUpdateSettingsBody) => v,
    schema: stateassignSettingsDtoSchema,
    invalidate: [[...KEY, "settings"], ...ALL],
  });
}

// ---------------------------------------------------------------------------
// Dossiers
// ---------------------------------------------------------------------------

export type AssignmentsQuery = Partial<Omit<AssignmentListQuery, "page" | "pageSize" | "includeHistory">> & { page?: number; pageSize?: number; includeHistory?: boolean };

export function useAssignments(query: AssignmentsQuery = {}, enabled = true) {
  const { includeHistory, ...rest } = query;
  return hooks.useApiQuery([...KEY, "assignments"], `${STATEASSIGN_BASE}/assignments`, {
    query: { ...rest, includeHistory: includeHistory ? "true" : undefined } as Query,
    schema: assignmentListResponseSchema,
    enabled,
    retry: false,
    keepPreviousData: true,
  });
}

export function useAssignment(id: string | null) {
  return hooks.useApiQuery([...KEY, "assignment", id], `${STATEASSIGN_BASE}/assignments/${id}`, { schema: assignmentDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useRecordAssignment() {
  return useApiAction({ path: `${STATEASSIGN_BASE}/assignments`, body: (v: RecordAssignmentBody) => v, schema: assignmentDtoSchema, invalidate: ALL });
}

export function useUpdateAssignment(id: string) {
  return useApiAction({
    method: "PATCH",
    path: `${STATEASSIGN_BASE}/assignments/${id}`,
    body: (v: { notes?: string | null; reference?: string; issuedOn?: string | null; issuingAuthority?: string | null; declaredStateAmount?: number | null; declaredParentAmount?: number | null; rowVersion: number }) => v,
    schema: assignmentDtoSchema,
    invalidate: ALL,
  });
}

export type AssignmentActName = "verify" | "reject" | "activate" | "suspend" | "resume" | "end" | "transfer-out";

/** Acte HUMAIN du cycle de vie. `reason` : rejeter, suspendre, terminer, transférer. `endedOn` : terminer, transférer. */
export function useAssignmentAct(act: AssignmentActName) {
  return useApiAction({
    path: (v: { id: string; rowVersion: number; reason?: string; note?: string; endedOn?: string }) => `${STATEASSIGN_BASE}/assignments/${v.id}/${act}`,
    body: (v) => ({ rowVersion: v.rowVersion, ...(v.reason !== undefined ? { reason: v.reason } : {}), ...(v.note !== undefined ? { note: v.note } : {}), ...(v.endedOn !== undefined ? { endedOn: v.endedOn } : {}) }),
    schema: assignmentDtoSchema,
    invalidate: ALL,
  });
}

export function useAmendAssignment() {
  return useApiAction({
    path: (v: { id: string; body: AmendAssignmentBody }) => `${STATEASSIGN_BASE}/assignments/${v.id}/amend`,
    body: (v) => v.body,
    schema: amendAssignmentResponseSchema,
    invalidate: ALL,
  });
}

export function useReconcileAssignment() {
  return useApiAction({ path: (id: string) => `${STATEASSIGN_BASE}/assignments/${id}/reconcile`, schema: reconcileAssignmentResultSchema, invalidate: ALL });
}

// ---------------------------------------------------------------------------
// Contrôles et pièces
// ---------------------------------------------------------------------------

export function usePlanControl() {
  return useApiAction({
    path: (v: { assignmentId: string; kind: string; academicPeriodId?: string | null; dueOn: string }) => `${STATEASSIGN_BASE}/assignments/${v.assignmentId}/controls`,
    body: (v) => ({ kind: v.kind, dueOn: v.dueOn, ...(v.academicPeriodId ? { academicPeriodId: v.academicPeriodId } : {}) }),
    schema: controlDtoSchema,
    invalidate: ALL,
  });
}

export function useCompleteControl() {
  return useApiAction({
    path: (v: { id: string; outcome: "OK" | "ANOMALY"; findings?: string | null }) => `${STATEASSIGN_BASE}/controls/${v.id}/complete`,
    body: (v) => ({ outcome: v.outcome, ...(v.findings ? { findings: v.findings } : {}) }),
    schema: controlDtoSchema,
    invalidate: ALL,
  });
}

export function useWaiveControl() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${STATEASSIGN_BASE}/controls/${v.id}/waive`, body: (v) => ({ reason: v.reason }), schema: controlDtoSchema, invalidate: ALL });
}

export function useResolveControl() {
  return useApiAction({ path: (v: { id: string; resolution: string }) => `${STATEASSIGN_BASE}/controls/${v.id}/resolve`, body: (v) => ({ resolution: v.resolution }), schema: controlDtoSchema, invalidate: ALL });
}

export function useAddAssignmentDocument() {
  return useApiAction({
    path: (v: { assignmentId: string; kind: string; documentRef: string; label?: string | null; receivedOn?: string | null }) => `${STATEASSIGN_BASE}/assignments/${v.assignmentId}/documents`,
    body: (v) => ({ kind: v.kind, documentRef: v.documentRef, ...(v.label ? { label: v.label } : {}), ...(v.receivedOn ? { receivedOn: v.receivedOn } : {}) }),
    schema: assignmentDocumentDtoSchema,
    invalidate: ALL,
  });
}

export function useWithdrawAssignmentDocument() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${STATEASSIGN_BASE}/documents/${v.id}/withdraw`, body: (v) => ({ reason: v.reason }), schema: assignmentDocumentDtoSchema, invalidate: ALL });
}

export function useControlsDue(query: { institutionId?: string; academicYearId?: string; status?: string; kind?: string; overdueOnly?: boolean; page?: number; pageSize?: number } = {}) {
  return hooks.useApiQuery([...KEY, "controls"], `${STATEASSIGN_BASE}/reports/controls-due`, {
    query: { ...query, overdueOnly: query.overdueOnly ? "true" : undefined } as Query,
    schema: controlsDueResponseSchema,
    retry: false,
    keepPreviousData: true,
  });
}

// ---------------------------------------------------------------------------
// Créances sur l'État
// ---------------------------------------------------------------------------

export interface ReceivablesQuery {
  institutionId?: string;
  academicYearId?: string;
  studentId?: string;
  assignmentId?: string;
  status?: string;
  overdueOnly?: boolean;
  dueFrom?: string;
  dueTo?: string;
  page?: number;
  pageSize?: number;
}

export function useReceivables(query: ReceivablesQuery = {}) {
  return hooks.useApiQuery([...KEY, "receivables", "list"], `${STATEASSIGN_BASE}/receivables`, {
    query: { ...query, overdueOnly: query.overdueOnly ? "true" : undefined } as Query,
    schema: receivableListResponseSchema,
    retry: false,
    keepPreviousData: true,
  });
}

export function useReceivablesAging(query: { institutionId?: string; academicYearId?: string } = {}) {
  return hooks.useApiQuery([...KEY, "receivables", "aging"], `${STATEASSIGN_BASE}/receivables/aging`, { query: query as Query, schema: receivablesAgingResponseSchema, retry: false });
}

export function useReceivableHistory(id: string | null) {
  return hooks.useApiQuery([...KEY, "receivables", "history", id], `${STATEASSIGN_BASE}/receivables/${id}/history`, { schema: itemsOf(receivableEventDtoSchema), select: (d) => d.items, enabled: id !== null, retry: false });
}

export function useScheduleReceivable() {
  return useApiAction({
    path: (v: { assignmentId: string; body: ScheduleReceivableBody }) => `${STATEASSIGN_BASE}/assignments/${v.assignmentId}/receivables`,
    body: (v) => v.body,
    schema: receivableDtoSchema,
    invalidate: ALL,
  });
}

export function useUpdateReceivable() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; label?: string; dueOn?: string; expectedAmount?: number; rowVersion: number }) => `${STATEASSIGN_BASE}/receivables/${v.id}`,
    body: ({ id: _id, ...rest }) => rest,
    schema: receivableDtoSchema,
    invalidate: ALL,
  });
}

export function useCancelReceivable() {
  return useApiAction({
    path: (v: { id: string; reason: string; rowVersion: number }) => `${STATEASSIGN_BASE}/receivables/${v.id}/cancel`,
    body: (v) => ({ reason: v.reason, rowVersion: v.rowVersion }),
    schema: receivableDtoSchema,
    invalidate: ALL,
  });
}

// ---------------------------------------------------------------------------
// États
// ---------------------------------------------------------------------------

export function useStateassignSummary(query: { institutionId?: string; academicYearId?: string } = {}) {
  return hooks.useApiQuery([...KEY, "reports", "summary"], `${STATEASSIGN_BASE}/reports/summary`, { query: query as Query, schema: stateassignSummaryResponseSchema, retry: false });
}

export function useReconciliationReport(query: { institutionId?: string; academicYearId?: string; reconciliationStatus?: string; page?: number; pageSize?: number } = {}) {
  return hooks.useApiQuery([...KEY, "reports", "reconciliation"], `${STATEASSIGN_BASE}/reports/reconciliation`, { query: query as Query, schema: reconciliationReportResponseSchema, retry: false, keepPreviousData: true });
}

// ---------------------------------------------------------------------------
// Exports : formats en données
// ---------------------------------------------------------------------------

export function useExportCatalog(enabled = true) {
  return hooks.useApiQuery([...KEY, "exports", "catalog"], `${STATEASSIGN_BASE}/exports/catalog`, { schema: exportCatalogResponseSchema, enabled, staleTime: 5 * 60_000, retry: false });
}

export function useExportFormats(query: { institutionId?: string; dataset?: ExportDataset } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "exports", "formats"], `${STATEASSIGN_BASE}/export-formats`, { query: query as Query, schema: itemsOf(exportFormatDtoSchema), select: (d) => d.items, enabled, retry: false });
}

export function useCreateExportFormat() {
  return useApiAction({ path: `${STATEASSIGN_BASE}/export-formats`, body: (v: CreateExportFormatBody) => v, schema: exportFormatDtoSchema, invalidate: [[...KEY, "exports", "formats"]] });
}

export function useUpdateExportFormat() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; label?: string; active?: boolean; delimiter?: ";" | "," | "\t"; includeBom?: boolean; columns?: Array<{ key: string; header: string }> }) => `${STATEASSIGN_BASE}/export-formats/${v.id}`,
    body: ({ id: _id, ...rest }) => rest,
    schema: exportFormatDtoSchema,
    invalidate: [[...KEY, "exports", "formats"]],
  });
}

export interface ExportRequest {
  dataset: ExportDataset;
  formatId?: string;
  institutionId?: string;
  academicYearId?: string;
  status?: string;
}

/** Lit le CSV du serveur (texte) et son méta (lignes, troncature signalée) : le fichier est ce que l'API a produit, tel quel. */
export async function fetchStateassignExport(request: ExportRequest): Promise<{ filename: string; csv: string; meta: ExportMeta }> {
  const path = `${STATEASSIGN_BASE}/exports/${request.dataset.toLowerCase()}`;
  const query = { formatId: request.formatId, institutionId: request.institutionId, academicYearId: request.academicYearId, status: request.status } as Query;
  const meta = await platformApi.get(`${path}/meta`, { query, schema: exportMetaSchema });
  const csv = await platformApi.get<string>(path, { query, responseType: "text" });
  return { filename: `stateassign-${request.dataset.toLowerCase()}.csv`, csv, meta };
}

// ---------------------------------------------------------------------------
// Passerelle (future) et famille
// ---------------------------------------------------------------------------

export function useGatewayStatus(enabled = true) {
  return hooks.useApiQuery([...KEY, "gateway"], `${STATEASSIGN_BASE}/gateway/status`, { schema: stateGatewayStatusSchema, enabled, staleTime: 5 * 60_000, retry: false });
}

/** Vue FAMILLE : statut du dossier de l'enfant, jamais les montants de l'État. */
export function useChildAssignment(studentId: string | null) {
  return hooks.useApiQuery([...KEY, "child", studentId], `${STATEASSIGN_BASE}/children/${studentId}/assignment`, { schema: childAssignmentDtoSchema, enabled: studentId !== null, retry: false });
}
