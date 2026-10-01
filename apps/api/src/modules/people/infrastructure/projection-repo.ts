/**
 * Projections alimentées par les événements des autres modules : inscriptions (`academic.enrollment.*`) et accès IAM
 * (`iam.membership.*`). Idempotentes (identifiant d'événement + horodatage de l'événement), insensibles à l'ordre de
 * livraison, reconstructibles. Tables de TENANT (RLS forcée).
 */
import type { Tx } from "@ecoledigitale/database";
import type { EnrollmentFacts } from "../domain/enrollment-projection";

export interface UpsertEnrollmentResult {
  /** `false` : événement plus ancien que l'état projeté (ignoré) ou doublon. */
  applied: boolean;
}

/**
 * Upsert d'une inscription. Un événement dont l'instant est PLUS ANCIEN que `source_occurred_at` est ignoré ; sinon les
 * champs présents dans le payload remplacent ceux de la projection (les absents sont conservés). `status` doit être résolu
 * par l'appelant (`statusForEvent`) ; pour une première insertion les champs obligatoires de la ligne doivent exister.
 */
export async function upsertEnrollmentSummary(
  tx: Tx,
  tenantId: string,
  facts: EnrollmentFacts,
  resolved: { status: string | null; eventId: string; occurredAt: Date },
): Promise<UpsertEnrollmentResult> {
  const existing = await tx.queryOne<{ occurred: Date; eventId: string }>(
    `SELECT source_occurred_at AS occurred, source_event_id AS "eventId" FROM people.student_enrollment_summaries WHERE tenant_id = $1 AND enrollment_id = $2 FOR UPDATE`,
    [tenantId, facts.enrollmentId],
  );
  if (existing) {
    if (existing.eventId === resolved.eventId || existing.occurred.getTime() > resolved.occurredAt.getTime()) return { applied: false };
    await tx.query(
      `UPDATE people.student_enrollment_summaries SET
         student_id = $3,
         academic_year_id = COALESCE($4, academic_year_id), institution_id = COALESCE($5, institution_id), classroom_id = COALESCE($6, classroom_id),
         classroom_name = COALESCE($7, classroom_name), program_id = COALESCE($8, program_id), program_label = COALESCE($9, program_label),
         grade_level_id = COALESCE($10, grade_level_id), grade_level_label = COALESCE($11, grade_level_label), mode = COALESCE($12, mode),
         status = COALESCE($13, status), funding_type = COALESCE($14, funding_type), registration_number = COALESCE($15, registration_number),
         enrolled_on = COALESCE($16::date, enrolled_on), source_event_id = $17, source_occurred_at = $18, updated_at = $18
       WHERE tenant_id = $1 AND enrollment_id = $2`,
      [
        tenantId,
        facts.enrollmentId,
        facts.studentId,
        facts.academicYearId ?? null,
        facts.institutionId ?? null,
        facts.classroomId ?? null,
        facts.classroomName ?? null,
        facts.programId ?? null,
        facts.programLabel ?? null,
        facts.gradeLevelId ?? null,
        facts.gradeLevelLabel ?? null,
        facts.mode ?? null,
        resolved.status,
        facts.fundingType ?? null,
        facts.registrationNumber ?? null,
        facts.enrolledOn ?? null,
        resolved.eventId,
        resolved.occurredAt,
      ],
    );
    return { applied: true };
  }
  if (!facts.academicYearId || !facts.institutionId || !facts.classroomId) return { applied: false };
  await tx.query(
    `INSERT INTO people.student_enrollment_summaries
       (tenant_id, enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, program_id, program_label,
        grade_level_id, grade_level_label, mode, status, funding_type, registration_number, enrolled_on, source_event_id, source_occurred_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'CLASS'),COALESCE($13,'PENDING'),COALESCE($14,'PRIVATE'),$15,$16::date,$17,$18,$18)`,
    [
      tenantId,
      facts.enrollmentId,
      facts.studentId,
      facts.academicYearId,
      facts.institutionId,
      facts.classroomId,
      facts.classroomName ?? null,
      facts.programId ?? null,
      facts.programLabel ?? null,
      facts.gradeLevelId ?? null,
      facts.gradeLevelLabel ?? null,
      facts.mode ?? null,
      resolved.status,
      facts.fundingType ?? null,
      facts.registrationNumber ?? null,
      facts.enrolledOn ?? resolved.occurredAt.toISOString().slice(0, 10),
      resolved.eventId,
      resolved.occurredAt,
    ],
  );
  return { applied: true };
}

export async function deleteAllEnrollmentSummaries(tx: Tx, tenantId: string, filter: { academicYearId?: string | undefined } = {}): Promise<number> {
  const res = filter.academicYearId
    ? await tx.query(`DELETE FROM people.student_enrollment_summaries WHERE tenant_id = $1 AND academic_year_id = $2`, [tenantId, filter.academicYearId])
    : await tx.query(`DELETE FROM people.student_enrollment_summaries WHERE tenant_id = $1`, [tenantId]);
  return res.rowCount;
}

export async function studentExists(tx: Tx, tenantId: string, studentId: string): Promise<boolean> {
  return (await tx.queryOne(`SELECT 1 AS ok FROM people.students WHERE tenant_id = $1 AND id = $2`, [tenantId, studentId])) !== null;
}

/** Instantané de la projection, trié, pour comparer une reconstruction à l'état avant reconstruction. */
export async function snapshotEnrollmentSummaries(tx: Tx, tenantId: string): Promise<unknown[]> {
  return tx.many(
    `SELECT enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, program_id, program_label, grade_level_id,
            grade_level_label, mode, status, funding_type, registration_number, enrolled_on::text AS enrolled_on
       FROM people.student_enrollment_summaries WHERE tenant_id = $1 ORDER BY enrollment_id`,
    [tenantId],
  );
}

// ---------------------------------------------------------------------------
// Accès IAM
// ---------------------------------------------------------------------------

export interface MembershipFacts {
  identityId: string;
  membershipId: string | null;
  status: "active" | "suspended" | "revoked" | "invited" | "unknown";
  roles: readonly string[] | null;
}

/** Upsert d'un accès : ignoré si l'événement est plus ancien que l'état projeté. */
export async function upsertMembership(tx: Tx, tenantId: string, m: MembershipFacts, eventId: string, occurredAt: Date): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO people.identity_memberships (tenant_id, identity_id, membership_id, status, roles, source_event_id, source_occurred_at, updated_at)
     VALUES ($1,$2,$3,$4,COALESCE($5::text[], '{}'),$6,$7,$7)
     ON CONFLICT (tenant_id, identity_id) DO UPDATE
       SET membership_id = COALESCE(EXCLUDED.membership_id, people.identity_memberships.membership_id),
           status = EXCLUDED.status,
           roles = COALESCE($5::text[], people.identity_memberships.roles),
           source_event_id = EXCLUDED.source_event_id, source_occurred_at = EXCLUDED.source_occurred_at, updated_at = EXCLUDED.updated_at
     WHERE people.identity_memberships.source_occurred_at <= EXCLUDED.source_occurred_at`,
    [tenantId, m.identityId, m.membershipId, m.status, m.roles === null ? null : [...m.roles], eventId, occurredAt],
  );
  return res.rowCount > 0;
}

export async function getMembership(tx: Tx, tenantId: string, identityId: string): Promise<{ status: string; roles: string[] } | null> {
  return tx.queryOne(`SELECT status, roles FROM people.identity_memberships WHERE tenant_id = $1 AND identity_id = $2`, [tenantId, identityId]);
}
