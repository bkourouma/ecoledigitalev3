/**
 * Types du domaine `rules` (aucun import pg / fastify). Les identifiants du cœur académique (établissement,
 * nœud de curriculum…) ne sont connus que par UUID.
 */
import type { ParameterSpec, ResultTypeSpec, RuleSchemaSpec, RuleSource, RuleStatus, RuleType } from "../engine";

/** Famille de tables : catalogue NATIONAL (global) ou variante d'établissement (RLS tenant). */
export type VersionKind = "NATIONAL" | "TENANT";
export type Origin = "national" | "tenant";

export const originOf = (kind: VersionKind): Origin => (kind === "NATIONAL" ? "national" : "tenant");

export type LabelMap = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Règle d'une version, telle que persistée. */
export interface RuleDefinitionRecord {
  readonly key: string;
  readonly type: RuleType;
  readonly position: number;
  readonly expression: string;
  readonly description: string | null;
  readonly parameters: Readonly<Record<string, ParameterSpec>>;
  /** `null` : le schéma d'entrée du contrat s'applique. */
  readonly inputSchema: RuleSchemaSpec | null;
  /** `null` : le type de résultat du contrat s'applique. */
  readonly resultType: ResultTypeSpec | null;
  readonly labelMap: LabelMap;
  readonly isOptional: boolean;
}

export interface RuleSetRecord {
  readonly kind: VersionKind;
  readonly id: string;
  /** `null` pour le catalogue national. */
  readonly tenantId: string | null;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly regulation: string | null;
  readonly educationSystem: string | null;
  readonly level: string | null;
  readonly basedOnSetId: string | null;
}

export interface RuleVersionRecord {
  readonly kind: VersionKind;
  readonly id: string;
  readonly tenantId: string | null;
  readonly ruleSetId: string;
  readonly ruleSetCode: string;
  readonly versionNo: number;
  readonly status: RuleStatus;
  readonly contractId: string;
  readonly basedOnVersionId: string | null;
  /** « AAAA-MM-JJ », bornes incluses. */
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly source: RuleSource;
  readonly definitionHash: string | null;
  readonly lastSimulationId: string | null;
  readonly decisionImpactConfirmedBy: string | null;
  readonly notes: string | null;
  readonly createdBy: string | null;
  readonly approvedBy: string | null;
  /** Verrou optimiste (variantes) ; 0 pour le national. */
  readonly rowVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RuleVersionWithRules extends RuleVersionRecord {
  readonly rules: readonly RuleDefinitionRecord[];
}

export interface VersionEventRecord {
  readonly id: string;
  readonly ruleVersionId: string;
  readonly fromStatus: RuleStatus | null;
  readonly toStatus: RuleStatus;
  readonly actorId: string | null;
  readonly actorName: string;
  readonly actorKind: "tenant_admin" | "super_admin" | "system";
  readonly comment: string | null;
  readonly occurredAt: Date;
}

export interface BindingRecord {
  readonly id: string;
  readonly contractId: string;
  readonly ruleSetCode: string;
  readonly institutionId: string | null;
  readonly curriculumNodeId: string | null;
  readonly levelCode: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

export type SimulationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface SimulationRecord {
  readonly id: string;
  readonly targetVersionKind: VersionKind;
  readonly targetVersionId: string;
  readonly baseVersionKind: VersionKind;
  readonly baseVersionId: string;
  readonly targetDefinitionHash: string;
  readonly contractId: string;
  readonly dataset: unknown;
  readonly status: SimulationStatus;
  readonly progressPercent: number;
  readonly casesCount: number | null;
  readonly summary: unknown;
  readonly ruleStats: unknown;
  readonly decisionChangedPercent: string | null;
  readonly differencesTruncated: boolean;
  readonly error: string | null;
  readonly requestedBy: string;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

/** Qui agit sur une version (identité figée dans l'historique). */
export interface GovernanceActor {
  readonly kind: "tenant_admin" | "super_admin" | "system";
  readonly id: string | null;
  readonly name: string;
}
