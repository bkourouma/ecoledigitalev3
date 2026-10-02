/**
 * File de rafraîchissement : les abonnés d'événements DEMANDENT (coalescé), le job `analytics.process-refreshes`
 * EXÉCUTE les demandes échues. Jamais de calcul dans l'abonné ni dans la requête HTTP.
 */
import { createSystemContext, newId, type RequestContext } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb, Tx } from "@ecoledigitale/database";
import { planRefreshes, REFRESH_DELAY_SECONDS } from "../domain/refresh-plan";
import { KIND_ORDER, type RefreshKind, type ScopeKey } from "../domain/types";
import { enqueueRequest, finishRequest, leaseDue, purgeFinished, reclaimStuck, retryRequest, type RefreshRequestRow } from "../infrastructure/requests-repository";
import { inTx } from "./deps";
import type { AnalyticsDeps } from "./ports";
import { refreshKind } from "./rebuild";

const STUCK_AFTER_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const PURGE_AFTER_MS = 7 * 86_400_000;

export interface EnqueueInput {
  kind: RefreshKind;
  scopeKey: ScopeKey;
  cause: { event: string; id: string | null };
  /** Échéance explicite ; défaut : maintenant + temporisation du genre. */
  notBefore?: Date | undefined;
  tx?: Tx | undefined;
}

export async function enqueueRefresh(deps: AnalyticsDeps, ctx: RequestContext, input: EnqueueInput): Promise<boolean> {
  const now = deps.clock.now();
  const notBefore = input.notBefore ?? new Date(now.getTime() + REFRESH_DELAY_SECONDS[input.kind] * 1000);
  return await inTx(
    deps,
    ctx,
    (tx) => enqueueRequest(tx, { id: newId(), tenantId: ctx.tenantId, kind: input.kind, scopeKey: input.scopeKey, cause: { event: input.cause.event, id: input.cause.id, at: now.toISOString() }, now, notBefore }),
    { tx: input.tx },
  );
}

/** Traduit un événement en demandes (voir `domain/refresh-plan.ts`) ; renvoie le nombre de demandes touchées. */
export async function enqueueFromEvent(deps: AnalyticsDeps, ctx: RequestContext, event: { id: string; type: string; payload: unknown; occurredAt: string }, tx?: Tx): Promise<number> {
  const plans = planRefreshes(event.type, event.payload, event.occurredAt);
  for (const plan of plans) await enqueueRefresh(deps, ctx, { kind: plan.kind, scopeKey: plan.scopeKey, cause: { event: event.type, id: event.id }, tx });
  return plans.length;
}

export interface ProcessReport {
  leased: number;
  ok: number;
  unavailable: number;
  failed: number;
  retried: number;
}

/** Délai de reprise d'une demande en échec : 15 s, 30 s, 60 s… plafonné à 5 minutes. */
export const retryDelayMs = (attempts: number): number => Math.min(300_000, 15_000 * 2 ** Math.max(0, attempts - 1));

/** Exécute les demandes échues d'UN tenant (ordre des genres, puis échéance). */
export async function processDueRefreshes(deps: AnalyticsDeps, ctx: RequestContext, options: { limit?: number } = {}): Promise<ProcessReport> {
  const now = deps.clock.now();
  const leased: RefreshRequestRow[] = await inTx(deps, ctx, async (tx) => {
    await reclaimStuck(tx, new Date(now.getTime() - STUCK_AFTER_MS));
    await purgeFinished(tx, new Date(now.getTime() - PURGE_AFTER_MS));
    return await leaseDue(tx, now, options.limit ?? 50);
  });
  leased.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.notBefore.getTime() - b.notBefore.getTime());
  const report: ProcessReport = { leased: leased.length, ok: 0, unavailable: 0, failed: 0, retried: 0 };

  for (const req of leased) {
    const outcomes = await refreshKind(deps, ctx, { kind: req.kind, scopeKey: req.scopeKey });
    const failed = outcomes.find((o) => o.status === "FAILED");
    const unavailable = outcomes.find((o) => o.status === "UNAVAILABLE");
    const at = deps.clock.now();
    await inTx(deps, ctx, async (tx) => {
      if (failed) {
        const error = failed.error ?? "échec";
        if (req.attempts < MAX_ATTEMPTS && (await retryRequest(tx, { id: req.id, error, notBefore: new Date(at.getTime() + retryDelayMs(req.attempts)) }))) {
          report.retried += 1;
          return;
        }
        await finishRequest(tx, { id: req.id, status: "FAILED", error, now: at });
        report.failed += 1;
      } else if (unavailable) {
        await finishRequest(tx, { id: req.id, status: "UNAVAILABLE", error: unavailable.error ?? "source non branchée", now: at });
        report.unavailable += 1;
      } else {
        await finishRequest(tx, { id: req.id, status: "DONE", error: null, now: at });
        report.ok += 1;
      }
    });
  }
  return report;
}

/** Job : exécute les demandes échues de chaque tenant actif. */
export async function processAllTenants(deps: AnalyticsDeps, systemDb: SystemDb, options: { limit?: number } = {}): Promise<ForEachTenantReport<ProcessReport>> {
  return systemDb.forEachTenant("analytics-process-refreshes", async (_tx, tenant) => processDueRefreshes(deps, createSystemContext(tenant.id), options));
}
