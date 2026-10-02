/**
 * Accès SQL au rapprochement : suivi des tentatives (`reconciliation_state`), liste « à rapprocher »,
 * résolutions manuelles à quatre yeux (`manual_resolutions`).
 *
 * Le suivi sert aussi de BAIL entre instances du worker : `claimDue*` pousse `next_attempt_at` dans le futur
 * (`FOR UPDATE SKIP LOCKED`), si bien que deux instances ne prennent jamais le même paiement. Un plantage laisse
 * le bail expirer : la tâche est reprise (le traitement d'un paiement est idempotent, sous verrou de ligne).
 */
import type { Tx } from "@ecoledigitale/database";
import type { ManualResolutionOutcome, ManualResolutionRecord, ManualResolutionStatus, PaymentRecord, ReconciliationRecord } from "../domain/records";
import type { Uuid } from "../domain/types";
import { PAYMENT_COLS, paymentOf } from "./payments-repository";

const STATE_COLS = `id, payment_id, refund_id, attempts, first_attempt_at, last_attempt_at, next_attempt_at, last_outcome,
  last_error_code, flagged_at, flag_reason, resolved_at`;

export const reconciliationOf = (r: any): ReconciliationRecord => ({
  id: r.id,
  paymentId: r.payment_id,
  refundId: r.refund_id,
  attempts: Number(r.attempts),
  firstAttemptAt: r.first_attempt_at,
  lastAttemptAt: r.last_attempt_at,
  nextAttemptAt: r.next_attempt_at,
  lastOutcome: r.last_outcome,
  lastErrorCode: r.last_error_code,
  flaggedAt: r.flagged_at,
  flagReason: r.flag_reason,
  resolvedAt: r.resolved_at,
});

export type ReconciliationSubject = { paymentId: Uuid } | { refundId: Uuid };

/**
 * Crée le suivi des paiements en ligne EN ATTENTE qui n'en ont pas encore (échéance = réception + délai minimal).
 * Idempotent (index unique partiel). Renvoie le nombre de suivis créés.
 */
export async function ensurePendingPaymentStates(
  tx: Tx,
  tenantId: string,
  newId: () => string,
  minAgeMs: number,
  limit: number,
): Promise<number> {
  const missing = await tx.many<{ id: string; received_at: Date }>(
    `SELECT p.id, p.received_at
       FROM finance.payments p
      WHERE p.status = 'PENDING' AND p.method = 'ONLINE' AND p.provider IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM finance.reconciliation_state s WHERE s.payment_id = p.id)
      ORDER BY p.received_at, p.id LIMIT $1`,
    [limit],
  );
  let created = 0;
  for (const row of missing) {
    const r = await tx.query(
      `INSERT INTO finance.reconciliation_state (id, tenant_id, payment_id, next_attempt_at)
       VALUES ($1, $2, $3, $4::timestamptz + ($5::text || ' milliseconds')::interval)
       ON CONFLICT (tenant_id, payment_id) WHERE payment_id IS NOT NULL DO NOTHING`,
      [newId(), tenantId, row.id, row.received_at, String(Math.max(0, Math.floor(minAgeMs)))],
    );
    created += r.rowCount ?? 0;
  }
  return created;
}

/** Idem pour les remboursements envoyés au fournisseur (échéance = envoi + délai minimal). */
export async function ensureInFlightRefundStates(
  tx: Tx,
  tenantId: string,
  newId: () => string,
  minAgeMs: number,
  limit: number,
): Promise<number> {
  const missing = await tx.many<{ id: string; provider_requested_at: Date }>(
    `SELECT r.id, r.provider_requested_at
       FROM finance.refunds r
      WHERE r.status = 'REFUND_PENDING'
        AND NOT EXISTS (SELECT 1 FROM finance.reconciliation_state s WHERE s.refund_id = r.id)
      ORDER BY r.provider_requested_at, r.id LIMIT $1`,
    [limit],
  );
  let created = 0;
  for (const row of missing) {
    const r = await tx.query(
      `INSERT INTO finance.reconciliation_state (id, tenant_id, refund_id, next_attempt_at)
       VALUES ($1, $2, $3, $4::timestamptz + ($5::text || ' milliseconds')::interval)
       ON CONFLICT (tenant_id, refund_id) WHERE refund_id IS NOT NULL DO NOTHING`,
      [newId(), tenantId, row.id, row.provider_requested_at, String(Math.max(0, Math.floor(minAgeMs)))],
    );
    created += r.rowCount ?? 0;
  }
  return created;
}

