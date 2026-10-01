/**
 * Gouvernance des versions : transitions `draft → simulated → proposed → approved → published → retired`.
 *
 * Qui peut quoi est décidé par `canTransition` du moteur (domain/governance.ts) ; la base le rejoue en miroir
 * (triggers). Ce module ajoute les PORTES MÉTIER de chaque transition :
 *
 *   draft → simulated      la version compile et satisfait son contrat (AC1.4, AC5.1) ; pour une variante, une
 *                          simulation TERMINÉE sur le contenu courant existe (AC2.1)
 *   simulated → proposed   idem + hash de définition signé ; si la simulation modifie plus de X % des décisions,
 *                          confirmation explicite tracée (AC2.5)
 *   proposed → approved    hash revérifié (R-RUL-03), contrat revérifié, aucun chevauchement de période d'effet avec
 *                          une autre version active (AC3.3), séparation des tâches du catalogue national (AC3.4) ;
 *                          commentaire obligatoire (AC3.5)
 *   approved → published   hash revérifié
 *   * → retired            commentaire obligatoire
 *   proposed → draft       rejet (super-administrateur, commentaire obligatoire) ou retrait par l'auteur
 *
 * PUBLIER OU APPROUVER NE RECALCULE RIEN (A-13) : une version n'est appliquée qu'aux calculs qui la résolvent après sa
 * date d'effet (épinglage par période).
 */
import { createRequestContext, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isExclusionViolation } from "../infrastructure/pg";
import type { Tx } from "@ecoledigitale/database";
import { isValidIsoDate, type RuleStatus } from "../engine";
import { getContract } from "../contracts";
import { checkConformity, type ConformityReport } from "../domain/conformity";
import { computeDefinitionHash } from "../domain/definition";
import { RulesCode, conflict, notFound, validation } from "../domain/errors";
import { planTransition, requiresDecisionConfirmation } from "../domain/governance";
import { RulesEvents } from "../domain/events";
import type { GovernanceActor, RuleVersionRecord, VersionKind } from "../domain/types";
import { originOf } from "../domain/types";
import { findActiveOverlap, getRules, getVersion, patchVersionStatus } from "../infrastructure/catalog-repository";
import { getSimulation, listSimulationsForTarget } from "../infrastructure/simulations-repository";
import { readSettings } from "../infrastructure/settings-repository";
import { inSystemTx, inTx, type RulesDeps } from "./deps";
import {
  VERSION_AGGREGATE,
  auditVerbFor,
  eventTypeFor,
  newEventBuffer,
  recordAudit,
  recordVersionEvent,
  versionPayload,
  versionSnapshot,
  type WriteEnv,
} from "./support";

export interface TransitionInput {
  readonly versionId: string;
  readonly to: RuleStatus;
  readonly comment?: string | undefined;
  /** AC2.5 : l'administrateur confirme avoir pris connaissance de l'impact sur les décisions. */
  readonly confirmDecisionImpact?: boolean | undefined;
  /** Verrou optimiste (variantes). */
  readonly expectedRowVersion?: number | undefined;
}

export interface TransitionOutcome {
  readonly version: RuleVersionRecord;
  /** Part (en %) des décisions modifiées par la dernière simulation, si connue. */
  readonly decisionChangedPercent: string | null;
}

/** Événement de version d'un catalogue national, à diffuser aux tenants APRÈS commit (voir `fanOutNationalEvent`). */
export interface NationalFanOut {
  readonly type: string;
  readonly version: RuleVersionRecord;
  readonly comment: string | null;
}

function conformityError(report: ConformityReport): AppError {
  const first = report.violations[0];
  const failing = report.rules.find((r) => !r.ok);
  const message = first
    ? first.message
    : failing
      ? `La règle « ${failing.key} » ne compile pas : ${failing.diagnostics[0]?.message ?? "erreur inconnue"}`
      : "La version ne satisfait pas son contrat.";
  return conflict(RulesCode.CONTRACT_VIOLATION, message, {
    contractId: report.contractId,
    violations: report.violations.slice(0, 20),
    failingRules: report.rules.filter((r) => !r.ok).slice(0, 20).map((r) => ({ key: r.key, diagnostics: r.diagnostics.slice(0, 3) })),
  });
}

