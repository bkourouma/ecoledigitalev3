/** Registre de crédits, dettes d'UE et réglages (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { AcquiredVia, DecimalString, HigherSettings, IsoDate, LedgerEntry, UeDebt, Uuid } from "../domain/types";
import { DEBT_COLUMNS, LEDGER_COLUMNS, decodeCursor, encodeCursor, toDebt, toLedgerEntry, type DebtRow, type LedgerRow } from "./rows";

export interface LedgerInsert {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly ueNodeId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly credits: number;
  readonly averageExact: DecimalString | null;
  readonly acquiredVia: AcquiredVia;
  readonly sessionObtained: 1 | 2;
  readonly compensatedEcueCount: number;
  readonly overrideId: Uuid | null;
  readonly sourceResultId: Uuid;
  readonly sourceResultsVersion: number;
  readonly validUntil: IsoDate | null;
  readonly acquiredAt: Date;
}

/** Acquisition (ACQUIRED) d'un étudiant pour une UE, ou `null`. */
export async function findAcquired(tx: Tx, studentId: Uuid, ueNodeId: Uuid, forUpdate = false): Promise<LedgerEntry | null> {
  const r = await tx.queryOne<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger WHERE student_id = $1 AND ue_node_id = $2 AND status = 'ACQUIRED' ${forUpdate ? "FOR UPDATE" : ""}`,
    [studentId, ueNodeId],
  );
  return r ? toLedgerEntry(r) : null;
}

/**
 * Insère une acquisition ; `null` si elle existe déjà (unicité partielle `(étudiant, UE) WHERE ACQUIRED`) — l'insertion
 * est idempotente : rejouer un événement n'ajoute rien (AC1.2).
 */
export async function insertAcquisition(tx: Tx, w: LedgerInsert): Promise<LedgerEntry | null> {
  const rows = await tx.many<LedgerRow>(
    `INSERT INTO higher.credit_ledger (id, tenant_id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits, average_exact,
        acquired_via, session_obtained, status, compensated_ecue_count, override_id, source_result_id, source_results_version, valid_until, acquired_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACQUIRED',$12,$13,$14,$15,$16,$17)
     ON CONFLICT (tenant_id, student_id, ue_node_id) WHERE status = 'ACQUIRED' DO NOTHING
     RETURNING ${LEDGER_COLUMNS}`,
    [
      w.id, w.tenantId, w.studentId, w.enrollmentId, w.ueNodeId, w.academicYearId, w.academicPeriodId, w.credits, w.averageExact, w.acquiredVia,
      w.sessionObtained, w.compensatedEcueCount, w.overrideId, w.sourceResultId, w.sourceResultsVersion, w.validUntil, w.acquiredAt.toISOString(),
    ],
  );
  return rows[0] ? toLedgerEntry(rows[0]) : null;
}

export async function getLedgerEntry(tx: Tx, id: Uuid): Promise<LedgerEntry | null> {
  const r = await tx.queryOne<LedgerRow>(`SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger WHERE id = $1`, [id]);
  return r ? toLedgerEntry(r) : null;
}

/** Écritures ACQUIRED d'un étudiant (valables ou non : le filtre de validité se fait avec `isCurrentlyValid`). */
export async function listAcquiredForStudent(tx: Tx, studentId: Uuid): Promise<LedgerEntry[]> {
  const rows = await tx.many<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger WHERE student_id = $1 AND status = 'ACQUIRED' ORDER BY acquired_at, id`,
    [studentId],
  );
  return rows.map(toLedgerEntry);
}

/** Écritures ACQUIRED d'un étudiant restreintes à des UE. */
export async function listAcquiredForUes(tx: Tx, studentId: Uuid, ueNodeIds: readonly Uuid[]): Promise<LedgerEntry[]> {
  if (ueNodeIds.length === 0) return [];
  const rows = await tx.many<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger WHERE student_id = $1 AND status = 'ACQUIRED' AND ue_node_id = ANY($2::uuid[]) ORDER BY acquired_at, id`,
    [studentId, ueNodeIds],
  );
  return rows.map(toLedgerEntry);
}

/** Historique complet d'un étudiant (toutes statuts). */
export async function listLedgerForStudent(
  tx: Tx,
  studentId: Uuid,
  f: { status?: LedgerEntry["status"] | undefined; limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
  const params: unknown[] = [studentId];
  const where = ["student_id = $1"];
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  const cursor = decodeCursor<{ a: string; i: string }>(f.cursor);
  if (cursor) { params.push(cursor.a, cursor.i); where.push(`(acquired_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  params.push(limit + 1);
  const rows = await tx.many<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger WHERE ${where.join(" AND ")} ORDER BY acquired_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(toLedgerEntry);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ a: last.acquiredAt.toISOString(), i: last.id }) : null };
}

