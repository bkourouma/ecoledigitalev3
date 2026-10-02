/**
 * Propagation du contexte de trace dans l'outbox (ADR-009) : branche `PgOutboxWriter` sur le `traceparent` du span actif,
 * à condition que le traçage soit actif ET que la colonne `kernel.domain_events.traceparent` existe (migration worker 0604).
 * Sans l'un des deux, l'écriture d'événements est strictement inchangée.
 */
import { setOutboxTraceparentProvider } from "@ecoledigitale/database";
import { currentTraceparent } from "./core/tracing";

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface OutboxTraceLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export async function outboxHasTraceparent(pool: Queryable): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'kernel' AND table_name = 'domain_events' AND column_name = 'traceparent'`,
  );
  return res.rows.length > 0;
}

/** Active la propagation ; renvoie `true` si le fournisseur est branché. */
export async function enableOutboxTraceContext(pool: Queryable, options: { tracingEnabled: boolean; logger?: OutboxTraceLogger }): Promise<boolean> {
  if (!options.tracingEnabled) return false;
  let present = false;
  try {
    present = await outboxHasTraceparent(pool);
  } catch (err) {
    options.logger?.warn({ err }, "traçage : colonne traceparent de l'outbox illisible, contexte de trace non propagé aux événements");
    return false;
  }
  if (!present) {
    options.logger?.warn({}, "traçage : kernel.domain_events.traceparent absente (migration worker 0604 non appliquée) : le contexte de trace n'est pas propagé aux événements");
    return false;
  }
  setOutboxTraceparentProvider(() => currentTraceparent());
  options.logger?.info({}, "traçage : contexte de trace propagé dans l'outbox (traceparent)");
  return true;
}

export function disableOutboxTraceContext(): void {
  setOutboxTraceparentProvider(undefined);
}
