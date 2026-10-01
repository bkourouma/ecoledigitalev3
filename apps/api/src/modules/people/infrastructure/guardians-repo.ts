/**
 * Dépôt SQL des tuteurs et des liens élève-tuteur. Un tuteur est une PERSONNE (aucun compte requis) ; un lien se CLÔT par
 * `valid_to` et ne se supprime jamais (déclencheur `forbid_mutation`) : l'historique des tuteurs successifs est conservé.
 * Un lien est VIVANT quand `valid_to IS NULL`.
 */
import type { Tx } from "@ecoledigitale/database";
import { PERSON_COLUMNS, type PersonRow } from "./persons-repo";
import { Where, updateById } from "./sql";

export interface GuardianRow extends PersonRow {
  guardianId: string;
  occupation: string | null;
  employer: string | null;
  guardianStatus: "ACTIVE" | "ARCHIVED";
  childrenCount: number;
  portalStatus: string | null;
  hasStaffRecord: boolean;
}

export const GUARDIAN_COLUMNS = `
  ${PERSON_COLUMNS},
  g.id AS "guardianId", g.occupation, g.employer, g.status AS "guardianStatus",
  (SELECT count(*)::int FROM people.student_guardians c WHERE c.tenant_id = g.tenant_id AND c.guardian_id = g.id AND c.valid_to IS NULL) AS "childrenCount",
  im.status AS "portalStatus",
  EXISTS (SELECT 1 FROM people.staff st WHERE st.tenant_id = g.tenant_id AND st.person_id = g.person_id) AS "hasStaffRecord"`;

export const GUARDIAN_FROM = `
  FROM people.guardians g
  JOIN people.persons p ON p.tenant_id = g.tenant_id AND p.id = g.person_id
  LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id`;

export async function getGuardianRow(tx: Tx, tenantId: string, guardianId: string): Promise<GuardianRow | null> {
  return tx.queryOne<GuardianRow>(`SELECT ${GUARDIAN_COLUMNS} ${GUARDIAN_FROM} WHERE g.tenant_id = $1 AND g.id = $2`, [tenantId, guardianId]);
}

export async function findGuardianByPerson(tx: Tx, tenantId: string, personId: string): Promise<GuardianRow | null> {
  return tx.queryOne<GuardianRow>(`SELECT ${GUARDIAN_COLUMNS} ${GUARDIAN_FROM} WHERE g.tenant_id = $1 AND g.person_id = $2`, [tenantId, personId]);
}

export async function findGuardianByIdentity(tx: Tx, tenantId: string, identityId: string): Promise<GuardianRow | null> {
  return tx.queryOne<GuardianRow>(`SELECT ${GUARDIAN_COLUMNS} ${GUARDIAN_FROM} WHERE g.tenant_id = $1 AND p.identity_id = $2`, [tenantId, identityId]);
}

export async function insertGuardian(tx: Tx, tenantId: string, g: { id: string; personId: string; occupation?: string | undefined; employer?: string | undefined }, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO people.guardians (id, tenant_id, person_id, occupation, employer, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [g.id, tenantId, g.personId, g.occupation ?? null, g.employer ?? null, now],
  );
}

export async function updateGuardian(tx: Tx, tenantId: string, guardianId: string, patch: { occupation?: string | null | undefined; employer?: string | null | undefined }, now: Date): Promise<void> {
  await updateById(tx, "people.guardians", tenantId, guardianId, { occupation: patch.occupation, employer: patch.employer }, now);
}