/** Vérifie le contrat d'une version (compilation incluse) ; `Err` nomme la clé et l'écart. */
export function requireConformity(version: RuleVersionRecord, rules: Parameters<typeof checkConformity>[1]): Result<ConformityReport, AppError> {
  const contract = getContract(version.contractId);
  if (!contract) return err(validation(RulesCode.UNKNOWN_CONTRACT, `Contrat inconnu : ${version.contractId}.`, "contractId"));
  const report = checkConformity(contract, rules);
  return report.ok ? ok(report) : err(conformityError(report));
}

/**
 * Cœur de la machine d'états : exécuté DANS une transaction (tenant ou système). Écrit le nouvel état, l'historique,
 * l'audit et, pour une variante, l'événement outbox ; renvoie aussi l'éventuel événement national à diffuser.
 */
export async function performTransition(
  deps: RulesDeps,
  tx: Tx,
  env: WriteEnv,
  input: TransitionInput,
): Promise<Result<TransitionOutcome & { fanOut: NationalFanOut | null }, AppError>> {
  const version = await getVersion(tx, env.kind, input.versionId, { forUpdate: true });
  if (!version) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", input.versionId));
  if (env.kind === "TENANT" && input.expectedRowVersion !== undefined && version.rowVersion !== input.expectedRowVersion) {
    return err(conflict(RulesCode.STALE_VERSION, "La version a été modifiée depuis votre lecture : rechargez-la.", { expected: input.expectedRowVersion, actual: version.rowVersion }));
  }

  const plan = planTransition({
    from: version.status,
    to: input.to,
    origin: originOf(env.kind),
    tenantId: env.tenantId,
    actor: env.actor,
    comment: input.comment,
  });
  if (!plan.ok) return plan;

  const now = deps.clock.now();
  const rules = await getRules(tx, env.kind, version.id);
  const hashNow = computeDefinitionHash(version.contractId, rules);
  const settings = await readSettings(tx);

  let definitionHash: string | null | undefined;
  let approvedBy: string | null | undefined;
  let lastSimulationId: string | null | undefined;
  let decisionImpactConfirmedBy: string | null | undefined;
  let clearSimulation = false;
  let decisionChangedPercent: string | null = null;

  switch (input.to) {
    case "simulated": {
      const conformity = requireConformity(version, rules);
      if (!conformity.ok) return conformity;
      if (env.kind === "TENANT") {
        const sims = await listSimulationsForTarget(tx, version.id);
        const valid = sims.find((s) => s.status === "COMPLETED" && s.targetDefinitionHash === hashNow);
        if (!valid) {
          return err(
            conflict(RulesCode.SIMULATION_REQUIRED, "Aucune simulation terminée ne correspond au contenu actuel de la variante : lancez (ou relancez) une simulation.", {
              versionId: version.id,
            }),
          );
        }
        lastSimulationId = valid.id;
        decisionChangedPercent = valid.decisionChangedPercent;
      }
      break;
    }
    case "proposed": {
      const conformity = requireConformity(version, rules);
      if (!conformity.ok) return conformity;
      definitionHash = hashNow;
      if (env.kind === "TENANT") {
        const sim = version.lastSimulationId ? await getSimulation(tx, version.lastSimulationId) : null;
        if (!sim || sim.status !== "COMPLETED" || sim.targetDefinitionHash !== hashNow) {
          return err(conflict(RulesCode.SIMULATION_REQUIRED, "La simulation ne correspond plus au contenu de la variante : relancez-la avant de proposer.", { versionId: version.id }));
        }
        decisionChangedPercent = sim.decisionChangedPercent;
        const percent = Number(sim.decisionChangedPercent ?? "0");
        if (requiresDecisionConfirmation(percent, settings.decisionImpactConfirmPercent)) {
          if (input.confirmDecisionImpact !== true) {
            return err(
              conflict(
                RulesCode.DECISION_IMPACT_CONFIRMATION_REQUIRED,
                `La simulation modifie ${sim.decisionChangedPercent} % des décisions (seuil : ${settings.decisionImpactConfirmPercent} %) : confirmez explicitement pour proposer.`,
                { decisionChangedPercent: sim.decisionChangedPercent, thresholdPercent: settings.decisionImpactConfirmPercent },
              ),
            );
          }
          decisionImpactConfirmedBy = env.actor.id;
        }
      }
      break;
    }
    case "approved": {
      if (version.definitionHash !== hashNow) return err(hashMismatch(version, hashNow));
      const conformity = requireConformity(version, rules);
      if (!conformity.ok) return conformity;
      const overlaps = await findActiveOverlap(tx, env.kind, version);
      if (overlaps.length > 0) return err(overlapError(version, overlaps));
      if (env.kind === "NATIONAL" && settings.nationalFourEyes && version.createdBy && env.actor.id === version.createdBy) {
        return err(conflict(RulesCode.FOUR_EYES, "L'auteur d'une version nationale ne peut pas l'approuver (séparation des tâches).", { versionId: version.id }));
      }
      if (!env.actor.id) return err(validation(RulesCode.INVALID_INPUT, "L'approbation doit être signée par une identité.", "actor"));
      approvedBy = env.actor.id;
      break;
    }
    case "published": {
      if (version.definitionHash !== hashNow) return err(hashMismatch(version, hashNow));
      const overlaps = await findActiveOverlap(tx, env.kind, version);
      if (overlaps.length > 0) return err(overlapError(version, overlaps));
      break;
    }
    case "draft": {
      definitionHash = null;
      clearSimulation = true;
      break;
    }
    default:
      break;
  }

  let updated: RuleVersionRecord;
  try {
    updated = await patchVersionStatus(tx, env.kind, version.id, {
      status: input.to,
      now,
      definitionHash,
      approvedBy,
      lastSimulationId,
      clearSimulation,
      decisionImpactConfirmedBy,
    });
  } catch (e) {
    if (isExclusionViolation(e)) return err(overlapError(version, []));
    throw e;
  }

  await recordVersionEvent(deps, tx, env, version.id, version.status, input.to, plan.value.comment);

  const verb = auditVerbFor(version.status, input.to, env.actor);
  const eventType = eventTypeFor(version.status, input.to, env.actor);
  if (env.kind === "TENANT" && env.ctx && eventType) {
    const events = newEventBuffer(deps, env.ctx);
    events.add(eventType, { ...versionPayload(updated, { comment: plan.value.comment, simulationId: updated.lastSimulationId }) }, { type: VERSION_AGGREGATE, id: updated.id });
    await events.flush(tx);
  }
  // L'audit est écrit EN DERNIER : il verrouille la tête de chaîne du tenant (ordre constant, pas d'interblocage).
  await recordAudit(deps, tx, env, {
    action: `rules.version.${verb}`,
    entity: "rule_version",
    entityId: updated.id,
    before: versionSnapshot(version),
    after: versionSnapshot(updated),
    reason: plan.value.comment,
    severity: ["approved", "published", "retired", "rejected"].includes(verb) ? "notice" : "info",
    metadata: {
      origin: originOf(env.kind),
      ruleSet: updated.ruleSetCode,
      contractId: updated.contractId,
      actorKind: env.actor.kind,
      ...(decisionChangedPercent !== null ? { decisionChangedPercent } : {}),
      ...(decisionImpactConfirmedBy ? { decisionImpactConfirmed: true } : {}),
    },
  });

  deps.cache.evictVersion(updated.id);
  const fanOut: NationalFanOut | null =
    env.kind === "NATIONAL" && eventType && [RulesEvents.VERSION_APPROVED, RulesEvents.VERSION_PUBLISHED, RulesEvents.VERSION_RETIRED].includes(eventType as never)
      ? { type: eventType, version: updated, comment: plan.value.comment }
      : null;
  return ok({ version: updated, decisionChangedPercent, fanOut });
}

