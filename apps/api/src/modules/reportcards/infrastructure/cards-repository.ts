/**
 * Requêtes SQL des snapshots (`report_cards`), des rendus (`renders`), de l'index public (tables globales) et du journal
 * d'accès. Les contenus (snapshot, trace) ne sont lus que par `getCardContent` : les listes n'en extraient que le titre et le
 * nom de l'élève.
 */
import type { Tx } from "@ecoledigitale/database";
import type { ReportcardExplain, ReportcardSnapshot } from "../domain/types";
import type { CardStatus, DocumentKind, RenderRecord, ReportCardRecord, Scope, Uuid } from "../domain/types";
import { CARD_COLUMNS, RENDER_COLUMNS, toCard, toRender } from "./rows";

const NIL = "00000000-0000-0000-0000-000000000000";

export interface NewCard {
  id: Uuid;
  tenantId: Uuid;
  documentKind: DocumentKind;
  enrollmentId: Uuid | null;
  studentId: Uuid;
  classroomId: Uuid | null;
  academicYearId: Uuid | null;
  academicPeriodId: Uuid | null;
  scope: Scope;
  version: number;
  provisional: boolean;
  snapshot: ReportcardSnapshot;
  explain: ReportcardExplain;
  snapshotHash: string;
  ruleSetCode: string;
  ruleVersionId: Uuid;
  ruleVersionNo: number;
  definitionHash: string;
  resultsStateId: Uuid;
  resultsVersion: number;
  closureHash: string;
  templateKey: string;
  templateVersion: number;
  configVersion: number;
  verificationCode: string;
  signingKeyId: string;
  signature: string;
  issuedAt: Date;
  issuedBy: Uuid | null;
  issuedByName: string;
  supersedesId: Uuid | null;
  supersedeReason: string | null;
  batchId: Uuid | null;
}

export async function insertCard(tx: Tx, c: NewCard): Promise<ReportCardRecord> {
  const rows = await tx.many(
    `INSERT INTO reportcards.report_cards
       (id, tenant_id, document_kind, enrollment_id, student_id, classroom_id, academic_year_id, academic_period_id, scope, version, provisional,
        snapshot_schema, snapshot, explain, snapshot_hash, rule_set_code, rule_version_id, rule_version_no, definition_hash, results_state_id,
        results_version, closure_hash, template_key, template_version, config_version, verification_code, signing_key_id, signature,
        issued_at, issued_by, issued_by_name, supersedes_id, supersede_reason, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
     RETURNING ${CARD_COLUMNS}`,
    [
      c.id, c.tenantId, c.documentKind, c.enrollmentId, c.studentId, c.classroomId, c.academicYearId, c.academicPeriodId, c.scope, c.version, c.provisional,
      c.snapshot.meta.schema, JSON.stringify(c.snapshot), JSON.stringify(c.explain), c.snapshotHash, c.ruleSetCode, c.ruleVersionId, c.ruleVersionNo,
      c.definitionHash, c.resultsStateId, c.resultsVersion, c.closureHash, c.templateKey, c.templateVersion, c.configVersion, c.verificationCode,
      c.signingKeyId, c.signature, c.issuedAt, c.issuedBy, c.issuedByName, c.supersedesId, c.supersedeReason, c.batchId,
    ],
  );
  return toCard(rows[0]!);
}

