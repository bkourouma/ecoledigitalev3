/** Définitions de diplômes, exigences et octrois (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { AwardedVia, DecimalString, DiplomaAward, DiplomaDefinition, DiplomaRequirement, DiplomaStatus, IsoDate, RequirementsSnapshot, Uuid } from "../domain/types";
import {
  AWARD_COLUMNS,
  DEFINITION_COLUMNS,
  REQUIREMENT_COLUMNS,
  decodeCursor,
  encodeCursor,
  toAward,
  toDefinition,
  toRequirement,
  type AwardRow,
  type DefinitionRow,
  type RequirementRow,
} from "./rows";

// --- définitions --------------------------------------------------------------------------------------------------

export interface DefinitionWrite {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly institutionId: Uuid | null;
  readonly code: string;
  readonly label: string;
  readonly gradeCode: string;
  readonly curriculumNodeId: Uuid;
  readonly uvRequired: number;
  readonly autoAward: boolean;
  readonly description: string | null;
  readonly createdBy: Uuid | null;
  readonly at: Date;
}

export async function insertDefinition(tx: Tx, w: DefinitionWrite): Promise<DiplomaDefinition> {
  const rows = await tx.many<DefinitionRow>(
    `INSERT INTO higher.diploma_definitions (id, tenant_id, institution_id, code, label, grade_code, curriculum_node_id, uv_required, auto_award, status, description, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$11,$12,$12) RETURNING ${DEFINITION_COLUMNS}`,
    [w.id, w.tenantId, w.institutionId, w.code, w.label, w.gradeCode, w.curriculumNodeId, w.uvRequired, w.autoAward, w.description, w.createdBy, w.at.toISOString()],
  );
  return toDefinition(rows[0] as DefinitionRow);
}

export async function getDefinition(tx: Tx, id: Uuid, forUpdate = false): Promise<DiplomaDefinition | null> {
  const r = await tx.queryOne<DefinitionRow>(`SELECT ${DEFINITION_COLUMNS} FROM higher.diploma_definitions WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toDefinition(r) : null;
}

export async function listDefinitions(
  tx: Tx,
  f: { status?: DiplomaStatus | undefined; curriculumNodeId?: Uuid | undefined; gradeCode?: string | undefined; q?: string | undefined },
): Promise<DiplomaDefinition[]> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.curriculumNodeId) { params.push(f.curriculumNodeId); where.push(`curriculum_node_id = $${params.length}`); }
  if (f.gradeCode) { params.push(f.gradeCode); where.push(`grade_code = $${params.length}`); }
  if (f.q) { params.push(`%${f.q.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(code ILIKE $${params.length} OR label ILIKE $${params.length})`); }
  const rows = await tx.many<DefinitionRow>(`SELECT ${DEFINITION_COLUMNS} FROM higher.diploma_definitions WHERE ${where.join(" AND ")} ORDER BY code, id`, params);
  return rows.map(toDefinition);
}

/** Définitions ACTIVES qui exigent une UE (évaluation automatique après capitalisation). */
export async function listActiveDefinitionsRequiringUe(tx: Tx, ueNodeId: Uuid): Promise<DiplomaDefinition[]> {
  const rows = await tx.many<DefinitionRow>(
    `SELECT ${DEFINITION_COLUMNS} FROM higher.diploma_definitions
      WHERE status = 'ACTIVE' AND EXISTS (SELECT 1 FROM higher.diploma_requirements r WHERE r.definition_id = diploma_definitions.id AND r.ue_node_id = $1)
      ORDER BY code, id`,
    [ueNodeId],
  );
  return rows.map(toDefinition);
}

/** Définitions ACTIVES qui exigent au moins une des UE données (progression d'un étudiant vers ses diplômes). */
export async function listActiveDefinitionsRequiringAny(tx: Tx, ueNodeIds: readonly Uuid[]): Promise<DiplomaDefinition[]> {
  if (ueNodeIds.length === 0) return [];
  const rows = await tx.many<DefinitionRow>(
    `SELECT ${DEFINITION_COLUMNS} FROM higher.diploma_definitions
      WHERE status = 'ACTIVE' AND EXISTS (SELECT 1 FROM higher.diploma_requirements r WHERE r.definition_id = diploma_definitions.id AND r.ue_node_id = ANY($1::uuid[]))
      ORDER BY code, id`,
    [ueNodeIds],
  );
  return rows.map(toDefinition);
}

