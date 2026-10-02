/**
 * Implémentation Postgres du port `OutboxWriter` (kernel).
 *
 * Écrit dans la transaction du `Tx` fourni : les événements suivent le sort de
 * la donnée métier. La RLS (`WITH CHECK`) refuse un événement dont le
 * `tenantId` n'est pas celui de la transaction.
 *
 * Contexte de trace (ADR-009) : quand un fournisseur de `traceparent` est enregistré (traçage actif) ou que l'événement en
 * porte un, la colonne `kernel.domain_events.traceparent` (migration worker 0604) est écrite. Sans traçage actif, le SQL
 * d'insertion est EXACTEMENT celui d'avant : une base sans la migration 0604 continue de fonctionner.
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
const MAX_EVENTS_PER_INSERT = Math.floor(60_000 / (COLUMNS.length + 1));

/** Renvoie le `traceparent` W3C du contexte courant, ou `undefined` (traçage inactif, aucun span actif). */
export type TraceparentProvider = () => string | undefined;

let traceparentProvider: TraceparentProvider | undefined;

/**
 * Enregistre (ou retire, avec `undefined`) le fournisseur du `traceparent` ambiant. Appelé par la plateforme quand le
 * traçage est actif ET que la colonne existe ; jamais par un module.
 */
export function setOutboxTraceparentProvider(provider: TraceparentProvider | undefined): void {
  traceparentProvider = provider;
}

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

function ambientTraceparent(): string | undefined {
  if (!traceparentProvider) return undefined;
  try {
    const value = traceparentProvider();
    return typeof value === "string" && TRACEPARENT_RE.test(value) ? value : undefined;
  } catch {
    return undefined; // la trace ne doit jamais faire échouer l'écriture d'un événement
  }
}

export class PgOutboxWriter implements OutboxWriter {
  constructor(private readonly tx: Tx) {}

  async append(events: readonly DomainEvent[]): Promise<void> {
    const ambient = ambientTraceparent();
    const traceOf = (e: DomainEvent): string | null => {
      const own = e.traceparent;
      return typeof own === "string" && TRACEPARENT_RE.test(own) ? own : (ambient ?? null);
    };
    for (let start = 0; start < events.length; start += MAX_EVENTS_PER_INSERT) {
      const chunk = events.slice(start, start + MAX_EVENTS_PER_INSERT);
      const withTrace = chunk.some((e) => traceOf(e) !== null);
      const columns: readonly string[] = withTrace ? [...COLUMNS, "traceparent"] : COLUMNS;
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
        if (withTrace) params.push(traceOf(e));
        const o = i * columns.length;
        return `(${columns.map((c, k) => (c === "payload" ? `$${o + k + 1}::jsonb` : `$${o + k + 1}`)).join(", ")})`;
      });
      await this.tx.query(
        `INSERT INTO kernel.domain_events (${columns.join(", ")}) VALUES ${rows.join(", ")}`,
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
  /** Présent seulement quand `fetchPendingEvents` est appelé avec `withTraceparent`. */
  traceparent?: string | null;
}

export interface FetchPendingOptions {
  /** Lit aussi `traceparent` (la migration worker 0604 doit être appliquée). */
  withTraceparent?: boolean;
}

/**
 * Réserve (FOR UPDATE SKIP LOCKED) les événements non publiés du tenant de la
 * transaction courante. À appeler dans `SystemDb.forEachTenant` / `runForTenant`.
 */
export function fetchPendingEvents(tx: Tx, limit = 100, options: FetchPendingOptions = {}): Promise<PendingEvent[]> {
  const n = Math.max(1, Math.min(Math.trunc(limit), 1000));
  return tx.many<PendingEvent>(
    `SELECT id, tenant_id, type, version, aggregate_type, aggregate_id, actor_id,
            request_id, payload, occurred_at, attempts${options.withTraceparent ? ", traceparent" : ""}
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
