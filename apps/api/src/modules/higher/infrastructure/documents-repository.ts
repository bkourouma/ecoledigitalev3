/** Documents officiels, emplacements de signature et compteurs de numérotation (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { CounterKey, DocumentKind, DocumentSlot, IsoDate, OfficialDocument, SlotKey, SnapshotSchema, Uuid } from "../domain/types";
import { DOCUMENT_COLUMNS, SLOT_COLUMNS, decodeCursor, encodeCursor, toDocument, toSlot, type DocumentRow, type SlotRow } from "./rows";

/**
 * Numéro suivant d'un compteur : fonction SQL `higher.next_number` (UPDATE verrouillant la ligne). Doit être appelée dans
 * la transaction qui écrit le document : une annulation ne consomme pas de numéro.
 */
export async function nextNumber(tx: Tx, key: CounterKey, year: number): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT higher.next_number($1, $2)::text AS n`, [key, year]);
  return Number((r as { n: string }).n);
}

// --- documents ----------------------------------------------------------------------------------------------------

export interface DocumentInsert {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly documentKind: DocumentKind;
  readonly awardId: Uuid | null;
  readonly studentId: Uuid;
  readonly programNodeId: Uuid | null;
  readonly reference: string;
  readonly referenceYear: number;
  readonly referenceSeq: number;
  readonly version: number;
  readonly supersedesId: Uuid | null;
  readonly snapshotSchema: SnapshotSchema;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly snapshotHash: string;
  readonly verificationCode: string;
  readonly issuedAt: Date;
  readonly issuedBy: Uuid;
  readonly issuedByName: string;
}

export async function insertDocument(tx: Tx, w: DocumentInsert): Promise<OfficialDocument> {
  const rows = await tx.many<DocumentRow>(
    `INSERT INTO higher.official_documents (id, tenant_id, document_kind, award_id, student_id, program_node_id, reference, reference_year, reference_seq, version,
        supersedes_id, status, snapshot_schema, snapshot, snapshot_hash, verification_code, issued_at, issued_by, issued_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ISSUED',$12,$13::jsonb,$14,$15,$16,$17,$18) RETURNING ${DOCUMENT_COLUMNS}`,
    [
      w.id, w.tenantId, w.documentKind, w.awardId, w.studentId, w.programNodeId, w.reference, w.referenceYear, w.referenceSeq, w.version, w.supersedesId,
      w.snapshotSchema, JSON.stringify(w.snapshot), w.snapshotHash, w.verificationCode, w.issuedAt.toISOString(), w.issuedBy, w.issuedByName,
    ],
  );
  return toDocument(rows[0] as DocumentRow);
}

export async function getDocument(tx: Tx, id: Uuid, forUpdate = false): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toDocument(r) : null;
}

export async function findIssuedForAward(tx: Tx, awardId: Uuid, kind: DocumentKind): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE award_id = $1 AND document_kind = $2 AND status = 'ISSUED'`,
    [awardId, kind],
  );
  return r ? toDocument(r) : null;
}

/** Dernière attestation d'authenticité d'un octroi, quel que soit son état (le numéro AUTH est attribué UNE fois par octroi). */
export async function findAuthenticityEver(tx: Tx, awardId: Uuid): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE award_id = $1 AND document_kind = 'ATTESTATION_AUTHENTICITY' ORDER BY issued_at DESC, id DESC LIMIT 1`,
    [awardId],
  );
  return r ? toDocument(r) : null;
}

export async function findIssuedAttestation(tx: Tx, studentId: Uuid, programNodeId: Uuid): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE student_id = $1 AND program_node_id = $2 AND document_kind = 'ATTESTATION_SUCCESS' AND status = 'ISSUED'`,
    [studentId, programNodeId],
  );
  return r ? toDocument(r) : null;
}

export async function listDocumentsOfAward(tx: Tx, awardId: Uuid): Promise<OfficialDocument[]> {
  const rows = await tx.many<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE award_id = $1 ORDER BY issued_at, id`, [awardId]);
  return rows.map(toDocument);
}

export async function listDocumentsOfStudent(tx: Tx, studentId: Uuid, publishedOnly: boolean): Promise<OfficialDocument[]> {
  const rows = await tx.many<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE student_id = $1 ${publishedOnly ? "AND published_at IS NOT NULL AND status IN ('ISSUED', 'SUPERSEDED', 'REVOKED')" : ""} ORDER BY issued_at DESC, id DESC`,
    [studentId],
  );
  return rows.map(toDocument);
}

export async function listDocuments(
  tx: Tx,
  f: { kind?: DocumentKind | undefined; status?: OfficialDocument["status"] | undefined; studentId?: Uuid | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: OfficialDocument[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.kind) { params.push(f.kind); where.push(`document_kind = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.studentId) { params.push(f.studentId); where.push(`student_id = $${params.length}`); }
  const cursor = decodeCursor<{ a: string; i: string }>(f.cursor);
  if (cursor) { params.push(cursor.a, cursor.i); where.push(`(issued_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE ${where.join(" AND ")} ORDER BY issued_at DESC, id DESC LIMIT $${params.length}`, params);
  const items = rows.slice(0, limit).map(toDocument);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ a: last.issuedAt.toISOString(), i: last.id }) : null };
}