export async function updateDefinition(
  tx: Tx,
  id: Uuid,
  patch: { label?: string | undefined; description?: string | null | undefined; uvRequired?: number | undefined; status?: DiplomaStatus | undefined; autoAward?: boolean | undefined; gradeCode?: string | undefined },
  at: Date,
): Promise<DiplomaDefinition | null> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, at.toISOString()];
  const add = (col: string, v: unknown): void => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (patch.label !== undefined) add("label", patch.label);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.uvRequired !== undefined) add("uv_required", patch.uvRequired);
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.autoAward !== undefined) add("auto_award", patch.autoAward);
  if (patch.gradeCode !== undefined) add("grade_code", patch.gradeCode);
  const r = await tx.queryOne<DefinitionRow>(`UPDATE higher.diploma_definitions SET ${sets.join(", ")} WHERE id = $1 RETURNING ${DEFINITION_COLUMNS}`, params);
  return r ? toDefinition(r) : null;
}

export async function touchSynced(tx: Tx, id: Uuid, at: Date): Promise<void> {
  await tx.query(`UPDATE higher.diploma_definitions SET last_synced_at = $2, updated_at = $2 WHERE id = $1`, [id, at.toISOString()]);
}

export async function deleteDefinition(tx: Tx, id: Uuid): Promise<void> {
  await tx.query(`DELETE FROM higher.diploma_requirements WHERE definition_id = $1`, [id]);
  await tx.query(`DELETE FROM higher.diploma_definitions WHERE id = $1`, [id]);
}

export async function countAwardsOfDefinition(tx: Tx, definitionId: Uuid): Promise<{ total: number; obtained: number }> {
  const r = await tx.queryOne<{ total: string; obtained: string }>(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'OBTAINED')::text AS obtained FROM higher.diploma_awards WHERE definition_id = $1`,
    [definitionId],
  );
  return { total: Number(r?.total ?? 0), obtained: Number(r?.obtained ?? 0) };
}

// --- exigences ----------------------------------------------------------------------------------------------------

export async function listRequirements(tx: Tx, definitionId: Uuid): Promise<DiplomaRequirement[]> {
  const rows = await tx.many<RequirementRow>(
    `SELECT ${REQUIREMENT_COLUMNS} FROM higher.diploma_requirements WHERE definition_id = $1 ORDER BY position, ue_code NULLS LAST, id`,
    [definitionId],
  );
  return rows.map(toRequirement);
}

export interface RequirementWrite {
  readonly id: Uuid;
  readonly ueNodeId: Uuid;
  readonly ueCode: string | null;
  readonly ueLabel: string | null;
  readonly credits: number;
  readonly mandatory: boolean;
  readonly position: number;
  readonly removedFromCurriculum: boolean;
}

export async function insertRequirement(tx: Tx, tenantId: Uuid, definitionId: Uuid, w: RequirementWrite, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO higher.diploma_requirements (id, tenant_id, definition_id, ue_node_id, ue_code, ue_label, credits, mandatory, position, removed_from_curriculum, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [w.id, tenantId, definitionId, w.ueNodeId, w.ueCode, w.ueLabel, w.credits, w.mandatory, w.position, w.removedFromCurriculum, at.toISOString()],
  );
}

export async function updateRequirementFromCurriculum(
  tx: Tx,
  id: Uuid,
  w: { ueCode: string | null; ueLabel: string | null; credits: number; removedFromCurriculum: boolean },
): Promise<void> {
  await tx.query(
    `UPDATE higher.diploma_requirements SET ue_code = $2, ue_label = $3, credits = $4, removed_from_curriculum = $5 WHERE id = $1`,
    [id, w.ueCode, w.ueLabel, w.credits, w.removedFromCurriculum],
  );
}

export async function deleteRequirementsOf(tx: Tx, definitionId: Uuid): Promise<void> {
  await tx.query(`DELETE FROM higher.diploma_requirements WHERE definition_id = $1`, [definitionId]);
}

// --- octrois ------------------------------------------------------------------------------------------------------

export interface AwardInsert {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly definitionId: Uuid;
  readonly studentId: Uuid;
  readonly lastEnrollmentId: Uuid | null;
  readonly academicYearId: Uuid | null;
  readonly reference: string;
  readonly referenceYear: number;
  readonly referenceSeq: number;
  readonly awardedVia: AwardedVia;
  readonly forcedReason: string | null;
  readonly creditsTotal: number;
  readonly requirementsSnapshot: RequirementsSnapshot;
  readonly eligibility: Readonly<Record<string, unknown>>;
  readonly cycleAverage: DecimalString | null;
  readonly mentionCode: string | null;
  readonly ruleSetCode: string;
  readonly ruleVersionId: Uuid;
  readonly ruleVersionNo: number;
  readonly definitionHash: string;
  readonly awardedAt: Date;
  readonly awardedBy: Uuid | null;
  readonly awardedByName: string;
  readonly acquiredDate: IsoDate | null;
  readonly predecessorAwardId: Uuid | null;
  readonly reawardDecision: string | null;
}

export async function insertAward(tx: Tx, w: AwardInsert): Promise<DiplomaAward> {
  const rows = await tx.many<AwardRow>(
    `INSERT INTO higher.diploma_awards (id, tenant_id, definition_id, student_id, last_enrollment_id, academic_year_id, reference, reference_year, reference_seq,
        status, awarded_via, forced_reason, credits_total, requirements_snapshot, eligibility, cycle_average, mention_code, rule_set_code, rule_version_id,
        rule_version_no, definition_hash, awarded_at, awarded_by, awarded_by_name, acquired_date, predecessor_award_id, reaward_decision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OBTAINED',$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     RETURNING ${AWARD_COLUMNS}`,
    [
      w.id, w.tenantId, w.definitionId, w.studentId, w.lastEnrollmentId, w.academicYearId, w.reference, w.referenceYear, w.referenceSeq, w.awardedVia,
      w.forcedReason, w.creditsTotal, JSON.stringify(w.requirementsSnapshot), JSON.stringify(w.eligibility), w.cycleAverage, w.mentionCode, w.ruleSetCode,
      w.ruleVersionId, w.ruleVersionNo, w.definitionHash, w.awardedAt.toISOString(), w.awardedBy, w.awardedByName, w.acquiredDate, w.predecessorAwardId,
      w.reawardDecision,
    ],
  );
  return toAward(rows[0] as AwardRow);
}

