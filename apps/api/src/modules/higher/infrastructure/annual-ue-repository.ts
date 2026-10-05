/** UE annuelles (O-11) : déclarations, lignées membres et résultats par semestre (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { AnnualPart, AnnualUeDef } from "../domain/annual-ue";
import type { UeState, Uuid } from "../domain/types";

interface DefRow {
  id: Uuid;
  ue_node_id: Uuid;
  parts_expected: number;
  reason: string;
  created_at: Date;
  members: Uuid[] | null;
}

const DEF_SELECT = `SELECT a.id, a.ue_node_id, a.parts_expected, a.reason, a.created_at,
       COALESCE((SELECT array_agg(m.member_ue_node_id ORDER BY m.member_ue_node_id) FROM higher.annual_ue_members m WHERE m.annual_ue_id = a.id), '{}') AS members
  FROM higher.annual_ues a`;

const toDef = (r: DefRow): AnnualUeDef => ({
  id: r.id,
  ueNodeId: r.ue_node_id,
  partsExpected: Number(r.parts_expected),
  memberNodeIds: r.members ?? [],
  reason: r.reason,
  createdAt: r.created_at,
});

export async function listDefs(tx: Tx): Promise<AnnualUeDef[]> {
  return (await tx.many<DefRow>(`${DEF_SELECT} ORDER BY a.created_at, a.id`)).map(toDef);
}

export async function getDef(tx: Tx, id: Uuid): Promise<AnnualUeDef | null> {
  const r = await tx.queryOne<DefRow>(`${DEF_SELECT} WHERE a.id = $1`, [id]);
  return r ? toDef(r) : null;
}

export async function getDefByAnchor(tx: Tx, ueNodeId: Uuid): Promise<AnnualUeDef | null> {
  const r = await tx.queryOne<DefRow>(`${DEF_SELECT} WHERE a.ue_node_id = $1`, [ueNodeId]);
  return r ? toDef(r) : null;
}

/** Définition à laquelle appartient une lignée (ancre ou autre membre), ou `null`. */
export async function getDefOfMember(tx: Tx, memberNodeId: Uuid): Promise<AnnualUeDef | null> {
  const r = await tx.queryOne<DefRow>(`${DEF_SELECT} WHERE a.id = (SELECT annual_ue_id FROM higher.annual_ue_members WHERE member_ue_node_id = $1)`, [memberNodeId]);
  return r ? toDef(r) : null;
}

export async function insertDef(tx: Tx, v: { id: Uuid; tenantId: Uuid; ueNodeId: Uuid; partsExpected: number; reason: string; createdBy: Uuid | null; at: Date }): Promise<void> {
  await tx.query("INSERT INTO higher.annual_ues (id, tenant_id, ue_node_id, parts_expected, reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    v.id, v.tenantId, v.ueNodeId, v.partsExpected, v.reason, v.createdBy, v.at.toISOString(),
  ]);
}

export async function insertMember(tx: Tx, tenantId: Uuid, annualUeId: Uuid, memberNodeId: Uuid): Promise<void> {
  await tx.query("INSERT INTO higher.annual_ue_members (tenant_id, annual_ue_id, member_ue_node_id) VALUES ($1,$2,$3)", [tenantId, annualUeId, memberNodeId]);
}

export async function deleteDef(tx: Tx, id: Uuid): Promise<void> {
  await tx.query("DELETE FROM higher.annual_ues WHERE id = $1", [id]);
}

export async function countParts(tx: Tx, annualUeId: Uuid): Promise<number> {
  const r = await tx.queryOne<{ n: string }>("SELECT count(*)::text AS n FROM higher.annual_ue_parts WHERE annual_ue_id = $1", [annualUeId]);
  return Number(r?.n ?? 0);
}

