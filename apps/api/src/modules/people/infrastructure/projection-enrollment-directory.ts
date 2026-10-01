/**
 * Annuaire d'inscriptions PAR DÉFAUT : la projection `student_enrollment_summaries` du module (alimentée par les
 * événements `academic.enrollment.*`). Il permet de limiter un enseignant aux élèves de SES classes sans dépendre du
 * module `academic`. Un adaptateur appelant `academic.getRoster` peut le remplacer (même port `EnrollmentDirectory`).
 */
import type { TenantDb } from "@ecoledigitale/database";
import { LIVE_ENROLLMENT_STATUSES } from "../domain/enrollment-projection";
import type { EnrollmentDirectory } from "../application/ports";

export function createProjectionEnrollmentDirectory(db: TenantDb): EnrollmentDirectory {
  return {
    async listClassroomIdsOfStudent(ctx, studentId, { onDate }) {
      const rows = await db.run(
        ctx,
        (tx) =>
          tx.many<{ classroomId: string }>(
            `SELECT DISTINCT classroom_id AS "classroomId" FROM people.student_enrollment_summaries
              WHERE tenant_id = $1 AND student_id = $2 AND status = ANY($3::text[]) AND enrolled_on <= $4::date`,
            [ctx.tenantId, studentId, LIVE_ENROLLMENT_STATUSES, onDate],
          ),
        { readOnly: true },
      );
      return rows.map((r) => r.classroomId);
    },
    async listStudentIdsOfClassrooms(ctx, classroomIds, { onDate }) {
      if (classroomIds.length === 0) return [];
      const rows = await db.run(
        ctx,
        (tx) =>
          tx.many<{ studentId: string }>(
            `SELECT DISTINCT student_id AS "studentId" FROM people.student_enrollment_summaries
              WHERE tenant_id = $1 AND classroom_id = ANY($2::uuid[]) AND status = ANY($3::text[]) AND enrolled_on <= $4::date`,
            [ctx.tenantId, classroomIds, LIVE_ENROLLMENT_STATUSES, onDate],
          ),
        { readOnly: true },
      );
      return rows.map((r) => r.studentId);
    },
  };
}