function hashMismatch(version: RuleVersionRecord, actual: string): AppError {
  return conflict(RulesCode.HASH_MISMATCH, "Le contenu de la version ne correspond plus à son empreinte : usage bloqué.", {
    versionId: version.id,
    expectedHash: version.definitionHash,
    actualHash: actual,
  });
}

function overlapError(version: RuleVersionRecord, overlaps: readonly RuleVersionRecord[]): AppError {
  return conflict(RulesCode.OVERLAP, "Une autre version active du même jeu de règles couvre déjà tout ou partie de cette période d'effet.", {
    versionId: version.id,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    conflictingVersions: overlaps.map((o) => ({ id: o.id, versionNo: o.versionNo, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo, status: o.status })),
  });
}

/* ------------------------------ points d'entrée ------------------------------ */

/** Un administrateur d'établissement fait évoluer SA variante (simuler, proposer, retirer sa proposition). */
export async function transitionTenantVersion(
  deps: RulesDeps,
  ctx: RequestContext,
  input: TransitionInput & { actorName?: string },
): Promise<Result<TransitionOutcome, AppError>> {
  if (!ctx.userId) return err(validation(RulesCode.INVALID_INPUT, "Une transition exige un utilisateur identifié.", "actor"));
  const actor: GovernanceActor = { kind: "tenant_admin", id: ctx.userId, name: input.actorName ?? ctx.userId };
  const result = await inTx(deps, ctx, (tx) => performTransition(deps, tx, { kind: "TENANT", tenantId: ctx.tenantId, ctx, actor }, input));
  if (!result.ok) return result;
  return ok({ version: result.value.version, decisionChangedPercent: result.value.decisionChangedPercent });
}

