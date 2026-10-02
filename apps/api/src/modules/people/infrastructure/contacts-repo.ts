/**
 * Lectures de COORDONNÉES pour le module `notifications` (spec v2/016, canaux externes) : adresse e-mail et téléphone d'une
 * personne, avec son compte (identité IAM) s'il est ACTIF. Réservé aux remises : jamais exposé par une route.
 *
 * Tuteurs : lien vivant (`valid_to` nul), nature « tuteur » (un contact d'urgence ne reçoit rien), tuteur et personne actifs,
 * personne non anonymisée. L'accès au portail n'est PAS exigé (un tuteur sans compte est joint par téléphone ou e-mail).
 * Un compte suspendu n'est pas joignable par l'application : son identité est masquée (la personne reste jointe par ses
 * coordonnées si elle en a).
 */
import type { Tx } from "@ecoledigitale/database";

export interface PersonContactRow {
  personId: string;
  identityId: string | null;
  lastName: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  phoneAlt: string | null;
}

export interface StudentContactRow extends PersonContactRow {
  studentId: string;
}

export interface GuardianContactRow extends PersonContactRow {
  studentId: string;
  guardianId: string;
  isPrimary: boolean;
  isFinancial: boolean;
  isEmergency: boolean;
  priority: number;
}

export interface StaffContactRow extends PersonContactRow {
  staffId: string;
}

const PERSON = `p.id AS "personId",
  CASE WHEN p.identity_id IS NOT NULL AND (im.status IS NULL OR im.status = 'active') THEN p.identity_id END AS "identityId",
  p.last_name AS "lastName", p.first_name AS "firstName", p.email, p.phone, p.phone_alt AS "phoneAlt"`;

export async function listStudentContacts(tx: Tx, tenantId: string, studentIds: readonly string[]): Promise<StudentContactRow[]> {
  if (studentIds.length === 0) return [];
  return tx.many<StudentContactRow>(
    `SELECT s.id AS "studentId", ${PERSON}
       FROM people.students s
       JOIN people.persons p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[]) AND p.anonymized_at IS NULL`,
    [tenantId, [...studentIds]],
  );
}

export async function listGuardianContacts(tx: Tx, tenantId: string, studentIds: readonly string[]): Promise<GuardianContactRow[]> {
  if (studentIds.length === 0) return [];
  return tx.many<GuardianContactRow>(
    `SELECT DISTINCT ON (sg.student_id, g.id) sg.student_id AS "studentId", g.id AS "guardianId", ${PERSON},
            sg.is_primary_contact AS "isPrimary", sg.is_financial_responsible AS "isFinancial", sg.is_emergency_contact AS "isEmergency", sg.priority
       FROM people.student_guardians sg
       JOIN people.guardians g ON g.tenant_id = sg.tenant_id AND g.id = sg.guardian_id
       JOIN people.persons p ON p.tenant_id = g.tenant_id AND p.id = g.person_id
       JOIN people.relationship_types rt ON rt.tenant_id = sg.tenant_id AND rt.code = sg.relationship_code
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE sg.tenant_id = $1 AND sg.student_id = ANY($2::uuid[]) AND sg.valid_to IS NULL AND rt.kind = 'GUARDIAN'
        AND g.status = 'ACTIVE' AND p.status = 'ACTIVE' AND p.anonymized_at IS NULL
      ORDER BY sg.student_id, g.id, sg.priority`,
    [tenantId, [...studentIds]],
  );
}

export async function listStaffContacts(tx: Tx, tenantId: string, staffIds: readonly string[]): Promise<StaffContactRow[]> {
  if (staffIds.length === 0) return [];
  return tx.many<StaffContactRow>(
    `SELECT st.id AS "staffId", ${PERSON}
       FROM people.staff st
       JOIN people.persons p ON p.tenant_id = st.tenant_id AND p.id = st.person_id
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE st.tenant_id = $1 AND st.id = ANY($2::uuid[]) AND st.status IN ('ACTIVE', 'ON_LEAVE') AND p.status = 'ACTIVE' AND p.anonymized_at IS NULL`,
    [tenantId, [...staffIds]],
  );
}

/** Personnes liées à ces comptes (identités) : coordonnées de la fiche, quand elle existe. */
export async function listContactsOfIdentities(tx: Tx, tenantId: string, identityIds: readonly string[]): Promise<PersonContactRow[]> {
  if (identityIds.length === 0) return [];
  return tx.many<PersonContactRow>(
    `SELECT ${PERSON}
       FROM people.persons p
       LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id
      WHERE p.tenant_id = $1 AND p.identity_id = ANY($2::uuid[]) AND p.status = 'ACTIVE' AND p.anonymized_at IS NULL
        AND (im.status IS NULL OR im.status = 'active')`,
    [tenantId, [...identityIds]],
  );
}