export async function getCard(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<ReportCardRecord | null> {
  const row = await tx.queryOne(`SELECT ${CARD_COLUMNS} FROM reportcards.report_cards WHERE id = $1 ${options.forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return row ? toCard(row) : null;
}

export async function getCardByCode(tx: Tx, code: string): Promise<ReportCardRecord | null> {
  const row = await tx.queryOne(`SELECT ${CARD_COLUMNS} FROM reportcards.report_cards WHERE verification_code = $1`, [code]);
  return row ? toCard(row) : null;
}

export interface CardContent {
  readonly record: ReportCardRecord;
  readonly snapshot: ReportcardSnapshot;
  readonly explain: ReportcardExplain;
}

export async function getCardContent(tx: Tx, id: Uuid): Promise<CardContent | null> {
  const row = await tx.queryOne(`SELECT ${CARD_COLUMNS}, snapshot, explain FROM reportcards.report_cards WHERE id = $1`, [id]);
  return row ? { record: toCard(row), snapshot: row.snapshot as ReportcardSnapshot, explain: row.explain as ReportcardExplain } : null;
}

export interface FunctionalKey {
  documentKind: DocumentKind;
  studentId: Uuid;
  enrollmentId: Uuid | null;
  academicPeriodId: Uuid | null;
  scope: Scope;
}

/** La version « vivante » (ISSUED / PUBLISHED, non provisoire) de la clé fonctionnelle, ou `null`. */
export async function findLiveCard(tx: Tx, key: FunctionalKey, options: { forUpdate?: boolean } = {}): Promise<ReportCardRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${CARD_COLUMNS} FROM reportcards.report_cards
      WHERE document_kind = $1 AND student_id = $2 AND scope = $3 AND status IN ('ISSUED','PUBLISHED') AND NOT provisional
        AND coalesce(enrollment_id, $4::uuid) = $5::uuid AND coalesce(academic_period_id, $4::uuid) = $6::uuid
      ${options.forUpdate ? "FOR UPDATE" : ""}`,
    [key.documentKind, key.studentId, key.scope, NIL, key.enrollmentId ?? NIL, key.academicPeriodId ?? NIL],
  );
  return row ? toCard(row) : null;
}

/** Dernière version (tous statuts) de la clé fonctionnelle : base du numéro de version suivant. */
export async function findLatestVersion(tx: Tx, key: FunctionalKey): Promise<ReportCardRecord | null> {
  const rows = await tx.many(
    `SELECT ${CARD_COLUMNS} FROM reportcards.report_cards
      WHERE document_kind = $1 AND student_id = $2 AND scope = $3 AND NOT provisional
        AND coalesce(enrollment_id, $4::uuid) = $5::uuid AND coalesce(academic_period_id, $4::uuid) = $6::uuid
      ORDER BY version DESC LIMIT 1`,
    [key.documentKind, key.studentId, key.scope, NIL, key.enrollmentId ?? NIL, key.academicPeriodId ?? NIL],
  );
  return rows[0] ? toCard(rows[0]) : null;
}

export interface CardFilter {
  classroomId?: Uuid;
  academicPeriodId?: Uuid;
  studentId?: Uuid;
  studentIds?: readonly Uuid[];
  status?: CardStatus;
  kind?: DocumentKind;
  live?: boolean;
  /** Visible aux familles : publié, non retiré, non provisoire. */
  familyVisible?: boolean;
  batchId?: Uuid;
  ids?: readonly Uuid[];
}

export interface CardPage {
  items: ReportCardRecord[];
  nextCursor: string | null;
}

const encodeCursor = (issuedAt: Date, id: string): string => Buffer.from(`${issuedAt.toISOString()}|${id}`, "utf8").toString("base64url");
function decodeCursor(cursor: string): { issuedAt: string; id: string } | null {
  try {
    const [issuedAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    return issuedAt && id && !Number.isNaN(Date.parse(issuedAt)) && /^[0-9a-f-]{36}$/.test(id) ? { issuedAt, id } : null;
  } catch {
    return null;
  }
}

export async function listCards(tx: Tx, filter: CardFilter, page: { cursor?: string; limit: number }): Promise<CardPage> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.classroomId) add("classroom_id = ?", filter.classroomId);
  if (filter.academicPeriodId) add("academic_period_id = ?", filter.academicPeriodId);
  if (filter.studentId) add("student_id = ?", filter.studentId);
  if (filter.studentIds) add("student_id = ANY(?::uuid[])", [...filter.studentIds]);
  if (filter.ids) add("id = ANY(?::uuid[])", [...filter.ids]);
  if (filter.status) add("status = ?", filter.status);
  if (filter.kind) add("document_kind = ?", filter.kind);
  if (filter.batchId) add("batch_id = ?", filter.batchId);
  if (filter.live) where.push("status IN ('ISSUED','PUBLISHED')");
  if (filter.familyVisible) where.push("status = 'PUBLISHED' AND withdrawn_at IS NULL AND NOT provisional");
  const cursor = page.cursor ? decodeCursor(page.cursor) : null;
  if (cursor) {
    params.push(cursor.issuedAt, cursor.id);
    where.push(`(issued_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(page.limit + 1);
  const rows = await tx.many(
    `SELECT ${CARD_COLUMNS} FROM reportcards.report_cards ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY issued_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const items = rows.slice(0, page.limit).map(toCard);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > page.limit && last ? encodeCursor(last.issuedAt, last.id) : null };
}

// --- Cycle de vie (colonnes mutables seulement ; les gardes SQL font le reste) -----------------

export async function markPublished(tx: Tx, id: Uuid, userId: Uuid, now: Date): Promise<ReportCardRecord> {
  const rows = await tx.many(
    `UPDATE reportcards.report_cards
        SET status = 'PUBLISHED', published_at = $2, published_by = $3, withdrawn_at = NULL
      WHERE id = $1 AND status = 'ISSUED'
      RETURNING ${CARD_COLUMNS}`,
    [id, now, userId],
  );
  return toCard(rows[0]!);
}

/** Re-publication après retrait : la date de première publication reste figée, seul le retrait est levé. */
export async function clearWithdrawn(tx: Tx, id: Uuid): Promise<ReportCardRecord> {
  const rows = await tx.many(`UPDATE reportcards.report_cards SET withdrawn_at = NULL WHERE id = $1 AND status = 'PUBLISHED' RETURNING ${CARD_COLUMNS}`, [id]);
  return toCard(rows[0]!);
}

export async function markWithdrawn(tx: Tx, id: Uuid, now: Date): Promise<ReportCardRecord> {
  const rows = await tx.many(`UPDATE reportcards.report_cards SET withdrawn_at = $2 WHERE id = $1 AND status = 'PUBLISHED' RETURNING ${CARD_COLUMNS}`, [id, now]);
  return toCard(rows[0]!);
}

export async function markRevoked(tx: Tx, id: Uuid, by: Uuid | null, byName: string, reason: string, now: Date): Promise<ReportCardRecord> {
  const rows = await tx.many(
    `UPDATE reportcards.report_cards
        SET status = 'REVOKED', revoked_at = $2, revoked_by = $3, revoked_by_name = $4, revoke_reason = $5
      WHERE id = $1 AND status IN ('ISSUED','PUBLISHED')
      RETURNING ${CARD_COLUMNS}`,
    [id, now, by, byName, reason],
  );
  return toCard(rows[0]!);
}

export async function setCardRenderState(tx: Tx, id: Uuid, renderStatus: string, currentRenderId: Uuid | null): Promise<void> {
  await tx.query(
    `UPDATE reportcards.report_cards SET render_status = $2, current_render_id = coalesce($3, current_render_id) WHERE id = $1`,
    [id, renderStatus, currentRenderId],
  );
}

// --- Rendus -----------------------------------------------------------------

export async function insertRender(tx: Tx, input: { id: Uuid; tenantId: Uuid; reportCardId: Uuid; status: string; attempts: number; requestedAt: Date }): Promise<RenderRecord> {
  const rows = await tx.many(
    `INSERT INTO reportcards.renders (id, tenant_id, report_card_id, status, attempts, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${RENDER_COLUMNS}`,
    [input.id, input.tenantId, input.reportCardId, input.status, input.attempts, input.requestedAt],
  );
  return toRender(rows[0]!);
}

export async function getRender(tx: Tx, id: Uuid): Promise<RenderRecord | null> {
  const row = await tx.queryOne(`SELECT ${RENDER_COLUMNS} FROM reportcards.renders WHERE id = $1`, [id]);
  return row ? toRender(row) : null;
}

export async function listRenders(tx: Tx, reportCardId: Uuid): Promise<RenderRecord[]> {
  const rows = await tx.many(`SELECT ${RENDER_COLUMNS} FROM reportcards.renders WHERE report_card_id = $1 ORDER BY requested_at DESC, id DESC`, [reportCardId]);
  return rows.map(toRender);
}

/** Tentatives déjà consommées pour ce bulletin (rendus non terminés ou en échec). */
export async function countFailedRenderAttempts(tx: Tx, reportCardId: Uuid): Promise<number> {
  const row = await tx.queryOne<{ n: string }>(`SELECT coalesce(sum(attempts), 0)::text AS n FROM reportcards.renders WHERE report_card_id = $1 AND status = 'FAILED'`, [reportCardId]);
  return Number(row?.n ?? 0);
}

export async function updateRender(
  tx: Tx,
  id: Uuid,
  patch: { status: string; objectKey?: string | null; pdfHash?: string | null; sizeBytes?: number | null; pages?: number | null; rendererVersion?: string | null; durationMs?: number | null; error?: string | null; attempts?: number; finishedAt?: Date | null },
): Promise<RenderRecord> {
  const rows = await tx.many(
    `UPDATE reportcards.renders
        SET status = $2, object_key = coalesce($3, object_key), pdf_hash = coalesce($4, pdf_hash), size_bytes = coalesce($5, size_bytes),
            pages = coalesce($6, pages), renderer_version = coalesce($7, renderer_version), duration_ms = coalesce($8, duration_ms),
            error = $9, attempts = coalesce($10, attempts), finished_at = $11
      WHERE id = $1
      RETURNING ${RENDER_COLUMNS}`,
    [id, patch.status, patch.objectKey ?? null, patch.pdfHash ?? null, patch.sizeBytes ?? null, patch.pages ?? null, patch.rendererVersion ?? null, patch.durationMs ?? null, patch.error ?? null, patch.attempts ?? null, patch.finishedAt ?? null],
  );
  return toRender(rows[0]!);
}

/** Le rendu RENDERED courant du bulletin (celui référencé par `current_render_id`). */
export async function getCurrentRender(tx: Tx, card: Pick<ReportCardRecord, "id" | "currentRenderId">): Promise<RenderRecord | null> {
  if (!card.currentRenderId) return null;
  const render = await getRender(tx, card.currentRenderId);
  return render && render.status === "RENDERED" ? render : null;
}

// --- Index public (tables globales) -----------------------------------------

export async function registerVerification(tx: Tx, input: { code: string; tenantId: Uuid; documentKind: string; documentId: Uuid }): Promise<void> {
  await tx.query(
    `INSERT INTO reportcards.verification_index (code, tenant_id, document_kind, document_id) VALUES ($1, $2, $3, $4)`,
    [input.code, input.tenantId, input.documentKind, input.documentId],
  );
}

export async function registerFileHash(tx: Tx, input: { pdfHash: string; code: string; tenantId: Uuid }): Promise<void> {
  await tx.query(
    `INSERT INTO reportcards.file_hash_index (pdf_hash, code, tenant_id) VALUES ($1, $2, $3) ON CONFLICT (pdf_hash) DO NOTHING`,
    [input.pdfHash, input.code, input.tenantId],
  );
}

export async function lookupVerification(tx: Tx, code: string): Promise<{ tenantId: Uuid; documentKind: string; documentId: Uuid } | null> {
  const row = await tx.queryOne<{ tenant_id: string; document_kind: string; document_id: string }>(
    `SELECT tenant_id, document_kind, document_id FROM reportcards.verification_index WHERE code = $1`,
    [code],
  );
  return row ? { tenantId: row.tenant_id, documentKind: row.document_kind, documentId: row.document_id } : null;
}

export async function lookupFileHash(tx: Tx, pdfHash: string): Promise<{ tenantId: Uuid; code: string } | null> {
  const row = await tx.queryOne<{ tenant_id: string; code: string }>(`SELECT tenant_id, code FROM reportcards.file_hash_index WHERE pdf_hash = $1`, [pdfHash]);
  return row ? { tenantId: row.tenant_id, code: row.code } : null;
}

export async function logVerification(tx: Tx, input: { id: Uuid; tenantId: Uuid; reportCardId: Uuid | null; documentKind: string; result: string; ipPrefix: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO reportcards.verification_events (id, tenant_id, report_card_id, document_kind, result, ip_prefix) VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.id, input.tenantId, input.reportCardId, input.documentKind, input.result, input.ipPrefix],
  );
}

export async function logAccess(tx: Tx, input: { id: Uuid; tenantId: Uuid; reportCardId: Uuid; userId: Uuid; actorKind: "STUDENT" | "GUARDIAN" }): Promise<void> {
  await tx.query(
    `INSERT INTO reportcards.access_log (id, tenant_id, report_card_id, user_id, actor_kind) VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.tenantId, input.reportCardId, input.userId, input.actorKind],
  );
}

/** Purge de rétention du journal des vérifications (lignes de plus de 24 mois) : seule suppression que la garde SQL autorise. */
export async function purgeExpiredVerificationEvents(tx: Tx): Promise<number> {
  await tx.query("SELECT set_config('reportcards.retention', 'on', true)");
  const res = await tx.query("DELETE FROM reportcards.verification_events WHERE occurred_at < now() - interval '24 months'");
  await tx.query("SELECT set_config('reportcards.retention', 'off', true)");
  return res.rowCount;
}
