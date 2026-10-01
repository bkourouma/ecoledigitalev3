/** Requêtes SQL des lots de génération (`batches`, `batch_items`). */
import type { Tx } from "@ecoledigitale/database";
import type { BatchItemRecord, BatchRecord, BatchStatus, DocumentKind, Uuid } from "../domain/types";
import { BATCH_COLUMNS, toBatch, toBatchItem } from "./rows";

export interface NewBatch {
  id: Uuid;
  tenantId: Uuid;
  documentKind: DocumentKind;
  classroomId: Uuid;
  academicPeriodId: Uuid | null;
  resultsStateId: Uuid;
  resultsVersion: number;
  idempotencyKey: string;
  provisional: boolean;
  total: number;
  requestedBy: Uuid | null;
  requestedAt: Date;
}

export async function findBatchByKey(tx: Tx, idempotencyKey: string): Promise<BatchRecord | null> {
  const row = await tx.queryOne(`SELECT ${BATCH_COLUMNS} FROM reportcards.batches WHERE idempotency_key = $1`, [idempotencyKey]);
  return row ? toBatch(row) : null;
}

export async function getBatch(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<BatchRecord | null> {
  const row = await tx.queryOne(`SELECT ${BATCH_COLUMNS} FROM reportcards.batches WHERE id = $1 ${options.forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return row ? toBatch(row) : null;
}

export async function insertBatch(tx: Tx, b: NewBatch): Promise<BatchRecord> {
  const rows = await tx.many(
    `INSERT INTO reportcards.batches
       (id, tenant_id, document_kind, classroom_id, academic_period_id, results_state_id, results_version, idempotency_key, provisional, status, total, requested_by, requested_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SNAPSHOTTING',$10,$11,$12)
     RETURNING ${BATCH_COLUMNS}`,
    [b.id, b.tenantId, b.documentKind, b.classroomId, b.academicPeriodId, b.resultsStateId, b.resultsVersion, b.idempotencyKey, b.provisional, b.total, b.requestedBy, b.requestedAt],
  );
  return toBatch(rows[0]!);
}

/** Résultat d'une inscription dans le lot ; une REPRISE du lot remplace l'issue précédente (échec -> émis, exclu -> émis…). */
export async function upsertBatchItem(
  tx: Tx,
  item: { id: Uuid; tenantId: Uuid; batchId: Uuid; enrollmentId: Uuid; reportCardId: Uuid | null; outcome: "ISSUED" | "EXCLUDED" | "FAILED"; reasonCode: string | null; message: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO reportcards.batch_items (id, tenant_id, batch_id, enrollment_id, report_card_id, outcome, reason_code, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (batch_id, enrollment_id) DO UPDATE
        SET report_card_id = EXCLUDED.report_card_id, outcome = EXCLUDED.outcome, reason_code = EXCLUDED.reason_code, message = EXCLUDED.message`,
    [item.id, item.tenantId, item.batchId, item.enrollmentId, item.reportCardId, item.outcome, item.reasonCode, item.message],
  );
}

export async function countBatchItems(tx: Tx, batchId: Uuid): Promise<{ issued: number; excluded: number; failed: number }> {
  const row = await tx.queryOne<{ issued: string; excluded: string; failed: string }>(
    `SELECT count(*) FILTER (WHERE outcome = 'ISSUED')::text AS issued,
            count(*) FILTER (WHERE outcome = 'EXCLUDED')::text AS excluded,
            count(*) FILTER (WHERE outcome = 'FAILED')::text AS failed
       FROM reportcards.batch_items WHERE batch_id = $1`,
    [batchId],
  );
  return { issued: Number(row?.issued ?? 0), excluded: Number(row?.excluded ?? 0), failed: Number(row?.failed ?? 0) };
}

export async function listBatchItems(tx: Tx, batchId: Uuid): Promise<BatchItemRecord[]> {
  const rows = await tx.many(
    `SELECT id, batch_id, enrollment_id, report_card_id, outcome, reason_code, message FROM reportcards.batch_items WHERE batch_id = $1 ORDER BY outcome, enrollment_id`,
    [batchId],
  );
  return rows.map(toBatchItem);
}

export async function setBatchCounts(tx: Tx, id: Uuid, counts: { issued: number; excluded: number; failed: number; total?: number; status: BatchStatus; finishedAt?: Date | null }): Promise<BatchRecord> {
  const rows = await tx.many(
    `UPDATE reportcards.batches SET issued = $2, excluded = $3, failed = $4, status = $5, total = coalesce($6, total), finished_at = CASE WHEN $5 = 'RENDERING' THEN NULL ELSE coalesce($7, finished_at) END
      WHERE id = $1 RETURNING ${BATCH_COLUMNS}`,
    [id, counts.issued, counts.excluded, counts.failed, counts.status, counts.total ?? null, counts.finishedAt ?? null],
  );
  return toBatch(rows[0]!);
}

/** Recompte les rendus du lot et déduit son état : tout rendu terminé (RENDERED ou FAILED) ⇒ lot terminé. */
export async function refreshBatchProgress(tx: Tx, batchId: Uuid, now: Date): Promise<{ batch: BatchRecord; justCompleted: boolean; failedRenders: number }> {
  const batch = await getBatch(tx, batchId, { forUpdate: true });
  if (!batch) throw new Error("batch introuvable");
  const counts = await tx.queryOne<{ rendered: string; failed: string; pending: string }>(
    `SELECT count(*) FILTER (WHERE render_status = 'RENDERED')::text AS rendered,
            count(*) FILTER (WHERE render_status = 'FAILED')::text AS failed,
            count(*) FILTER (WHERE render_status IN ('PENDING','RENDERING'))::text AS pending
       FROM reportcards.report_cards WHERE batch_id = $1`,
    [batchId],
  );
  const rendered = Number(counts?.rendered ?? 0);
  const failedRenders = Number(counts?.failed ?? 0);
  const pending = Number(counts?.pending ?? 0);
  const done = pending === 0 && batch.status !== "CANCELLED";
  const status: BatchStatus = batch.status === "CANCELLED" ? "CANCELLED" : done ? (failedRenders > 0 || batch.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED") : "RENDERING";
  const justCompleted = done && batch.status !== "COMPLETED" && batch.status !== "COMPLETED_WITH_ERRORS";
  const rows = await tx.many(
    `UPDATE reportcards.batches SET rendered = $2, status = $3, finished_at = CASE WHEN $4::boolean THEN coalesce(finished_at, $5) ELSE finished_at END
      WHERE id = $1 RETURNING ${BATCH_COLUMNS}`,
    [batchId, rendered, status, done, now],
  );
  return { batch: toBatch(rows[0]!), justCompleted, failedRenders };
}

export async function setBatchCombinedPdf(tx: Tx, id: Uuid, key: string): Promise<void> {
  await tx.query(`UPDATE reportcards.batches SET combined_pdf_key = $2 WHERE id = $1`, [id, key]);
}
