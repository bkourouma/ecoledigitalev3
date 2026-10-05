/**
 * SQL de l'index de texte des PDF (`documents.text_index`, migration 2504) et de la recherche dans ce texte.
 *
 * RÈGLE D'OR : la recherche applique, dans la MÊME requête que le filtre de contenu, la condition de visibilité de la liste des
 * documents (`visibilityPredicate`, miroir SQL de `resolveAccess`) ; le texte d'un document que l'appelant ne peut pas lire n'est
 * donc jamais lu pour lui, encore moins renvoyé. Le texte brut n'est jamais renvoyé en entier : seulement un extrait (`ts_headline`)
 * calculé sur la page de résultats déjà filtrée.
 *
 * Configuration de recherche : `documents.fr_search` (français + suppression des accents), voir 2504.
 */
import type { Tx } from "@ecoledigitale/database";
import type { DocumentTextIndexStatus } from "@ecoledigitale/contracts/src/v2/documents";
import type { Actor, DocumentKind, Uuid } from "../domain/types";
import { SELECT_DOC, SqlParams, toDocument, visibilityPredicate, type DocumentRow, type RawDocument } from "./documents-repository";

const CONFIG = "'documents.fr_search'::regconfig";

/** Caractères réservés au surlignage : retirés du texte à l'extraction, donc impossibles à confondre avec du contenu. */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";
export const FRAGMENT_SEPARATOR = "\u0003";

export interface TextIndexRow {
  documentId: Uuid;
  versionNo: number;
  status: DocumentTextIndexStatus;
  attempts: number;
  pageCount: number | null;
  pagesIndexed: number | null;
  truncated: boolean;
  charCount: number | null;
  errorCode: string | null;
  indexedAt: Date | null;
}

const STATE_COLS = `document_id AS "documentId", version_no AS "versionNo", status, attempts, page_count AS "pageCount", pages_indexed AS "pagesIndexed",
  truncated, char_count AS "charCount", error_code AS "errorCode", indexed_at AS "indexedAt"`;

export async function getTextIndexState(tx: Tx, tenantId: Uuid, documentId: Uuid): Promise<TextIndexRow | null> {
  return tx.queryOne<TextIndexRow>(`SELECT ${STATE_COLS} FROM documents.text_index WHERE tenant_id = $1 AND document_id = $2`, [tenantId, documentId]);
}

