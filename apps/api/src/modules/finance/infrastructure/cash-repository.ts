/**
 * Accès SQL aux caisses et à leurs sessions.
 */
import type { CurrencyCode } from "@ecoledigitale/kernel";
import { Money } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CashRegisterRecord, CashSessionRecord } from "../domain/records";
import type { Uuid } from "../domain/types";
import { money, moneyOrNull } from "./rows";

const registerOf = (r: any): CashRegisterRecord => ({
  id: r.id,
  code: r.code,
  name: r.name,
  campusId: r.campus_id,
  active: r.active,
});

export async function insertCashRegister(
  tx: Tx,
  tenantId: string,
  r: { id: Uuid; code: string; name: string; campusId: Uuid | null },
): Promise<CashRegisterRecord> {
  const row = await tx.queryOne(
    "INSERT INTO finance.cash_registers (id, tenant_id, code, name, campus_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, campus_id, active",
    [r.id, tenantId, r.code, r.name, r.campusId],
  );
  return registerOf(row);
}

export async function getCashRegister(tx: Tx, id: Uuid): Promise<CashRegisterRecord | null> {
  const row = await tx.queryOne("SELECT id, code, name, campus_id, active FROM finance.cash_registers WHERE id = $1", [id]);
  return row ? registerOf(row) : null;
}

export async function listCashRegisters(tx: Tx): Promise<CashRegisterRecord[]> {
  const rows = await tx.many("SELECT id, code, name, campus_id, active FROM finance.cash_registers ORDER BY code");
  return rows.map(registerOf);
}

const SESSION_COLS = `id, register_id, cashier_id, status, currency, opening_float::text AS opening_float, opened_at, closed_at,
  expected_amount::text AS expected_amount, counted_amount::text AS counted_amount, variance_amount::text AS variance_amount, close_note`;

const sessionOf = (r: any): CashSessionRecord => ({
  id: r.id,
  registerId: r.register_id,
  cashierId: r.cashier_id,
  status: r.status,
  openingFloat: money(r.opening_float, r.currency),
  openedAt: r.opened_at,
  closedAt: r.closed_at,
  expected: moneyOrNull(r.expected_amount, r.currency),
  counted: moneyOrNull(r.counted_amount, r.currency),
  variance: moneyOrNull(r.variance_amount, r.currency),
  closeNote: r.close_note,
});

export async function insertCashSession(
  tx: Tx,
  tenantId: string,
  s: { id: Uuid; registerId: Uuid; cashierId: Uuid; openingFloat: Money; openedAt: Date },
): Promise<CashSessionRecord> {
  const row = await tx.queryOne(
    `INSERT INTO finance.cash_sessions (id, tenant_id, register_id, cashier_id, currency, opening_float, opened_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${SESSION_COLS}`,
    [s.id, tenantId, s.registerId, s.cashierId, s.openingFloat.currency, s.openingFloat.amount, s.openedAt],
  );
  return sessionOf(row);
}

export async function getCashSession(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<CashSessionRecord | null> {
  const row = await tx.queryOne(`SELECT ${SESSION_COLS} FROM finance.cash_sessions WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? sessionOf(row) : null;
}

/**
 * Session ouverte du caissier. `FOR SHARE` : un encaissement en cours empêche la
 * clôture simultanée de la session (la clôture prend `FOR UPDATE` et attend), donc le
 * montant attendu calculé à la clôture inclut tous les encaissements validés.
 */
export async function getOpenSessionForCashier(
  tx: Tx,
  cashierId: Uuid,
  lock: "share" | "none" = "none",
): Promise<CashSessionRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${SESSION_COLS} FROM finance.cash_sessions WHERE cashier_id = $1 AND status = 'OPEN'${lock === "share" ? " FOR SHARE" : ""}`,
    [cashierId],
  );
  return row ? sessionOf(row) : null;
}

export async function listCashSessions(
  tx: Tx,
  f: { registerId?: Uuid; cashierId?: Uuid; status?: "OPEN" | "CLOSED"; limit: number; offset: number },
): Promise<CashSessionRecord[]> {
  const rows = await tx.many(
    `SELECT ${SESSION_COLS} FROM finance.cash_sessions
      WHERE ($1::uuid IS NULL OR register_id = $1) AND ($2::uuid IS NULL OR cashier_id = $2) AND ($3::text IS NULL OR status = $3)
      ORDER BY opened_at DESC, id DESC LIMIT $4 OFFSET $5`,
    [f.registerId ?? null, f.cashierId ?? null, f.status ?? null, f.limit, f.offset],
  );
  return rows.map(sessionOf);
}

/** Espèces encaissées (paiements CASH confirmés ou remboursés) et remboursées (sorties) sur une session. */
export async function sessionCashMovements(
  tx: Tx,
  sessionId: Uuid,
  currency: CurrencyCode,
): Promise<{ received: Money; refunded: Money; paymentCount: number; refundCount: number }> {
  const inRow = await tx.queryOne<{ s: string; n: string }>(
    `SELECT COALESCE(sum(amount), 0)::text AS s, count(*)::text AS n FROM finance.payments
      WHERE cash_session_id = $1 AND method = 'CASH' AND status IN ('CONFIRMED','REFUNDED')`,
    [sessionId],
  );
  const outRow = await tx.queryOne<{ s: string; n: string }>(
    `SELECT COALESCE(sum(amount), 0)::text AS s, count(*)::text AS n FROM finance.refunds
      WHERE cash_session_id = $1 AND status = 'COMPLETED'`,
    [sessionId],
  );
  return {
    received: money(inRow!.s, currency),
    refunded: money(outRow!.s, currency),
    paymentCount: Number(inRow!.n),
    refundCount: Number(outRow!.n),
  };
}

export async function closeCashSessionRow(
  tx: Tx,
  id: Uuid,
  close: { closedAt: Date; expected: Money; counted: Money; variance: Money; note: string | null },
): Promise<CashSessionRecord> {
  const row = await tx.queryOne(
    `UPDATE finance.cash_sessions
        SET status = 'CLOSED', closed_at = $2, expected_amount = $3, counted_amount = $4, variance_amount = $5,
            close_note = $6, updated_at = now()
      WHERE id = $1 AND status = 'OPEN' RETURNING ${SESSION_COLS}`,
    [id, close.closedAt, close.expected.amount, close.counted.amount, close.variance.amount, close.note],
  );
  if (!row) throw new Error("closeCashSessionRow : la session n'est pas ouverte.");
  return sessionOf(row);
}
