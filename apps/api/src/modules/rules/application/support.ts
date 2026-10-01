/**
 * Plomberie commune des cas d'usage d'écriture : environnement d'exécution (famille de tables, acteur, journal d'audit),
 * audit, historique de gouvernance et événements de version.
 */
import type { Tx } from "@ecoledigitale/database";
import type { RequestContext } from "@ecoledigitale/kernel";
import type { RuleStatus } from "../engine";
import { RulesEvents, type VersionEventPayload } from "../domain/events";
import type { GovernanceActor, RuleVersionRecord, VersionKind } from "../domain/types";
import { originOf } from "../domain/types";
import { insertVersionEvent } from "../infrastructure/catalog-repository";
import { EventBuffer, type RulesDeps } from "./deps";
import type { RulesAuditEntry } from "./ports";

/**
 * Où et qui : catalogue national (transaction système, journal de plateforme) ou variante d'un établissement
 * (transaction du tenant, journal du tenant). L'acteur est figé dans l'historique.
 */
export interface WriteEnv {
  readonly kind: VersionKind;
  readonly tenantId: string | null;
  /** Contexte de la transaction tenant ; `null` pour le catalogue national. */
  readonly ctx: RequestContext | null;
  readonly actor: GovernanceActor;
}

export function auditActorOf(env: WriteEnv): RulesAuditEntry["actor"] | undefined {
  // Dans une transaction tenant, l'acteur est dérivé du contexte (utilisateur ou super-administrateur).
  if (env.kind === "TENANT") return undefined;
  return env.actor.kind === "system" ? { type: "system", id: null } : { type: "superAdmin", id: env.actor.id };
}

export async function recordAudit(deps: RulesDeps, tx: Tx, env: WriteEnv, entry: RulesAuditEntry): Promise<void> {
  if (env.kind === "NATIONAL") {
    await deps.audit.recordPlatform(tx, { ...entry, actor: entry.actor ?? auditActorOf(env) });
  } else {
    await deps.audit.record(tx, entry);
  }
}

export function versionSnapshot(v: RuleVersionRecord): Record<string, unknown> {
  return {
    ruleSet: v.ruleSetCode,
    versionNo: v.versionNo,
    status: v.status,
    contractId: v.contractId,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    definitionHash: v.definitionHash,
  };
}

export async function recordVersionEvent(
  deps: RulesDeps,
  tx: Tx,
  env: WriteEnv,
  versionId: string,
  from: RuleStatus | null,
  to: RuleStatus,
  comment?: string | null,
): Promise<void> {
  await insertVersionEvent(tx, env.kind, env.tenantId, {
    id: deps.newId(),
    ruleVersionId: versionId,
    fromStatus: from,
    toStatus: to,
    actor: env.actor,
    comment: comment ?? null,
    occurredAt: deps.clock.now(),
  });
}

export function versionPayload(v: RuleVersionRecord, extra: Partial<VersionEventPayload> = {}): VersionEventPayload {
  return {
    v: 1,
    ruleVersionId: v.id,
    ruleSetCode: v.ruleSetCode,
    versionNo: v.versionNo,
    origin: originOf(v.kind),
    contractId: v.contractId,
    effectiveFrom: v.effectiveFrom,
    definitionHash: v.definitionHash,
    ...extra,
  };
}

export const VERSION_AGGREGATE = "rule_version";

/** Événement de version de la transition `to`, ou `null` si cette transition n'en publie pas. */
export function eventTypeFor(from: RuleStatus, to: RuleStatus, actor: GovernanceActor): string | null {
  if (to === "proposed") return RulesEvents.VERSION_PROPOSED;
  if (to === "approved") return RulesEvents.VERSION_APPROVED;
  if (to === "published") return RulesEvents.VERSION_PUBLISHED;
  if (to === "retired") return RulesEvents.VERSION_RETIRED;
  if (to === "draft" && from === "proposed" && actor.kind === "super_admin") return RulesEvents.VERSION_REJECTED;
  return null;
}

/** Verbe d'audit de la transition (`rules.version.<verbe>`). */
export function auditVerbFor(from: RuleStatus, to: RuleStatus, actor: GovernanceActor): string {
  if (to === "draft") return from === "proposed" ? (actor.kind === "super_admin" ? "rejected" : "withdrawn") : "reopened";
  return to;
}

export function newEventBuffer(deps: RulesDeps, ctx: RequestContext): EventBuffer {
  return new EventBuffer(deps, ctx);
}