export async function listGuardianRows(
  tx: Tx,
  tenantId: string,
  f: { q?: string | undefined; qPhone?: string | null | undefined; studentId?: string | undefined; limit: number; offset: number },
): Promise<{ rows: GuardianRow[]; total: number }> {
  const w = new Where([tenantId]);
  w.and(`p.anonymized_at IS NULL`);
  if (f.studentId) {
    w.and(`EXISTS (SELECT 1 FROM people.student_guardians sg WHERE sg.tenant_id = g.tenant_id AND sg.guardian_id = g.id AND sg.student_id = ${w.bind(f.studentId)} AND sg.valid_to IS NULL)`);
  }
  const q = f.q?.trim();
  if (q) {
    const folded = w.bind(q);
    const parts = [`p.search_key LIKE '%' || people.normalize_search(${folded}) || '%'`, `p.search_key % people.normalize_search(${folded})`, `lower(p.email) = lower(${folded})`];
    if (f.qPhone) {
      const phone = w.bind(f.qPhone);
      parts.push(`p.phone = ${phone}`, `p.phone_alt = ${phone}`);
    }
    w.and(`(${parts.join(" OR ")})`);
  }
  const limit = w.bind(f.limit);
  const offset = w.bind(f.offset);
  const rows = await tx.many<GuardianRow & { total: string }>(
    `SELECT ${GUARDIAN_COLUMNS}, count(*) OVER() AS total ${GUARDIAN_FROM}
      WHERE g.tenant_id = $1${w.sql} ORDER BY lower(p.last_name), lower(p.first_name), g.id LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { rows, total: rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0 };
}

// ---------------------------------------------------------------------------
// Liens élève <-> tuteur
// ---------------------------------------------------------------------------

export interface LinkRow {
  id: string;
  studentId: string;
  guardianId: string;
  relationshipCode: string;
  relationshipKind: "GUARDIAN" | "EMERGENCY" | "OTHER";
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  isFinancialResponsible: boolean;
  hasLegalCustody: boolean;
  canPickup: boolean;
  portalAccess: boolean;
  priority: number;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
}

export const LINK_COLUMNS = `
  sg.id, sg.student_id AS "studentId", sg.guardian_id AS "guardianId", sg.relationship_code AS "relationshipCode", rt.kind AS "relationshipKind",
  sg.is_primary_contact AS "isPrimaryContact", sg.is_emergency_contact AS "isEmergencyContact", sg.is_financial_responsible AS "isFinancialResponsible",
  sg.has_legal_custody AS "hasLegalCustody", sg.can_pickup AS "canPickup", sg.portal_access AS "portalAccess", sg.priority,
  sg.valid_from::text AS "validFrom", sg.valid_to::text AS "validTo", sg.notes`;
export const LINK_FROM = `FROM people.student_guardians sg JOIN people.relationship_types rt ON rt.tenant_id = sg.tenant_id AND rt.code = sg.relationship_code`;

export async function getLink(tx: Tx, tenantId: string, linkId: string): Promise<LinkRow | null> {
  return tx.queryOne<LinkRow>(`SELECT ${LINK_COLUMNS} ${LINK_FROM} WHERE sg.tenant_id = $1 AND sg.id = $2`, [tenantId, linkId]);
}

export async function getAliveLink(tx: Tx, tenantId: string, studentId: string, guardianId: string): Promise<LinkRow | null> {
  return tx.queryOne<LinkRow>(
    `SELECT ${LINK_COLUMNS} ${LINK_FROM} WHERE sg.tenant_id = $1 AND sg.student_id = $2 AND sg.guardian_id = $3 AND sg.valid_to IS NULL`,
    [tenantId, studentId, guardianId],
  );
}

export async function listLinksOfStudent(tx: Tx, tenantId: string, studentId: string, options: { aliveOnly: boolean }): Promise<LinkRow[]> {
  return tx.many<LinkRow>(
    `SELECT ${LINK_COLUMNS} ${LINK_FROM} WHERE sg.tenant_id = $1 AND sg.student_id = $2${options.aliveOnly ? " AND sg.valid_to IS NULL" : ""}
      ORDER BY sg.valid_to IS NOT NULL, sg.priority, sg.valid_from, sg.id`,
    [tenantId, studentId],
  );
}

export async function getAlivePrimaryLink(tx: Tx, tenantId: string, studentId: string): Promise<LinkRow | null> {
  return tx.queryOne<LinkRow>(
    `SELECT ${LINK_COLUMNS} ${LINK_FROM} WHERE sg.tenant_id = $1 AND sg.student_id = $2 AND sg.is_primary_contact AND sg.valid_to IS NULL`,
    [tenantId, studentId],
  );
}

export interface PrimaryGuardianRow {
  studentId: string;
  guardianId: string;
  lastName: string;
  firstName: string;
  relationshipCode: string;
  phone: string | null;
}

/** Tuteur principal vivant de chacun des élèves donnés. */
export async function listPrimaryGuardians(tx: Tx, tenantId: string, studentIds: readonly string[]): Promise<PrimaryGuardianRow[]> {
  if (studentIds.length === 0) return [];
  return tx.many<PrimaryGuardianRow>(
    `SELECT sg.student_id AS "studentId", g.id AS "guardianId", p.last_name AS "lastName", p.first_name AS "firstName",
            sg.relationship_code AS "relationshipCode", p.phone
       FROM people.student_guardians sg
       JOIN people.guardians g ON g.tenant_id = sg.tenant_id AND g.id = sg.guardian_id
       JOIN people.persons p ON p.tenant_id = g.tenant_id AND p.id = g.person_id
      WHERE sg.tenant_id = $1 AND sg.student_id = ANY($2::uuid[]) AND sg.is_primary_contact AND sg.valid_to IS NULL`,
    [tenantId, studentIds],
  );
}

export interface NewLink {
  id: string;
  studentId: string;
  guardianId: string;
  relationshipCode: string;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  isFinancialResponsible: boolean;
  hasLegalCustody: boolean;
  canPickup: boolean;
  portalAccess: boolean;
  priority: number;
  validFrom: string;
  notes?: string | undefined;
}

export async function insertLink(tx: Tx, tenantId: string, l: NewLink, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO people.student_guardians
       (id, tenant_id, student_id, guardian_id, relationship_code, is_primary_contact, is_emergency_contact, is_financial_responsible,
        has_legal_custody, can_pickup, portal_access, priority, valid_from, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,$15,$15)`,
    [l.id, tenantId, l.studentId, l.guardianId, l.relationshipCode, l.isPrimaryContact, l.isEmergencyContact, l.isFinancialResponsible, l.hasLegalCustody, l.canPickup, l.portalAccess, l.priority, l.validFrom, l.notes ?? null, now],
  );
}

