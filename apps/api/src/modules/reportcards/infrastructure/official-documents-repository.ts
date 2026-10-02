/**
 * Accès SQL aux documents officiels d'autres modules (reçus, bulletins de paie) — table `reportcards.official_documents`.
 * Le contenu scellé est immuable (garde SQL 1304) ; seul l'état de rendu évolue.
 */
import type { Tx } from "@ecoledigitale/database";
import type { OfficialDocumentKind } from "../domain/constants";
import type { RenderStatus, Uuid } from "../domain/types";

export interface OfficialDocumentRecord {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly documentKind: OfficialDocumentKind;
  readonly sourceId: Uuid;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly snapshotHash: string;
  readonly verificationCode: string;
  readonly signingKeyId: string;
  readonly signature: string;
  readonly issuedAt: Date;
  readonly requestedBy: Uuid | null;
  readonly createdAt: Date;
  readonly renderStatus: RenderStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly objectKey: string | null;
  readonly pdfHash: string | null;
  readonly sizeBytes: number | null;
  readonly pages: number | null;
  readonly renderedAt: Date | null;
}

const COLS = `id, tenant_id, document_kind, source_id, title, template_key, template_version, snapshot_hash, verification_code, signing_key_id,
  signature, issued_at, requested_by, created_at, render_status, attempts, last_error, object_key, pdf_hash, size_bytes::text AS size_bytes, pages, rendered_at`;

const recordOf = (r: any): OfficialDocumentRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  documentKind: r.document_kind,
  sourceId: r.source_id,
  title: r.title,
  templateKey: r.template_key,
  templateVersion: r.template_version,
  snapshotHash: r.snapshot_hash,
  verificationCode: r.verification_code,
  signingKeyId: r.signing_key_id,
  signature: r.signature,
  issuedAt: r.issued_at,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  renderStatus: r.render_status,
  attempts: r.attempts,
  lastError: r.last_error,
  objectKey: r.object_key,
  pdfHash: r.pdf_hash,
  sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
  pages: r.pages,
  renderedAt: r.rendered_at,
});

export interface NewOfficialDocument {
  id: Uuid;
  tenantId: Uuid;
  documentKind: OfficialDocumentKind;
  sourceId: Uuid;
  title: string;
  templateKey: string;
  templateVersion: number;
  snapshot: unknown;
  explain: unknown;
  snapshotHash: string;
  verificationCode: string;
  signingKeyId: string;
  signature: string;
  issuedAt: Date;
  requestedBy: Uuid | null;
}

export async function insertOfficialDocument(tx: Tx, d: NewOfficialDocument): Promise<OfficialDocumentRecord> {
  const row = await tx.queryOne(
    `INSERT INTO reportcards.official_documents (id, tenant_id, document_kind, source_id, title, template_key, template_version, snapshot, explain,
        snapshot_hash, verification_code, signing_key_id, signature, issued_at, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15)
     RETURNING ${COLS}`,
    [d.id, d.tenantId, d.documentKind, d.sourceId, d.title, d.templateKey, d.templateVersion, JSON.stringify(d.snapshot), JSON.stringify(d.explain), d.snapshotHash, d.verificationCode, d.signingKeyId, d.signature, d.issuedAt, d.requestedBy],
  );
  return recordOf(row);
}

export async function getOfficialDocument(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<OfficialDocumentRecord | null> {
  const row = await tx.queryOne(`SELECT ${COLS} FROM reportcards.official_documents WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? recordOf(row) : null;
}

export async function getOfficialDocumentBySource(tx: Tx, kind: OfficialDocumentKind, sourceId: Uuid, options: { forUpdate?: boolean } = {}): Promise<OfficialDocumentRecord | null> {
  const row = await tx.queryOne(`SELECT ${COLS} FROM reportcards.official_documents WHERE document_kind = $1 AND source_id = $2${options.forUpdate ? " FOR UPDATE" : ""}`, [kind, sourceId]);
  return row ? recordOf(row) : null;
}

/** Contenu scellé (instantané + contexte d'impression) : lu par le rendu et par la vérification publique. */
export async function getOfficialDocumentContent(tx: Tx, id: Uuid): Promise<{ record: OfficialDocumentRecord; snapshot: any; explain: any } | null> {
  const row = await tx.queryOne(`SELECT ${COLS}, snapshot, explain FROM reportcards.official_documents WHERE id = $1`, [id]);
  return row ? { record: recordOf(row), snapshot: (row as any).snapshot, explain: (row as any).explain } : null;
}

export async function setOfficialRenderState(tx: Tx, id: Uuid, state: { status: RenderStatus; attempts?: number; error?: string | null }): Promise<void> {
  await tx.query(
    `UPDATE reportcards.official_documents SET render_status = $2, attempts = COALESCE($3, attempts), last_error = $4 WHERE id = $1`,
    [id, state.status, state.attempts ?? null, state.error ?? null],
  );
}

export async function markOfficialRendered(tx: Tx, id: Uuid, done: { objectKey: string; pdfHash: string; sizeBytes: number; pages: number; at: Date }): Promise<void> {
  await tx.query(
    `UPDATE reportcards.official_documents SET render_status = 'RENDERED', object_key = $2, pdf_hash = $3, size_bytes = $4, pages = $5, rendered_at = $6, last_error = NULL WHERE id = $1`,
    [id, done.objectKey, done.pdfHash, done.sizeBytes, done.pages, done.at],
  );
}

/** Documents restés `PENDING` depuis `olderThan` (événement perdu, worker arrêté) : candidats à une nouvelle demande de rendu. */
export async function listStalePendingOfficialDocuments(tx: Tx, olderThan: Date, limit: number): Promise<Uuid[]> {
  const rows = await tx.many<{ id: string }>(
    `SELECT id FROM reportcards.official_documents WHERE render_status IN ('PENDING', 'RENDERING') AND created_at < $1 ORDER BY created_at LIMIT $2`,
    [olderThan, limit],
  );
  return rows.map((r) => r.id);
}
