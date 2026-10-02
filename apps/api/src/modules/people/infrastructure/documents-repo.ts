/** Pièces de l'élève (`people.student_documents`) : métadonnées seulement, le fichier vit dans le stockage objet. */
import type { Tx } from "@ecoledigitale/database";
import { iso, isoOrNull } from "./sql";

export interface DocumentRow {
  id: string;
  studentId: string;
  typeCode: string;
  title: string | null;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  version: number;
  supersedesId: string | null;
  status: "ACTIVE" | "REPLACED" | "REMOVED";
  issuedOn: string | null;
  expiresOn: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  replacedAt: string | null;
  removedAt: string | null;
  removedReason: string | null;
}

const COLS = `id, student_id, type_code, title, file_name, content_type, size_bytes, sha256, object_key, version, supersedes_id, status,
  issued_on::text AS issued_on, expires_on::text AS expires_on, uploaded_by, uploaded_at, replaced_at, removed_at, removed_reason`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRow = (r: any): DocumentRow => ({
  id: r.id,
  studentId: r.student_id,
  typeCode: r.type_code,
  title: r.title,
  fileName: r.file_name,
  contentType: r.content_type,
  sizeBytes: Number(r.size_bytes),
  sha256: r.sha256,
  objectKey: r.object_key,
  version: Number(r.version),
  supersedesId: r.supersedes_id,
  status: r.status,
  issuedOn: r.issued_on,
  expiresOn: r.expires_on,
  uploadedBy: r.uploaded_by,
  uploadedAt: iso(r.uploaded_at),
  replacedAt: isoOrNull(r.replaced_at),
  removedAt: isoOrNull(r.removed_at),
  removedReason: r.removed_reason,
});

export async function listDocuments(tx: Tx, tenantId: string, studentId: string, options: { includeHistory: boolean }): Promise<DocumentRow[]> {
  const rows = await tx.many(
    `SELECT ${COLS} FROM people.student_documents WHERE tenant_id = $1 AND student_id = $2 AND ($3::boolean OR status = 'ACTIVE') ORDER BY type_code, version DESC, uploaded_at DESC, id`,
    [tenantId, studentId, options.includeHistory],
  );
  return rows.map(toRow);
}

export async function getDocument(tx: Tx, tenantId: string, studentId: string, id: string, options: { forUpdate?: boolean } = {}): Promise<DocumentRow | null> {
  const r = await tx.queryOne(`SELECT ${COLS} FROM people.student_documents WHERE tenant_id = $1 AND student_id = $2 AND id = $3${options.forUpdate ? " FOR UPDATE" : ""}`, [tenantId, studentId, id]);
  return r ? toRow(r) : null;
}

export async function findActiveOfType(tx: Tx, tenantId: string, studentId: string, typeCode: string): Promise<DocumentRow | null> {
  const r = await tx.queryOne(`SELECT ${COLS} FROM people.student_documents WHERE tenant_id = $1 AND student_id = $2 AND type_code = $3 AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1`, [tenantId, studentId, typeCode]);
  return r ? toRow(r) : null;
}

export interface NewDocument {
  id: string;
  studentId: string;
  typeCode: string;
  title: string | null;
  fileName: string;
  contentType: DocumentRow["contentType"];
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  version: number;
  supersedesId: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;
}

export async function insertDocument(tx: Tx, tenantId: string, d: NewDocument): Promise<DocumentRow> {
  const r = await tx.queryOne(
    `INSERT INTO people.student_documents (id, tenant_id, student_id, type_code, title, file_name, content_type, size_bytes, sha256, object_key, version, supersedes_id, issued_on, expires_on, uploaded_by, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14::date, $15, $16) RETURNING ${COLS}`,
    [d.id, tenantId, d.studentId, d.typeCode, d.title, d.fileName, d.contentType, d.sizeBytes, d.sha256, d.objectKey, d.version, d.supersedesId, d.issuedOn, d.expiresOn, d.uploadedBy, d.uploadedAt],
  );
  return toRow(r);
}

