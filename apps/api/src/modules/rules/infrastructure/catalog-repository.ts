/**
 * Accès SQL au catalogue : ensembles, versions, règles et historique, pour les DEUX familles de tables
 * (national global / variantes d'établissement sous RLS). Toutes les fonctions prennent le `Tx` d'une transaction
 * `TenantDb` ou `SystemDb` : jamais de pool direct. Les noms de tables viennent de `TABLES` (constantes).
 */
import type { Tx } from "@ecoledigitale/database";
import type { RuleStatus } from "../engine";
import type {
  GovernanceActor,
  RuleDefinitionRecord,
  RuleSetRecord,
  RuleVersionRecord,
  RuleVersionWithRules,
  VersionEventRecord,
  VersionKind,
} from "../domain/types";
import {
  DEFINITION_COLUMNS,
  TABLES,
  setColumns,
  toDefinition,
  toEvent,
  toRuleSet,
  toVersion,
  versionColumns,
  type RuleDefinitionRow,
  type RuleSetRow,
  type RuleVersionRow,
  type VersionEventRow,
} from "./rows";

const json = (v: unknown): string => JSON.stringify(v);

/* ------------------------------- ensembles ------------------------------- */

export async function listRuleSets(tx: Tx, kind: VersionKind): Promise<RuleSetRecord[]> {
  const rows = await tx.many<RuleSetRow>(`SELECT ${setColumns(kind)} FROM ${TABLES[kind].sets} s ORDER BY s.code`);
  return rows.map((r) => toRuleSet(kind, r));
}

export async function getRuleSetByCode(tx: Tx, kind: VersionKind, code: string): Promise<RuleSetRecord | null> {
  const row = await tx.queryOne<RuleSetRow>(`SELECT ${setColumns(kind)} FROM ${TABLES[kind].sets} s WHERE s.code = $1`, [code]);
  return row ? toRuleSet(kind, row) : null;
}

export async function getRuleSetById(tx: Tx, kind: VersionKind, id: string): Promise<RuleSetRecord | null> {
  const row = await tx.queryOne<RuleSetRow>(`SELECT ${setColumns(kind)} FROM ${TABLES[kind].sets} s WHERE s.id = $1`, [id]);
  return row ? toRuleSet(kind, row) : null;
}

export interface NewRuleSet {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly regulation?: string | null | undefined;
  readonly educationSystem?: string | null | undefined;
  readonly level?: string | null | undefined;
  readonly basedOnSetId?: string | null | undefined;
}

export async function insertRuleSet(tx: Tx, kind: VersionKind, tenantId: string | null, s: NewRuleSet): Promise<RuleSetRecord> {
  if (kind === "TENANT") {
    await tx.query(
      `INSERT INTO rules.rule_sets (id, tenant_id, code, name, country_code, regulation, education_system, level, based_on_set_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [s.id, tenantId, s.code, s.name, s.countryCode, s.regulation ?? null, s.educationSystem ?? null, s.level ?? null, s.basedOnSetId ?? null],
    );
  } else {
    await tx.query(
      `INSERT INTO rules.national_rule_sets (id, code, name, country_code, regulation, education_system, level)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.id, s.code, s.name, s.countryCode, s.regulation ?? null, s.educationSystem ?? null, s.level ?? null],
    );
  }
  return (await getRuleSetById(tx, kind, s.id)) as RuleSetRecord;
}

/* ------------------------------- versions ------------------------------- */

export interface VersionFilter {
  readonly ruleSetId?: string;
  readonly ruleSetCode?: string;
  readonly statuses?: readonly RuleStatus[];
  readonly contractId?: string;
}

export async function listVersions(tx: Tx, kind: VersionKind, filter: VersionFilter = {}): Promise<RuleVersionRecord[]> {
  const t = TABLES[kind];
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ruleSetId) where.push(`v.rule_set_id = $${params.push(filter.ruleSetId)}`);
  if (filter.ruleSetCode) where.push(`s.code = $${params.push(filter.ruleSetCode)}`);
  if (filter.contractId) where.push(`v.contract_id = $${params.push(filter.contractId)}`);
  if (filter.statuses && filter.statuses.length > 0) where.push(`v.status = ANY($${params.push([...filter.statuses])}::text[])`);
  const rows = await tx.many<RuleVersionRow>(
    `SELECT ${versionColumns(kind)} FROM ${t.versions} v JOIN ${t.sets} s ON s.id = v.rule_set_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.code, v.version`,
    params,
  );
  return rows.map((r) => toVersion(kind, r));
}

