/**
 * Simulation (US2) : rapport « avant / après » d'une version sur les données RÉELLES du tenant.
 *
 *  - `requestSimulation` crée la simulation (PENDING), publie `rules.simulation.requested` (le module `results` construit
 *    les cas) et trace la demande ; AUCUN recalcul n'est déclenché.
 *  - `runSimulation` exécute avec la `SimulationCaseSource` enregistrée pour le contrat (port du module consommateur) :
 *    asynchrone, avec progression ; `recordSimulationCases` est le point d'entrée d'un abonné externe (worker) qui
 *    fournit lui-même les cas ; `recordSimulationReport` enregistre un rapport déjà produit.
 *  - Le rapport est celui de `simulate()` du moteur (un rapport par groupe de cas, fusionnés) : delta exact par règle
 *    numérique, matrice de transitions pour les règles à code, compteurs exacts au-delà du plafond de différences (AC2.4).
 *  - Une simulation n'est valable que pour le HASH de la version simulée : toute modification la rend caduque (AC2.1).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { simulate, type RuleType, type SimulationReport } from "../engine";
import { getContract, contractRule } from "../contracts";
import { computeDefinitionHash, toEngineDefinition, toEngineVersionMeta } from "../domain/definition";
import { RulesCode, conflict, notFound, validation } from "../domain/errors";
import { RulesEvents, type SimulationCompletedPayload, type SimulationRequestedPayload } from "../domain/events";
import { decisionChangedPercent, mergeSimulationReports } from "../domain/simulation";
import type { RuleVersionRecord, RuleVersionWithRules, SimulationRecord } from "../domain/types";
import { NATIONAL_VISIBLE_STATUSES } from "./resolve";
import {
  findVersion,
  getRuleSetByCode,
  getVersionWithRules,
  listVersions,
} from "../infrastructure/catalog-repository";
import {
  completeSimulation,
  getSimulation,
  insertDifferences,
  insertSimulation,
  listDifferences,
  markSimulation,
  type DifferenceRow,
} from "../infrastructure/simulations-repository";
import { inTx, type RulesDeps } from "./deps";
import type { SimulationCaseGroup, SimulationCaseSource, SimulationDataset } from "./ports";
import { newEventBuffer, recordAudit } from "./support";

export interface RequestSimulationInput {
  readonly versionId: string;
  readonly baseVersionId?: string | undefined;
  readonly dataset: SimulationDataset;
}

const SIMULATION_AGGREGATE = "simulation";

/** Version de référence par défaut : la version active précédente du même jeu, sinon la version nationale copiée (R-RUL-04). */
async function defaultBase(tx: Parameters<typeof findVersion>[0], target: RuleVersionRecord): Promise<RuleVersionRecord | null> {
  const sameSet = (await listVersions(tx, target.kind, { ruleSetId: target.ruleSetId, contractId: target.contractId }))
    .filter((v) => v.id !== target.id && v.versionNo < target.versionNo && (v.status === "approved" || v.status === "published"))
    .sort((a, b) => b.versionNo - a.versionNo);
  if (sameSet[0]) return sameSet[0];
  if (target.basedOnVersionId) {
    const base = await findVersion(tx, target.basedOnVersionId);
    if (base) return base;
  }
  const national = await getRuleSetByCode(tx, "NATIONAL", target.ruleSetCode);
  if (!national || target.kind === "NATIONAL") {
    if (target.kind === "NATIONAL" && national) {
      const earlier = (await listVersions(tx, "NATIONAL", { ruleSetId: national.id, contractId: target.contractId }))
        .filter((v) => v.id !== target.id && v.versionNo < target.versionNo && v.status === "published")
        .sort((a, b) => b.versionNo - a.versionNo);
      return earlier[0] ?? null;
    }
    return null;
  }
  const published = (await listVersions(tx, "NATIONAL", { ruleSetId: national.id, contractId: target.contractId, statuses: ["published"] })).sort((a, b) => b.versionNo - a.versionNo);
  return published[0] ?? null;
}

