/**
 * Lignes SQL ↔ enregistrements du domaine. Les dates calendaires sont lues en texte `AAAA-MM-JJ` (`to_char`) :
 * jamais d'objet `Date` (le fuseau du processus ne doit pas décaler un jour d'effet).
 */
import type { ParameterSpec, ResultTypeSpec, RuleSchemaSpec, RuleSource, RuleStatus, RuleType } from "../engine";
import type {
  BindingRecord,
  GovernanceActor,
  LabelMap,
  RuleDefinitionRecord,
  RuleSetRecord,
  RuleVersionRecord,
  SimulationRecord,
  SimulationStatus,
  VersionEventRecord,
  VersionKind,
} from "../domain/types";

export interface VersionTables {
  readonly sets: string;
  readonly versions: string;
  readonly defs: string;
  readonly events: string;
}

/** Noms de tables FIXES (jamais issus d'une entrée utilisateur) : l'interpolation SQL n'y est pas une injection. */
export const TABLES: Readonly<Record<VersionKind, VersionTables>> = Object.freeze({
  NATIONAL: Object.freeze({
    sets: "rules.national_rule_sets",
    versions: "rules.national_rule_versions",
    defs: "rules.national_rule_definitions",
    events: "rules.national_version_events",
  }),
  TENANT: Object.freeze({
    sets: "rules.rule_sets",
    versions: "rules.rule_versions",
    defs: "rules.rule_definitions",
    events: "rules.version_events",
  }),
});

/* ------------------------------- ensembles ------------------------------- */

export interface RuleSetRow {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  country_code: string;
  regulation: string | null;
  education_system: string | null;
  level: string | null;
  based_on_set_id: string | null;
}

export function setColumns(kind: VersionKind, alias = "s"): string {
  return kind === "TENANT"
    ? `${alias}.id, ${alias}.tenant_id, ${alias}.code, ${alias}.name, ${alias}.country_code, ${alias}.regulation, ${alias}.education_system, ${alias}.level, ${alias}.based_on_set_id`
    : `${alias}.id, NULL::uuid AS tenant_id, ${alias}.code, ${alias}.name, ${alias}.country_code, ${alias}.regulation, ${alias}.education_system, ${alias}.level, NULL::uuid AS based_on_set_id`;
}

export function toRuleSet(kind: VersionKind, r: RuleSetRow): RuleSetRecord {
  return {
    kind,
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    countryCode: r.country_code,
    regulation: r.regulation,
    educationSystem: r.education_system,
    level: r.level,
    basedOnSetId: r.based_on_set_id,
  };
}

/* ------------------------------- versions ------------------------------- */

export interface RuleVersionRow {
  id: string;
  tenant_id: string | null;
  rule_set_id: string;
  rule_set_code: string;
  version: number;
  status: RuleStatus;
  contract_id: string;
  based_on_version_id: string | null;
  effective_from: string;
  effective_to: string | null;
  source_kind: RuleSource["kind"];
  source_reference: string | null;
  source_url: string | null;
  source_description: string | null;
  definition_hash: string | null;
  last_simulation_id: string | null;
  decision_impact_confirmed_by: string | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  row_version: number;
  created_at: Date;
  updated_at: Date;
}

/** Colonnes d'une version (alias `v`) jointe à son jeu (alias `s`). */
export function versionColumns(kind: VersionKind): string {
  const common =
    "v.id, v.rule_set_id, s.code AS rule_set_code, v.version, v.status, v.contract_id, " +
    "to_char(v.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(v.effective_to, 'YYYY-MM-DD') AS effective_to, " +
    "v.source_kind, v.source_reference, v.source_url, v.source_description, v.definition_hash, v.notes, " +
    "v.created_by, v.approved_by, v.created_at, v.updated_at";
  return kind === "TENANT"
    ? `${common}, v.tenant_id, v.based_on_version_id, v.last_simulation_id, v.decision_impact_confirmed_by, v.row_version`
    : `${common}, NULL::uuid AS tenant_id, NULL::uuid AS based_on_version_id, NULL::uuid AS last_simulation_id, NULL::uuid AS decision_impact_confirmed_by, 0 AS row_version`;
}