export async function getVersion(tx: Tx, kind: VersionKind, id: string, options: { forUpdate?: boolean } = {}): Promise<RuleVersionRecord | null> {
  const t = TABLES[kind];
  // FOR UPDATE OF v : ne verrouille que la ligne de la version (pas celle du jeu).
  const row = await tx.queryOne<RuleVersionRow>(
    `SELECT ${versionColumns(kind)} FROM ${t.versions} v JOIN ${t.sets} s ON s.id = v.rule_set_id
      WHERE v.id = $1 ${options.forUpdate ? "FOR UPDATE OF v" : ""}`,
    [id],
  );
  return row ? toVersion(kind, row) : null;
}

/** Une version par identifiant, dans la famille de l'établissement d'abord, puis dans le catalogue national. */
export async function findVersion(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<RuleVersionRecord | null> {
  return (await getVersion(tx, "TENANT", id, options)) ?? (await getVersion(tx, "NATIONAL", id, options));
}

export async function nextVersionNo(tx: Tx, kind: VersionKind, ruleSetId: string): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(`SELECT coalesce(max(version), 0) + 1 AS n FROM ${TABLES[kind].versions} WHERE rule_set_id = $1`, [ruleSetId]);
  return Number(row?.n ?? 1);
}

export interface NewVersion {
  readonly id: string;
  readonly ruleSetId: string;
  readonly versionNo: number;
  readonly contractId: string;
  readonly basedOnVersionId?: string | null | undefined;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null | undefined;
  readonly source: { kind: string; reference?: string | undefined; url?: string | undefined; description?: string | undefined };
  readonly notes?: string | null | undefined;
  readonly createdBy: string | null;
}

export async function insertVersion(tx: Tx, kind: VersionKind, tenantId: string | null, v: NewVersion): Promise<RuleVersionRecord> {
  if (kind === "TENANT") {
    if (!v.createdBy) throw new Error("Une variante d'établissement a toujours un auteur.");
    await tx.query(
      `INSERT INTO rules.rule_versions (id, tenant_id, rule_set_id, version, status, contract_id, based_on_version_id, effective_from, effective_to,
                                        source_kind, source_reference, source_url, source_description, notes, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        v.id, tenantId, v.ruleSetId, v.versionNo, v.contractId, v.basedOnVersionId ?? null, v.effectiveFrom, v.effectiveTo ?? null,
        v.source.kind, v.source.reference ?? null, v.source.url ?? null, v.source.description ?? null, v.notes ?? null, v.createdBy,
      ],
    );
  } else {
    await tx.query(
      `INSERT INTO rules.national_rule_versions (id, rule_set_id, version, status, contract_id, effective_from, effective_to,
                                                  source_kind, source_reference, source_url, source_description, notes, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        v.id, v.ruleSetId, v.versionNo, v.contractId, v.effectiveFrom, v.effectiveTo ?? null,
        v.source.kind, v.source.reference ?? null, v.source.url ?? null, v.source.description ?? null, v.notes ?? null, v.createdBy,
      ],
    );
  }
  return (await getVersion(tx, kind, v.id)) as RuleVersionRecord;
}

/** Changement de statut (et marques associées) ; incrémente le verrou optimiste des variantes. */
export interface StatusPatch {
  readonly status: RuleStatus;
  readonly definitionHash?: string | null | undefined;
  readonly approvedBy?: string | null | undefined;
  readonly lastSimulationId?: string | null | undefined;
  readonly clearSimulation?: boolean | undefined;
  readonly decisionImpactConfirmedBy?: string | null | undefined;
  readonly effectiveTo?: string | null | undefined;
  readonly setEffectiveTo?: boolean | undefined;
  readonly now: Date;
}

