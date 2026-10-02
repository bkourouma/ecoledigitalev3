/**
 * Faits de vie scolaire pour les AUTRES modules (conseil de classe, bulletins, examens, présences) : comptages et codes, jamais de
 * texte libre, de déclaration d'élève ni d'élément `CONFIDENTIAL` (l'audience `STAFF_RESTRICTED` l'exclut par la règle SQL).
 */
import type { Tx } from "@ecoledigitale/database";

export interface LifeCounts {
  incidents: number;
  sanctions: number;
  warnings: number;
  tempExclusions: number;
  exclusionDays: number;
  encouragements: number;
  observations: number;
}

export async function lifeCountsOfStudent(tx: Tx, audience: string, studentId: string, academicYearId: string): Promise<LifeCounts> {
  const row = await tx.queryOne<LifeCounts>(
    `SELECT
       (SELECT count(DISTINCT i.id)::int FROM schoollife.incident_involvements v JOIN schoollife.incidents i ON i.tenant_id = v.tenant_id AND i.id = v.incident_id
          WHERE v.student_id = $2 AND v.role = 'AUTHOR' AND i.academic_year_id = $3 AND i.status IN ('CONFIRMED','CLOSED')
            AND schoollife.audience_may_see($1, 'INCIDENT', i.confidentiality, true, i.status, NULL)) AS incidents,
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.student_id = $2 AND m.academic_year_id = $3 AND m.kind = 'SANCTION' AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS sanctions,
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.student_id = $2 AND m.academic_year_id = $3 AND m.kind = 'WARNING' AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS warnings,
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.student_id = $2 AND m.academic_year_id = $3 AND m.kind = 'TEMP_EXCLUSION' AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS "tempExclusions",
       (SELECT coalesce(sum(m.ends_on - m.starts_on + 1), 0)::int FROM schoollife.measures m WHERE m.student_id = $2 AND m.academic_year_id = $3 AND m.kind = 'TEMP_EXCLUSION'
          AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED') AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS "exclusionDays",
       (SELECT count(*)::int FROM schoollife.notes n WHERE n.student_id = $2 AND n.academic_year_id = $3 AND n.kind = 'ENCOURAGEMENT' AND n.status = 'ACTIVE'
          AND schoollife.audience_may_see($1, 'NOTE', n.confidentiality, true, n.status, n.visibility)) AS encouragements,
       (SELECT count(*)::int FROM schoollife.notes n WHERE n.student_id = $2 AND n.academic_year_id = $3 AND n.kind = 'OBSERVATION' AND n.status = 'ACTIVE'
          AND schoollife.audience_may_see($1, 'NOTE', n.confidentiality, true, n.status, n.visibility)) AS observations`,
    [audience, studentId, academicYearId],
  );
  return row ?? { incidents: 0, sanctions: 0, warnings: 0, tempExclusions: 0, exclusionDays: 0, encouragements: 0, observations: 0 };
}

export interface DisciplineBreakdownRow {
  kind: string;
  severityCode: string | null;
  count: number;
}

/** Mesures en vigueur d'une inscription regroupées par famille et gravité (codes et comptages seulement). */
export const disciplineBreakdown = (tx: Tx, audience: string, enrollmentId: string): Promise<DisciplineBreakdownRow[]> =>
  tx.many<DisciplineBreakdownRow>(
    `SELECT m.kind, m.severity_code AS "severityCode", count(*)::int AS count FROM schoollife.measures m
      WHERE m.enrollment_id = $2 AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
        AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)
      GROUP BY m.kind, m.severity_code ORDER BY m.kind, m.severity_code NULLS FIRST`,
    [audience, enrollmentId],
  );

/** Inscriptions d'une liste dont l'élève est exclu à la date (exclusion temporaire en vigueur). */
export async function excludedEnrollmentIds(tx: Tx, enrollmentIds: readonly string[], on: string): Promise<Set<string>> {
  if (enrollmentIds.length === 0) return new Set();
  const rows = await tx.many<{ id: string }>(
    `SELECT DISTINCT enrollment_id AS id FROM schoollife.measures WHERE enrollment_id = ANY($1::uuid[]) AND kind = 'TEMP_EXCLUSION'
        AND status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED') AND starts_on <= $2::date AND ends_on >= $2::date`,
    [enrollmentIds, on],
  );
  return new Set(rows.map((r) => r.id));
}
