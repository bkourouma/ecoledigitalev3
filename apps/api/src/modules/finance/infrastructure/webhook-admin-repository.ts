/**
 * Lecture et suivi administratif des événements webhook (écran « webhooks en échec »).
 *
 * La charge brute (`payload`) n'est JAMAIS lue ici : elle peut contenir des données du payeur (numéro de téléphone, nom)
 * et n'a aucune utilité pour décider d'un rejeu (le rejeu interroge le fournisseur, il ne rejoue pas la charge).
 */
import type { Tx } from "@ecoledigitale/database";
import type { WebhookEventRecord, WebhookEventStatus } from "../domain/records";
import type { Uuid } from "../domain/types";

const COLS = "id, provider, event_id, event_type, status, payment_id, error, attempts, received_at, processed_at";

const webhookOf = (r: any): WebhookEventRecord => ({
  id: r.id,
  provider: r.provider,
  eventId: r.event_id,
  eventType: r.event_type,
  status: r.status as WebhookEventStatus,
  paymentId: r.payment_id,
  error: r.error,
  attempts: r.attempts,
  receivedAt: r.received_at,
  processedAt: r.processed_at,
});

export async function getWebhookEventById(tx: Tx, id: Uuid, forUpdate = false): Promise<WebhookEventRecord | null> {
  const row = await tx.queryOne(`SELECT ${COLS} FROM finance.webhook_events WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? webhookOf(row) : null;
}

export async function listWebhookEvents(
  tx: Tx,
  filter: { status: WebhookEventStatus; provider?: string; paymentId?: Uuid; limit: number; offset: number },
): Promise<{ items: WebhookEventRecord[]; total: number }> {
  const where: string[] = ["status = $1"];
  const params: unknown[] = [filter.status];
  if (filter.provider) {
    params.push(filter.provider);
    where.push(`provider = $${params.length}`);
  }
  if (filter.paymentId) {
    params.push(filter.paymentId);
    where.push(`payment_id = $${params.length}`);
  }
  const clause = where.join(" AND ");
  const total = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM finance.webhook_events WHERE ${clause}`, params);
  const rows = await tx.many(
    `SELECT ${COLS} FROM finance.webhook_events WHERE ${clause} ORDER BY received_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filter.limit, filter.offset],
  );
  return { items: rows.map(webhookOf), total: Number(total?.n ?? 0) };
}

/** Un rejeu qui n'aboutit pas : tentative comptée, motif (code) mis à jour, l'événement reste `FAILED`. */
export async function recordWebhookReplayFailure(tx: Tx, id: Uuid, error: string): Promise<void> {
  await tx.query("UPDATE finance.webhook_events SET attempts = attempts + 1, error = $2 WHERE id = $1 AND status = 'FAILED'", [id, error]);
}