export interface Operator {
  readonly id: string;
  readonly name?: string | undefined;
}

/** Contexte d'un opérateur de la plateforme agissant SUR un tenant (variante : approbation, rejet, publication, retrait). */
export function operatorContext(tenantId: string, operator: Operator, requestId?: string): RequestContext {
  return createRequestContext({ tenantId, userId: operator.id, actor: "superAdmin", ...(requestId ? { requestId } : {}) });
}

/**
 * Le super-administrateur fait avancer une version : variante d'un établissement (`tenantId` fourni) ou version du
 * catalogue national (sans `tenantId`). Pour le catalogue national, l'événement est diffusé APRÈS commit à chaque tenant actif.
 */
export async function transitionAsOperator(
  deps: RulesDeps,
  operator: Operator,
  input: TransitionInput & { tenantId?: string | undefined; requestId?: string | undefined },
): Promise<Result<TransitionOutcome, AppError>> {
  const actor: GovernanceActor = { kind: "super_admin", id: operator.id, name: operator.name ?? operator.id };
  if (input.tenantId) {
    const ctx = operatorContext(input.tenantId, operator, input.requestId);
    const result = await inTx(deps, ctx, (tx) => performTransition(deps, tx, { kind: "TENANT", tenantId: input.tenantId ?? null, ctx, actor }, input));
    if (!result.ok) return result;
    return ok({ version: result.value.version, decisionChangedPercent: result.value.decisionChangedPercent });
  }
  const result = await inSystemTx(deps, `rules-national-${input.to}`, (tx) => performTransition(deps, tx, { kind: "NATIONAL", tenantId: null, ctx: null, actor }, input));
  if (!result.ok) return result;
  if (result.value.fanOut) await fanOutNationalEvent(deps, result.value.fanOut);
  return ok({ version: result.value.version, decisionChangedPercent: null });
}

export interface ClosePeriodInput {
  readonly versionId: string;
  /** Dernier jour d'application (inclus) ; ne peut que RACCOURCIR la période d'effet. */
  readonly effectiveTo: string;
  readonly comment?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly requestId?: string | undefined;
}