/** Le duplicata qui a remplacé ce document (le plus récent), pour la vérification publique d'un document remplacé. */
export async function findSuperseding(tx: Tx, id: Uuid): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM higher.official_documents WHERE supersedes_id = $1 ORDER BY version DESC LIMIT 1`, [id]);
  return r ? toDocument(r) : null;
}

export async function markSuperseded(tx: Tx, id: Uuid): Promise<boolean> {
  const res = await tx.query(`UPDATE higher.official_documents SET status = 'SUPERSEDED' WHERE id = $1 AND status = 'ISSUED'`, [id]);
  return res.rowCount > 0;
}

export async function revokeDocument(tx: Tx, id: Uuid, reason: string, at: Date): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `UPDATE higher.official_documents SET status = 'REVOKED', revoked_at = $2, revoke_reason = $3 WHERE id = $1 AND status IN ('ISSUED', 'SUPERSEDED') RETURNING ${DOCUMENT_COLUMNS}`,
    [id, at.toISOString(), reason],
  );
  return r ? toDocument(r) : null;
}

export async function publishDocument(tx: Tx, id: Uuid, at: Date): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `UPDATE higher.official_documents SET published_at = COALESCE(published_at, $2) WHERE id = $1 AND status = 'ISSUED' RETURNING ${DOCUMENT_COLUMNS}`,
    [id, at.toISOString()],
  );
  return r ? toDocument(r) : null;
}

/** Scellement et rendu (écrits par reportcards via l'API publique) : renseignés une fois. */
export async function recordSeal(
  tx: Tx,
  id: Uuid,
  seal: { signingKeyId: string; signature: string; templateKey: string | null; templateVersion: number | null; configVersion: number | null },
): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `UPDATE higher.official_documents SET signing_key_id = $2, signature = $3, template_key = $4, template_version = $5, config_version = $6
      WHERE id = $1 AND signature IS NULL RETURNING ${DOCUMENT_COLUMNS}`,
    [id, seal.signingKeyId, seal.signature, seal.templateKey, seal.templateVersion, seal.configVersion],
  );
  return r ? toDocument(r) : null;
}

export async function recordRender(
  tx: Tx,
  id: Uuid,
  render: { status: OfficialDocument["renderStatus"]; objectKey?: string | null; pdfHash?: string | null },
): Promise<OfficialDocument | null> {
  const r = await tx.queryOne<DocumentRow>(
    `UPDATE higher.official_documents SET render_status = $2, object_key = COALESCE($3, object_key), pdf_hash = COALESCE($4, pdf_hash)
      WHERE id = $1 RETURNING ${DOCUMENT_COLUMNS}`,
    [id, render.status, render.objectKey ?? null, render.pdfHash ?? null],
  );
  return r ? toDocument(r) : null;
}

// --- emplacements -------------------------------------------------------------------------------------------------

export async function listSlots(tx: Tx): Promise<DocumentSlot[]> {
  const rows = await tx.many<SlotRow>(`SELECT ${SLOT_COLUMNS} FROM higher.official_document_slots ORDER BY slot_key, valid_from, id`);
  return rows.map(toSlot);
}

/** Affectations d'un emplacement qui recouvrent la plage `[from, to]` (`to` absent = sans fin). */
export async function listOverlappingSlots(tx: Tx, key: SlotKey, from: IsoDate, to: IsoDate | null): Promise<DocumentSlot[]> {
  const rows = await tx.many<SlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM higher.official_document_slots
      WHERE slot_key = $1 AND daterange(valid_from, valid_to, '[]') && daterange($2::date, $3::date, '[]') ORDER BY valid_from`,
    [key, from, to],
  );
  return rows.map(toSlot);
}

export async function insertSlot(
  tx: Tx,
  w: { id: Uuid; tenantId: Uuid; slotKey: SlotKey; signatoryId: Uuid; validFrom: IsoDate; validTo: IsoDate | null; createdBy: Uuid; createdAt: Date },
): Promise<DocumentSlot> {
  const rows = await tx.many<SlotRow>(
    `INSERT INTO higher.official_document_slots (id, tenant_id, slot_key, signatory_id, valid_from, valid_to, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SLOT_COLUMNS}`,
    [w.id, w.tenantId, w.slotKey, w.signatoryId, w.validFrom, w.validTo, w.createdBy, w.createdAt.toISOString()],
  );
  return toSlot(rows[0] as SlotRow);
}

export async function closeSlot(tx: Tx, id: Uuid, validTo: IsoDate): Promise<void> {
  await tx.query(`UPDATE higher.official_document_slots SET valid_to = $2 WHERE id = $1`, [id, validTo]);
}
