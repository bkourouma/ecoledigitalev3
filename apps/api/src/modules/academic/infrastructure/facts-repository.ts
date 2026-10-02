/**
 * Lectures SQL des faits publiés pour les autres modules (cycles, UE par lignée, inscriptions d'un cycle ou d'une classe,
 * placements d'un apprenant). Toutes passent par le `Tx` du tenant (RLS) ; aucune écriture.
 */
import type { Tx } from "@ecoledigitale/database";
import { normalizeDecimal } from "../domain/decimal";
import type { ClassroomEnrollmentFacts, CycleEnrollmentFacts, LastEnrollmentFacts, RepeatYearFact, UeFacts } from "../domain/facts";

/** Statuts d'inscription qui comptent pour une scolarité suivie (voir `SCHOOLING_ENROLLMENT_STATUSES`). */
const SCHOOLING = ["ACTIVE", "COMPLETED"];

/** Le programme et ses sous-programmes (série > spécialité) : le périmètre d'un cycle. */
export async function programScope(tx: Tx, programId: string): Promise<string[]> {
  const rows = await tx.many<{ id: string }>("SELECT id FROM academic.programs WHERE id = $1 OR parent_program_id = $1", [programId]);
  return rows.map((r) => r.id);
}

/** UE (type système `UE`, actives) de la version la plus récente de chaque programme donné ; l'identité de l'UE est sa LIGNÉE. */
export async function latestUeOfPrograms(tx: Tx, programIds: readonly string[]): Promise<UeFacts[]> {
  if (programIds.length === 0) return [];
  const rows = await tx.many<{ lineage_id: string; id: string; code: string; label: string; credits: string | null; category_code: string | null; program_id: string; academic_year_id: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (v.program_id) v.id, v.program_id, v.academic_year_id
         FROM academic.curriculum_versions v
         JOIN academic.academic_years y ON y.tenant_id = v.tenant_id AND y.id = v.academic_year_id
        WHERE v.program_id = ANY($1::uuid[]) AND v.status IN ('PUBLISHED', 'LOCKED', 'ARCHIVED')
        ORDER BY v.program_id, y.starts_on DESC, v.created_at DESC
     )
     SELECT n.lineage_id, n.id, n.code, n.label, n.credits::text AS credits, n.category_code, l.program_id, l.academic_year_id
       FROM latest l
       JOIN academic.curriculum_nodes n ON n.tenant_id = kernel.current_tenant_id() AND n.version_id = l.id
      WHERE n.node_type_code = 'UE' AND n.status = 'ACTIVE'
      ORDER BY l.program_id, n.ordinal, n.code`,
    [[...programIds]],
  );
  return rows.map(mapUe);
}

/** L'UE d'une lignée, dans la version la plus récente qui la contient (peut être retirée du curriculum courant). */
export async function ueByLineage(tx: Tx, lineageId: string): Promise<UeFacts | null> {
  const r = await tx.queryOne<{ lineage_id: string; id: string; code: string; label: string; credits: string | null; category_code: string | null; program_id: string; academic_year_id: string }>(
    `SELECT n.lineage_id, n.id, n.code, n.label, n.credits::text AS credits, n.category_code, v.program_id, v.academic_year_id
       FROM academic.curriculum_nodes n
       JOIN academic.curriculum_versions v ON v.tenant_id = n.tenant_id AND v.id = n.version_id
       JOIN academic.academic_years y ON y.tenant_id = v.tenant_id AND y.id = v.academic_year_id
      WHERE n.lineage_id = $1 AND n.node_type_code = 'UE'
      ORDER BY y.starts_on DESC, n.created_at DESC LIMIT 1`,
    [lineageId],
  );
  return r ? mapUe(r) : null;
}

const mapUe = (r: { lineage_id: string; id: string; code: string; label: string; credits: string | null; category_code: string | null; program_id: string; academic_year_id: string }): UeFacts => ({
  lineageId: r.lineage_id,
  nodeId: r.id,
  code: r.code,
  label: r.label,
  credits: normalizeDecimal(r.credits ?? "0"),
  categoryCode: r.category_code,
  programId: r.program_id,
  academicYearId: r.academic_year_id,
});

export async function listCycleEnrollments(tx: Tx, programIds: readonly string[]): Promise<CycleEnrollmentFacts[]> {
  if (programIds.length === 0) return [];
  const rows = await tx.many<{ id: string; student_id: string; classroom_id: string; academic_year_id: string; status: string }>(
    `SELECT e.id, e.student_id, e.classroom_id, e.academic_year_id, e.status
       FROM academic.enrollments e
       JOIN academic.classrooms c ON c.tenant_id = e.tenant_id AND c.id = e.classroom_id
      WHERE c.program_id = ANY($1::uuid[]) AND e.status = ANY($2::text[])
      ORDER BY e.created_at, e.id`,
    [[...programIds], SCHOOLING],
  );
  return rows.map((r) => ({ enrollmentId: r.id, studentId: r.student_id, classroomId: r.classroom_id, academicYearId: r.academic_year_id, status: r.status }));
}

export async function lastEnrollmentInPrograms(tx: Tx, studentId: string, programIds: readonly string[]): Promise<LastEnrollmentFacts | null> {
  if (programIds.length === 0) return null;
  const r = await tx.queryOne<{ id: string; classroom_id: string; academic_year_id: string; code: string; label: string }>(
    `SELECT e.id, e.classroom_id, e.academic_year_id, y.code, y.label
       FROM academic.enrollments e
       JOIN academic.classrooms c ON c.tenant_id = e.tenant_id AND c.id = e.classroom_id
       JOIN academic.academic_years y ON y.tenant_id = e.tenant_id AND y.id = e.academic_year_id
      WHERE e.student_id = $1 AND c.program_id = ANY($2::uuid[]) AND e.status = ANY($3::text[])
      ORDER BY y.starts_on DESC, e.created_at DESC, e.id DESC LIMIT 1`,
    [studentId, [...programIds], SCHOOLING],
  );
  return r ? { enrollmentId: r.id, academicYearId: r.academic_year_id, academicYearCode: r.code, academicYearLabel: r.label, classroomId: r.classroom_id } : null;
}

/**
 * Apprenants qui SUIVENT une UE (lignée) : inscription en mode classe dont la classe porte le niveau de l'UE (le nœud a
 * pour ancêtre un nœud `LEVEL` du niveau de la classe) ou sélection de cours (option, à la carte…) sur un nœud de la
 * lignée. `statuses` : statuts d'inscription retenus (`ACTIVE` seul = « actuellement inscrits »).
 */
export async function studentsFollowingLineage(tx: Tx, lineageId: string, enrollmentStatuses: readonly string[], courseStatuses: readonly string[]): Promise<string[]> {
  const rows = await tx.many<{ student_id: string }>(
    `WITH RECURSIVE target AS (
       SELECT n.id, n.version_id, n.parent_id, n.grade_level_id, 0 AS depth FROM academic.curriculum_nodes n WHERE n.lineage_id = $1
       UNION ALL
       SELECT p.id, t.version_id, p.parent_id, p.grade_level_id, t.depth + 1
         FROM target t JOIN academic.curriculum_nodes p ON p.id = t.parent_id WHERE t.depth < 16
     ),
     level_of AS (SELECT DISTINCT version_id, grade_level_id FROM target WHERE grade_level_id IS NOT NULL)
     SELECT e.student_id
       FROM academic.enrollments e
       JOIN academic.classrooms c ON c.tenant_id = e.tenant_id AND c.id = e.classroom_id
       JOIN level_of l ON l.version_id = c.curriculum_version_id AND l.grade_level_id = c.grade_level_id
      WHERE e.status = ANY($2::text[]) AND e.mode = 'CLASS'
     UNION
     SELECT e.student_id
       FROM academic.enrollment_courses ec
       JOIN academic.curriculum_nodes n ON n.id = ec.curriculum_node_id AND n.lineage_id = $1
       JOIN academic.enrollments e ON e.tenant_id = ec.tenant_id AND e.id = ec.enrollment_id
      WHERE ec.status = ANY($3::text[]) AND e.status = ANY($2::text[])`,
    [lineageId, [...enrollmentStatuses], [...courseStatuses]],
  );
  return rows.map((r) => r.student_id);
}

export async function studentFollowsLineage(tx: Tx, studentId: string, lineageId: string, enrollmentStatuses: readonly string[], courseStatuses: readonly string[]): Promise<boolean> {
  const all = await studentsFollowingLineage(tx, lineageId, enrollmentStatuses, courseStatuses);
  return all.includes(studentId);
}

/** Inscriptions d'une classe : celles dont la classe courante ou un placement (historique) est cette classe. */
export async function listEnrollmentsOfClassroom(tx: Tx, classroomId: string): Promise<ClassroomEnrollmentFacts[]> {
  const rows = await tx.many<{ id: string; student_id: string; classroom_id: string; academic_year_id: string; status: string }>(
    `SELECT e.id, e.student_id, e.classroom_id, e.academic_year_id, e.status
       FROM academic.enrollments e
      WHERE e.classroom_id = $1
         OR EXISTS (SELECT 1 FROM academic.enrollment_placements p WHERE p.tenant_id = e.tenant_id AND p.enrollment_id = e.id AND p.classroom_id = $1)
      ORDER BY e.created_at, e.id`,
    [classroomId],
  );
  return rows.map((r) => ({
    enrollmentId: r.id,
    studentId: r.student_id,
    classroomId: r.classroom_id,
    academicYearId: r.academic_year_id,
    status: r.status,
    active: r.classroom_id === classroomId && SCHOOLING.includes(r.status),
  }));
}

/**
 * Années de redoublement de l'élève dans un cycle d'enseignement (`education_level_id` du niveau de la classe).
 * Une année est un redoublement si l'inscription est marquée `is_repeating`, OU si l'inscription qu'elle prolonge
 * (`previous_enrollment_id`) s'est conclue par une issue de type `REPEAT` : les deux signalements d'un MÊME redoublement ne
 * comptent qu'une fois (une ligne par inscription). Les inscriptions annulées ou en attente ne comptent pas.
 */
export async function listRepeatYearsInCycle(tx: Tx, input: { studentId: string; educationLevelId: string; institutionId: string | null }): Promise<RepeatYearFact[]> {
  const rows = await tx.many<{ id: string; academic_year_id: string; starts_on: string }>(
    `WITH cyc AS (
       SELECT e.id, e.academic_year_id, e.is_repeating, e.previous_enrollment_id, y.starts_on::text AS starts_on, o.kind AS outcome_kind
         FROM academic.enrollments e
         JOIN academic.classrooms c ON c.tenant_id = e.tenant_id AND c.id = e.classroom_id
         JOIN academic.grade_levels g ON g.tenant_id = c.tenant_id AND g.id = c.grade_level_id
         JOIN academic.academic_years y ON y.tenant_id = e.tenant_id AND y.id = e.academic_year_id
         LEFT JOIN academic.enrollment_outcomes o ON o.tenant_id = e.tenant_id AND o.code = e.outcome_code
        WHERE e.student_id = $1 AND g.education_level_id = $2 AND e.status NOT IN ('CANCELLED', 'PENDING')
          AND ($3::uuid IS NULL OR e.institution_id = $3::uuid)
     )
     SELECT e.id, e.academic_year_id, e.starts_on
       FROM cyc e
      WHERE e.is_repeating OR EXISTS (SELECT 1 FROM cyc p WHERE p.id = e.previous_enrollment_id AND p.outcome_kind = 'REPEAT')
      ORDER BY e.starts_on, e.id`,
    [input.studentId, input.educationLevelId, input.institutionId],
  );
  return rows.map((r) => ({ enrollmentId: r.id, academicYearId: r.academic_year_id, startsOn: r.starts_on }));
}

/** Classes où l'apprenant a une inscription ACTIVE, et offres suivies (sélections confirmées). */
export async function placementsOfStudent(tx: Tx, studentId: string): Promise<{ classroomIds: string[]; offeringIds: string[] }> {
  const classes = await tx.many<{ classroom_id: string }>("SELECT DISTINCT classroom_id FROM academic.enrollments WHERE student_id = $1 AND status = 'ACTIVE'", [studentId]);
  const offers = await tx.many<{ offering_id: string }>(
    `SELECT DISTINCT ec.offering_id FROM academic.enrollment_courses ec
       JOIN academic.enrollments e ON e.tenant_id = ec.tenant_id AND e.id = ec.enrollment_id
      WHERE e.student_id = $1 AND e.status = 'ACTIVE' AND ec.status IN ('CONFIRMED') AND ec.offering_id IS NOT NULL`,
    [studentId],
  );
  return { classroomIds: classes.map((r) => r.classroom_id), offeringIds: offers.map((r) => r.offering_id) };
}