interface PartRow {
  annual_ue_id: Uuid;
  student_id: Uuid;
  enrollment_id: Uuid;
  academic_year_id: Uuid;
  academic_period_id: Uuid;
  part_ue_node_id: Uuid;
  credits: string;
  average_exact: string | null;
  validated: boolean;
  ue_state: UeState;
  session_obtained: number | null;
  via: AnnualPart["via"];
  override_id: Uuid | null;
  compensated_ecue_count: number;
  source_result_id: Uuid;
  results_version: number;
  validated_at: Date | null;
  recorded_at: Date;
}

const PART_COLS = `annual_ue_id, student_id, enrollment_id, academic_year_id, academic_period_id, part_ue_node_id, credits::text AS credits, average_exact::text AS average_exact,
  validated, ue_state, session_obtained, via, override_id, compensated_ecue_count, source_result_id, results_version, validated_at, recorded_at`;

const toPart = (r: PartRow): AnnualPart => ({
  annualUeId: r.annual_ue_id,
  studentId: r.student_id,
  enrollmentId: r.enrollment_id,
  academicYearId: r.academic_year_id,
  academicPeriodId: r.academic_period_id,
  partUeNodeId: r.part_ue_node_id,
  credits: Number(r.credits),
  averageExact: r.average_exact,
  validated: r.validated,
  ueState: r.ue_state,
  sessionObtained: r.session_obtained === null ? null : (Number(r.session_obtained) as 1 | 2),
  via: r.via,
  overrideId: r.override_id,
  compensatedEcueCount: Number(r.compensated_ecue_count),
  sourceResultId: r.source_result_id,
  resultsVersion: Number(r.results_version),
  validatedAt: r.validated_at,
  recordedAt: r.recorded_at,
});

export async function listParts(tx: Tx, annualUeId: Uuid, studentId: Uuid, academicYearId: Uuid): Promise<AnnualPart[]> {
  const rows = await tx.many<PartRow>(
    `SELECT ${PART_COLS} FROM higher.annual_ue_parts WHERE annual_ue_id = $1 AND student_id = $2 AND academic_year_id = $3 ORDER BY recorded_at, academic_period_id`,
    [annualUeId, studentId, academicYearId],
  );
  return rows.map(toPart);
}

/**
 * Enregistre (ou remplace) le résultat FINAL d'une partie. Une version plus ancienne n'écrase jamais une plus récente
 * (rejeu d'un événement tardif) ; le rejeu de la même version est sans effet.
 */
export async function upsertPart(tx: Tx, tenantId: Uuid, id: Uuid, p: AnnualPart, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO higher.annual_ue_parts (id, tenant_id, annual_ue_id, student_id, enrollment_id, academic_year_id, academic_period_id, part_ue_node_id, credits, average_exact,
        validated, ue_state, session_obtained, via, override_id, compensated_ecue_count, source_result_id, results_version, validated_at, recorded_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
     ON CONFLICT (tenant_id, annual_ue_id, student_id, academic_year_id, academic_period_id) DO UPDATE SET
        enrollment_id = EXCLUDED.enrollment_id, part_ue_node_id = EXCLUDED.part_ue_node_id, credits = EXCLUDED.credits, average_exact = EXCLUDED.average_exact,
        validated = EXCLUDED.validated, ue_state = EXCLUDED.ue_state, session_obtained = EXCLUDED.session_obtained, via = EXCLUDED.via, override_id = EXCLUDED.override_id,
        compensated_ecue_count = EXCLUDED.compensated_ecue_count, source_result_id = EXCLUDED.source_result_id, results_version = EXCLUDED.results_version,
        validated_at = EXCLUDED.validated_at, updated_at = EXCLUDED.updated_at
      WHERE higher.annual_ue_parts.results_version <= EXCLUDED.results_version`,
    [
      id, tenantId, p.annualUeId, p.studentId, p.enrollmentId, p.academicYearId, p.academicPeriodId, p.partUeNodeId, p.credits, p.averageExact, p.validated, p.ueState,
      p.sessionObtained, p.via, p.overrideId, p.compensatedEcueCount, p.sourceResultId, p.resultsVersion, p.validatedAt ? p.validatedAt.toISOString() : null, at.toISOString(),
    ],
  );
}