export function toVersion(kind: VersionKind, r: RuleVersionRow): RuleVersionRecord {
  const source: RuleSource = {
    kind: r.source_kind,
    ...(r.source_reference ? { reference: r.source_reference } : {}),
    ...(r.source_url ? { url: r.source_url } : {}),
    ...(r.source_description ? { description: r.source_description } : {}),
  };
  return {
    kind,
    id: r.id,
    tenantId: r.tenant_id,
    ruleSetId: r.rule_set_id,
    ruleSetCode: r.rule_set_code,
    versionNo: Number(r.version),
    status: r.status,
    contractId: r.contract_id,
    basedOnVersionId: r.based_on_version_id,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    source,
    definitionHash: r.definition_hash,
    lastSimulationId: r.last_simulation_id,
    decisionImpactConfirmedBy: r.decision_impact_confirmed_by,
    notes: r.notes,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    rowVersion: Number(r.row_version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ------------------------------- définitions ------------------------------- */

export interface RuleDefinitionRow {
  key: string;
  type: RuleType;
  position: number;
  expression: string;
  description: string | null;
  parameters: Record<string, ParameterSpec> | null;
  input_schema: RuleSchemaSpec | null;
  result_type: ResultTypeSpec | null;
  label_map: LabelMap | null;
  is_optional: boolean;
}

export const DEFINITION_COLUMNS = "key, type, position, expression, description, parameters, input_schema, result_type, label_map, is_optional";

export function toDefinition(r: RuleDefinitionRow): RuleDefinitionRecord {
  return {
    key: r.key,
    type: r.type,
    position: Number(r.position),
    expression: r.expression,
    description: r.description,
    parameters: r.parameters ?? {},
    inputSchema: r.input_schema,
    resultType: r.result_type,
    labelMap: r.label_map ?? {},
    isOptional: r.is_optional,
  };
}

/* ------------------------------- historique ------------------------------- */

export interface VersionEventRow {
  id: string;
  rule_version_id: string;
  from_status: RuleStatus | null;
  to_status: RuleStatus;
  actor_id: string | null;
  actor_name: string;
  actor_kind: GovernanceActor["kind"] | null;
  comment: string | null;
  occurred_at: Date;
}

export function toEvent(r: VersionEventRow): VersionEventRecord {
  return {
    id: r.id,
    ruleVersionId: r.rule_version_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorKind: r.actor_kind ?? "super_admin",
    comment: r.comment,
    occurredAt: r.occurred_at,
  };
}

/* ------------------------------- liaisons ------------------------------- */

export interface BindingRow {
  id: string;
  contract_id: string;
  rule_set_code: string;
  institution_id: string | null;
  curriculum_node_id: string | null;
  level_code: string | null;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: Date;
  placeholder_ack_by: string | null;
  placeholder_ack_at: Date | null;
  placeholder_ack_reason: string | null;
}

export const BINDING_COLUMNS =
  "id, contract_id, rule_set_code, institution_id, curriculum_node_id, level_code, " +
  "to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to, created_by, created_at, " +
  "placeholder_ack_by, placeholder_ack_at, placeholder_ack_reason";

export function toBinding(r: BindingRow): BindingRecord {
  return {
    id: r.id,
    contractId: r.contract_id,
    ruleSetCode: r.rule_set_code,
    institutionId: r.institution_id,
    curriculumNodeId: r.curriculum_node_id,
    levelCode: r.level_code,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    createdBy: r.created_by,
    createdAt: r.created_at,
    placeholderAck:
      r.placeholder_ack_by && r.placeholder_ack_at && r.placeholder_ack_reason
        ? { by: r.placeholder_ack_by, at: r.placeholder_ack_at, reason: r.placeholder_ack_reason }
        : null,
  };
}

/* ------------------------------ simulations ------------------------------ */

export interface SimulationRow {
  id: string;
  target_version_kind: VersionKind;
  target_version_id: string;
  base_version_kind: VersionKind;
  base_version_id: string;
  target_definition_hash: string;
  contract_id: string;
  dataset: unknown;
  status: SimulationStatus;
  progress_percent: number;
  cases_count: number | null;
  summary: unknown;
  rule_stats: unknown;
  decision_changed_percent: string | null;
  differences_truncated: boolean;
  error: string | null;
  requested_by: string;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export const SIMULATION_COLUMNS =
  "id, target_version_kind, target_version_id, base_version_kind, base_version_id, target_definition_hash, contract_id, dataset, status, " +
  "progress_percent, cases_count, summary, rule_stats, decision_changed_percent::text AS decision_changed_percent, differences_truncated, error, " +
  "requested_by, started_at, completed_at, created_at";

export function toSimulation(r: SimulationRow): SimulationRecord {
  return {
    id: r.id,
    targetVersionKind: r.target_version_kind,
    targetVersionId: r.target_version_id,
    baseVersionKind: r.base_version_kind,
    baseVersionId: r.base_version_id,
    targetDefinitionHash: r.target_definition_hash,
    contractId: r.contract_id,
    dataset: r.dataset,
    status: r.status,
    progressPercent: Number(r.progress_percent),
    casesCount: r.cases_count === null ? null : Number(r.cases_count),
    summary: r.summary,
    ruleStats: r.rule_stats,
    decisionChangedPercent: r.decision_changed_percent,
    differencesTruncated: r.differences_truncated,
    error: r.error,
    requestedBy: r.requested_by,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}
