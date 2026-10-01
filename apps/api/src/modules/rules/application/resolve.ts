/**
 * Résolution et chargement.
 *
 *  - `resolveInTx` : fonction PURE sur un état lu (AC4.1) — liaison la plus spécifique du périmètre, puis
 *    `resolveRuleSet` du moteur (variante d'établissement active > national publié) à la date de DÉBUT de la période
 *    (jamais l'heure courante, R-RUL-05). La réponse inclut `considered`, la raison de chaque écart.
 *    `null` : le consommateur refuse le calcul (`results.no_active_ruleset`), jamais de valeur par défaut codée.
 *  - `loadVersionInTx` : charge, compile (cache) et VÉRIFIE le hash de définition ; fonctionne aussi pour une
 *    version retirée (explication d'anciens bulletins, AC4.5). Une divergence lève `rules.hash_mismatch`.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { isValidIsoDate, resolveRuleSet, type ConsideredVersion } from "../engine";
import { getContract } from "../contracts";
import { selectBinding } from "../domain/binding";
import { computeDefinitionHash, toEngineRuleSet } from "../domain/definition";
import { RulesCode, conflict, notFound, validation } from "../domain/errors";
import type { Origin, RuleSetRecord, RuleVersionRecord } from "../domain/types";
import { originOf } from "../domain/types";
import { listBindings } from "../infrastructure/bindings-repository";
import { findVersion, getRuleSetByCode, getRules, listVersions } from "../infrastructure/catalog-repository";
import { CompiledVersionCache, createCompiledVersion, type CompiledVersion } from "./compiled";
import type { RulesDeps } from "./deps";

export interface ResolveInput {
  readonly contractId: string;
  readonly institutionId?: string | undefined;
  readonly curriculumNodeId?: string | undefined;
  readonly levelCode?: string | undefined;
  /** Date de DÉBUT de la période, « AAAA-MM-JJ ». */
  readonly date: string;
}

export interface ResolvedVersion {
  readonly ruleVersionId: string;
  readonly ruleSetCode: string;
  readonly versionNo: number;
  readonly definitionHash: string;
  readonly origin: Origin;
  readonly contractId: string;
  readonly bindingId: string;
}

export interface Resolution {
  readonly resolved: ResolvedVersion | null;
  readonly considered: readonly ConsideredVersion[];
}

/** Statuts du catalogue national visibles d'un établissement : jamais un brouillon ni une version en cours d'approbation. */
export const NATIONAL_VISIBLE_STATUSES = ["published", "retired"] as const;

export async function resolveInTx(tx: Tx, tenantId: string, input: ResolveInput): Promise<Result<Resolution, AppError>> {
  if (!isValidIsoDate(input.date)) return err(validation(RulesCode.INVALID_INPUT, `Date d'effet invalide « ${input.date} » (format attendu : AAAA-MM-JJ).`, "date"));
  if (!getContract(input.contractId)) return err(validation(RulesCode.UNKNOWN_CONTRACT, `Contrat inconnu : ${input.contractId}.`, "contractId"));

  const binding = selectBinding(await listBindings(tx, { contractId: input.contractId }), input);
  if (!binding) return ok({ resolved: null, considered: [] });

  const nationalSet = await getRuleSetByCode(tx, "NATIONAL", binding.ruleSetCode);
  const tenantSet = await getRuleSetByCode(tx, "TENANT", binding.ruleSetCode);
  if (!nationalSet && !tenantSet) return ok({ resolved: null, considered: [] });

  const sets: Array<{ set: RuleSetRecord; versions: RuleVersionRecord[] }> = [];
  if (nationalSet) {
    const versions = await listVersions(tx, "NATIONAL", { ruleSetId: nationalSet.id, contractId: input.contractId, statuses: NATIONAL_VISIBLE_STATUSES });
    sets.push({ set: nationalSet, versions });
  }
  if (tenantSet) sets.push({ set: tenantSet, versions: await listVersions(tx, "TENANT", { ruleSetId: tenantSet.id, contractId: input.contractId }) });

  const attributes = nationalSet ?? (tenantSet as RuleSetRecord);
  const engineSets = sets.map(({ set, versions }) => toEngineRuleSet(set, versions));
  const resolved = resolveRuleSet(engineSets, {
    tenantId,
    countryCode: attributes.countryCode,
    ...(attributes.educationSystem ? { educationSystem: attributes.educationSystem } : {}),
    ...(attributes.level ? { level: attributes.level } : {}),
    code: binding.ruleSetCode,
    date: input.date,
  });
  if (!resolved) {
    // On explique quand même pourquoi rien n'est actif (versions écartées et raison).
    return ok({ resolved: null, considered: explainNone(sets, input.date) });
  }
  const all = sets.flatMap((s) => s.versions);
  const record = all.find((v) => v.id === resolved.version.id) as RuleVersionRecord;
  return ok({
    resolved: {
      ruleVersionId: record.id,
      ruleSetCode: record.ruleSetCode,
      versionNo: record.versionNo,
      definitionHash: record.definitionHash ?? "",
      origin: originOf(record.kind),
      contractId: record.contractId,
      bindingId: binding.id,
    },
    considered: resolved.considered,
  });
}