export async function patchVersionStatus(tx: Tx, kind: VersionKind, id: string, p: StatusPatch): Promise<RuleVersionRecord> {
  const t = TABLES[kind];
  const sets: string[] = ["status = $2", "updated_at = $3"];
  const params: unknown[] = [id, p.status, p.now];
  const add = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (p.definitionHash !== undefined) add("definition_hash", p.definitionHash);
  if (p.approvedBy !== undefined) add("approved_by", p.approvedBy);
  if (p.setEffectiveTo) add("effective_to", p.effectiveTo ?? null);
  if (kind === "TENANT") {
    sets.push("row_version = row_version + 1");
    if (p.clearSimulation) {
      sets.push("last_simulation_id = NULL", "decision_impact_confirmed_by = NULL", "decision_impact_confirmed_at = NULL");
    }
    if (p.lastSimulationId !== undefined) add("last_simulation_id", p.lastSimulationId);
    if (p.decisionImpactConfirmedBy !== undefined) {
      add("decision_impact_confirmed_by", p.decisionImpactConfirmedBy);
      add("decision_impact_confirmed_at", p.decisionImpactConfirmedBy ? p.now : null);
    }
  }
  await tx.query(`UPDATE ${t.versions} SET ${sets.join(", ")} WHERE id = $1`, params);
  return (await getVersion(tx, kind, id)) as RuleVersionRecord;
}

/** Modification du contenu d'un brouillon : incrémente le verrou optimiste (variantes) et rafraîchit `updated_at`. */
export async function touchDraft(tx: Tx, kind: VersionKind, id: string, now: Date): Promise<void> {
  const t = TABLES[kind];
  await tx.query(`UPDATE ${t.versions} SET updated_at = $2${kind === "TENANT" ? ", row_version = row_version + 1" : ""} WHERE id = $1`, [id, now]);
}

export async function updateDraftMeta(
  tx: Tx,
  kind: VersionKind,
  id: string,
  patch: { effectiveFrom?: string; effectiveTo?: string | null; notes?: string | null; now: Date },
): Promise<void> {
  const t = TABLES[kind];
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, patch.now];
  if (patch.effectiveFrom !== undefined) sets.push(`effective_from = $${params.push(patch.effectiveFrom)}`);
  if (patch.effectiveTo !== undefined) sets.push(`effective_to = $${params.push(patch.effectiveTo)}`);
  if (patch.notes !== undefined) sets.push(`notes = $${params.push(patch.notes)}`);
  if (kind === "TENANT") sets.push("row_version = row_version + 1");
  await tx.query(`UPDATE ${t.versions} SET ${sets.join(", ")} WHERE id = $1`, params);
}

/* ------------------------------- règles ------------------------------- */

export async function getRules(tx: Tx, kind: VersionKind, versionId: string): Promise<RuleDefinitionRecord[]> {
  const rows = await tx.many<RuleDefinitionRow>(
    `SELECT ${DEFINITION_COLUMNS} FROM ${TABLES[kind].defs} WHERE rule_version_id = $1 ORDER BY position, key`,
    [versionId],
  );
  return rows.map(toDefinition);
}

export async function getVersionWithRules(tx: Tx, kind: VersionKind, id: string, options: { forUpdate?: boolean } = {}): Promise<RuleVersionWithRules | null> {
  const v = await getVersion(tx, kind, id, options);
  if (!v) return null;
  return { ...v, rules: await getRules(tx, kind, id) };
}

export async function insertRules(
  tx: Tx,
  kind: VersionKind,
  tenantId: string | null,
  versionId: string,
  rules: readonly RuleDefinitionRecord[],
  newId: () => string,
): Promise<void> {
  const t = TABLES[kind];
  for (const r of rules) {
    if (kind === "TENANT") {
      await tx.query(
        `INSERT INTO ${t.defs} (id, tenant_id, rule_version_id, key, type, position, expression, description, parameters, input_schema, result_type, label_map, is_optional)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13)`,
        [newId(), tenantId, versionId, r.key, r.type, r.position, r.expression, r.description, json(r.parameters), r.inputSchema ? json(r.inputSchema) : null, r.resultType, json(r.labelMap), r.isOptional],
      );
    } else {
      await tx.query(
        `INSERT INTO ${t.defs} (id, rule_version_id, key, type, position, expression, description, parameters, input_schema, result_type, label_map, is_optional)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12)`,
        [newId(), versionId, r.key, r.type, r.position, r.expression, r.description, json(r.parameters), r.inputSchema ? json(r.inputSchema) : null, r.resultType, json(r.labelMap), r.isOptional],
      );
    }
  }
}