export async function requestSimulation(deps: RulesDeps, ctx: RequestContext, input: RequestSimulationInput): Promise<Result<SimulationRecord, AppError>> {
  if (!ctx.userId) return err(validation(RulesCode.INVALID_INPUT, "Lancer une simulation exige un utilisateur identifié.", "actor"));
  return inTx(deps, ctx, async (tx) => {
    const target = await getVersionWithRules(tx, "TENANT", input.versionId).then(async (t) => t ?? (await getVersionWithRules(tx, "NATIONAL", input.versionId)));
    if (!target) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", input.versionId));
    if (target.kind === "NATIONAL" && !(NATIONAL_VISIBLE_STATUSES as readonly string[]).includes(target.status)) {
      return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", input.versionId));
    }
    if (!getContract(target.contractId)) return err(validation(RulesCode.UNKNOWN_CONTRACT, `Contrat inconnu : ${target.contractId}.`, "contractId"));

    const base = input.baseVersionId ? await findVersion(tx, input.baseVersionId) : await defaultBase(tx, target);
    if (!base) {
      return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, "Aucune version de référence à comparer : une simulation compare TOUJOURS à une version précédente active, jamais à une version vide.", { versionId: target.id }));
    }
    if (base.id === target.id) return err(validation(RulesCode.INVALID_INPUT, "La version de référence doit différer de la version simulée.", "baseVersionId"));
    if (base.contractId !== target.contractId) {
      return err(validation(RulesCode.INVALID_INPUT, `Les contrats diffèrent (${base.contractId} / ${target.contractId}) : la comparaison n'a pas de sens.`, "baseVersionId"));
    }
    if (base.kind === "NATIONAL" && !(NATIONAL_VISIBLE_STATUSES as readonly string[]).includes(base.status)) {
      return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de référence", base.id));
    }

    const simulation = await insertSimulation(tx, ctx.tenantId, {
      id: deps.newId(),
      targetKind: target.kind,
      targetVersionId: target.id,
      baseKind: base.kind,
      baseVersionId: base.id,
      targetDefinitionHash: computeDefinitionHash(target.contractId, target.rules),
      contractId: target.contractId,
      dataset: input.dataset,
      requestedBy: ctx.userId as string,
    });
    const events = newEventBuffer(deps, ctx);
    const payload: SimulationRequestedPayload = {
      v: 1,
      simulationId: simulation.id,
      versionId: target.id,
      baseVersionId: base.id,
      contractId: target.contractId,
      dataset: input.dataset,
    };
    events.add(RulesEvents.SIMULATION_REQUESTED, payload as unknown as { v: 1 } & Record<string, unknown>, { type: SIMULATION_AGGREGATE, id: simulation.id });
    await events.flush(tx);
    await recordAudit(
      deps,
      tx,
      { kind: "TENANT", tenantId: ctx.tenantId, ctx, actor: { kind: "tenant_admin", id: ctx.userId, name: ctx.userId as string } },
      {
        action: "rules.simulation.requested",
        entity: "rule_simulation",
        entityId: simulation.id,
        metadata: { versionId: target.id, baseVersionId: base.id, contractId: target.contractId, periods: input.dataset.periodIds.length },
      },
    );
    return ok(simulation);
  });
}

/* ------------------------------ exécution ------------------------------ */

async function loadCompared(
  deps: RulesDeps,
  ctx: RequestContext,
  simulation: SimulationRecord,
): Promise<Result<{ target: RuleVersionWithRules; base: RuleVersionWithRules }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const target = await getVersionWithRules(tx, simulation.targetVersionKind, simulation.targetVersionId);
      const base = await getVersionWithRules(tx, simulation.baseVersionKind, simulation.baseVersionId);
      if (!target || !base) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", simulation.targetVersionId));
      return ok({ target, base });
    },
    { readOnly: true },
  );
}

function engineVersionOf(v: RuleVersionWithRules) {
  const contract = getContract(v.contractId);
  return toEngineVersionMeta(
    v,
    v.rules.map((r) => toEngineDefinition(r, contract ? contractRule(contract, r.key) : undefined)),
  );
}

/** Calcule le rapport (groupe par groupe) — CPU pur, hors transaction. */
export function computeSimulationReport(
  base: RuleVersionWithRules,
  target: RuleVersionWithRules,
  groups: readonly SimulationCaseGroup[],
  maxDifferences: number,
): Result<{ report: SimulationReport; casesCount: number; decisionPercent: string }, AppError> {
  const seenKeys = new Set<string>();
  for (const g of groups) {
    for (const k of g.ruleKeys) {
      if (seenKeys.has(k)) return err(validation(RulesCode.INVALID_INPUT, `La règle « ${k} » figure dans plusieurs groupes de cas.`, "groups"));
      seenKeys.add(k);
    }
  }
  const oldV = engineVersionOf(base);
  const newV = engineVersionOf(target);
  const caseIds = new Set<string>();
  const reports: SimulationReport[] = [];
  for (const g of groups) {
    for (const c of g.cases) caseIds.add(c.id);
    reports.push(
      simulate(
        oldV,
        newV,
        g.cases.map((c) => ({ id: c.id, ...(c.label !== undefined ? { label: c.label } : {}), context: { variables: c.context.variables, lookups: c.context.lookups } })),
        { ruleKeys: g.ruleKeys, maxDifferences },
      ),
    );
  }
  if (reports.length === 0) {
    reports.push(simulate(oldV, newV, [], { ruleKeys: [], maxDifferences }));
  }
  const report = mergeSimulationReports(reports, caseIds, maxDifferences);
  const types = new Map<string, RuleType>([...base.rules, ...target.rules].map((r) => [r.key, r.type]));
  return ok({ report, casesCount: caseIds.size, decisionPercent: decisionChangedPercent(report, types) });
}

