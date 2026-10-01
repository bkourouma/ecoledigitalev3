import type { Tx } from "@ecoledigitale/database";
import type { Difference, RuleSimulationStats, SimulationReport } from "../engine";
import type { SimulationRecord, SimulationStatus, VersionKind } from "../domain/types";
import { SIMULATION_COLUMNS, toSimulation, type SimulationRow } from "./rows";

const json = (v: unknown): string => JSON.stringify(v);

export interface NewSimulation {
  readonly id: string;
  readonly targetKind: VersionKind;
  readonly targetVersionId: string;
  readonly baseKind: VersionKind;
  readonly baseVersionId: string;
  readonly targetDefinitionHash: string;
  readonly contractId: string;
  readonly dataset: unknown;
  readonly requestedBy: string;
}

export async function insertSimulation(tx: Tx, tenantId: string, s: NewSimulation): Promise<SimulationRecord> {
  await tx.query(
    `INSERT INTO rules.simulations (id, tenant_id, target_version_kind, target_version_id, base_version_kind, base_version_id,
                                    target_definition_hash, contract_id, dataset, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [s.id, tenantId, s.targetKind, s.targetVersionId, s.baseKind, s.baseVersionId, s.targetDefinitionHash, s.contractId, json(s.dataset), s.requestedBy],
  );
  return (await getSimulation(tx, s.id)) as SimulationRecord;
}

export async function getSimulation(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<SimulationRecord | null> {
  const row = await tx.queryOne<SimulationRow>(`SELECT ${SIMULATION_COLUMNS} FROM rules.simulations WHERE id = $1 ${options.forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return row ? toSimulation(row) : null;
}

export async function listSimulationsForTarget(tx: Tx, targetVersionId: string): Promise<SimulationRecord[]> {
  const rows = await tx.many<SimulationRow>(`SELECT ${SIMULATION_COLUMNS} FROM rules.simulations WHERE target_version_id = $1 ORDER BY created_at DESC, id`, [targetVersionId]);
  return rows.map(toSimulation);
}

export async function markSimulation(
  tx: Tx,
  id: string,
  patch: { status: SimulationStatus; progressPercent?: number; error?: string | null; startedAt?: Date; completedAt?: Date },
): Promise<void> {
  const sets = ["status = $2"];
  const params: unknown[] = [id, patch.status];
  if (patch.progressPercent !== undefined) sets.push(`progress_percent = $${params.push(patch.progressPercent)}`);
  if (patch.error !== undefined) sets.push(`error = $${params.push(patch.error)}`);
  if (patch.startedAt) sets.push(`started_at = $${params.push(patch.startedAt)}`);
  if (patch.completedAt) sets.push(`completed_at = $${params.push(patch.completedAt)}`);
  await tx.query(`UPDATE rules.simulations SET ${sets.join(", ")} WHERE id = $1`, params);
}

export async function completeSimulation(
  tx: Tx,
  id: string,
  r: { report: SimulationReport; decisionChangedPercent: string; casesCount: number; completedAt: Date },
): Promise<void> {
  await tx.query(
    `UPDATE rules.simulations
        SET status = 'COMPLETED', progress_percent = 100, cases_count = $2, summary = $3::jsonb, rule_stats = $4::jsonb,
            decision_changed_percent = $5::numeric, differences_truncated = $6, completed_at = $7, error = NULL
      WHERE id = $1`,
    [id, r.casesCount, json(r.report.summary), json(r.report.rules), r.decisionChangedPercent, r.report.truncated, r.completedAt],
  );
}

export async function insertDifferences(tx: Tx, tenantId: string, simulationId: string, differences: readonly Difference[], newId: () => string): Promise<void> {
  for (const d of differences) {
    await tx.query(
      `INSERT INTO rules.simulation_differences (id, tenant_id, simulation_id, case_ref, rule_key, kind, old_outcome, new_outcome, delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [newId(), tenantId, simulationId, d.caseId, d.ruleKey, d.kind, json(d.old), json(d.new), d.delta ?? null],
    );
  }
}

export interface DifferenceRow {
  case_ref: string;
  rule_key: string;
  kind: Difference["kind"];
  old_outcome: Difference["old"];
  new_outcome: Difference["new"];
  delta: string | null;
}

export async function listDifferences(tx: Tx, simulationId: string, limit = 1000): Promise<DifferenceRow[]> {
  return tx.many<DifferenceRow>(
    `SELECT case_ref, rule_key, kind, old_outcome, new_outcome, delta FROM rules.simulation_differences
      WHERE simulation_id = $1 ORDER BY rule_key, case_ref, id LIMIT $2`,
    [simulationId, limit],
  );
}

export type StoredRuleStats = RuleSimulationStats[];