export async function getAward(tx: Tx, id: Uuid, forUpdate = false): Promise<DiplomaAward | null> {
  const r = await tx.queryOne<AwardRow>(`SELECT ${AWARD_COLUMNS} FROM higher.diploma_awards WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toAward(r) : null;
}

export async function findActiveAward(tx: Tx, definitionId: Uuid, studentId: Uuid): Promise<DiplomaAward | null> {
  const r = await tx.queryOne<AwardRow>(
    `SELECT ${AWARD_COLUMNS} FROM higher.diploma_awards WHERE definition_id = $1 AND student_id = $2 AND status = 'OBTAINED'`,
    [definitionId, studentId],
  );
  return r ? toAward(r) : null;
}

export async function findLastRevokedAward(tx: Tx, definitionId: Uuid, studentId: Uuid): Promise<DiplomaAward | null> {
  const r = await tx.queryOne<AwardRow>(
    `SELECT ${AWARD_COLUMNS} FROM higher.diploma_awards WHERE definition_id = $1 AND student_id = $2 AND status = 'REVOKED' ORDER BY revoked_at DESC, id DESC LIMIT 1`,
    [definitionId, studentId],
  );
  return r ? toAward(r) : null;
}

export async function listAwards(
  tx: Tx,
  f: { definitionId?: Uuid | undefined; studentId?: Uuid | undefined; status?: DiplomaAward["status"] | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: DiplomaAward[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.definitionId) { params.push(f.definitionId); where.push(`definition_id = $${params.length}`); }
  if (f.studentId) { params.push(f.studentId); where.push(`student_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  const cursor = decodeCursor<{ a: string; i: string }>(f.cursor);
  if (cursor) { params.push(cursor.a, cursor.i); where.push(`(awarded_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<AwardRow>(`SELECT ${AWARD_COLUMNS} FROM higher.diploma_awards WHERE ${where.join(" AND ")} ORDER BY awarded_at DESC, id DESC LIMIT $${params.length}`, params);
  const items = rows.slice(0, limit).map(toAward);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ a: last.awardedAt.toISOString(), i: last.id }) : null };
}

export async function listAwardsOfStudent(tx: Tx, studentId: Uuid): Promise<DiplomaAward[]> {
  const rows = await tx.many<AwardRow>(`SELECT ${AWARD_COLUMNS} FROM higher.diploma_awards WHERE student_id = $1 ORDER BY awarded_at DESC, id DESC`, [studentId]);
  return rows.map(toAward);
}

/** Révocation (transition terminale) ; les documents encore émis passent `REVOKED` par déclencheur. */
export async function revokeAward(tx: Tx, id: Uuid, by: Uuid, byName: string, reason: string, at: Date): Promise<DiplomaAward | null> {
  const r = await tx.queryOne<AwardRow>(
    `UPDATE higher.diploma_awards SET status = 'REVOKED', revoked_at = $2, revoked_by = $3, revoked_by_name = $4, revoke_reason = $5
      WHERE id = $1 AND status = 'OBTAINED' RETURNING ${AWARD_COLUMNS}`,
    [id, at.toISOString(), by, byName, reason],
  );
  return r ? toAward(r) : null;
}