/** Enregistre un rapport COMPLET déjà calculé (ex. par un abonné qui a exécuté le pipeline lui-même). */
export async function recordSimulationReport(
  deps: RulesDeps,
  ctx: RequestContext,
  simulationId: string,
  report: SimulationReport,
  casesCount: number,
): Promise<Result<SimulationRecord, AppError>> {
  const simulation = await deps.db.run(ctx, (tx) => getSimulation(tx, simulationId), { readOnly: true });
  if (!simulation) return err(notFound(RulesCode.SIMULATION_NOT_FOUND, "Simulation", simulationId));
  const compared = await loadCompared(deps, ctx, simulation);
  if (!compared.ok) return compared;
  const types = new Map<string, RuleType>([...compared.value.base.rules, ...compared.value.target.rules].map((r) => [r.key, r.type]));
  return persistReport(deps, ctx, simulation, report, casesCount, decisionChangedPercent(report, types));
}

async function persistReport(
  deps: RulesDeps,
  ctx: RequestContext,
  simulation: SimulationRecord,
  report: SimulationReport,
  casesCount: number,
  decisionPercent: string,
): Promise<Result<SimulationRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await getSimulation(tx, simulation.id, { forUpdate: true });
    if (!current) return err(notFound(RulesCode.SIMULATION_NOT_FOUND, "Simulation", simulation.id));
    if (current.status === "CANCELLED" || current.status === "COMPLETED") {
      return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, `La simulation est déjà ${current.status === "CANCELLED" ? "annulée" : "terminée"}.`, { status: current.status }));
    }
    await insertDifferences(tx, ctx.tenantId, simulation.id, report.differences.slice(0, deps.config.maxSimulationDifferences), deps.newId);
    await completeSimulation(tx, simulation.id, { report, decisionChangedPercent: decisionPercent, casesCount, completedAt: deps.clock.now() });
    const events = newEventBuffer(deps, ctx);
    const payload: SimulationCompletedPayload = { v: 1, simulationId: simulation.id, versionId: simulation.targetVersionId, status: "COMPLETED", summary: report.summary };
    events.add(RulesEvents.SIMULATION_COMPLETED, payload as unknown as { v: 1 } & Record<string, unknown>, { type: SIMULATION_AGGREGATE, id: simulation.id });
    await events.flush(tx);
    return ok((await getSimulation(tx, simulation.id)) as SimulationRecord);
  });
}

/** Point d'entrée d'un abonné externe : il fournit les cas (groupés), `rules` produit et enregistre le rapport. */
export async function recordSimulationCases(
  deps: RulesDeps,
  ctx: RequestContext,
  simulationId: string,
  groups: readonly SimulationCaseGroup[],
): Promise<Result<SimulationRecord, AppError>> {
  const simulation = await deps.db.run(ctx, (tx) => getSimulation(tx, simulationId), { readOnly: true });
  if (!simulation) return err(notFound(RulesCode.SIMULATION_NOT_FOUND, "Simulation", simulationId));
  const compared = await loadCompared(deps, ctx, simulation);
  if (!compared.ok) return compared;
  const { target, base } = compared.value;
  if (computeDefinitionHash(target.contractId, target.rules) !== simulation.targetDefinitionHash) {
    await failSimulation(deps, ctx, simulation, "La version simulée a été modifiée pendant la simulation : relancez-la.");
    return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, "La version simulée a été modifiée pendant la simulation.", { simulationId }));
  }
  const computed = computeSimulationReport(base, target, groups, deps.config.maxSimulationDifferences);
  if (!computed.ok) {
    await failSimulation(deps, ctx, simulation, computed.error.message);
    return computed;
  }
  return persistReport(deps, ctx, simulation, computed.value.report, computed.value.casesCount, computed.value.decisionPercent);
}

