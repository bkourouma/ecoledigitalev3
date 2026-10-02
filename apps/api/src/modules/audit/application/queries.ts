/**
 * Cas d'usage de lecture : liste paginée par curseur, détail, export CSV borné.
 * Aucune écriture ici (l'export journalise sa propre exécution, voir `exportLogsCsv`).
 */
import { NotFoundError, ValidationError } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { getLogById, listLogs, listPlatformLogs, exportLogs, type LogFilter } from "../infrastructure/log-repository";
import type { StoredAuditEntry } from "../domain/types";
import type { AuditService } from "./audit-service";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const EXPORT_MAX_ROWS = 10_000;

export function encodeCursor(seq: number): string {
  return Buffer.from(JSON.stringify({ s: seq }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { s?: unknown };
    if (typeof parsed.s === "number" && Number.isSafeInteger(parsed.s) && parsed.s > 0) return parsed.s;
  } catch {
    /* tombe sur l'erreur ci-dessous */
  }
  throw ValidationError.field("cursor", "Curseur de pagination invalide.", "invalid_cursor");
}

export interface LogPage {
  items: StoredAuditEntry[];
  nextCursor: string | null;
}

export async function listAuditLogs(
  tx: Tx,
  tenantId: string,
  filter: LogFilter,
  options: { cursor?: string; limit?: number } = {},
): Promise<LogPage> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const before = options.cursor ? decodeCursor(options.cursor) : null;
  // On lit une ligne de plus pour savoir s'il y a une page suivante, sans COUNT.
  const rows = await listLogs(tx, tenantId, filter, before, limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.seq) : null };
}

/**
 * Journal de PLATEFORME (événements sans tenant : console des opérateurs, événements sans tenant exploitable).
 * Même pagination par curseur que `listAuditLogs`. À appeler dans `SystemDb.run` (table globale hors RLS) ; l'appelant
 * (console plateforme) authentifie l'opérateur — ce module ne décide pas qui peut lire.
 */
export async function listPlatformAuditLogs(tx: Tx, filter: LogFilter, options: { cursor?: string; limit?: number } = {}): Promise<LogPage> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const before = options.cursor ? decodeCursor(options.cursor) : null;
  const rows = await listPlatformLogs(tx, filter, before, limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.seq) : null };
}

export async function getAuditLog(tx: Tx, tenantId: string, id: string): Promise<StoredAuditEntry> {
  const row = await getLogById(tx, tenantId, id);
  if (!row) throw NotFoundError.of("Entrée du journal d'audit", id);
  return row;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
  "seq", "id", "occurred_at", "severity", "action", "entity", "entity_id",
  "actor_type", "actor_id", "impersonated_by", "ip", "device", "request_id", "reason", "diff", "hash",
] as const;

/**
 * Cellule CSV (RFC 4180) neutralisée contre l'injection de formule : un texte commençant
 * par `= + - @` ou une tabulation / retour chariot est préfixé d'une apostrophe, que les
 * tableurs n'interprètent pas comme formule.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly StoredAuditEntry[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.seq, r.id, r.occurredAt, r.severity, r.action, r.entity, r.entityId,
        r.actorType, r.actorId, r.impersonatedBy, r.ip, r.device, r.requestId, r.reason, r.diff, r.hash,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // BOM UTF-8 : Excel affiche correctement les accents.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface ExportResult {
  csv: string;
  rows: number;
  /** `true` si le plafond a été atteint : la période contient davantage de lignes. */
  truncated: boolean;
}

/**
 * Export borné (période obligatoire, plafond de lignes). L'export est une lecture
 * SENSIBLE : il est lui-même journalisé (`audit_log.exported`) dans la même transaction.
 */
export async function exportLogsCsv(
  tx: Tx,
  audit: AuditService,
  tenantId: string,
  filter: LogFilter & { from: string; to: string },
  limit: number = EXPORT_MAX_ROWS,
): Promise<ExportResult> {
  const cap = Math.min(Math.max(limit, 1), EXPORT_MAX_ROWS);
  const rows = await exportLogs(tx, tenantId, filter, cap + 1);
  const truncated = rows.length > cap;
  const kept = rows.slice(0, cap);
  await audit.record(tx, {
    action: "audit_log.exported",
    entity: "audit_log",
    severity: "notice",
    metadata: { filter, rows: kept.length, truncated },
  });
  return { csv: toCsv(kept), rows: kept.length, truncated };
}
