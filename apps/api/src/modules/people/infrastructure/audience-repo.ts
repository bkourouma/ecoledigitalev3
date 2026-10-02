/**
 * Lectures d'AUDIENCE pour la messagerie (spec v2/016) : comptes (identités IAM) joignables, jamais de coordonnées.
 * Conditions de tutelle identiques à `isGuardianOfStudentSql` (lien vivant, accès portail, nature `GUARDIAN`, tuteur
 * et personne actifs) : un contact d'urgence ou un lien clos ne reçoit rien.
 */
import type { Tx } from "@ecoledigitale/database";

export interface StudentAudienceRow {
  studentId: string;
  identityId: string | null;
  lastName: string;
  firstName: string;
}

export interface GuardianAudienceRow {
  studentId: string;
  guardianId: string;
  identityId: string;
  lastName: string;
  firstName: string;
}

/** Élèves demandés avec l'identité de leur compte (si lié et actif). */
export async function listStudentAudience(tx: Tx, tenantId: string, studentIds: readonly string[]): Promise<StudentAudienceRow[]> {
  if (studentIds.length === 0) return [];
  return tx.many<StudentAudienceRow>(
    `SELECT s.id AS "studentId",
            CASE WHEN p.status = 'ACTIVE' AND p.anonymized_at IS NULL AND (im.status IS NULL OR im.status = 'active') THEN p.identity_id END AS "identityId",
            p.last_name AS "lastName", p.first_name AS "firstName"
       FROM people.students s
       JOIN people.persons p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[])`,
    [tenantId, [...studentIds]],
  );
}

/** Tuteurs joignables (compte actif lié, accès portail) des élèves demandés. */
export async function listGuardianAudience(tx: Tx, tenantId: string, studentIds: readonly string[]): Promise<GuardianAudienceRow[]> {
  if (studentIds.length === 0) return [];
  return tx.many<GuardianAudienceRow>(
    `SELECT DISTINCT sg.student_id AS "studentId", g.id AS "guardianId", p.identity_id AS "identityId",
            p.last_name AS "lastName", p.first_name AS "firstName"
       FROM people.student_guardians sg
       JOIN people.guardians g ON g.tenant_id = sg.tenant_id AND g.id = sg.guardian_id
       JOIN people.persons p ON p.tenant_id = g.tenant_id AND p.id = g.person_id
       JOIN people.relationship_types rt ON rt.tenant_id = sg.tenant_id AND rt.code = sg.relationship_code
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE sg.tenant_id = $1 AND sg.student_id = ANY($2::uuid[])
        AND p.identity_id IS NOT NULL AND p.status = 'ACTIVE' AND p.anonymized_at IS NULL AND g.status = 'ACTIVE'
        AND sg.valid_to IS NULL AND sg.portal_access AND rt.kind = 'GUARDIAN'
        AND (im.status IS NULL OR im.status = 'active')`,
    [tenantId, [...studentIds]],
  );
}

export interface IdentitySearchRow {
  identityId: string;
  lastName: string;
  firstName: string;
  isStudent: boolean;
  isGuardian: boolean;
  isStaff: boolean;
}

/** Recherche par nom (sans accents) parmi les personnes dotées d'un compte actif ; plafonnée. */
export async function searchPortalIdentities(tx: Tx, tenantId: string, query: string, limit: number): Promise<IdentitySearchRow[]> {
  return tx.many<IdentitySearchRow>(
    `SELECT p.identity_id AS "identityId", p.last_name AS "lastName", p.first_name AS "firstName",
            EXISTS (SELECT 1 FROM people.students s WHERE s.tenant_id = p.tenant_id AND s.person_id = p.id) AS "isStudent",
            EXISTS (SELECT 1 FROM people.guardians g WHERE g.tenant_id = p.tenant_id AND g.person_id = p.id AND g.status = 'ACTIVE') AS "isGuardian",
            EXISTS (SELECT 1 FROM people.staff st WHERE st.tenant_id = p.tenant_id AND st.person_id = p.id AND st.status IN ('ACTIVE', 'ON_LEAVE')) AS "isStaff"
       FROM people.persons p
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE p.tenant_id = $1 AND p.identity_id IS NOT NULL AND p.status = 'ACTIVE' AND p.anonymized_at IS NULL
        AND (im.status IS NULL OR im.status = 'active')
        AND p.search_key LIKE '%' || people.normalize_search($2) || '%'
      ORDER BY p.last_name, p.first_name
      LIMIT $3`,
    [tenantId, query, Math.min(Math.max(limit, 1), 50)],
  );
}
