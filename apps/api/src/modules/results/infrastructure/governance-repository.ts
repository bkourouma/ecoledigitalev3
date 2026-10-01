/**
 * Accès SQL : surcharges, délibérations, décisions, appréciations, file de recalcul.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AppreciationRecord, DecisionRecord, DeliberationRecord, OverrideRecord, RecomputeRequest } from "../domain/records";
import type { ApprovedOverride, Level, OverrideKind } from "../domain/types";
import {
  APPRECIATION_COLUMNS,
  DECISION_COLUMNS,
  DELIBERATION_COLUMNS,
  OVERRIDE_COLUMNS,
  RECOMPUTE_COLUMNS,
  toAppreciation,
  toDecision,
  toDeliberation,
  toOverride,
  toRecompute,
} from "./rows";

// ---------------------------------------------------------------------------------------------------------------------
// Surcharges
// ---------------------------------------------------------------------------------------------------------------------

export async function insertOverride(
  tx: Tx,
  o: {
    id: string; tenantId: string; stateId: string; enrollmentId: string; level: Level; curriculumNodeId: string | null; ruleKey: string; kind: OverrideKind;
    originalValue: string | null; overrideValue: string | null; overrideFlag: boolean | null; justification: string; requestedBy: string; requestedByName: string; now: Date;
  },
): Promise<OverrideRecord> {
  const row = await tx.queryOne(
    `INSERT INTO results.overrides AS o (id, tenant_id, state_id, enrollment_id, level, curriculum_node_id, rule_key, kind, original_value, override_value, override_flag,
        justification, requested_by, requested_by_name, requested_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11,$12,$13,$14,$15)
     RETURNING ${OVERRIDE_COLUMNS}`,
    [o.id, o.tenantId, o.stateId, o.enrollmentId, o.level, o.curriculumNodeId, o.ruleKey, o.kind, o.originalValue, o.overrideValue, o.overrideFlag, o.justification, o.requestedBy, o.requestedByName, o.now],
  );
  return toOverride(row);
}

export async function getOverride(tx: Tx, id: string, forUpdate = false): Promise<OverrideRecord | null> {
  const row = await tx.queryOne(`SELECT ${OVERRIDE_COLUMNS} FROM results.overrides o WHERE o.id = $1${forUpdate ? " FOR UPDATE OF o" : ""}`, [id]);
  return row ? toOverride(row) : null;
}

export async function listOverrides(tx: Tx, f: { stateId?: string | undefined; enrollmentId?: string | undefined; status?: string | undefined }): Promise<OverrideRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.stateId) { params.push(f.stateId); where.push(`o.state_id = $${params.length}`); }
  if (f.enrollmentId) { params.push(f.enrollmentId); where.push(`o.enrollment_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`o.status = $${params.length}`); }
  const rows = await tx.many(`SELECT ${OVERRIDE_COLUMNS} FROM results.overrides o ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.requested_at, o.id`, params);
  return rows.map(toOverride);
}

export async function listApprovedOverrides(tx: Tx, stateId: string): Promise<ApprovedOverride[]> {
  const rows = await tx.many(`SELECT ${OVERRIDE_COLUMNS} FROM results.overrides o WHERE o.state_id = $1 AND o.status = 'APPROVED' ORDER BY o.id`, [stateId]);
  return rows.map(toOverride).map((o) => ({
    id: o.id,
    enrollmentId: o.enrollmentId,
    level: o.level,
    curriculumNodeId: o.curriculumNodeId,
    ruleKey: o.ruleKey,
    kind: o.kind,
    value: o.overrideValue,
    flag: o.overrideFlag,
    originalValue: o.originalValue,
  }));
}

export async function decideOverride(
  tx: Tx,
  d: { id: string; status: "APPROVED" | "REJECTED"; by: string; byName: string; at: Date; comment: string | null; fourEyesWaived: boolean },
): Promise<OverrideRecord | null> {
  const row = await tx.queryOne(
    `UPDATE results.overrides o SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = $5, decision_comment = $6, four_eyes_waived = $7
      WHERE o.id = $1 AND o.status = 'REQUESTED' RETURNING ${OVERRIDE_COLUMNS}`,
    [d.id, d.status, d.by, d.byName, d.at, d.comment, d.fourEyesWaived],
  );
  return row ? toOverride(row) : null;
}

export async function revokeOverride(tx: Tx, d: { id: string; by: string; byName: string; at: Date; reason: string }): Promise<OverrideRecord | null> {
  const row = await tx.queryOne(
    `UPDATE results.overrides o SET status = 'REVOKED', revoked_reason = $2, decided_by = coalesce(o.decided_by, $3), decided_by_name = coalesce(o.decided_by_name, $4), decided_at = coalesce(o.decided_at, $5)
      WHERE o.id = $1 AND o.status IN ('REQUESTED', 'APPROVED') RETURNING ${OVERRIDE_COLUMNS}`,
    [d.id, d.reason, d.by, d.byName, d.at],
  );
  return row ? toOverride(row) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Délibérations
// ---------------------------------------------------------------------------------------------------------------------

export async function insertDeliberation(
  tx: Tx,
  d: { id: string; tenantId: string; classroomId: string; stateId: string; kind: "COUNCIL" | "JURY"; heldOn: string | null; status: string; participants: unknown; createdBy: string; now: Date },
): Promise<DeliberationRecord> {
  const row = await tx.queryOne(
    `INSERT INTO results.deliberations AS d (id, tenant_id, classroom_id, state_id, kind, held_on, status, participants, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8::jsonb,$9,$10,$10) RETURNING ${DELIBERATION_COLUMNS}`,
    [d.id, d.tenantId, d.classroomId, d.stateId, d.kind, d.heldOn, d.status, JSON.stringify(d.participants), d.createdBy, d.now],
  );
  return toDeliberation(row);
}

export async function getDeliberation(tx: Tx, id: string, forUpdate = false): Promise<DeliberationRecord | null> {
  const row = await tx.queryOne(`SELECT ${DELIBERATION_COLUMNS} FROM results.deliberations d WHERE d.id = $1${forUpdate ? " FOR UPDATE OF d" : ""}`, [id]);
  return row ? toDeliberation(row) : null;
}

export async function listDeliberations(tx: Tx, stateId: string): Promise<DeliberationRecord[]> {
  const rows = await tx.many(`SELECT ${DELIBERATION_COLUMNS} FROM results.deliberations d WHERE d.state_id = $1 ORDER BY d.created_at, d.id`, [stateId]);
  return rows.map(toDeliberation);
}

export async function updateDeliberation(
  tx: Tx,
  id: string,
  p: { kind?: "COUNCIL" | "JURY" | undefined; heldOn?: string | null | undefined; status?: string | undefined; participants?: unknown; minutesObjectKey?: string | null | undefined },
  now: Date,
): Promise<DeliberationRecord | null> {
  const row = await tx.queryOne(
    `UPDATE results.deliberations d SET kind = coalesce($2, kind), held_on = coalesce($3::date, held_on), status = coalesce($4, status),
        participants = coalesce($5::jsonb, participants), minutes_object_key = coalesce($6, minutes_object_key), updated_at = $7
      WHERE d.id = $1 RETURNING ${DELIBERATION_COLUMNS}`,
    [id, p.kind ?? null, p.heldOn ?? null, p.status ?? null, p.participants === undefined ? null : JSON.stringify(p.participants), p.minutesObjectKey ?? null, now],
  );
  return row ? toDeliberation(row) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------------------------------------------------

export async function getDecision(tx: Tx, id: string, forUpdate = false): Promise<DecisionRecord | null> {
  const row = await tx.queryOne(`SELECT ${DECISION_COLUMNS} FROM results.decisions d WHERE d.id = $1${forUpdate ? " FOR UPDATE OF d" : ""}`, [id]);
  return row ? toDecision(row) : null;
}

export async function listDecisions(tx: Tx, f: { stateId?: string | undefined; enrollmentId?: string | undefined; status?: string | undefined }): Promise<DecisionRecord[]> {
  const where = ["d.status <> 'WITHDRAWN'"];
  const params: unknown[] = [];
  if (f.stateId) { params.push(f.stateId); where.push(`d.state_id = $${params.length}`); }
  if (f.enrollmentId) { params.push(f.enrollmentId); where.push(`d.enrollment_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`d.status = $${params.length}`); }
  const rows = await tx.many(`SELECT ${DECISION_COLUMNS} FROM results.decisions d WHERE ${where.join(" AND ")} ORDER BY d.created_at, d.id`, params);
  return rows.map(toDecision);
}

/** Matérialise la proposition d'une règle (une décision active par (période, inscription, nature)). Confirmée : conservée. */
export async function upsertProposal(
  tx: Tx,
  p: { id: string; tenantId: string; stateId: string; enrollmentId: string; scope: string; kind: string; sourceResultId: string; code: string; outcome: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO results.decisions (id, tenant_id, state_id, enrollment_id, scope, kind, source_result_id, proposed_code, proposed_outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, state_id, enrollment_id, kind) WHERE status <> 'WITHDRAWN'
     DO UPDATE SET source_result_id = EXCLUDED.source_result_id, proposed_code = EXCLUDED.proposed_code, proposed_outcome = EXCLUDED.proposed_outcome
        WHERE results.decisions.status = 'PROPOSED'`,
    [p.id, p.tenantId, p.stateId, p.enrollmentId, p.scope, p.kind, p.sourceResultId, p.code, p.outcome],
  );
}

export async function confirmDecision(
  tx: Tx,
  d: { id: string; finalCode: string; finalOutcome: string; deliberationId: string | null; justification: string | null; by: string; byName: string; at: Date },
): Promise<DecisionRecord | null> {
  const row = await tx.queryOne(
    `UPDATE results.decisions d SET status = 'CONFIRMED', final_code = $2, final_outcome = $3, deliberation_id = $4, justification = $5, decided_by = $6, decided_by_name = $7, decided_at = $8
      WHERE d.id = $1 AND d.status IN ('PROPOSED', 'CONFIRMED') RETURNING ${DECISION_COLUMNS}`,
    [d.id, d.finalCode, d.finalOutcome, d.deliberationId, d.justification, d.by, d.byName, d.at],
  );
  return row ? toDecision(row) : null;
}

/**
 * Réouverture : les décisions CONFIRMÉES reposent sur l'ancienne version des résultats ; elles sont RETIRÉES (conservées,
 * consultables) et de nouvelles propositions seront créées par le recalcul. Les décisions PUBLIÉES (bulletin) ne bougent pas.
 */
export async function withdrawConfirmedDecisions(tx: Tx, stateId: string): Promise<number> {
  const res = await tx.query("UPDATE results.decisions SET status = 'WITHDRAWN' WHERE state_id = $1 AND status = 'CONFIRMED'", [stateId]);
  return res.rowCount;
}

// ---------------------------------------------------------------------------------------------------------------------
// Appréciations
// ---------------------------------------------------------------------------------------------------------------------

export async function upsertAppreciation(
  tx: Tx,
  a: { id: string; tenantId: string; stateId: string; enrollmentId: string; curriculumNodeId: string | null; authorStaffId: string; authorRole: string; body: string; now: Date },
): Promise<AppreciationRecord> {
  const row = await tx.queryOne(
    `INSERT INTO results.appreciations AS a (id, tenant_id, state_id, enrollment_id, curriculum_node_id, author_staff_id, author_role, body, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, state_id, enrollment_id, author_role, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET body = EXCLUDED.body, author_staff_id = EXCLUDED.author_staff_id, updated_at = EXCLUDED.updated_at
     RETURNING ${APPRECIATION_COLUMNS}`,
    [a.id, a.tenantId, a.stateId, a.enrollmentId, a.curriculumNodeId, a.authorStaffId, a.authorRole, a.body, a.now],
  );
  return toAppreciation(row);
}

export async function listAppreciations(tx: Tx, stateId: string, enrollmentId?: string): Promise<AppreciationRecord[]> {
  const rows = enrollmentId
    ? await tx.many(`SELECT ${APPRECIATION_COLUMNS} FROM results.appreciations a WHERE a.state_id = $1 AND a.enrollment_id = $2 ORDER BY a.updated_at, a.id`, [stateId, enrollmentId])
    : await tx.many(`SELECT ${APPRECIATION_COLUMNS} FROM results.appreciations a WHERE a.state_id = $1 ORDER BY a.enrollment_id, a.updated_at, a.id`, [stateId]);
  return rows.map(toAppreciation);
}

// ---------------------------------------------------------------------------------------------------------------------
// File de recalcul (coalescence par classe × période)
// ---------------------------------------------------------------------------------------------------------------------

export async function getPendingRequest(tx: Tx, classroomId: string, periodId: string): Promise<RecomputeRequest | null> {
  const row = await tx.queryOne(`SELECT ${RECOMPUTE_COLUMNS} FROM results.recompute_requests q WHERE q.classroom_id = $1 AND q.academic_period_id = $2 AND q.status = 'PENDING'`, [classroomId, periodId]);
  return row ? toRecompute(row) : null;
}

/**
 * Crée ou met à jour la demande PENDING de la clé (UN seul PENDING par classe × période). La temporisation repart du
 * DERNIER événement : 40 publications en rafale produisent UN calcul.
 */
export async function upsertPendingRequest(
  tx: Tx,
  r: { id: string; tenantId: string; classroomId: string; periodId: string; scopeEnrollments: readonly string[] | null; cause: { event: string; id: string | null; at: string }; notBefore: Date; maxCauses: number; now: Date },
): Promise<RecomputeRequest> {
  const row = await tx.queryOne(
    `INSERT INTO results.recompute_requests AS q (id, tenant_id, classroom_id, academic_period_id, scope_enrollments, causes, not_before, requested_at)
     VALUES ($1,$2,$3,$4,$5::uuid[],jsonb_build_array($6::jsonb),$7,$8)
     ON CONFLICT (tenant_id, classroom_id, academic_period_id) WHERE status = 'PENDING'
     DO UPDATE SET not_before = GREATEST(q.not_before, EXCLUDED.not_before),
        scope_enrollments = CASE WHEN q.scope_enrollments IS NULL OR EXCLUDED.scope_enrollments IS NULL THEN NULL
                                 ELSE (SELECT array_agg(DISTINCT x) FROM unnest(q.scope_enrollments || EXCLUDED.scope_enrollments) AS x) END,
        causes = CASE WHEN jsonb_array_length(q.causes) >= $9 THEN q.causes ELSE q.causes || EXCLUDED.causes END
     RETURNING ${RECOMPUTE_COLUMNS}`,
    [r.id, r.tenantId, r.classroomId, r.periodId, r.scopeEnrollments ? [...r.scopeEnrollments] : null, JSON.stringify(r.cause), r.notBefore, r.now, r.maxCauses],
  );
  return toRecompute(row);
}

/** Réserve (SKIP LOCKED) les demandes échues ; une seule RUNNING par clé (index unique). */
export async function claimDueRequests(tx: Tx, now: Date, limit: number): Promise<RecomputeRequest[]> {
  const rows = await tx.many(
    `UPDATE results.recompute_requests q SET status = 'RUNNING', started_at = $1, attempts = q.attempts + 1
      WHERE q.id IN (SELECT id FROM results.recompute_requests WHERE status = 'PENDING' AND not_before <= $1
                      AND NOT EXISTS (SELECT 1 FROM results.recompute_requests r2 WHERE r2.status = 'RUNNING' AND r2.classroom_id = results.recompute_requests.classroom_id AND r2.academic_period_id = results.recompute_requests.academic_period_id)
                      ORDER BY not_before LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING ${RECOMPUTE_COLUMNS}`,
    [now, limit],
  );
  return rows.map(toRecompute);
}

export async function finishRequest(tx: Tx, id: string, status: "DONE" | "BLOCKED" | "FAILED" | "PENDING", now: Date, extra: { blockedReason?: string | null; lastError?: string | null; notBefore?: Date } = {}): Promise<void> {
  await tx.query(
    `UPDATE results.recompute_requests SET status = $2::text, finished_at = CASE WHEN $2::text = 'PENDING' THEN NULL ELSE $3::timestamptz END, blocked_reason = $4, last_error = $5,
        not_before = coalesce($6::timestamptz, not_before), started_at = CASE WHEN $2::text = 'PENDING' THEN NULL ELSE started_at END
      WHERE id = $1`,
    [id, status, now, extra.blockedReason ?? null, extra.lastError ?? null, extra.notBefore ?? null],
  );
}

export async function listRequests(tx: Tx, f: { classroomId?: string | undefined; periodId?: string | undefined; status?: string | undefined }): Promise<RecomputeRequest[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.classroomId) { params.push(f.classroomId); where.push(`q.classroom_id = $${params.length}`); }
  if (f.periodId) { params.push(f.periodId); where.push(`q.academic_period_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`q.status = $${params.length}`); }
  const rows = await tx.many(`SELECT ${RECOMPUTE_COLUMNS} FROM results.recompute_requests q ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY q.requested_at, q.id`, params);
  return rows.map(toRecompute);
}

export async function purgeFinishedRequests(tx: Tx, before: Date): Promise<number> {
  const res = await tx.query("DELETE FROM results.recompute_requests WHERE status IN ('DONE', 'FAILED') AND finished_at < $1", [before]);
  return res.rowCount;
}
