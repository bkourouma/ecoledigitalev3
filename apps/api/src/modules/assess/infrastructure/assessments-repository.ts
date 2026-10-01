/**
 * Accès SQL : types d'évaluation, réglages, évaluations, historique des transitions. Une fonction par requête, SQL
 * paramétré, `Tx` reçu en paramètre (RLS : `tenant_id` est imposé par la base, on l'écrit quand un index le demande).
 */
import type { Tx } from "@ecoledigitale/database";
import { DEFAULT_ASSESS_SETTINGS, type Assessment, type AssessmentType, type AssessSettings, type PublicationMode, type Transition } from "../domain/types";
import type { AssessStatus } from "@ecoledigitale/contracts/src/v2/assess";
import {
  ASSESSMENT_COLUMNS,
  ASSESSMENT_FROM,
  SETTINGS_COLUMNS,
  TRANSITION_COLUMNS,
  TYPE_COLUMNS,
  toAssessment,
  toSettings,
  toTransition,
  toType,
  type AssessmentRow,
  type SettingsRow,
  type TransitionRow,
  type TypeRow,
} from "./rows";

// ---------------------------------------------------------------------------
// Types d'évaluation
// ---------------------------------------------------------------------------

export interface TypeInsert {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  aggregationGroup: string;
  defaultScaleMax: string;
  defaultWeight: string;
  publicationMode: PublicationMode;
  visibleToStudents: boolean;
  allowsSession2: boolean;
  isSystem: boolean;
  templateKey: string | null;
  position: number;
  now: Date;
}

export async function insertType(tx: Tx, t: TypeInsert): Promise<AssessmentType> {
  const row = await tx.queryOne<TypeRow>(
    `INSERT INTO assess.assessment_types AS t (id, tenant_id, code, label, aggregation_group, default_scale_max, default_weight, publication_mode,
        visible_to_students, allows_session2, is_system, template_key, position, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10,$11,$12,$13,$14,$14)
     RETURNING ${TYPE_COLUMNS}`,
    [t.id, t.tenantId, t.code, t.label, t.aggregationGroup, t.defaultScaleMax, t.defaultWeight, t.publicationMode, t.visibleToStudents, t.allowsSession2, t.isSystem, t.templateKey, t.position, t.now],
  );
  return toType(row as TypeRow);
}

/** Insertion idempotente d'un type de modèle de pack : rien si le code existe déjà (jamais d'écrasement). */
export async function insertTypeIfAbsent(tx: Tx, t: TypeInsert): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO assess.assessment_types (id, tenant_id, code, label, aggregation_group, default_scale_max, default_weight, publication_mode,
        visible_to_students, allows_session2, is_system, template_key, position, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10,$11,$12,$13,$14,$14)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [t.id, t.tenantId, t.code, t.label, t.aggregationGroup, t.defaultScaleMax, t.defaultWeight, t.publicationMode, t.visibleToStudents, t.allowsSession2, t.isSystem, t.templateKey, t.position, t.now],
  );
  return res.rowCount > 0;
}

export async function listTypes(tx: Tx, options: { includeInactive?: boolean } = {}): Promise<AssessmentType[]> {
  const rows = await tx.many<TypeRow>(
    `SELECT ${TYPE_COLUMNS} FROM assess.assessment_types t ${options.includeInactive ? "" : "WHERE t.active"} ORDER BY t.position, t.code`,
  );
  return rows.map(toType);
}

export async function getType(tx: Tx, id: string): Promise<AssessmentType | null> {
  const row = await tx.queryOne<TypeRow>(`SELECT ${TYPE_COLUMNS} FROM assess.assessment_types t WHERE t.id = $1`, [id]);
  return row ? toType(row) : null;
}

export async function getTypeByCode(tx: Tx, code: string): Promise<AssessmentType | null> {
  const row = await tx.queryOne<TypeRow>(`SELECT ${TYPE_COLUMNS} FROM assess.assessment_types t WHERE t.code = $1`, [code]);
  return row ? toType(row) : null;
}

export interface TypePatch {
  label?: string;
  aggregationGroup?: string;
  defaultScaleMax?: string;
  defaultWeight?: string;
  publicationMode?: PublicationMode;
  visibleToStudents?: boolean;
  allowsSession2?: boolean;
  position?: number;
  active?: boolean;
}

