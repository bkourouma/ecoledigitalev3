/**
 * SQL des abonnements Web Push (un par appareil) et du registre des relances d'impayés.
 */
import type { Tx } from "@ecoledigitale/database";

export interface PushRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const COLS = `id, user_id AS "userId", endpoint, p256dh, auth, device_label AS "deviceLabel", created_at AS "createdAt", last_used_at AS "lastUsedAt"`;

/** Enregistre un appareil : le même point d'accès réabonné met à jour ses clés (et change éventuellement de titulaire). */
export async function upsertSubscription(
  tx: Tx,
  tenantId: string,
  input: { id: string; userId: string; endpoint: string; p256dh: string; auth: string; deviceLabel: string | null; userAgent: string | null; at: Date },
): Promise<string> {
  const row = await tx.queryOne<{ id: string }>(
    `INSERT INTO notifications.push_subscriptions (id, tenant_id, user_id, endpoint, p256dh, auth, device_label, user_agent, created_at, failure_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)
     ON CONFLICT (tenant_id, endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        device_label = COALESCE(EXCLUDED.device_label, notifications.push_subscriptions.device_label), user_agent = EXCLUDED.user_agent, failure_count = 0
     RETURNING id`,
    [input.id, tenantId, input.userId, input.endpoint, input.p256dh, input.auth, input.deviceLabel, input.userAgent, input.at],
  );
  return row!.id;
}

export async function listForUser(tx: Tx, tenantId: string, userId: string): Promise<PushRow[]> {
  return tx.many<PushRow>(`SELECT ${COLS} FROM notifications.push_subscriptions WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at`, [tenantId, userId]);
}

export async function countForUsers(tx: Tx, tenantId: string, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx.many<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM notifications.push_subscriptions WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])`, [tenantId, [...userIds]]);
  return new Set(rows.map((r) => r.userId));
}

export async function removeByEndpoint(tx: Tx, tenantId: string, userId: string, endpoint: string): Promise<boolean> {
  const r = await tx.query(`DELETE FROM notifications.push_subscriptions WHERE tenant_id = $1 AND user_id = $2 AND endpoint = $3`, [tenantId, userId, endpoint]);
  return (r.rowCount ?? 0) > 0;
}

export async function removeById(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.query(`DELETE FROM notifications.push_subscriptions WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

export async function touch(tx: Tx, tenantId: string, id: string, at: Date): Promise<void> {
  await tx.query(`UPDATE notifications.push_subscriptions SET last_used_at = $3, failure_count = 0 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, at]);
}

export async function recordFailure(tx: Tx, tenantId: string, id: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(`UPDATE notifications.push_subscriptions SET failure_count = failure_count + 1 WHERE tenant_id = $1 AND id = $2 RETURNING failure_count AS n`, [tenantId, id]);
  return r?.n ?? 0;
}

/** Abonnements en échec répété ou jamais utilisés depuis longtemps : nettoyage. */
export async function purgeStale(tx: Tx, tenantId: string, input: { maxFailures: number; unusedBefore: Date }): Promise<number> {
  const r = await tx.query(
    `DELETE FROM notifications.push_subscriptions
      WHERE tenant_id = $1 AND (failure_count >= $2 OR COALESCE(last_used_at, created_at) < $3)`,
    [tenantId, input.maxFailures, input.unusedBefore],
  );
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Registre des paliers de relance
// ---------------------------------------------------------------------------

export async function recordedStages(tx: Tx, tenantId: string, installmentIds: readonly string[]): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  if (installmentIds.length === 0) return out;
  const rows = await tx.many<{ installmentId: string; stage: number }>(
    `SELECT installment_id AS "installmentId", stage_days AS stage FROM notifications.dunning_steps WHERE tenant_id = $1 AND installment_id = ANY($2::uuid[])`,
    [tenantId, [...installmentIds]],
  );
  for (const r of rows) {
    const set = out.get(r.installmentId) ?? new Set<number>();
    set.add(r.stage);
    out.set(r.installmentId, set);
  }
  return out;
}

/** Consigne un palier. Retourne `true` si le palier est NOUVEAU (clé primaire : jamais deux fois le même). */
export async function recordStage(
  tx: Tx,
  tenantId: string,
  input: { installmentId: string; stage: number; invoiceId: string; learnerId: string; dueDate: string; notified: boolean; at: Date },
): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO notifications.dunning_steps (tenant_id, installment_id, stage_days, invoice_id, learner_id, due_date, notified, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8) ON CONFLICT (tenant_id, installment_id, stage_days) DO NOTHING`,
    [tenantId, input.installmentId, input.stage, input.invoiceId, input.learnerId, input.dueDate, input.notified, input.at],
  );
  return (r.rowCount ?? 0) > 0;
}