export async function markReplaced(tx: Tx, tenantId: string, id: string, at: Date): Promise<void> {
  await tx.query(`UPDATE people.student_documents SET status = 'REPLACED', replaced_at = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'`, [tenantId, id, at]);
}

export async function markRemoved(tx: Tx, tenantId: string, id: string, reason: string, at: Date): Promise<void> {
  await tx.query(`UPDATE people.student_documents SET status = 'REMOVED', removed_at = $3, removed_reason = $4 WHERE tenant_id = $1 AND id = $2 AND status <> 'REMOVED'`, [tenantId, id, at, reason]);
}

export async function updateMetadata(tx: Tx, tenantId: string, id: string, patch: { title?: string | null | undefined; issuedOn?: string | null | undefined; expiresOn?: string | null | undefined }): Promise<DocumentRow> {
  const has = (v: unknown): boolean => v !== undefined;
  const r = await tx.queryOne(
    `UPDATE people.student_documents SET
        title = CASE WHEN $3::boolean THEN $4 ELSE title END,
        issued_on = CASE WHEN $5::boolean THEN $6::date ELSE issued_on END,
        expires_on = CASE WHEN $7::boolean THEN $8::date ELSE expires_on END,
        -- une nouvelle échéance rouvre le droit à une alerte
        expiry_alerted_for = CASE WHEN $7::boolean THEN NULL ELSE expiry_alerted_for END
      WHERE tenant_id = $1 AND id = $2 RETURNING ${COLS}`,
    [tenantId, id, has(patch.title), patch.title ?? null, has(patch.issuedOn), patch.issuedOn ?? null, has(patch.expiresOn), patch.expiresOn ?? null],
  );
  return toRow(r);
}

/** Clés de stockage de TOUTES les pièces de l'élève (anonymisation : suppression des fichiers) ; les lignes passent `REMOVED`. */
export async function wipeAllDocuments(tx: Tx, tenantId: string, studentId: string, reason: string, at: Date): Promise<string[]> {
  const rows = await tx.many<{ object_key: string }>(
    `UPDATE people.student_documents SET
        status = 'REMOVED', removed_at = COALESCE(removed_at, $3), removed_reason = COALESCE(removed_reason, $4), title = NULL, file_name = 'anonymisé'
      WHERE tenant_id = $1 AND student_id = $2 RETURNING object_key`,
    [tenantId, studentId, at, reason],
  );
  return rows.map((r) => r.object_key);
}

export interface ExpiringDocumentRow {
  documentId: string;
  studentId: string;
  typeCode: string;
  expiresOn: string;
  daysLeft: number;
}

/** Pièces ACTIVES échues ou qui échoient dans `withinDays`, pas encore signalées pour CETTE échéance (une alerte par franchissement de seuil). */
export async function lockUnalertedExpiring(tx: Tx, tenantId: string, asOf: string, withinDays: number): Promise<ExpiringDocumentRow[]> {
  return tx.many<ExpiringDocumentRow>(
    `SELECT d.id AS "documentId", d.student_id AS "studentId", d.type_code AS "typeCode", d.expires_on::text AS "expiresOn", (d.expires_on - $2::date)::int AS "daysLeft"
       FROM people.student_documents d JOIN people.students s ON s.tenant_id = d.tenant_id AND s.id = d.student_id
      WHERE d.tenant_id = $1 AND d.status = 'ACTIVE' AND d.expires_on IS NOT NULL AND s.status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')
        AND d.expires_on <= $2::date + $3::int AND d.expiry_alerted_for IS DISTINCT FROM d.expires_on
      ORDER BY d.expires_on, d.id
      FOR UPDATE OF d SKIP LOCKED`,
    [tenantId, asOf, withinDays],
  );
}

export async function markAlerted(tx: Tx, tenantId: string, id: string, expiresOn: string): Promise<void> {
  await tx.query(`UPDATE people.student_documents SET expiry_alerted_for = $3::date WHERE tenant_id = $1 AND id = $2`, [tenantId, id, expiresOn]);
}
