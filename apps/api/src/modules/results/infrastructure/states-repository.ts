/**
 * Accès SQL : réglages, états de période, clôtures. Une fonction par requête, SQL paramétré, `Tx` reçu en paramètre.
 */
import type { Tx } from "@ecoledigitale/database";
import { DEFAULT_RESULTS_SETTINGS, type ClosureRecord, type PeriodState, type ResultsSettings } from "../domain/records";
import type { ReopenKind, StateScope } from "../domain/types";
import { CLOSURE_COLUMNS, SETTINGS_COLUMNS, STATE_COLUMNS, toClosure, toSettings, toState } from "./rows";

export async function getSettingsRow(tx: Tx): Promise<ResultsSettings> {
  const row = await tx.queryOne(`SELECT ${SETTINGS_COLUMNS} FROM results.settings`);
  return row ? toSettings(row) : { ...DEFAULT_RESULTS_SETTINGS };
}

export async function upsertSettings(
  tx: Tx,
  tenantId: string,
  patch: { requireDeliberation?: boolean | undefined; requireSeparateApprover?: boolean | undefined; recomputeDelaySeconds?: number | undefined },
  by: string | null,
  now: Date,
): Promise<ResultsSettings> {
  const cur = await getSettingsRow(tx);
  const next = {
    requireDeliberation: patch.requireDeliberation ?? cur.requireDeliberation,
    requireSeparateApprover: patch.requireSeparateApprover ?? cur.requireSeparateApprover,
    recomputeDelaySeconds: patch.recomputeDelaySeconds ?? cur.recomputeDelaySeconds,
  };
  const row = await tx.queryOne(
    `INSERT INTO results.settings (tenant_id, require_deliberation, require_separate_approver, recompute_delay_seconds, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id) DO UPDATE SET require_deliberation = EXCLUDED.require_deliberation, require_separate_approver = EXCLUDED.require_separate_approver,
        recompute_delay_seconds = EXCLUDED.recompute_delay_seconds, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
     RETURNING ${SETTINGS_COLUMNS}`,
    [tenantId, next.requireDeliberation, next.requireSeparateApprover, next.recomputeDelaySeconds, by, now],
  );
  return toSettings(row);
}

export type RowLock = "share" | "update";

export async function getStateById(tx: Tx, id: string, lock?: RowLock): Promise<PeriodState | null> {
  const suffix = lock === "update" ? " FOR UPDATE OF s" : lock === "share" ? " FOR SHARE OF s" : "";
  const row = await tx.queryOne(`SELECT ${STATE_COLUMNS} FROM results.period_states s WHERE s.id = $1${suffix}`, [id]);
  return row ? toState(row) : null;
}

export async function getStateByKey(
  tx: Tx,
  key: { classroomId: string; academicPeriodId: string | null; academicYearId: string; scope: StateScope },
  lock?: RowLock,
): Promise<PeriodState | null> {
  const suffix = lock === "update" ? " FOR UPDATE OF s" : lock === "share" ? " FOR SHARE OF s" : "";
  const row = await tx.queryOne(
    `SELECT ${STATE_COLUMNS} FROM results.period_states s
      WHERE s.classroom_id = $1 AND s.scope = $4 AND s.academic_year_id = $3
        AND coalesce(s.academic_period_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)${suffix}`,
    [key.classroomId, key.academicPeriodId, key.academicYearId, key.scope],
  );
  return row ? toState(row) : null;
}

export async function listStatesOfClassroom(tx: Tx, classroomId: string): Promise<PeriodState[]> {
  const rows = await tx.many(`SELECT ${STATE_COLUMNS} FROM results.period_states s WHERE s.classroom_id = $1 ORDER BY s.created_at, s.id`, [classroomId]);
  return rows.map(toState);
}

export interface StateInsert {
  id: string;
  tenantId: string;
  classroomId: string;
  academicPeriodId: string | null;
  academicYearId: string;
  scope: StateScope;
  contractId: string;
  ruleVersionKind: string;
  ruleVersionId: string;
  ruleSetCode: string;
  ruleVersionNo: number;
  definitionHash: string;
  pinnedBy: string | null;
  now: Date;
}

export async function insertState(tx: Tx, s: StateInsert): Promise<PeriodState> {
  const row = await tx.queryOne(
    `INSERT INTO results.period_states AS s (id, tenant_id, classroom_id, academic_period_id, academic_year_id, scope, contract_id, rule_version_kind, rule_version_id,
        rule_set_code, rule_version_no, definition_hash, pinned_at, pinned_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13,$13)
     RETURNING ${STATE_COLUMNS}`,
    [s.id, s.tenantId, s.classroomId, s.academicPeriodId, s.academicYearId, s.scope, s.contractId, s.ruleVersionKind, s.ruleVersionId, s.ruleSetCode, s.ruleVersionNo, s.definitionHash, s.now, s.pinnedBy],
  );
  return toState(row);
}