/**
 * Clôture la période d'effet d'une version approuvée ou publiée (seule modification permise d'une version figée, R-RUL-02).
 * C'est ce qui permet de planifier la version suivante sans chevauchement (AC3.3). Tracée dans l'historique et l'audit ;
 * réservée au super-administrateur. N'altère aucun résultat existant : les périodes déjà épinglées gardent leur version.
 */
export async function closeVersionPeriod(deps: RulesDeps, operator: Operator, input: ClosePeriodInput): Promise<Result<RuleVersionRecord, AppError>> {
  if (!isValidIsoDate(input.effectiveTo)) return err(validation(RulesCode.INVALID_INPUT, "Date d'effet invalide (format attendu : AAAA-MM-JJ).", "effectiveTo"));
  const actor: GovernanceActor = { kind: "super_admin", id: operator.id, name: operator.name ?? operator.id };
  const run = async (tx: Tx, env: WriteEnv): Promise<Result<RuleVersionRecord, AppError>> => {
    const version = await getVersion(tx, env.kind, input.versionId, { forUpdate: true });
    if (!version) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", input.versionId));
    if (version.status !== "approved" && version.status !== "published") {
      return err(conflict(RulesCode.TRANSITION_FORBIDDEN, `Seule la période d'une version approuvée ou publiée se clôture (statut : ${version.status}).`, { status: version.status }));
    }
    if (input.effectiveTo < version.effectiveFrom) return err(validation(RulesCode.INVALID_INPUT, "La fin d'effet doit être postérieure ou égale au début.", "effectiveTo"));
    if (version.effectiveTo !== null && input.effectiveTo >= version.effectiveTo) {
      return err(validation(RulesCode.INVALID_INPUT, "Une période d'effet ne peut qu'être raccourcie.", "effectiveTo"));
    }
    const updated = await patchVersionStatus(tx, env.kind, version.id, { status: version.status, now: deps.clock.now(), setEffectiveTo: true, effectiveTo: input.effectiveTo });
    await recordVersionEvent(deps, tx, env, version.id, version.status, version.status, `Période d'effet clôturée au ${input.effectiveTo}.${input.comment ? ` ${input.comment}` : ""}`);
    await recordAudit(deps, tx, env, {
      action: "rules.version.period_closed",
      entity: "rule_version",
      entityId: version.id,
      before: versionSnapshot(version),
      after: versionSnapshot(updated),
      reason: input.comment ?? null,
      severity: "notice",
      metadata: { origin: originOf(env.kind), ruleSet: version.ruleSetCode },
    });
    deps.cache.evictVersion(version.id);
    return ok(updated);
  };
  if (input.tenantId) {
    const ctx = operatorContext(input.tenantId, operator, input.requestId);
    return inTx(deps, ctx, (tx) => run(tx, { kind: "TENANT", tenantId: input.tenantId ?? null, ctx, actor }));
  }
  return inSystemTx(deps, "rules-national-close-period", (tx) => run(tx, { kind: "NATIONAL", tenantId: null, ctx: null, actor }));
}

/**
 * Diffuse un événement du catalogue national dans l'outbox de CHAQUE tenant actif (une transaction par tenant :
 * l'outbox est par tenant). Non atomique avec la publication nationale — l'événement ne sert qu'à libérer des caches et à
 * alerter (« périodes en retard de version »), jamais à la justesse ; un échec par tenant est journalisé, pas bloquant.
 */
export async function fanOutNationalEvent(deps: RulesDeps, fan: NationalFanOut): Promise<void> {
  const report = await deps.systemDb.forEachTenant(`rules-fanout-${fan.type}`, async (tx, tenant) => {
    const ctx = createRequestContext({ tenantId: tenant.id, actor: "system", userId: null });
    const events = newEventBuffer(deps, ctx);
    events.add(fan.type, { ...versionPayload(fan.version, { comment: fan.comment }) }, { type: VERSION_AGGREGATE, id: fan.version.id });
    await events.flush(tx);
  });
  for (const f of report.failed) {
    deps.logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "rules : diffusion d'un événement national en échec");
  }
}

export type { VersionKind };