function explainNone(sets: ReadonlyArray<{ set: RuleSetRecord; versions: RuleVersionRecord[] }>, date: string): ConsideredVersion[] {
  const out: ConsideredVersion[] = [];
  for (const { set, versions } of sets) {
    const origin = originOf(set.kind);
    for (const v of versions) {
      const active = origin === "tenant" ? ["approved", "published"] : ["published"];
      const reason = !active.includes(v.status)
        ? `statut « ${v.status} » non actif`
        : `hors période d'effet (${v.effectiveFrom} → ${v.effectiveTo ?? "∞"}) à la date ${date}`;
      out.push({ ruleSetId: set.id, versionId: v.id, version: v.versionNo, origin, eligible: false, reason });
    }
  }
  return out;
}

/** `resolve` autonome : ouvre une transaction de lecture sous l'identité du contexte. */
export async function resolve(deps: RulesDeps, ctx: { tenantId: string } & Parameters<RulesDeps["db"]["run"]>[0], input: ResolveInput): Promise<Result<Resolution, AppError>> {
  return deps.db.run(ctx, (tx) => resolveInTx(tx, ctx.tenantId, input), { readOnly: true });
}

/* ------------------------------ chargement ------------------------------ */

export interface LoadOptions {
  /** Ignore les caches et RECALCULE le hash depuis la base (rejeu, vérification d'intégrité) : détecte une altération hors application. */
  readonly verify?: boolean;
  /** Console de la plateforme : voit aussi les brouillons et versions en cours d'approbation du catalogue national. */
  readonly platform?: boolean;
}

export async function loadVersionInTx(deps: Pick<RulesDeps, "cache">, tx: Tx, versionId: string, options: LoadOptions = {}): Promise<Result<CompiledVersion, AppError>> {
  const version = await findVersion(tx, versionId);
  if (!version) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
  if (version.kind === "NATIONAL" && !options.platform && !(NATIONAL_VISIBLE_STATUSES as readonly string[]).includes(version.status)) {
    return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
  }
  const editable = version.status === "draft" || version.status === "simulated";
  if (!editable && version.definitionHash && !options.verify) {
    const key = CompiledVersionCache.keyOf(version, version.definitionHash);
    const hit = deps.cache.get(key);
    if (hit) return ok(hit);
  }
  const rules = await getRules(tx, version.kind, version.id);
  const actual = computeDefinitionHash(version.contractId, rules);
  if (!editable && version.definitionHash !== actual) {
    return err(
      conflict(RulesCode.HASH_MISMATCH, "Le contenu de la version ne correspond plus à son empreinte : usage bloqué.", {
        versionId: version.id,
        expectedHash: version.definitionHash,
        actualHash: actual,
      }),
    );
  }
  const compiled = createCompiledVersion(version, rules, actual);
  if (!editable) {
    deps.cache.set(CompiledVersionCache.keyOf(version, actual), compiled);
    // Version nationale : chemin rapide seulement si visible des établissements (publiée ou retirée).
    if (version.kind === "TENANT" || (NATIONAL_VISIBLE_STATUSES as readonly string[]).includes(version.status)) {
      deps.cache.setFast(version.kind === "TENANT" ? version.tenantId : null, version.id, compiled);
    }
  }
  return ok(compiled);
}

/** `loadVersion` autonome (transaction de lecture). */
export async function loadVersion(deps: RulesDeps, ctx: Parameters<RulesDeps["db"]["run"]>[0], versionId: string, options: LoadOptions = {}): Promise<Result<CompiledVersion, AppError>> {
  // Chaud : aucune requête SQL (≤ 5 ms). Le mode plateforme relit toujours (visibilité élargie).
  if (!options.platform && !options.verify) {
    const hit = deps.cache.getFast(ctx.tenantId, versionId);
    if (hit) return ok(hit);
  }
  return deps.db.run(ctx, (tx) => loadVersionInTx(deps, tx, versionId, options), { readOnly: true });
}