/** Met en file l'extraction de la version courante d'un PDF (réinitialise l'ancien texte : un texte périmé ne répond jamais). */
export async function enqueueTextIndex(tx: Tx, tenantId: Uuid, documentId: Uuid, versionNo: number, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.text_index (tenant_id, document_id, version_no, status, requested_at, next_attempt_at)
     VALUES ($1, $2, $3, 'PENDING', $4, $4)
     ON CONFLICT (tenant_id, document_id) DO UPDATE
        SET version_no = EXCLUDED.version_no, status = 'PENDING', attempts = 0, content = NULL, tsv = NULL, page_count = NULL, pages_indexed = NULL,
            truncated = false, char_count = NULL, error_code = NULL, requested_at = EXCLUDED.requested_at, next_attempt_at = EXCLUDED.next_attempt_at, indexed_at = NULL`,
    [tenantId, documentId, versionNo, now],
  );
}

/** Supprime l'index d'un document (version courante qui n'est plus un PDF). */
export async function clearTextIndex(tx: Tx, tenantId: Uuid, documentId: Uuid): Promise<void> {
  await tx.query(`DELETE FROM documents.text_index WHERE tenant_id = $1 AND document_id = $2`, [tenantId, documentId]);
}

export interface TextIndexClaim {
  documentId: Uuid;
  versionNo: number;
  attempts: number;
}

/**
 * Réserve un lot de lignes à traiter : `attempts` est incrémenté et `next_attempt_at` repoussé à `leaseUntil` (bail : si le worker
 * s'arrête en cours de route, la ligne redevient disponible après le bail). `SKIP LOCKED` : deux workers ne prennent jamais la même.
 */
export async function claimDueTextIndex(tx: Tx, tenantId: Uuid, now: Date, leaseUntil: Date, limit: number): Promise<TextIndexClaim[]> {
  return tx.many<TextIndexClaim>(
    `WITH due AS (
       SELECT document_id FROM documents.text_index
        WHERE tenant_id = $1 AND status = 'PENDING' AND next_attempt_at <= $2
        ORDER BY next_attempt_at, document_id LIMIT $4 FOR UPDATE SKIP LOCKED)
     UPDATE documents.text_index t SET attempts = t.attempts + 1, next_attempt_at = $3
       FROM due WHERE t.tenant_id = $1 AND t.document_id = due.document_id
     RETURNING t.document_id AS "documentId", t.version_no AS "versionNo", t.attempts AS attempts`,
    [tenantId, now, leaseUntil, limit],
  );
}

export type TextIndexOutcome =
  | { kind: "INDEXED"; text: string; pageCount: number; pagesIndexed: number; truncated: boolean }
  | { kind: "NO_TEXT"; pageCount: number; pagesIndexed: number }
  | { kind: "FAILED"; errorCode: string }
  | { kind: "RETRY"; errorCode: string; retryAt: Date }
  | { kind: "RELEASE"; retryAt: Date };

/**
 * Enregistre le résultat de l'extraction de la version `versionNo`. Sans effet (0) si la ligne a changé entre-temps (nouvelle
 * version déposée, ligne supprimée, déjà traitée) : on n'écrit jamais le texte d'une version périmée.
 */
export async function completeTextIndex(tx: Tx, tenantId: Uuid, documentId: Uuid, versionNo: number, outcome: TextIndexOutcome, now: Date): Promise<number> {
  const guard = `tenant_id = $1 AND document_id = $2 AND version_no = $3 AND status = 'PENDING'`;
  switch (outcome.kind) {
    case "INDEXED": {
      const r = await tx.query(
        `UPDATE documents.text_index SET status = 'INDEXED', content = $4, tsv = to_tsvector(${CONFIG}, $4), page_count = $5, pages_indexed = $6, truncated = $7,
                char_count = $8, error_code = NULL, indexed_at = $9, next_attempt_at = $9
          WHERE ${guard}`,
        [tenantId, documentId, versionNo, outcome.text, outcome.pageCount, outcome.pagesIndexed, outcome.truncated, outcome.text.length, now],
      );
      return r.rowCount ?? 0;
    }
    case "NO_TEXT": {
      const r = await tx.query(
        `UPDATE documents.text_index SET status = 'NO_TEXT', content = NULL, tsv = NULL, page_count = $4, pages_indexed = $5, truncated = false, char_count = 0,
                error_code = NULL, indexed_at = $6, next_attempt_at = $6
          WHERE ${guard}`,
        [tenantId, documentId, versionNo, outcome.pageCount, outcome.pagesIndexed, now],
      );
      return r.rowCount ?? 0;
    }
    case "FAILED": {
      const r = await tx.query(`UPDATE documents.text_index SET status = 'FAILED', content = NULL, tsv = NULL, error_code = $4, indexed_at = $5, next_attempt_at = $5 WHERE ${guard}`, [tenantId, documentId, versionNo, outcome.errorCode, now]);
      return r.rowCount ?? 0;
    }
    case "RETRY": {
      const r = await tx.query(`UPDATE documents.text_index SET error_code = $4, next_attempt_at = $5 WHERE ${guard}`, [tenantId, documentId, versionNo, outcome.errorCode, outcome.retryAt]);
      return r.rowCount ?? 0;
    }
    case "RELEASE": {
      // Extracteur indisponible : la tentative ne compte pas et la ligne reste en file.
      const r = await tx.query(`UPDATE documents.text_index SET attempts = GREATEST(attempts - 1, 0), next_attempt_at = $4 WHERE ${guard}`, [tenantId, documentId, versionNo, outcome.retryAt]);
      return r.rowCount ?? 0;
    }
  }
}

export interface TextIndexStats {
  counts: Record<DocumentTextIndexStatus, number>;
  failures: Array<{ errorCode: string; count: number }>;
}

export async function textIndexStats(tx: Tx, tenantId: Uuid): Promise<TextIndexStats> {
  const rows = await tx.many<{ status: DocumentTextIndexStatus; n: string }>(`SELECT status, count(*)::text AS n FROM documents.text_index WHERE tenant_id = $1 GROUP BY status`, [tenantId]);
  const counts: Record<DocumentTextIndexStatus, number> = { PENDING: 0, INDEXED: 0, NO_TEXT: 0, FAILED: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  const failures = await tx.many<{ errorCode: string; n: string }>(
    `SELECT error_code AS "errorCode", count(*)::text AS n FROM documents.text_index WHERE tenant_id = $1 AND status = 'FAILED' AND error_code IS NOT NULL GROUP BY error_code ORDER BY count(*) DESC, error_code`,
    [tenantId],
  );
  return { counts, failures: failures.map((f) => ({ errorCode: f.errorCode, count: Number(f.n) })) };
}

/**
 * Remet des PDF en file. `FAILED` : seulement les échecs ; `ALL` : tous les PDF courants (index vidé puis reconstruit), y compris
 * ceux qui n'ont pas encore de ligne. Un document purgé ou une version purgée n'est jamais remis en file.
 */
export async function requeueTextIndex(tx: Tx, tenantId: Uuid, scope: "FAILED" | "ALL", now: Date): Promise<number> {
  if (scope === "FAILED") {
    const r = await tx.query(
      `UPDATE documents.text_index SET status = 'PENDING', attempts = 0, error_code = NULL, requested_at = $2, next_attempt_at = $2, indexed_at = NULL
        WHERE tenant_id = $1 AND status = 'FAILED'`,
      [tenantId, now],
    );
    return r.rowCount ?? 0;
  }
  const updated = await tx.query(
    `UPDATE documents.text_index t SET status = 'PENDING', attempts = 0, content = NULL, tsv = NULL, page_count = NULL, pages_indexed = NULL, truncated = false,
            char_count = NULL, error_code = NULL, requested_at = $2, next_attempt_at = $2, indexed_at = NULL, version_no = d.current_version_no
       FROM documents.documents d
      WHERE t.tenant_id = $1 AND d.tenant_id = t.tenant_id AND d.id = t.document_id AND d.purged_at IS NULL`,
    [tenantId, now],
  );
  const inserted = await tx.query(
    `INSERT INTO documents.text_index (tenant_id, document_id, version_no, status, requested_at, next_attempt_at)
     SELECT d.tenant_id, d.id, d.current_version_no, 'PENDING', $2, $2
       FROM documents.documents d
       JOIN documents.versions v ON v.tenant_id = d.tenant_id AND v.document_id = d.id AND v.version_no = d.current_version_no
      WHERE d.tenant_id = $1 AND d.purged_at IS NULL AND v.state = 'ACTIVE' AND v.detected_mime = 'application/pdf'
        AND NOT EXISTS (SELECT 1 FROM documents.text_index t WHERE t.tenant_id = d.tenant_id AND t.document_id = d.id)`,
    [tenantId, now],
  );
  return (updated.rowCount ?? 0) + (inserted.rowCount ?? 0);
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

export interface TextSearchFilters {
  query: string;
  categoryId?: Uuid | undefined;
  kind?: DocumentKind | undefined;
  /** Curseur : pertinence (texte) et identifiant du dernier résultat de la page précédente. */
  cursor?: { rank: string; id: Uuid } | undefined;
  limit: number;
}

export interface TextSearchHit extends DocumentRow {
  rank: string;
  versionNo: number;
  pageCount: number | null;
  pagesIndexed: number | null;
  truncated: boolean;
  /** Extrait avec marques `MARK_START` / `MARK_END` autour des mots trouvés et `FRAGMENT_SEPARATOR` entre fragments. */
  headline: string;
}

type RawHit = RawDocument & { rank: string; versionNo: number; pageCount: number | null; pagesIndexed: number | null; truncated: boolean; headline: string };

/**
 * Recherche dans le texte des PDF VISIBLES de l'appelant : documents actifs, version indexée = version courante, visibilité
 * identique à la liste. Tri : pertinence décroissante puis identifiant (pagination par curseur stable).
 */
export async function searchTextIndex(tx: Tx, tenantId: Uuid, actor: Actor, now: Date, f: TextSearchFilters): Promise<TextSearchHit[]> {
  const p = new SqlParams();
  p.add(tenantId); // $1
  p.add(actor.userId); // $2
  p.add(now); // $3
  const visible = visibilityPredicate(actor, now, p);
  const query = p.add(f.query);
  const tsq = `websearch_to_tsquery(${CONFIG}, ${query})`;
  const extra: string[] = [];
  if (f.categoryId) extra.push(`d.category_id = ${p.add(f.categoryId)}::uuid`);
  if (f.kind) extra.push(`d.kind = ${p.add(f.kind)}`);
  const cursor = f.cursor ? `WHERE (h."rank", h.id) < (${p.add(f.cursor.rank)}::float4, ${p.add(f.cursor.id)}::uuid)` : "";
  const limit = p.add(f.limit + 1);
  const options = p.add(`StartSel=${MARK_START}, StopSel=${MARK_END}, MaxFragments=2, MaxWords=28, MinWords=10, ShortWord=2, FragmentDelimiter=${FRAGMENT_SEPARATOR}`);
  const rows = await tx.many<RawHit>(
    `WITH hits AS (
        SELECT d.id, ti.version_no, ts_rank_cd(ti.tsv, ${tsq}, 32) AS "rank"
          FROM documents.text_index ti
          JOIN documents.documents d ON d.tenant_id = ti.tenant_id AND d.id = ti.document_id
          JOIN documents.categories c ON c.tenant_id = d.tenant_id AND c.id = d.category_id
         WHERE ti.tenant_id = $1 AND ti.status = 'INDEXED' AND ti.version_no = d.current_version_no
           AND d.status = 'ACTIVE' AND d.purged_at IS NULL AND ti.tsv @@ ${tsq}
           AND ${visible}${extra.length ? ` AND ${extra.join(" AND ")}` : ""}
     ), page AS (
        SELECT h.id, h.version_no, h."rank" FROM hits h ${cursor} ORDER BY h."rank" DESC, h.id DESC LIMIT ${limit}
     )
     SELECT ${SELECT_DOC}, page."rank"::text AS "rank", page.version_no AS "versionNo", ti.page_count AS "pageCount", ti.pages_indexed AS "pagesIndexed", ti.truncated,
            ts_headline(${CONFIG}, ti.content, ${tsq}, ${options}) AS headline
       FROM page
       JOIN documents.text_index ti ON ti.tenant_id = $1 AND ti.document_id = page.id
       JOIN documents.documents d ON d.tenant_id = $1 AND d.id = page.id
       JOIN documents.categories c ON c.tenant_id = d.tenant_id AND c.id = d.category_id
      ORDER BY page."rank" DESC, page.id DESC`,
    p.values,
  );
  return rows.map((r) => ({ ...toDocument(r), rank: r.rank, versionNo: r.versionNo, pageCount: r.pageCount, pagesIndexed: r.pagesIndexed, truncated: r.truncated, headline: r.headline }));
}