/** Écritures ACQUIRED nées de la clôture d'une période (candidates à la révocation lors d'une reclôture). */
export async function listAcquiredFromPeriod(tx: Tx, academicPeriodId: Uuid, enrollmentIds: readonly Uuid[]): Promise<LedgerEntry[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.many<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger
      WHERE academic_period_id = $1 AND enrollment_id = ANY($2::uuid[]) AND status = 'ACQUIRED' AND acquired_via IN ('DIRECT', 'RESIT', 'JURY_OVERRIDE')`,
    [academicPeriodId, enrollmentIds],
  );
  return rows.map(toLedgerEntry);
}

/** Octrois non révoqués qui s'appuient sur une écriture (identifiants). */
export async function listAwardsUsingLedger(tx: Tx, studentId: Uuid, ledgerId: Uuid): Promise<Uuid[]> {
  const rows = await tx.many<{ id: Uuid }>(
    `SELECT id FROM higher.diploma_awards
      WHERE student_id = $1 AND status = 'OBTAINED'
        AND requirements_snapshot -> 'requirements' @> jsonb_build_array(jsonb_build_object('ledgerId', $2::text))`,
    [studentId, ledgerId],
  );
  return rows.map((r) => r.id);
}

export async function markRevoked(tx: Tx, id: Uuid, at: Date, reason: string, supersededByVersion: number | null): Promise<boolean> {
  const res = await tx.query(
    `UPDATE higher.credit_ledger SET status = 'REVOKED', revoked_at = $2, revoke_reason = $3, superseded_by_version = $4
      WHERE id = $1 AND status = 'ACQUIRED'`,
    [id, at.toISOString(), reason, supersededByVersion],
  );
  return res.rowCount > 0;
}

export async function markExpired(tx: Tx, id: Uuid, at: Date): Promise<boolean> {
  const res = await tx.query(`UPDATE higher.credit_ledger SET status = 'EXPIRED', expired_at = $2 WHERE id = $1 AND status = 'ACQUIRED'`, [id, at.toISOString()]);
  return res.rowCount > 0;
}

/** Écritures ACQUIRED dont la validité est dépassée (balayage des expirations). */
export async function listDue(tx: Tx, today: IsoDate, limit: number): Promise<LedgerEntry[]> {
  const rows = await tx.many<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM higher.credit_ledger l
      WHERE status = 'ACQUIRED' AND valid_until IS NOT NULL AND valid_until < $1::date
        AND NOT EXISTS (
          SELECT 1 FROM higher.diploma_awards a
           WHERE a.student_id = l.student_id AND a.status = 'OBTAINED'
             AND a.requirements_snapshot -> 'requirements' @> jsonb_build_array(jsonb_build_object('ledgerId', l.id::text)))
      ORDER BY valid_until, id LIMIT $2`,
    [today, limit],
  );
  return rows.map(toLedgerEntry);
}

// --- dettes -------------------------------------------------------------------------------------------------------

/** Ouvre une dette ; `false` si une dette ouverte existe déjà pour (étudiant, UE). */
export async function openDebt(
  tx: Tx,
  w: { id: Uuid; tenantId: Uuid; studentId: Uuid; enrollmentId: Uuid; ueNodeId: Uuid; academicYearId: Uuid; academicPeriodId: Uuid; sourceResultId: Uuid | null; detectedAt: Date },
): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO higher.ue_debts (id, tenant_id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, source_result_id, status, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9)
     ON CONFLICT (tenant_id, student_id, ue_node_id) WHERE status = 'OPEN' DO NOTHING`,
    [w.id, w.tenantId, w.studentId, w.enrollmentId, w.ueNodeId, w.academicYearId, w.academicPeriodId, w.sourceResultId, w.detectedAt.toISOString()],
  );
  return res.rowCount > 0;
}

export async function clearDebts(tx: Tx, studentId: Uuid, ueNodeId: Uuid, at: Date, ledgerId: Uuid): Promise<number> {
  const res = await tx.query(
    `UPDATE higher.ue_debts SET status = 'CLEARED', cleared_at = $3, cleared_ledger_id = $4 WHERE student_id = $1 AND ue_node_id = $2 AND status = 'OPEN'`,
    [studentId, ueNodeId, at.toISOString(), ledgerId],
  );
  return res.rowCount;
}

export async function listOpenDebts(tx: Tx, studentId: Uuid): Promise<UeDebt[]> {
  const rows = await tx.many<DebtRow>(`SELECT ${DEBT_COLUMNS} FROM higher.ue_debts WHERE student_id = $1 AND status = 'OPEN' ORDER BY detected_at, id`, [studentId]);
  return rows.map(toDebt);
}

// --- réglages -----------------------------------------------------------------------------------------------------

export async function getSettings(tx: Tx): Promise<HigherSettings> {
  const r = await tx.queryOne<{ credit_validity_months: number | null }>(`SELECT credit_validity_months FROM higher.settings`);
  return { creditValidityMonths: r?.credit_validity_months ?? null };
}

export async function upsertSettings(tx: Tx, tenantId: Uuid, s: HigherSettings, userId: Uuid | null, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO higher.settings (tenant_id, credit_validity_months, updated_by, updated_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET credit_validity_months = EXCLUDED.credit_validity_months, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, s.creditValidityMonths, userId, at.toISOString()],
  );
}
