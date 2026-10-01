/**
 * Lectures du catalogue : côté établissement (jeux nationaux VISIBLES + variantes du tenant) et côté plateforme
 * (tout le catalogue national, file d'approbation, impact par tenant).
 *
 * Un établissement ne voit du catalogue national que les versions publiées ou retirées (jamais un brouillon ni une
 * version en cours d'approbation) ; il ne lit jamais la variante d'un autre (RLS, R-RUL-10).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { RuleStatus } from "../engine";
import { RulesCode, notFound } from "../domain/errors";
import type { Origin, RuleSetRecord, RuleVersionRecord, RuleVersionWithRules, VersionEventRecord, VersionKind } from "../domain/types";
import { originOf } from "../domain/types";
import {
  findVersion,
  getRules,
  listRuleSets,
  listVersionEvents,
  listVersions,
} from "../infrastructure/catalog-repository";
import { getSimulation } from "../infrastructure/simulations-repository";
import { inSystemTx, inTx, type RulesDeps } from "./deps";
import { NATIONAL_VISIBLE_STATUSES } from "./resolve";

export interface RuleSetWithVersions {
  readonly set: RuleSetRecord;
  readonly versions: readonly RuleVersionRecord[];
}

export interface CatalogQuery {
  readonly code?: string | undefined;
  readonly status?: RuleStatus | undefined;
  readonly origin?: Origin | undefined;
}

async function collect(tx: Parameters<typeof listRuleSets>[0], kind: VersionKind, query: CatalogQuery, nationalVisibleOnly: boolean): Promise<RuleSetWithVersions[]> {
  const sets = (await listRuleSets(tx, kind)).filter((s) => !query.code || s.code === query.code);
  const out: RuleSetWithVersions[] = [];
  for (const set of sets) {
    const statuses = query.status
      ? [query.status]
      : kind === "NATIONAL" && nationalVisibleOnly
        ? [...NATIONAL_VISIBLE_STATUSES]
        : undefined;
    if (query.status && kind === "NATIONAL" && nationalVisibleOnly && !(NATIONAL_VISIBLE_STATUSES as readonly string[]).includes(query.status)) {
      out.push({ set, versions: [] });
      continue;
    }
    const versions = await listVersions(tx, kind, { ruleSetId: set.id, ...(statuses ? { statuses } : {}) });
    out.push({ set, versions });
  }
  return out;
}

/** Jeux visibles d'un établissement : nationaux (versions publiées/retirées) puis variantes. */
export async function listTenantCatalog(deps: RulesDeps, ctx: RequestContext, query: CatalogQuery = {}): Promise<Result<RuleSetWithVersions[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const national = query.origin === "tenant" ? [] : await collect(tx, "NATIONAL", query, true);
      const tenant = query.origin === "national" ? [] : await collect(tx, "TENANT", query, false);
      // Un jeu national sans version visible n'est pas montré (sauf filtre explicite sur le code).
      return ok([...national.filter((n) => n.versions.length > 0 || query.code), ...tenant]);
    },
    { readOnly: true },
  );
}

export interface VersionDetail {
  readonly version: RuleVersionRecord;
  readonly rules: RuleVersionWithRules["rules"];
  readonly events: readonly VersionEventRecord[];
}

/** Une version (variante du tenant, ou version nationale publiée/retirée), avec ses règles et son historique. */
export async function getVersionDetail(deps: RulesDeps, ctx: RequestContext, versionId: string): Promise<Result<VersionDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const version = await findVersion(tx, versionId);
      if (!version || (version.kind === "NATIONAL" && !(NATIONAL_VISIBLE_STATUSES as readonly string[]).includes(version.status))) {
        return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
      }
      return ok({ version, rules: await getRules(tx, version.kind, version.id), events: await listVersionEvents(tx, version.kind, version.id) });
    },
    { readOnly: true },
  );
}

export async function getVersionEvents(deps: RulesDeps, ctx: RequestContext, versionId: string): Promise<Result<VersionEventRecord[], AppError>> {
  const detail = await getVersionDetail(deps, ctx, versionId);
  return detail.ok ? ok([...detail.value.events]) : detail;
}

/* ------------------------------- plateforme ------------------------------- */

/** Tout le catalogue national (tous statuts). */
export async function listPlatformCatalog(deps: RulesDeps, query: CatalogQuery = {}): Promise<Result<RuleSetWithVersions[], AppError>> {
  return inSystemTx(deps, "rules-platform-catalog", async (tx) => ok(await collect(tx, "NATIONAL", query, false)));
}

export async function getPlatformVersionDetail(
  deps: RulesDeps,
  versionId: string,
  tenantId?: string,
): Promise<Result<VersionDetail, AppError>> {
  if (tenantId) {
    return deps.systemDb.runForTenant("rules-platform-version-read", tenantId, async (tx) => {
      const version = await findVersion(tx, versionId);
      if (!version || version.kind !== "TENANT") return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
      return ok({ version, rules: await getRules(tx, "TENANT", version.id), events: await listVersionEvents(tx, "TENANT", version.id) });
    });
  }
  return inSystemTx(deps, "rules-platform-version-read", async (tx) => {
    const version = await findVersion(tx, versionId);
    if (!version || version.kind !== "NATIONAL") return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
    return ok({ version, rules: await getRules(tx, "NATIONAL", version.id), events: await listVersionEvents(tx, "NATIONAL", version.id) });
  });
}

export interface QueueItem {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly version: RuleVersionRecord;
  readonly ruleSetName: string;
  readonly decisionChangedPercent: string | null;
  readonly decisionImpactConfirmed: boolean;
}

/** File d'approbation : variantes `proposed` de TOUS les tenants actifs (un tenant à la fois, RLS préservée). */
export async function listApprovalQueue(deps: RulesDeps): Promise<QueueItem[]> {
  const report = await deps.systemDb.forEachTenant("rules-approval-queue", async (tx) => {
    const versions = await listVersions(tx, "TENANT", { statuses: ["proposed"] });
    const sets = new Map((await listRuleSets(tx, "TENANT")).map((s) => [s.id, s]));
    const items: Array<Omit<QueueItem, "tenantId" | "tenantSlug">> = [];
    for (const version of versions) {
      const sim = version.lastSimulationId ? await getSimulation(tx, version.lastSimulationId) : null;
      items.push({
        version,
        ruleSetName: sets.get(version.ruleSetId)?.name ?? version.ruleSetCode,
        decisionChangedPercent: sim?.decisionChangedPercent ?? null,
        decisionImpactConfirmed: version.decisionImpactConfirmedBy !== null,
      });
    }
    return items;
  });
  return report.succeeded.flatMap((s) => s.result.map((item) => ({ tenantId: s.tenantId, tenantSlug: s.slug, ...item })));
}

export interface ImpactItem {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly activeVariants: readonly RuleVersionRecord[];
}

/** Impact : variantes actives (approuvées/publiées) par tenant. */
export async function listPlatformImpact(deps: RulesDeps): Promise<ImpactItem[]> {
  const report = await deps.systemDb.forEachTenant("rules-platform-impact", async (tx) => listVersions(tx, "TENANT", { statuses: ["approved", "published"] }));
  return report.succeeded.filter((s) => s.result.length > 0).map((s) => ({ tenantId: s.tenantId, tenantSlug: s.slug, activeVariants: s.result }));
}

export { originOf };