export interface LinkPatchValues {
  relationshipCode?: string | undefined;
  isPrimaryContact?: boolean | undefined;
  isEmergencyContact?: boolean | undefined;
  isFinancialResponsible?: boolean | undefined;
  hasLegalCustody?: boolean | undefined;
  canPickup?: boolean | undefined;
  portalAccess?: boolean | undefined;
  priority?: number | undefined;
  notes?: string | null | undefined;
}

export async function updateLink(tx: Tx, tenantId: string, linkId: string, p: LinkPatchValues, now: Date): Promise<void> {
  await updateById(
    tx,
    "people.student_guardians",
    tenantId,
    linkId,
    {
      relationship_code: p.relationshipCode,
      is_primary_contact: p.isPrimaryContact,
      is_emergency_contact: p.isEmergencyContact,
      is_financial_responsible: p.isFinancialResponsible,
      has_legal_custody: p.hasLegalCustody,
      can_pickup: p.canPickup,
      portal_access: p.portalAccess,
      priority: p.priority,
      notes: p.notes,
    },
    now,
  );
}

export async function closeLink(tx: Tx, tenantId: string, linkId: string, validTo: string, now: Date): Promise<void> {
  // Un lien clos n'est plus contact principal (l'index unique ne couvre que les liens vivants).
  await tx.query(
    `UPDATE people.student_guardians SET valid_to = $3::date, is_primary_contact = false, portal_access = false, updated_at = $4 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, linkId, validTo, now],
  );
}

/** Liens vivants d'un tuteur (les enfants qu'il suit). */
export async function listAliveLinksOfGuardian(tx: Tx, tenantId: string, guardianId: string): Promise<LinkRow[]> {
  return tx.many<LinkRow>(`SELECT ${LINK_COLUMNS} ${LINK_FROM} WHERE sg.tenant_id = $1 AND sg.guardian_id = $2 AND sg.valid_to IS NULL ORDER BY sg.id`, [tenantId, guardianId]);
}

// ---------------------------------------------------------------------------
// Règle « tuteur de cet élève » (version SQL de `isGuardianOfStudentRule`)
// ---------------------------------------------------------------------------

/**
 * Vrai ssi une personne portant cette identité est un tuteur ACTIF lié à l'élève par un lien VIVANT, avec accès au portail,
 * dont le type est de nature `GUARDIAN` (un contact d'urgence n'ouvre jamais l'accès).
 */
export async function isGuardianOfStudentSql(tx: Tx, tenantId: string, identityId: string, studentId: string): Promise<boolean> {
  const row = await tx.queryOne(
    `SELECT 1 AS ok
       FROM people.persons p
       JOIN people.guardians g ON g.tenant_id = p.tenant_id AND g.person_id = p.id
       JOIN people.student_guardians sg ON sg.tenant_id = g.tenant_id AND sg.guardian_id = g.id
       JOIN people.relationship_types rt ON rt.tenant_id = sg.tenant_id AND rt.code = sg.relationship_code
      WHERE p.tenant_id = $1 AND p.identity_id = $2 AND sg.student_id = $3
        AND p.status = 'ACTIVE' AND g.status = 'ACTIVE'
        AND sg.valid_to IS NULL AND sg.portal_access AND rt.kind = 'GUARDIAN'
      LIMIT 1`,
    [tenantId, identityId, studentId],
  );
  return row !== null;
}

/** Identifiants des enfants d'une identité de tuteur (mêmes conditions que `isGuardianOfStudentSql`). */
export async function listChildIdsOfIdentity(tx: Tx, tenantId: string, identityId: string): Promise<string[]> {
  const rows = await tx.many<{ studentId: string }>(
    `SELECT DISTINCT sg.student_id AS "studentId"
       FROM people.persons p
       JOIN people.guardians g ON g.tenant_id = p.tenant_id AND g.person_id = p.id
       JOIN people.student_guardians sg ON sg.tenant_id = g.tenant_id AND sg.guardian_id = g.id
       JOIN people.relationship_types rt ON rt.tenant_id = sg.tenant_id AND rt.code = sg.relationship_code
      WHERE p.tenant_id = $1 AND p.identity_id = $2 AND p.status = 'ACTIVE' AND g.status = 'ACTIVE'
        AND sg.valid_to IS NULL AND sg.portal_access AND rt.kind = 'GUARDIAN'`,
    [tenantId, identityId],
  );
  return rows.map((r) => r.studentId);
}