async function failSimulation(deps: RulesDeps, ctx: RequestContext, simulation: SimulationRecord, message: string): Promise<void> {
  await deps.db.run(ctx, async (tx) => {
    const current = await getSimulation(tx, simulation.id, { forUpdate: true });
    if (!current || current.status === "COMPLETED" || current.status === "CANCELLED") return;
    await markSimulation(tx, simulation.id, { status: "FAILED", error: message.slice(0, 2000), completedAt: deps.clock.now() });
    const events = newEventBuffer(deps, ctx);
    const payload: SimulationCompletedPayload = { v: 1, simulationId: simulation.id, versionId: simulation.targetVersionId, status: "FAILED" };
    events.add(RulesEvents.SIMULATION_COMPLETED, payload as unknown as { v: 1 } & Record<string, unknown>, { type: SIMULATION_AGGREGATE, id: simulation.id });
    await events.flush(tx);
  });
}

/**
 * Exécute une simulation PENDING avec la source de cas du contrat (ou celle fournie). Asynchrone côté appelant :
 * l'API HTTP la lance en tâche de fond (`startSimulation`) et renvoie 202.
 */
export async function runSimulation(
  deps: RulesDeps,
  ctx: RequestContext,
  simulationId: string,
  source?: SimulationCaseSource,
): Promise<Result<SimulationRecord, AppError>> {
  const claimed = await inTx(deps, ctx, async (tx) => {
    const sim = await getSimulation(tx, simulationId, { forUpdate: true });
    if (!sim) return err(notFound(RulesCode.SIMULATION_NOT_FOUND, "Simulation", simulationId));
    if (sim.status !== "PENDING") return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, `La simulation est déjà ${sim.status}.`, { status: sim.status }));
    const effective = source ?? deps.simulationSources.get(sim.contractId);
    if (!effective) return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, "Aucune source de données n'est branchée pour ce contrat : la simulation reste en attente.", { contractId: sim.contractId }));
    await markSimulation(tx, sim.id, { status: "RUNNING", progressPercent: 0, startedAt: deps.clock.now() });
    return ok({ sim, effective });
  });
  if (!claimed.ok) return claimed;
  const { sim, effective } = claimed.value;

  try {
    const groups = await effective.buildCaseGroups({
      ctx,
      contractId: sim.contractId,
      dataset: sim.dataset as SimulationDataset,
      progress: async (percent) => {
        await deps.db.run(ctx, (tx) => markSimulation(tx, sim.id, { status: "RUNNING", progressPercent: Math.max(0, Math.min(99, Math.floor(percent))) }));
      },
    });
    const finished = await recordSimulationCases(deps, ctx, sim.id, groups);
    return finished;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.logger.error({ simulationId: sim.id, err: message }, "rules : simulation en échec");
    await failSimulation(deps, ctx, sim, "La construction des cas de simulation a échoué.");
    return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, "La simulation a échoué.", { simulationId: sim.id }));
  }
}

/** Lance `runSimulation` en tâche de fond (HTTP : 202 immédiat). Sans source branchée, la simulation reste PENDING. */
export function startSimulation(deps: RulesDeps, ctx: RequestContext, simulationId: string): boolean {
  const pending = deps.simulationSources.size > 0;
  if (!pending) return false;
  deps.background.run(async () => {
    await runSimulation(deps, ctx, simulationId);
  });
  return true;
}

export async function cancelSimulation(deps: RulesDeps, ctx: RequestContext, simulationId: string): Promise<Result<SimulationRecord, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const sim = await getSimulation(tx, simulationId, { forUpdate: true });
    if (!sim) return err(notFound(RulesCode.SIMULATION_NOT_FOUND, "Simulation", simulationId));
    if (sim.status !== "PENDING" && sim.status !== "RUNNING") {
      return err(conflict(RulesCode.SIMULATION_NOT_AVAILABLE, `La simulation est déjà ${sim.status}.`, { status: sim.status }));
    }
    await markSimulation(tx, sim.id, { status: "CANCELLED", completedAt: deps.clock.now() });
    return ok((await getSimulation(tx, sim.id)) as SimulationRecord);
  });
}

/* ------------------------------- lecture ------------------------------- */

export interface SimulationView {
  readonly simulation: SimulationRecord;
  readonly differences: DifferenceRow[];
}

export async function getSimulationView(deps: RulesDeps, ctx: RequestContext, simulationId: string): Promise<Result<SimulationView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const simulation = await getSimulation(tx, simulationId);
      if (!simulation) return err(notFound(RulesCode.SIMULATION_NOT_FOUND, "Simulation", simulationId));
      return ok({ simulation, differences: await listDifferences(tx, simulationId, deps.config.maxSimulationDifferences) });
    },
    { readOnly: true },
  );
}

