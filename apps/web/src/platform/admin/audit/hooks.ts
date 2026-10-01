"use client";

import { useCallback, useState } from "react";
import {
  auditChainVerificationSchema,
  auditLogEntrySchema,
  auditLogListResponseSchema,
  type AuditChainVerificationDto,
  type AuditLogEntryDto,
  type AuditLogListResponseDto,
} from "@ecoledigitale/contracts/v2/audit";
import type { QueryParams } from "@/platform/api/client";
import { ApiError } from "@/platform/api/errors";
import { platformApi, platformHooks } from "@/platform/api/default-client";
import { AUDIT_EXPORT_MAX_ROWS, toExportQuery, toListQuery, type AuditFilterState } from "./filters";

export const AUDIT = "/api/v1/audit";
const PAGE_SIZE = 50;

/** Liste paginée par curseur ; `fetchNextPage()` accumule les pages dans `data.pages`. */
export function useAuditLogs(filters: AuditFilterState) {
  return platformHooks.useApiInfiniteQuery<AuditLogListResponseDto>(["audit", "logs"], `${AUDIT}/logs`, {
    query: { ...toListQuery(filters), limit: PAGE_SIZE },
    schema: auditLogListResponseSchema,
    getNextCursor: (page) => page.nextCursor,
    retry: false,
  });
}

export function useAuditEntry(id: string) {
  return platformHooks.useApiQuery<AuditLogEntryDto>(["audit", "entry", id], `${AUDIT}/logs/${id}`, {
    schema: auditLogEntrySchema,
    retry: false,
  });
}

export interface VerifyRange {
  from?: string;
  to?: string;
}

/**
 * Vérification d'intégrité de la chaîne. Exécutée à la demande (`run`) : l'appel relit toute la plage, il n'est jamais
 * lancé à l'affichage de la page.
 */
export function useAuditVerify() {
  const [range, setRange] = useState<VerifyRange | null>(null);
  const query: QueryParams = { ...(range?.from ? { from: range.from } : {}), ...(range?.to ? { to: range.to } : {}) };
  const result = platformHooks.useApiQuery<AuditChainVerificationDto>(["audit", "verify"], `${AUDIT}/verify`, {
    query,
    schema: auditChainVerificationSchema,
    enabled: range !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const run = useCallback((next: VerifyRange) => setRange({ ...next }), []);
  return { run, reset: () => setRange(null), started: range !== null, ...result };
}

export interface ExportResult {
  csv: string;
  rows: number | null;
  truncated: boolean;
  filename: string;
}

/** Télécharge le CSV via le client typé (corps texte) et déclenche l'enregistrement du fichier. */
export function useAuditExport() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [last, setLast] = useState<Omit<ExportResult, "csv"> | null>(null);

  const run = useCallback(async (filters: AuditFilterState): Promise<ExportResult | null> => {
    setPending(true);
    setError(null);
    try {
      const csv = await platformApi.get<string>(`${AUDIT}/logs/export`, {
        query: toExportQuery(filters),
        responseType: "text",
        headers: { Accept: "text/csv" },
        timeoutMs: 120_000,
      });
      const text = typeof csv === "string" ? csv : "";
      const day = new Date().toISOString().slice(0, 10);
      const rows = countCsvRows(text);
      // Le client ne donne pas accès aux en-têtes (`X-Audit-Export-Truncated`) : plafond atteint = peut-être tronqué.
      const result: ExportResult = { csv: text, rows, truncated: rows >= AUDIT_EXPORT_MAX_ROWS, filename: `audit-${day}.csv` };
      saveTextFile(result.filename, text, "text/csv;charset=utf-8");
      setLast({ rows: result.rows, truncated: result.truncated, filename: result.filename });
      return result;
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, last };
}

/** Nombre de lignes de données (hors en-tête) d'un CSV simple. */
export function countCsvRows(csv: string): number {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(lines.length - 1, 0);
}

function saveTextFile(filename: string, content: string, type: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const blob = new Blob(["﻿", content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