/** Prend à bail les paiements échus (en attente, non signalés) : `next_attempt_at` est repoussé de `leaseMs`. */
export async function claimDuePayments(tx: Tx, now: Date, leaseMs: number, limit: number): Promise<Array<{ state: ReconciliationRecord; paymentId: Uuid }>> {
  const rows = await tx.many(
    `UPDATE finance.reconciliation_state s
        SET next_attempt_at = $1::timestamptz + ($2::text || ' milliseconds')::interval, updated_at = now()
      WHERE s.id IN (
        SELECT s2.id
          FROM finance.reconciliation_state s2
          JOIN finance.payments p ON p.id = s2.payment_id
         WHERE s2.payment_id IS NOT NULL AND s2.resolved_at IS NULL AND s2.flagged_at IS NULL
           AND s2.next_attempt_at <= $1 AND p.status = 'PENDING'
         ORDER BY s2.next_attempt_at, s2.id
         LIMIT $3
         FOR UPDATE OF s2 SKIP LOCKED)
      RETURNING ${STATE_COLS}`,
    [now, String(Math.max(1, Math.floor(leaseMs))), limit],
  );
  return rows.map((r) => ({ state: reconciliationOf(r), paymentId: (r as any).payment_id as Uuid }));
}

export async function claimDueRefunds(tx: Tx, now: Date, leaseMs: number, limit: number): Promise<Array<{ state: ReconciliationRecord; refundId: Uuid }>> {
  const rows = await tx.many(
    `UPDATE finance.reconciliation_state s
        SET next_attempt_at = $1::timestamptz + ($2::text || ' milliseconds')::interval, updated_at = now()
      WHERE s.id IN (
        SELECT s2.id
          FROM finance.reconciliation_state s2
          JOIN finance.refunds r ON r.id = s2.refund_id
         WHERE s2.refund_id IS NOT NULL AND s2.resolved_at IS NULL AND s2.flagged_at IS NULL
           AND s2.next_attempt_at <= $1 AND r.status = 'REFUND_PENDING'
         ORDER BY s2.next_attempt_at, s2.id
         LIMIT $3
         FOR UPDATE OF s2 SKIP LOCKED)
      RETURNING ${STATE_COLS}`,
    [now, String(Math.max(1, Math.floor(leaseMs))), limit],
  );
  return rows.map((r) => ({ state: reconciliationOf(r), refundId: (r as any).refund_id as Uuid }));
}

