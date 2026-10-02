/**
 * Reconstruction complète d'un tenant : le MÊME chemin de lecture que le flux d'événements (ports -> remplacement du
 * périmètre), exécuté dans l'ordre des dépendances (calendrier d'abord : les autres genres énumèrent ses années, ses
 * périodes et ses campus). Idempotente : rejouer deux fois donne exactement les mêmes read-models.
 *
 * Sert au rattrapage (premier démarrage d'`analytics` sur un tenant qui a déjà un historique, événements perdus,
 * correction d'un adaptateur) : job nocturne `analytics.nightly-rebuild` et `POST /api/v1/analytics/rebuild`.
 */
import { createSystemContext, type RequestContext } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { addDays, MAX_RANGE_DAYS, rangeKey } from "../domain/refresh-plan";
import type { RefreshKind, ScopeKey } from "../domain/types";
import { ALL_SCOPE } from "../domain/types";
import { selectPeriods, selectYears } from "../infrastructure/dims-repository";
import { inTx } from "./deps";
import type { AnalyticsDeps } from "./ports";
import { refreshLeaf, type RefreshOptions, type RefreshOutcome } from "./refresh";

/** Nombre maximal de classes lues par période lors d'une passe (garde-fou contre une énumération démesurée). */
const MAX_CLASS_PERIODS = 5_000;

/**
 * Rafraîchit un (genre, périmètre) en développant ce qui doit l'être : `RESULTS` pour « toutes les classes de la période »
 * (`*|periodId`), `REBUILD` (reconstruction complète). Renvoie une issue par feuille.
 */
export async function refreshKind(deps: AnalyticsDeps, ctx: RequestContext, input: { kind: RefreshKind; scopeKey: ScopeKey }, options: RefreshOptions = {}): Promise<RefreshOutcome[]> {
  if (input.kind === "REBUILD") return await rebuildTenant(deps, ctx, options);
  if (input.kind === "RESULTS") {
    const [classroomId, periodId] = input.scopeKey.split("|");
    if (classroomId === ALL_SCOPE && periodId) return await refreshResultsOfPeriod(deps, ctx, { periodId }, options);
  }
  return [await refreshLeaf(deps, ctx, input, options)];
}

async function refreshResultsOfPeriod(deps: AnalyticsDeps, ctx: RequestContext, input: { periodId?: string; yearId?: string }, options: RefreshOptions): Promise<RefreshOutcome[]> {
  const port = deps.sources().results;
  if (!port) return [await refreshLeaf(deps, ctx, { kind: "RESULTS", scopeKey: `${ALL_SCOPE}|${input.periodId ?? input.yearId ?? ALL_SCOPE}` }, options)];
  let pairs: Array<{ classroomId: string; periodId: string }>;
  try {
    pairs = await port.listClassPeriods(ctx, input);
  } catch (e) {
    deps.logger.error({ err: e instanceof Error ? e.message : String(e) }, "analytics : énumération des classes impossible");
    return [{ kind: "RESULTS", scopeKey: `${ALL_SCOPE}|${input.periodId ?? input.yearId ?? ALL_SCOPE}`, status: "FAILED", rows: 0, changed: false, durationMs: 0, error: e instanceof Error ? e.message : String(e) }];
  }
  const out: RefreshOutcome[] = [];
  for (const p of pairs.slice(0, MAX_CLASS_PERIODS)) out.push(await refreshLeaf(deps, ctx, { kind: "RESULTS", scopeKey: `${p.classroomId}|${p.periodId}` }, options));
  return out;
}

export interface RebuildReport {
  tenantId: string;
  outcomes: RefreshOutcome[];
  ok: number;
  unavailable: number;
  failed: number;
  changed: number;
}

export async function rebuildTenant(deps: AnalyticsDeps, ctx: RequestContext, options: RefreshOptions = {}): Promise<RefreshOutcome[]> {
  // La reconstruction réécrit toujours (`force`) : c'est ce qui la distingue d'un simple rafraîchissement.
  const o: RefreshOptions = { force: options.force ?? true };
  const outcomes: RefreshOutcome[] = [];
  const run = async (kind: RefreshKind, scopeKey: ScopeKey = ALL_SCOPE): Promise<void> => {
    outcomes.push(...(await refreshKind(deps, ctx, { kind, scopeKey }, o)));
  };

  await run("CALENDAR");
  await run("ENROLLMENT");

  const { years, periods } = await inTx(deps, ctx, async (tx) => ({ years: await selectYears(tx), periods: await selectPeriods(tx) }), { readOnly: true });
  for (const p of periods) await run("RESULTS", `${ALL_SCOPE}|${p.id}`);

  const today = deps.clock.now().toISOString().slice(0, 10);
  const earliest = years.map((y) => y.startsOn).sort()[0];
  const floor = addDays(today, -(MAX_RANGE_DAYS - 1));
  const from = earliest && earliest > floor ? earliest : floor;
  const range = rangeKey(from, today);
  await run("ATTENDANCE", range);
  await run("STAFF_PRESENCE", range);
  await run("FINANCE");
  await run("COLLECTIONS", range);
  await run("CASH");
  await run("PAYROLL");
  await run("TEACHING_LOAD");
  return outcomes;
}

export function summarize(tenantId: string, outcomes: RefreshOutcome[]): RebuildReport {
  return {
    tenantId,
    outcomes,
    ok: outcomes.filter((o) => o.status === "OK").length,
    unavailable: outcomes.filter((o) => o.status === "UNAVAILABLE").length,
    failed: outcomes.filter((o) => o.status === "FAILED").length,
    changed: outcomes.filter((o) => o.changed).length,
  };
}

/** Job nocturne : reconstruit chaque tenant actif. Un tenant en échec n'arrête pas les autres. */
export async function rebuildAllTenants(deps: AnalyticsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<RebuildReport>> {
  return systemDb.forEachTenant("analytics-nightly-rebuild", async (_tx, tenant) => summarize(tenant.id, await rebuildTenant(deps, createSystemContext(tenant.id))));
}