export async function deleteRules(tx: Tx, kind: VersionKind, versionId: string): Promise<void> {
  await tx.query(`DELETE FROM ${TABLES[kind].defs} WHERE rule_version_id = $1`, [versionId]);
}

export async function updateRuleExpression(
  tx: Tx,
  kind: VersionKind,
  versionId: string,
  key: string,
  patch: { expression: string; description?: string | null | undefined },
): Promise<boolean> {
  const sets = ["expression = $3"];
  const params: unknown[] = [versionId, key, patch.expression];
  if (patch.description !== undefined) sets.push(`description = $${params.push(patch.description)}`);
  const res = await tx.query(`UPDATE ${TABLES[kind].defs} SET ${sets.join(", ")} WHERE rule_version_id = $1 AND key = $2`, params);
  return res.rowCount > 0;
}

export async function updateRuleParameters(tx: Tx, kind: VersionKind, versionId: string, key: string, parameters: Record<string, unknown>): Promise<boolean> {
  const res = await tx.query(`UPDATE ${TABLES[kind].defs} SET parameters = $3::jsonb WHERE rule_version_id = $1 AND key = $2`, [versionId, key, json(parameters)]);
  return res.rowCount > 0;
}

/* ------------------------------- historique ------------------------------- */

export interface NewVersionEvent {
  readonly id: string;
  readonly ruleVersionId: string;
  readonly fromStatus: RuleStatus | null;
  readonly toStatus: RuleStatus;
  readonly actor: GovernanceActor;
  readonly comment?: string | null | undefined;
  readonly occurredAt: Date;
}

export async function insertVersionEvent(tx: Tx, kind: VersionKind, tenantId: string | null, e: NewVersionEvent): Promise<void> {
  if (kind === "TENANT") {
    await tx.query(
      `INSERT INTO rules.version_events (id, tenant_id, rule_version_id, from_status, to_status, actor_id, actor_name, actor_kind, comment, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [e.id, tenantId, e.ruleVersionId, e.fromStatus, e.toStatus, e.actor.id, e.actor.name, e.actor.kind, e.comment ?? null, e.occurredAt],
    );
  } else {
    await tx.query(
      `INSERT INTO rules.national_version_events (id, rule_version_id, from_status, to_status, actor_id, actor_name, comment, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.id, e.ruleVersionId, e.fromStatus, e.toStatus, e.actor.id, e.actor.name, e.comment ?? null, e.occurredAt],
    );
  }
}

export async function listVersionEvents(tx: Tx, kind: VersionKind, versionId: string): Promise<VersionEventRecord[]> {
  const actorKind = kind === "TENANT" ? "actor_kind" : "'super_admin'::text AS actor_kind";
  const rows = await tx.many<VersionEventRow>(
    `SELECT id, rule_version_id, from_status, to_status, actor_id, actor_name, ${actorKind}, comment, occurred_at
       FROM ${TABLES[kind].events} WHERE rule_version_id = $1 ORDER BY occurred_at, id`,
    [versionId],
  );
  return rows.map(toEvent);
}

/* ------------------------------- recherches ------------------------------- */

/**
 * Chevauchement de période d'effet avec une AUTRE version active du même jeu et du même contrat
 * (contrôle applicatif de l'AC3.3 ; la contrainte d'exclusion en base est le filet).
 */
export async function findActiveOverlap(
  tx: Tx,
  kind: VersionKind,
  v: { id: string; ruleSetId: string; contractId: string; effectiveFrom: string; effectiveTo: string | null },
): Promise<RuleVersionRecord[]> {
  const t = TABLES[kind];
  const rows = await tx.many<RuleVersionRow>(
    `SELECT ${versionColumns(kind)} FROM ${t.versions} v JOIN ${t.sets} s ON s.id = v.rule_set_id
      WHERE v.rule_set_id = $1 AND v.contract_id = $2 AND v.id <> $3 AND v.status IN ('approved', 'published')
        AND daterange(v.effective_from, v.effective_to, '[]') && daterange($4::date, $5::date, '[]')`,
    [v.ruleSetId, v.contractId, v.id, v.effectiveFrom, v.effectiveTo],
  );
  return rows.map((r) => toVersion(kind, r));
}
