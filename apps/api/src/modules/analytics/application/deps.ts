/**
 * Dépendances du module : `createAnalyticsDeps` complète les valeurs par défaut sûres (horloge système, audit no-op,
 * aucun port source = chaque genre de rafraîchissement déclare `UNAVAILABLE`, jamais une erreur 500).
 */
import { noopLogger, systemClock, type Clock, type Logger, type RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb, Tx } from "@ecoledigitale/database";
import { noopAudit, type AnalyticsDeps, type AnalyticsSourcePorts, type AuditPort } from "./ports";

export interface AnalyticsDepsInput {
  db: TenantDb;
  clock?: Clock | undefined;
  logger?: Logger | undefined;
  audit?: AuditPort | undefined;
  /** Registre lu à l'appel (`app.analyticsPorts.current`, `analyticsWorkerPorts`). */
  portsProvider?: (() => Partial<AnalyticsSourcePorts>) | undefined;
}

export function createAnalyticsDeps(input: AnalyticsDepsInput): AnalyticsDeps {
  return {
    tenantDb: input.db,
    clock: input.clock ?? systemClock,
    logger: input.logger ?? noopLogger,
    audit: input.audit ?? noopAudit,
    sources: input.portsProvider ?? (() => ({})),
  };
}

/** Exécute `fn` dans une transaction du tenant (lecture seule si demandé), ou dans `tx` s'il est fourni. */
export async function inTx<T>(deps: AnalyticsDeps, ctx: RequestContext, fn: (tx: Tx) => Promise<T>, options: { readOnly?: boolean; tx?: Tx | undefined } = {}): Promise<T> {
  if (options.tx) return await fn(options.tx);
  return await deps.tenantDb.run(ctx, fn, options.readOnly ? { readOnly: true } : undefined);
}
