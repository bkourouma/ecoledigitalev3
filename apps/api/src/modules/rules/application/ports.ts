/**
 * Ports du module `rules` : tout ce qui vient d'ailleurs (audit, données réelles du tenant pour la simulation)
 * est décrit STRUCTURELLEMENT, sans importer un autre module.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";

/** Entrée d'audit telle que l'attend `audit.record` (voir `RuntimeAuditEntry` de la plateforme). */
export interface RulesAuditEntry {
  /** `entité.verbe`, ex. `rules.version.approved`. */
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
  actor?: { type: "user" | "system" | "superAdmin" | "impersonation"; id: string | null; impersonatedBy?: string | null };
}

/** `runtime.auditPort` : `record` dans la transaction d'un tenant, `recordPlatform` pour le journal de plateforme. */
export interface RulesAuditPort {
  record(tx: Tx, entry: RulesAuditEntry): Promise<unknown>;
  recordPlatform(tx: Tx, entry: RulesAuditEntry): Promise<unknown>;
}

export const noopAudit: RulesAuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit n'est pas branché */
  },
  async recordPlatform(): Promise<void> {
    /* le module audit n'est pas branché */
  },
});

/* ------------------------------ simulation ------------------------------ */

/** Cas de simulation : contexte d'entrée d'UNE évaluation par règle (jamais d'identité d'élève). */
export interface SimulationCaseInput {
  /** Référence opaque du cas (ex. `<inscription>:<période>`), pour le lien vers l'élève côté consommateur. */
  readonly id: string;
  readonly label?: string;
  readonly context: {
    readonly variables?: Readonly<Record<string, unknown>> | undefined;
    readonly lookups?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  };
}

/**
 * Les règles d'un contrat s'évaluent sur des contextes DIFFÉRENTS (une moyenne d'UE n'a pas les mêmes variables
 * qu'une mention) : le consommateur fournit des GROUPES de cas, chacun limité aux règles qu'il alimente
 * (en général une étape du pipeline du contrat).
 */
export interface SimulationCaseGroup {
  readonly ruleKeys: readonly string[];
  readonly cases: readonly SimulationCaseInput[];
}

export interface SimulationDataset {
  readonly periodIds: readonly string[];
  readonly classroomIds?: readonly string[] | undefined;
  readonly sample?: { readonly size?: number | undefined; readonly seed?: number | undefined } | undefined;
}

export interface SimulationCaseRequest {
  readonly ctx: RequestContext;
  readonly contractId: string;
  readonly dataset: SimulationDataset;
  /** Progression 0–100 (écrite dans la simulation). */
  progress(percent: number): Promise<void>;
}

/**
 * Port implémenté par le module consommateur (`results`) : construit les cas depuis les données RÉELLES du tenant
 * (notes publiées, curriculum, surcharges approuvées), de façon déterministe et sans donnée d'identité.
 */
export interface SimulationCaseSource {
  buildCaseGroups(request: SimulationCaseRequest): Promise<readonly SimulationCaseGroup[]>;
}

/* ------------------------------- rejeu ------------------------------- */

/** Un résultat enregistré par un consommateur, à rejouer (AC4.3). */
export interface ReplayRecord {
  readonly resultId: string;
  readonly ruleVersionId: string;
  readonly definitionHash: string;
  readonly engineVersion: string;
  readonly ruleKey: string;
  readonly context: SimulationCaseInput["context"];
  readonly overrides?: Readonly<Record<string, number | string | boolean>> | undefined;
  readonly inputsHash: string;
  readonly outputsHash: string;
}

/** Échantillon fourni par le consommateur : ≥ `percent` % des résultats FINAL + les résultats portés par un bulletin contesté. */
export interface ReplaySource {
  sample(request: { ctx: RequestContext; percent: number }): Promise<readonly ReplayRecord[]>;
}
