/**
 * Journal idempotent des webhooks fournisseurs.
 *
 * Clé unique (tenant, fournisseur, event_id) : un même événement reçu deux fois (rejeu du
 * fournisseur, relance réseau) n'est traité qu'une fois. Deux livraisons CONCURRENTES du
 * même événement se sérialisent sur l'index unique : la seconde attend la fin de la
 * première transaction, voit le conflit, et relit le résultat.
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

/** Enregistre l'événement ; `null` s'il existait déjà (rejeu). */
export async function insertWebhookEvent(
  tx: Tx,
  tenantId: string,
  e: { id: Uuid; provider: string; eventId: string; eventType: string | null; payload: unknown; receivedAt: Date },
): Promise<WebhookEventRecord | null> {
  const row = await tx.queryOne(
    `INSERT INTO finance.webhook_events (id, tenant_id, provider, event_id, event_type, payload, received_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (tenant_id, provider, event_id) DO NOTHING
     RETURNING ${COLS}`,
    [e.id, tenantId, e.provider, e.eventId, e.eventType, JSON.stringify(e.payload ?? {}), e.receivedAt],
  );
  return row ? webhookOf(row) : null;
}

export async function getWebhookEvent(tx: Tx, provider: string, eventId: string, forUpdate = false): Promise<WebhookEventRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${COLS} FROM finance.webhook_events WHERE provider = $1 AND event_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
    [provider, eventId],
  );
  return row ? webhookOf(row) : null;
}

export async function markWebhookProcessed(
  tx: Tx,
  id: Uuid,
  result: { status: Exclude<WebhookEventStatus, "RECEIVED">; paymentId: Uuid | null; error: string | null; at: Date },
): Promise<void> {
  await tx.query(
    "UPDATE finance.webhook_events SET status = $2, payment_id = $3, error = $4, processed_at = $5 WHERE id = $1",
    [id, result.status, result.paymentId, result.error, result.at],
  );
}

export async function bumpWebhookAttempts(tx: Tx, id: Uuid): Promise<void> {
  await tx.query("UPDATE finance.webhook_events SET attempts = attempts + 1 WHERE id = $1", [id]);
}