export async function repinState(
  tx: Tx,
  id: string,
  pin: { ruleVersionKind: string; ruleVersionId: string; ruleSetCode: string; ruleVersionNo: number; definitionHash: string },
  by: string | null,
  now: Date,
): Promise<PeriodState> {
  const row = await tx.queryOne(
    `UPDATE results.period_states s SET rule_version_kind = $2, rule_version_id = $3, rule_set_code = $4, rule_version_no = $5, definition_hash = $6,
        pinned_at = $7, pinned_by = $8, updated_at = $7
      WHERE s.id = $1 RETURNING ${STATE_COLUMNS}`,
    [id, pin.ruleVersionKind, pin.ruleVersionId, pin.ruleSetCode, pin.ruleVersionNo, pin.definitionHash, now, by],
  );
  return toState(row);
}

export type StateTransition =
  | { to: "GRADING_LOCKED"; by: string; now: Date }
  | { to: "DELIBERATED"; by: string; now: Date }
  | { to: "CLOSED"; by: string; now: Date; resultsVersion: number }
  | { to: "OPEN"; now: Date; reopen?: { kind: ReopenKind; reason: string } };

/** Applique une transition d'état (le déclencheur valide et incrémente `row_version`). */
export async function transitionState(tx: Tx, id: string, expectedVersion: number, t: StateTransition): Promise<PeriodState | null> {
  const set: string[] = ["status = $3", "updated_at = $4"];
  const params: unknown[] = [id, expectedVersion, t.to, t.now];
  const add = (col: string, v: unknown): void => {
    params.push(v);
    set.push(`${col} = $${params.length}`);
  };
  if (t.to === "GRADING_LOCKED") {
    add("locked_at", t.now);
    add("locked_by", t.by);
  } else if (t.to === "DELIBERATED") {
    add("deliberated_at", t.now);
    add("deliberated_by", t.by);
  } else if (t.to === "CLOSED") {
    add("closed_at", t.now);
    add("closed_by", t.by);
    add("results_version", t.resultsVersion);
  } else if (t.reopen) {
    set.push("reopen_count = reopen_count + 1");
    add("last_reopen_kind", t.reopen.kind);
    add("last_reopen_reason", t.reopen.reason);
    set.push("closed_at = NULL", "closed_by = NULL");
  } else {
    // retour en OPEN depuis un verrouillage non clôturé
    set.push("locked_at = NULL", "locked_by = NULL", "deliberated_at = NULL", "deliberated_by = NULL");
  }
  const row = await tx.queryOne(`UPDATE results.period_states s SET ${set.join(", ")} WHERE s.id = $1 AND s.row_version = $2 RETURNING ${STATE_COLUMNS}`, params);
  return row ? toState(row) : null;
}

export async function insertClosure(
  tx: Tx,
  c: { id: string; tenantId: string; stateId: string; resultsVersion: number; resultsCount: number; closureHash: string; excluded: unknown; forcedReason: string | null; closedBy: string; closedByName: string; now: Date },
): Promise<ClosureRecord> {
  const row = await tx.queryOne(
    `INSERT INTO results.closures AS c (id, tenant_id, state_id, results_version, results_count, closure_hash, excluded, forced_reason, closed_at, closed_by, closed_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
     RETURNING ${CLOSURE_COLUMNS}`,
    [c.id, c.tenantId, c.stateId, c.resultsVersion, c.resultsCount, c.closureHash, JSON.stringify(c.excluded), c.forcedReason, c.now, c.closedBy, c.closedByName],
  );
  return toClosure(row);
}

export async function listClosures(tx: Tx, stateId: string): Promise<ClosureRecord[]> {
  const rows = await tx.many(`SELECT ${CLOSURE_COLUMNS} FROM results.closures c WHERE c.state_id = $1 ORDER BY c.results_version`, [stateId]);
  return rows.map(toClosure);
}

export async function getClosure(tx: Tx, stateId: string, resultsVersion: number): Promise<ClosureRecord | null> {
  const row = await tx.queryOne(`SELECT ${CLOSURE_COLUMNS} FROM results.closures c WHERE c.state_id = $1 AND c.results_version = $2`, [stateId, resultsVersion]);
  return row ? toClosure(row) : null;
}