export async function updateType(tx: Tx, id: string, patch: TypePatch, now: Date): Promise<AssessmentType | null> {
  const row = await tx.queryOne<TypeRow>(
    `UPDATE assess.assessment_types t SET
        label = coalesce($2, label), aggregation_group = coalesce($3, aggregation_group),
        default_scale_max = coalesce($4::numeric, default_scale_max), default_weight = coalesce($5::numeric, default_weight),
        publication_mode = coalesce($6, publication_mode), visible_to_students = coalesce($7, visible_to_students),
        allows_session2 = coalesce($8, allows_session2), position = coalesce($9, position), active = coalesce($10, active),
        updated_at = $11
      WHERE t.id = $1
      RETURNING ${TYPE_COLUMNS}`,
    [id, patch.label ?? null, patch.aggregationGroup ?? null, patch.defaultScaleMax ?? null, patch.defaultWeight ?? null, patch.publicationMode ?? null, patch.visibleToStudents ?? null, patch.allowsSession2 ?? null, patch.position ?? null, patch.active ?? null, now],
  );
  return row ? toType(row) : null;
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function getSettingsRow(tx: Tx): Promise<AssessSettings> {
  const row = await tx.queryOne<SettingsRow>(`SELECT ${SETTINGS_COLUMNS} FROM assess.settings`);
  return row ? toSettings(row) : { ...DEFAULT_ASSESS_SETTINGS };
}

export async function upsertSettings(
  tx: Tx,
  tenantId: string,
  patch: { requireSeparateReviewer?: boolean | undefined; requireSeparateApprover?: boolean | undefined; maxScoreDecimals?: number | undefined },
  by: string | null,
  now: Date,
): Promise<AssessSettings> {
  const current = await getSettingsRow(tx);
  const next = {
    requireSeparateReviewer: patch.requireSeparateReviewer ?? current.requireSeparateReviewer,
    requireSeparateApprover: patch.requireSeparateApprover ?? current.requireSeparateApprover,
    maxScoreDecimals: patch.maxScoreDecimals ?? current.maxScoreDecimals,
  };
  const row = await tx.queryOne<SettingsRow>(
    `INSERT INTO assess.settings (tenant_id, require_separate_reviewer, require_separate_approver, max_score_decimals, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id) DO UPDATE SET require_separate_reviewer = EXCLUDED.require_separate_reviewer,
        require_separate_approver = EXCLUDED.require_separate_approver, max_score_decimals = EXCLUDED.max_score_decimals,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
     RETURNING ${SETTINGS_COLUMNS}`,
    [tenantId, next.requireSeparateReviewer, next.requireSeparateApprover, next.maxScoreDecimals, by, now],
  );
  return toSettings(row as SettingsRow);
}

// ---------------------------------------------------------------------------
// Évaluations
// ---------------------------------------------------------------------------

export interface AssessmentInsert {
  id: string;
  tenantId: string;
  typeId: string;
  classroomId: string;
  curriculumNodeId: string;
  academicPeriodId: string;
  academicYearId: string;
  teacherId: string;
  title: string;
  assessedOn: string;
  scaleMax: string;
  weight: string;
  sessionNo: number;
  createdBy: string;
  now: Date;
}

export async function insertAssessment(tx: Tx, a: AssessmentInsert): Promise<void> {
  await tx.query(
    `INSERT INTO assess.assessments (id, tenant_id, type_id, classroom_id, curriculum_node_id, academic_period_id, academic_year_id, teacher_id,
        title, assessed_on, scale_max, weight, session_no, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::numeric,$12::numeric,$13,$14,$15,$15)`,
    [a.id, a.tenantId, a.typeId, a.classroomId, a.curriculumNodeId, a.academicPeriodId, a.academicYearId, a.teacherId, a.title, a.assessedOn, a.scaleMax, a.weight, a.sessionNo, a.createdBy, a.now],
  );
}

export type RowLock = "share" | "update";

export async function getAssessment(tx: Tx, id: string, lock?: RowLock): Promise<Assessment | null> {
  // FOR SHARE / FOR UPDATE ne s'applique qu'à la table `a` (pas au type)
  const suffix = lock === "update" ? " FOR UPDATE OF a" : lock === "share" ? " FOR SHARE OF a" : "";
  const row = await tx.queryOne<AssessmentRow>(`SELECT ${ASSESSMENT_COLUMNS} FROM ${ASSESSMENT_FROM} WHERE a.id = $1${suffix}`, [id]);
  return row ? toAssessment(row) : null;
}

export interface AssessmentFilter {
  classroomId?: string | undefined;
  academicPeriodId?: string | undefined;
  curriculumNodeId?: string | undefined;
  teacherId?: string | undefined;
  status?: string | undefined;
  sessionNo?: number | undefined;
  statuses?: readonly string[] | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function listAssessments(tx: Tx, f: AssessmentFilter): Promise<{ items: Assessment[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.classroomId) add("a.classroom_id = ?", f.classroomId);
  if (f.academicPeriodId) add("a.academic_period_id = ?", f.academicPeriodId);
  if (f.curriculumNodeId) add("a.curriculum_node_id = ?", f.curriculumNodeId);
  if (f.teacherId) add("a.teacher_id = ?", f.teacherId);
  if (f.status) add("a.status = ?", f.status);
  if (f.statuses) add("a.status = ANY(?::text[])", [...f.statuses]);
  if (f.sessionNo) add("a.session_no = ?", f.sessionNo);
  if (f.cursor) {
    const [day = "", id = ""] = f.cursor.split("|");
    params.push(day, id);
    where.push(`(a.assessed_on, a.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  const limit = Math.min(f.limit ?? 50, 200);
  params.push(limit + 1);
  const rows = await tx.many<AssessmentRow>(
    `SELECT ${ASSESSMENT_COLUMNS} FROM ${ASSESSMENT_FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.assessed_on DESC, a.id DESC LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit).map(toAssessment);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? `${last.assessedOn}|${last.id}` : null };
}

export interface AssessmentPatch {
  typeId?: string | undefined;
  title?: string | undefined;
  assessedOn?: string | undefined;
  scaleMax?: string | undefined;
  weight?: string | undefined;
  sessionNo?: number | undefined;
  curriculumNodeId?: string | undefined;
  academicPeriodId?: string | undefined;
  academicYearId?: string | undefined;
  teacherId?: string | undefined;
}

/** Modification d'une évaluation en brouillon (comparaison de `row_version` : 0 ligne ⇒ évaluation modifiée entre-temps). */
export async function updateAssessmentDraft(tx: Tx, id: string, expectedVersion: number, p: AssessmentPatch, now: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE assess.assessments SET
        type_id = coalesce($3, type_id), title = coalesce($4, title), assessed_on = coalesce($5::date, assessed_on),
        scale_max = coalesce($6::numeric, scale_max), weight = coalesce($7::numeric, weight), session_no = coalesce($8, session_no),
        curriculum_node_id = coalesce($9, curriculum_node_id), academic_period_id = coalesce($10, academic_period_id),
        academic_year_id = coalesce($11, academic_year_id), teacher_id = coalesce($12, teacher_id), updated_at = $13
      WHERE id = $1 AND row_version = $2`,
    [id, expectedVersion, p.typeId ?? null, p.title ?? null, p.assessedOn ?? null, p.scaleMax ?? null, p.weight ?? null, p.sessionNo ?? null, p.curriculumNodeId ?? null, p.academicPeriodId ?? null, p.academicYearId ?? null, p.teacherId ?? null, now],
  );
  return res.rowCount === 1;
}

export interface StatusChange {
  to: AssessStatus;
  actorId: string | null;
  now: Date;
  comment?: string | null | undefined;
  fourEyesWaived?: boolean | undefined;
  /** Publication automatique à l'approbation : l'approbateur est aussi le publicateur. */
  alsoPublish?: boolean | undefined;
}

/** Applique une transition : écrit les colonnes de signature correspondantes ; le déclencheur valide et incrémente `row_version`. */
export async function applyStatusChange(tx: Tx, id: string, expectedVersion: number, c: StatusChange): Promise<boolean> {
  const set: string[] = ["status = $3", "updated_at = $4"];
  const params: unknown[] = [id, expectedVersion, c.to, c.now];
  const add = (column: string, value: unknown): void => {
    params.push(value);
    set.push(`${column} = $${params.length}`);
  };
  switch (c.to) {
    case "SUBMITTED":
      add("submitted_at", c.now);
      add("submitted_by", c.actorId);
      add("return_comment", null);
      add("four_eyes_waived", false);
      break;
    case "REVIEWED":
      add("reviewed_at", c.now);
      add("reviewed_by", c.actorId);
      break;
    case "APPROVED":
      add("approved_at", c.now);
      add("approved_by", c.actorId);
      break;
    case "PUBLISHED":
      add("published_at", c.now);
      add("published_by", c.actorId);
      break;
    case "DRAFT":
      add("return_comment", c.comment ?? null);
      break;
    case "CANCELLED":
      add("cancelled_at", c.now);
      add("cancelled_by", c.actorId);
      add("cancel_reason", c.comment ?? null);
      break;
    default:
      break;
  }
  if (c.fourEyesWaived) add("four_eyes_waived", true);
  const res = await tx.query(`UPDATE assess.assessments SET ${set.join(", ")} WHERE id = $1 AND row_version = $2`, params);
  return res.rowCount === 1;
}

export async function countGrades(tx: Tx, assessmentId: string): Promise<number> {
  const row = await tx.queryOne<{ n: string }>("SELECT count(*)::text AS n FROM assess.grades WHERE assessment_id = $1", [assessmentId]);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Historique des transitions
// ---------------------------------------------------------------------------

export async function insertTransition(
  tx: Tx,
  t: { id: string; tenantId: string; assessmentId: string; from: AssessStatus | null; to: AssessStatus; actorId: string | null; actorName: string | null; comment: string | null; fourEyesWaived: boolean; at: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO assess.assessment_transitions (id, tenant_id, assessment_id, from_status, to_status, actor_id, actor_name, comment, four_eyes_waived, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [t.id, t.tenantId, t.assessmentId, t.from, t.to, t.actorId, t.actorName, t.comment, t.fourEyesWaived, t.at],
  );
}

export async function listTransitions(tx: Tx, assessmentId: string): Promise<Transition[]> {
  const rows = await tx.many<TransitionRow>(
    `SELECT ${TRANSITION_COLUMNS} FROM assess.assessment_transitions WHERE assessment_id = $1 ORDER BY at, id`,
    [assessmentId],
  );
  return rows.map(toTransition);
}