export async function getReconciliationState(tx: Tx, subject: ReconciliationSubject, forUpdate = false): Promise<ReconciliationRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${STATE_COLS} FROM finance.reconciliation_state WHERE ${"paymentId" in subject ? "payment_id" : "refund_id"} = $1${forUpdate ? " FOR UPDATE" : ""}`,
    ["paymentId" in subject ? subject.paymentId : subject.refundId],
  );
  return row ? reconciliationOf(row) : null;
}

/** Garantit l'existence du suivi d'un sujet (appel manuel hors job : « Vérifier », signalement immédiat). */
export async function ensureState(tx: Tx, tenantId: string, subject: ReconciliationSubject, newId: () => string, nextAttemptAt: Date): Promise<ReconciliationRecord> {
  const isPayment = "paymentId" in subject;
  const subjectId = isPayment ? subject.paymentId : subject.refundId;
  await tx.query(
    isPayment
      ? `INSERT INTO finance.reconciliation_state (id, tenant_id, payment_id, next_attempt_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, payment_id) WHERE payment_id IS NOT NULL DO NOTHING`
      : `INSERT INTO finance.reconciliation_state (id, tenant_id, refund_id, next_attempt_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, refund_id) WHERE refund_id IS NOT NULL DO NOTHING`,
    [newId(), tenantId, subjectId, nextAttemptAt],
  );
  return (await getReconciliationState(tx, subject, true))!;
}

export interface AttemptResult {
  readonly at: Date;
  readonly outcome: string;
  readonly errorCode?: string | null;
  /** Prochaine échéance ; ignorée si `flag` est fourni. */
  readonly nextAttemptAt?: Date;
  /** Le job ne peut plus conclure : le suivi est signalé (`flagged_at`, motif) et ne sera plus repris. */
  readonly flag?: { reason: string };
}

/** Enregistre UNE tentative (compteur +1) et fixe la suite : prochaine échéance ou signalement. */
export async function recordAttempt(tx: Tx, stateId: Uuid, r: AttemptResult): Promise<ReconciliationRecord> {
  const row = await tx.queryOne(
    `UPDATE finance.reconciliation_state
        SET attempts = attempts + 1,
            first_attempt_at = COALESCE(first_attempt_at, $2),
            last_attempt_at = $2,
            last_outcome = $3,
            last_error_code = $4,
            next_attempt_at = COALESCE($5, next_attempt_at),
            flagged_at = CASE WHEN $6::text IS NOT NULL THEN COALESCE(flagged_at, $2) ELSE flagged_at END,
            flag_reason = CASE WHEN $6::text IS NOT NULL THEN COALESCE(flag_reason, $6) ELSE flag_reason END,
            updated_at = now()
      WHERE id = $1
      RETURNING ${STATE_COLS}`,
    [stateId, r.at, r.outcome.slice(0, 60), r.errorCode ? r.errorCode.slice(0, 80) : null, r.flag ? null : (r.nextAttemptAt ?? null), r.flag?.reason.slice(0, 120) ?? null],
  );
  return reconciliationOf(row);
}

/** Le sujet est conclu (confirmé, échoué, remboursé…) : le suivi est clos. */
export async function resolveState(tx: Tx, subject: ReconciliationSubject, at: Date, outcome: string): Promise<void> {
  await tx.query(
    `UPDATE finance.reconciliation_state
        SET resolved_at = COALESCE(resolved_at, $2), last_outcome = $3, updated_at = now()
      WHERE ${"paymentId" in subject ? "payment_id" : "refund_id"} = $1`,
    ["paymentId" in subject ? subject.paymentId : subject.refundId, at, outcome.slice(0, 60)],
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Liste « paiements à rapprocher »
// ---------------------------------------------------------------------------------------------------------------------

export interface PendingPaymentRow {
  readonly payment: PaymentRecord;
  readonly reconciliation: ReconciliationRecord | null;
  /** Demande de résolution manuelle ouverte (à approuver), s'il y en a une. */
  readonly openResolutionId: Uuid | null;
}

export interface PendingFilter {
  /** `true` : seulement les signalés ; `false` : seulement ceux que le job traite encore. */
  readonly flagged?: boolean;
  readonly provider?: string;
  /** Reçus avant cet instant (ancienneté minimale). */
  readonly olderThan?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listPendingPayments(tx: Tx, f: PendingFilter): Promise<{ items: PendingPaymentRow[]; total: number }> {
  const params = [f.flagged === undefined ? null : f.flagged, f.provider ?? null, f.olderThan ?? null];
  // Sous-requête : les colonnes de paiement gardent leurs noms (`paymentOf` les relit telles quelles).
  const base = `FROM (SELECT ${PAYMENT_COLS} FROM finance.payments
                        WHERE status = 'PENDING' AND method = 'ONLINE' AND ($2::text IS NULL OR provider = $2)
                          AND ($3::timestamptz IS NULL OR received_at <= $3)) p
       LEFT JOIN finance.reconciliation_state s ON s.payment_id = p.id
      WHERE ($1::boolean IS NULL OR (s.flagged_at IS NOT NULL) = $1)`;
  const rows = await tx.many(
    `SELECT p.*,
            s.id AS s_id, s.attempts AS s_attempts, s.first_attempt_at AS s_first, s.last_attempt_at AS s_last, s.next_attempt_at AS s_next,
            s.last_outcome AS s_outcome, s.last_error_code AS s_error, s.flagged_at AS s_flagged, s.flag_reason AS s_reason, s.resolved_at AS s_resolved,
            (SELECT m.id FROM finance.manual_resolutions m WHERE m.payment_id = p.id AND m.status = 'REQUESTED') AS open_resolution
       ${base}
      ORDER BY (s.flagged_at IS NOT NULL) DESC, p.received_at, p.id
      LIMIT $4 OFFSET $5`,
    [...params, f.limit, f.offset],
  );
  const count = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n ${base}`, params);
  return {
    items: rows.map((r: any) => ({
      payment: paymentOf(r),
      reconciliation: r.s_id
        ? {
            id: r.s_id,
            paymentId: r.id,
            refundId: null,
            attempts: Number(r.s_attempts),
            firstAttemptAt: r.s_first,
            lastAttemptAt: r.s_last,
            nextAttemptAt: r.s_next,
            lastOutcome: r.s_outcome,
            lastErrorCode: r.s_error,
            flaggedAt: r.s_flagged,
            flagReason: r.s_reason,
            resolvedAt: r.s_resolved,
          }
        : null,
      openResolutionId: r.open_resolution ?? null,
    })),
    total: Number(count?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Résolutions manuelles
// ---------------------------------------------------------------------------------------------------------------------

const RES_COLS = `id, payment_id, refund_id, outcome, reason, evidence_ref, status, requested_by, requested_at, decided_by, decided_at, decision_note`;

export const resolutionOf = (r: any): ManualResolutionRecord => ({
  id: r.id,
  paymentId: r.payment_id,
  refundId: r.refund_id,
  outcome: r.outcome as ManualResolutionOutcome,
  reason: r.reason,
  evidenceRef: r.evidence_ref,
  status: r.status as ManualResolutionStatus,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
});

/** Insère une demande ; `null` si une demande est déjà ouverte pour ce sujet (index unique partiel). */
export async function insertResolution(
  tx: Tx,
  tenantId: string,
  r: { id: Uuid; subject: ReconciliationSubject; outcome: ManualResolutionOutcome; reason: string; evidenceRef: string; requestedBy: Uuid; requestedAt: Date },
): Promise<ManualResolutionRecord | null> {
  const isPayment = "paymentId" in r.subject;
  const row = await tx.queryOne(
    `INSERT INTO finance.manual_resolutions (id, tenant_id, payment_id, refund_id, outcome, reason, evidence_ref, requested_by, requested_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING
     RETURNING ${RES_COLS}`,
    [r.id, tenantId, isPayment ? (r.subject as { paymentId: Uuid }).paymentId : null, isPayment ? null : (r.subject as { refundId: Uuid }).refundId, r.outcome, r.reason, r.evidenceRef, r.requestedBy, r.requestedAt],
  );
  return row ? resolutionOf(row) : null;
}

export async function getResolution(tx: Tx, id: Uuid, forUpdate = false): Promise<ManualResolutionRecord | null> {
  const row = await tx.queryOne(`SELECT ${RES_COLS} FROM finance.manual_resolutions WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? resolutionOf(row) : null;
}

export async function decideResolution(tx: Tx, id: Uuid, status: "APPROVED" | "REJECTED", by: Uuid, at: Date, note: string | null): Promise<void> {
  await tx.query(
    `UPDATE finance.manual_resolutions SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5, updated_at = now()
      WHERE id = $1 AND status = 'REQUESTED'`,
    [id, status, by, at, note],
  );
}

export async function listResolutions(
  tx: Tx,
  f: { status?: ManualResolutionStatus; paymentId?: Uuid; refundId?: Uuid; limit: number; offset: number },
): Promise<ManualResolutionRecord[]> {
  const rows = await tx.many(
    `SELECT ${RES_COLS} FROM finance.manual_resolutions
      WHERE ($1::text IS NULL OR status = $1) AND ($2::uuid IS NULL OR payment_id = $2) AND ($3::uuid IS NULL OR refund_id = $3)
      ORDER BY requested_at DESC, id DESC LIMIT $4 OFFSET $5`,
    [f.status ?? null, f.paymentId ?? null, f.refundId ?? null, f.limit, f.offset],
  );
  return rows.map(resolutionOf);
}
