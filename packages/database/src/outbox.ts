/**
 * Implémentation Postgres du port `OutboxWriter` (kernel).
 *
 * Écrit dans la transaction du `Tx` fourni : les événements suivent le sort de
 * la donnée métier. La RLS (`WITH CHECK`) refuse un événement dont le
 * `tenantId` n'est pas celui de la transaction.
 */
import type { DomainEvent, OutboxWriter } from "@ecoledigitale/kernel";
import type { Tx } from "./types";

const COLUMNS = [
  "id",
  "tenant_id",
  "type",
  "version",
  "aggregate_type",
  "aggregate_id",
  "actor_id",
  "request_id",
  "payload",
  "occurred_at",
] as const;

/** Postgres limite à 65 535 paramètres par requête. */
const MAX_EVENTS_PER_INSERT = Math.floor(60_000 / COLUMNS.length);

export class PgOutboxWriter implements OutboxWriter {
  constructor(private readonly tx: Tx) {}

  async append(events: readonly DomainEvent[]): Promise<void> {
    for (let start = 0; start < events.length; start += MAX_EVENTS_PER_INSERT) {
      const chunk = events.slice(start, start + MAX_EVENTS_PER_INSERT);
      const params: unknown[] = [];
      const rows = chunk.map((e, i) => {
        params.push(
          e.id,
          e.tenantId,
          e.type,
          e.version,
          e.aggregateType ?? null,
          e.aggregateId ?? null,
          e.actorId ?? null,
          e.requestId ?? null,
          JSON.stringify(e.payload ?? {}),
          e.occurredAt,
        );
        const o = i * COLUMNS.length;
        return `(${COLUMNS.map((_, k) => (COLUMNS[k] === "payload" ? `$${o + k + 1}::jsonb` : `$${o + k + 1}`)).join(", ")})`;
      });
      await this.tx.query(
        `INSERT INTO kernel.domain_events (${COLUMNS.join(", ")}) VALUES ${rows.join(", ")}`,
        params,
      );
    }
  }
}

export interface PendingEvent {
  id: string;
  tenant_id: string;
  type: string;
  version: number;
  aggregate_type: string | null;
  aggregate_id: string | null;
  actor_id: string | null;
  request_id: string | null;
  payload: unknown;
  occurred_at: Date;
  attempts: number;
}

/**
 * Réserve (FOR UPDATE SKIP LOCKED) les événements non publiés du tenant de la
 * transaction courante. À appeler dans `SystemDb.forEachTenant` / `runForTenant`.
 */
export function fetchPendingEvents(tx: Tx, limit = 100): Promise<PendingEvent[]> {
  const n = Math.max(1, Math.min(Math.trunc(limit), 1000));
  return tx.many<PendingEvent>(
    `SELECT id, tenant_id, type, version, aggregate_type, aggregate_id, actor_id,
            request_id, payload, occurred_at, attempts
       FROM kernel.domain_events
      WHERE published_at IS NULL AND available_at <= now()
      ORDER BY id
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [n],
  );
}

export async function markEventsPublished(tx: Tx, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await tx.query(
    "UPDATE kernel.domain_events SET published_at = now() WHERE id = ANY($1::uuid[]) AND published_at IS NULL",
    [ids],
  );
  return res.rowCount;
}

export async function markEventFailed(tx: Tx, id: string, error: string, retryInMs: number): Promise<void> {
  await tx.query(
    `UPDATE kernel.domain_events
        SET attempts = attempts + 1,
            last_error = left($2, 2000),
            available_at = now() + ($3::double precision * interval '1 millisecond')
      WHERE id = $1`,
    [id, error, Math.max(0, retryInMs)],
  );
}
