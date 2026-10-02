/**
 * Dépôt SQL des élèves : dossier permanent (`students`), historique de statut, contacts d'urgence, antécédents scolaires
 * et lecture de la projection d'inscriptions. Tables de TENANT (RLS forcée). Aucun DELETE sur `students`.
 */
import type { Tx } from "@ecoledigitale/database";
import { PERSON_COLUMNS, type PersonRow } from "./persons-repo";
import { Where, likeEscape, updateById } from "./sql";

export interface StudentRow extends PersonRow {
  studentId: string;
  studentNumber: string;
  sequenceNumber: number;
  nationalStudentId: string | null;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED" | "WITHDRAWN" | "TRANSFERRED_OUT" | "EXCLUDED" | "ARCHIVED";
  firstEnrolledOn: string | null;
  leftOn: string | null;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Projection de l'inscription courante (ou `null`). */
  ceEnrollmentId: string | null;
  ceAcademicYearId: string | null;
  ceInstitutionId: string | null;
  ceClassroomId: string | null;
  ceClassroomName: string | null;
  ceStatus: string | null;
  ceRegistrationNumber: string | null;
  /** État du compte de portail de la personne (projection IAM) ; `null` si aucune identité liée. */
  portalStatus: string | null;
}

/**
 * Colonnes d'un élève (alias `s`, personne `p`, inscription courante `ce`, accès `im`). L'inscription courante est
 * l'inscription ACTIVE la plus récente, à défaut PENDING / SUSPENDED.
 */
export const STUDENT_COLUMNS = `
  ${PERSON_COLUMNS},
  s.id AS "studentId", s.student_number AS "studentNumber", s.sequence_number AS "sequenceNumber",
  s.national_student_id AS "nationalStudentId", s.status, s.first_enrolled_on::text AS "firstEnrolledOn", s.left_on::text AS "leftOn",
  s.external_ref AS "externalRef", s.created_at AS "createdAt", s.updated_at AS "updatedAt",
  ce.enrollment_id AS "ceEnrollmentId", ce.academic_year_id AS "ceAcademicYearId", ce.institution_id AS "ceInstitutionId",
  ce.classroom_id AS "ceClassroomId", ce.classroom_name AS "ceClassroomName", ce.status AS "ceStatus",
  ce.registration_number AS "ceRegistrationNumber", im.status AS "portalStatus"`;

export const STUDENT_FROM = `
  FROM people.students s
  JOIN people.persons p ON p.tenant_id = s.tenant_id AND p.id = s.person_id
  LEFT JOIN LATERAL (
    SELECT e.enrollment_id, e.academic_year_id, e.institution_id, e.classroom_id, e.classroom_name, e.status, e.registration_number
      FROM people.student_enrollment_summaries e
     WHERE e.tenant_id = s.tenant_id AND e.student_id = s.id AND e.status IN ('ACTIVE', 'PENDING', 'SUSPENDED')
     ORDER BY (e.status = 'ACTIVE') DESC, e.enrolled_on DESC, e.enrollment_id
     LIMIT 1) ce ON true
  LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id`;

export async function getStudentRow(tx: Tx, tenantId: string, studentId: string): Promise<StudentRow | null> {
  return tx.queryOne<StudentRow>(`SELECT ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, studentId]);
}

/** Verrouille le dossier (changement de statut, anonymisation) et renvoie son statut. */
export async function lockStudent(tx: Tx, tenantId: string, studentId: string): Promise<{ id: string; personId: string; status: StudentRow["status"] } | null> {
  return tx.queryOne(`SELECT id, person_id AS "personId", status FROM people.students WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, studentId]);
}

export async function getStudentRows(tx: Tx, tenantId: string, ids: readonly string[]): Promise<StudentRow[]> {
  if (ids.length === 0) return [];
  return tx.many<StudentRow>(`SELECT ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[])`, [tenantId, ids]);
}

export async function findStudentByExternalRef(tx: Tx, tenantId: string, externalRef: string): Promise<StudentRow | null> {
  return tx.queryOne<StudentRow>(`SELECT ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE s.tenant_id = $1 AND s.external_ref = $2`, [tenantId, externalRef]);
}

export async function findStudentByPerson(tx: Tx, tenantId: string, personId: string): Promise<StudentRow | null> {
  return tx.queryOne<StudentRow>(`SELECT ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE s.tenant_id = $1 AND s.person_id = $2`, [tenantId, personId]);
}

export async function findStudentByIdentity(tx: Tx, tenantId: string, identityId: string): Promise<StudentRow | null> {
  return tx.queryOne<StudentRow>(`SELECT ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE s.tenant_id = $1 AND p.identity_id = $2`, [tenantId, identityId]);
}

export interface NewStudent {
  id: string;
  personId: string;
  studentNumber: string;
  sequenceNumber: number;
  nationalStudentId?: string | null | undefined;
  birthCertificateNumber?: string | null | undefined;
  birthCertificateDate?: string | null | undefined;
  civilRegistryOffice?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
  externalRef?: string | null | undefined;
  /** Statut à la création (défaut `ACTIVE`). */
  status?: "ACTIVE" | "INACTIVE" | undefined;
}

export async function insertStudent(tx: Tx, tenantId: string, s: NewStudent, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO people.students
       (id, tenant_id, person_id, student_number, sequence_number, national_student_id, birth_certificate_number,
        birth_certificate_date, civil_registry_office, attributes, external_ref, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::jsonb,$11,$13,$12,$12)`,
    [
      s.id,
      tenantId,
      s.personId,
      s.studentNumber,
      s.sequenceNumber,
      s.nationalStudentId ?? null,
      s.birthCertificateNumber ?? null,
      s.birthCertificateDate ?? null,
      s.civilRegistryOffice ?? null,
      JSON.stringify(s.attributes ?? {}),
      s.externalRef ?? null,
      now,
      s.status ?? "ACTIVE",
    ],
  );
}

export interface StudentPatchValues {
  nationalStudentId?: string | null | undefined;
  birthCertificateNumber?: string | null | undefined;
  birthCertificateDate?: string | null | undefined;
  civilRegistryOffice?: string | null | undefined;
  externalRef?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
}

export async function updateStudent(tx: Tx, tenantId: string, studentId: string, patch: StudentPatchValues, now: Date): Promise<void> {
  await updateById(
    tx,
    "people.students",
    tenantId,
    studentId,
    {
      national_student_id: patch.nationalStudentId,
      birth_certificate_number: patch.birthCertificateNumber,
      birth_certificate_date: patch.birthCertificateDate,
      civil_registry_office: patch.civilRegistryOffice,
      external_ref: patch.externalRef,
      attributes: patch.attributes === undefined ? undefined : JSON.stringify(patch.attributes),
    },
    now,
  );
}

export async function setStudentStatus(tx: Tx, tenantId: string, studentId: string, status: string, leftOn: string | null | undefined, now: Date): Promise<void> {
  await updateById(tx, "people.students", tenantId, studentId, { status, left_on: leftOn }, now);
}

export async function setFirstEnrolledOn(tx: Tx, tenantId: string, studentId: string, date: string): Promise<void> {
  // N'avance jamais : la plus ancienne date d'inscription est conservée (R4).
  await tx.query(
    `UPDATE people.students SET first_enrolled_on = $3::date
      WHERE tenant_id = $1 AND id = $2 AND (first_enrolled_on IS NULL OR first_enrolled_on > $3::date)`,
    [tenantId, studentId, date],
  );
}

export interface StudentSensitiveRow {
  studentId: string;
  nationalStudentId: string | null;
  birthCertificateNumber: string | null;
  birthCertificateDate: string | null;
  civilRegistryOffice: string | null;
  attributes: Record<string, unknown>;
}

export async function getSensitive(tx: Tx, tenantId: string, studentId: string): Promise<StudentSensitiveRow | null> {
  return tx.queryOne<StudentSensitiveRow>(
    `SELECT id AS "studentId", national_student_id AS "nationalStudentId", birth_certificate_number AS "birthCertificateNumber",
            birth_certificate_date::text AS "birthCertificateDate", civil_registry_office AS "civilRegistryOffice", attributes
       FROM people.students WHERE tenant_id = $1 AND id = $2`,
    [tenantId, studentId],
  );
}

/** Efface les champs sensibles du dossier (anonymisation). Le matricule et les faits académiques sont conservés. */
export async function wipeStudentSensitive(tx: Tx, tenantId: string, studentId: string, now: Date): Promise<void> {
  await tx.query(
    `UPDATE people.students
        SET national_student_id = NULL, birth_certificate_number = NULL, birth_certificate_date = NULL, civil_registry_office = NULL,
            external_ref = NULL, attributes = '{}'::jsonb, updated_at = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, studentId, now],
  );
}

// ---------------------------------------------------------------------------
// Listes et recherche
// ---------------------------------------------------------------------------

export interface StudentListFilter {
  q?: string | undefined;
  /** Interprétation d'un `q` numérique / alphanumérique : téléphone normalisé d'un tuteur. */
  qPhone?: string | null | undefined;
  /** Autorise la recherche exacte par identifiant national (donnée sensible). */
  allowNationalIdSearch?: boolean | undefined;
  status?: string | undefined;
  includeArchived?: boolean | undefined;
  classroomId?: string | undefined;
  academicYearId?: string | undefined;
  institutionId?: string | undefined;
  programId?: string | undefined;
  enrollmentStatus?: string | undefined;
  guardianId?: string | undefined;
  /** Restreint aux élèves listés (accès « classe » d'un enseignant). */
  onlyIds?: readonly string[] | undefined;
  limit: number;
  offset: number;
}

function buildStudentWhere(tenantId: string, f: StudentListFilter): Where {
  const w = new Where([tenantId]);
  if (f.status) w.and(`s.status = ${w.bind(f.status)}`);
  else if (!f.includeArchived) w.and(`s.status <> 'ARCHIVED'`);
  if (f.onlyIds) w.and(`s.id = ANY(${w.bind(f.onlyIds)}::uuid[])`);
  const enrol: string[] = [];
  if (f.classroomId) enrol.push(`e.classroom_id = ${w.bind(f.classroomId)}`);
  if (f.academicYearId) enrol.push(`e.academic_year_id = ${w.bind(f.academicYearId)}`);
  if (f.institutionId) enrol.push(`e.institution_id = ${w.bind(f.institutionId)}`);
  if (f.programId) enrol.push(`e.program_id = ${w.bind(f.programId)}`);
  if (f.enrollmentStatus) enrol.push(`e.status = ${w.bind(f.enrollmentStatus)}`);
  if (enrol.length > 0) {
    w.and(`EXISTS (SELECT 1 FROM people.student_enrollment_summaries e WHERE e.tenant_id = s.tenant_id AND e.student_id = s.id AND ${enrol.join(" AND ")})`);
  }
  if (f.guardianId) {
    w.and(
      `EXISTS (SELECT 1 FROM people.student_guardians sg WHERE sg.tenant_id = s.tenant_id AND sg.student_id = s.id AND sg.guardian_id = ${w.bind(f.guardianId)} AND sg.valid_to IS NULL)`,
    );
  }
  const q = f.q?.trim();
  if (q) {
    const folded = w.bind(q);
    const like = w.bind(`%${likeEscape(q)}%`);
    const parts = [
      `people.normalize_search(${folded}) <> '' AND p.search_key LIKE '%' || people.normalize_search(${folded}) || '%'`,
      `p.search_key % people.normalize_search(${folded})`,
      `s.student_number ILIKE ${like} ESCAPE '\\'`,
      `EXISTS (SELECT 1 FROM people.student_enrollment_summaries e2 WHERE e2.tenant_id = s.tenant_id AND e2.student_id = s.id AND e2.registration_number ILIKE ${like} ESCAPE '\\')`,
    ];
    if (f.allowNationalIdSearch) parts.push(`s.national_student_id = ${folded}`);
    if (f.qPhone) {
      const phone = w.bind(f.qPhone);
      parts.push(
        `EXISTS (SELECT 1 FROM people.student_guardians sg2 JOIN people.guardians g2 ON g2.tenant_id = sg2.tenant_id AND g2.id = sg2.guardian_id
                  JOIN people.persons gp ON gp.tenant_id = g2.tenant_id AND gp.id = g2.person_id
                 WHERE sg2.tenant_id = s.tenant_id AND sg2.student_id = s.id AND sg2.valid_to IS NULL AND (gp.phone = ${phone} OR gp.phone_alt = ${phone}))`,
      );
    }
    w.and(`(${parts.join(" OR ")})`);
  }
  return w;
}

export async function listStudentRows(tx: Tx, tenantId: string, f: StudentListFilter): Promise<{ rows: StudentRow[]; total: number }> {
  const w = buildStudentWhere(tenantId, f);
  const limit = w.bind(f.limit);
  const offset = w.bind(f.offset);
  const rows = await tx.many<StudentRow & { total: string }>(
    `SELECT ${STUDENT_COLUMNS}, count(*) OVER() AS total ${STUDENT_FROM}
      WHERE s.tenant_id = $1${w.sql}
      ORDER BY lower(p.last_name), lower(p.first_name), s.id
      LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  if (rows.length === 0 && f.offset > 0) {
    const w2 = buildStudentWhere(tenantId, f);
    const c = await tx.queryOne<{ n: string }>(`SELECT count(*) AS n ${STUDENT_FROM} WHERE s.tenant_id = $1${w2.sql}`, w2.params);
    return { rows: [], total: Number(c?.n ?? 0) };
  }
  return { rows, total: rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0 };
}

/** Lignes de l'export (plafonnées par l'appelant). */
export async function listStudentRowsForExport(tx: Tx, tenantId: string, f: Omit<StudentListFilter, "limit" | "offset">, limit: number): Promise<StudentRow[]> {
  const w = buildStudentWhere(tenantId, { ...f, limit, offset: 0 });
  const lim = w.bind(limit);
  return tx.many<StudentRow>(
    `SELECT ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE s.tenant_id = $1${w.sql} ORDER BY lower(p.last_name), lower(p.first_name), s.id LIMIT ${lim}`,
    w.params,
  );
}

// ---------------------------------------------------------------------------
// Historique de statut (append-only)
// ---------------------------------------------------------------------------

export interface StatusHistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reasonCode: string | null;
  reasonText: string | null;
  effectiveOn: string;
  changedBy: string | null;
  changedAt: Date;
}

export async function insertStatusHistory(
  tx: Tx,
  tenantId: string,
  h: { id: string; studentId: string; fromStatus: string | null; toStatus: string; reasonCode?: string | null | undefined; reasonText?: string | null | undefined; effectiveOn: string; changedBy: string | null },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.student_status_history (id, tenant_id, student_id, from_status, to_status, reason_code, reason_text, effective_on, changed_by, changed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10)`,
    [h.id, tenantId, h.studentId, h.fromStatus, h.toStatus, h.reasonCode ?? null, h.reasonText ?? null, h.effectiveOn, h.changedBy, now],
  );
}

export async function listStatusHistory(tx: Tx, tenantId: string, studentId: string): Promise<StatusHistoryRow[]> {
  return tx.many<StatusHistoryRow>(
    `SELECT id, from_status AS "fromStatus", to_status AS "toStatus", reason_code AS "reasonCode", reason_text AS "reasonText",
            effective_on::text AS "effectiveOn", changed_by AS "changedBy", changed_at AS "changedAt"
       FROM people.student_status_history WHERE tenant_id = $1 AND student_id = $2 ORDER BY changed_at DESC, id DESC`,
    [tenantId, studentId],
  );
}

/** Instant du dernier passage à `ARCHIVED` (point de départ du délai de conservation). */
export async function lastArchivedAt(tx: Tx, tenantId: string, studentId: string): Promise<{ effectiveOn: string; changedAt: Date } | null> {
  return tx.queryOne(
    `SELECT effective_on::text AS "effectiveOn", changed_at AS "changedAt" FROM people.student_status_history
      WHERE tenant_id = $1 AND student_id = $2 AND to_status = 'ARCHIVED' ORDER BY changed_at DESC, id DESC LIMIT 1`,
    [tenantId, studentId],
  );
}

// ---------------------------------------------------------------------------
// Contacts d'urgence (rattachés à l'ÉLÈVE)
// ---------------------------------------------------------------------------

export interface EmergencyContactRow {
  id: string;
  studentId: string;
  contactName: string;
  relationshipLabel: string | null;
  phone: string;
  phoneAlt: string | null;
  email: string | null;
  priority: number;
}
const EC_COLUMNS = `id, student_id AS "studentId", contact_name AS "contactName", relationship_label AS "relationshipLabel", phone, phone_alt AS "phoneAlt", email, priority`;

export const listEmergencyContacts = (tx: Tx, tenantId: string, studentId: string): Promise<EmergencyContactRow[]> =>
  tx.many<EmergencyContactRow>(`SELECT ${EC_COLUMNS} FROM people.student_emergency_contacts WHERE tenant_id = $1 AND student_id = $2 ORDER BY priority, created_at, id`, [tenantId, studentId]);

export const getEmergencyContact = (tx: Tx, tenantId: string, studentId: string, id: string): Promise<EmergencyContactRow | null> =>
  tx.queryOne<EmergencyContactRow>(`SELECT ${EC_COLUMNS} FROM people.student_emergency_contacts WHERE tenant_id = $1 AND student_id = $2 AND id = $3`, [tenantId, studentId, id]);

export async function insertEmergencyContact(
  tx: Tx,
  tenantId: string,
  v: { id: string; studentId: string; contactName: string; relationshipLabel?: string | undefined; phone: string; phoneAlt?: string | undefined; email?: string | undefined; priority?: number | undefined },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.student_emergency_contacts (id, tenant_id, student_id, contact_name, relationship_label, phone, phone_alt, email, priority, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,100),$10,$10)`,
    [v.id, tenantId, v.studentId, v.contactName, v.relationshipLabel ?? null, v.phone, v.phoneAlt ?? null, v.email ?? null, v.priority ?? null, now],
  );
}

export async function updateEmergencyContact(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: { contactName?: string | undefined; relationshipLabel?: string | null | undefined; phone?: string | undefined; phoneAlt?: string | null | undefined; email?: string | null | undefined; priority?: number | undefined },
  now: Date,
): Promise<void> {
  await updateById(
    tx,
    "people.student_emergency_contacts",
    tenantId,
    id,
    { contact_name: patch.contactName, relationship_label: patch.relationshipLabel, phone: patch.phone, phone_alt: patch.phoneAlt, email: patch.email, priority: patch.priority },
    now,
  );
}

export async function deleteEmergencyContact(tx: Tx, tenantId: string, studentId: string, id: string): Promise<number> {
  const res = await tx.query(`DELETE FROM people.student_emergency_contacts WHERE tenant_id = $1 AND student_id = $2 AND id = $3`, [tenantId, studentId, id]);
  return res.rowCount;
}

export async function deleteAllEmergencyContacts(tx: Tx, tenantId: string, studentId: string): Promise<number> {
  const res = await tx.query(`DELETE FROM people.student_emergency_contacts WHERE tenant_id = $1 AND student_id = $2`, [tenantId, studentId]);
  return res.rowCount;
}

// ---------------------------------------------------------------------------
// Antécédents scolaires et diplômes d'entrée
// ---------------------------------------------------------------------------

export interface PriorEducationRow {
  id: string;
  studentId: string;
  kind: "SCHOOL" | "DIPLOMA" | "CERTIFICATE" | "OTHER";
  label: string;
  institutionName: string | null;
  schoolYear: string | null;
  levelLabel: string | null;
  seriesLabel: string | null;
  obtainedOn: string | null;
  referenceNumber: string | null;
  attachmentObjectKey: string | null;
  note: string | null;
}
const PE_COLUMNS = `id, student_id AS "studentId", kind, label, institution_name AS "institutionName", school_year AS "schoolYear",
  level_label AS "levelLabel", series_label AS "seriesLabel", obtained_on::text AS "obtainedOn", reference_number AS "referenceNumber",
  attachment_object_key AS "attachmentObjectKey", note`;

export const listPriorEducation = (tx: Tx, tenantId: string, studentId: string): Promise<PriorEducationRow[]> =>
  tx.many<PriorEducationRow>(`SELECT ${PE_COLUMNS} FROM people.student_prior_education WHERE tenant_id = $1 AND student_id = $2 ORDER BY obtained_on NULLS LAST, created_at, id`, [tenantId, studentId]);

export const getPriorEducation = (tx: Tx, tenantId: string, studentId: string, id: string): Promise<PriorEducationRow | null> =>
  tx.queryOne<PriorEducationRow>(`SELECT ${PE_COLUMNS} FROM people.student_prior_education WHERE tenant_id = $1 AND student_id = $2 AND id = $3`, [tenantId, studentId, id]);

export async function insertPriorEducation(
  tx: Tx,
  tenantId: string,
  v: {
    id: string;
    studentId: string;
    kind: string;
    label: string;
    institutionName?: string | undefined;
    schoolYear?: string | undefined;
    levelLabel?: string | undefined;
    seriesLabel?: string | undefined;
    obtainedOn?: string | undefined;
    referenceNumber?: string | undefined;
    note?: string | undefined;
  },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.student_prior_education
       (id, tenant_id, student_id, kind, label, institution_name, school_year, level_label, series_label, obtained_on, reference_number, note, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$13)`,
    [v.id, tenantId, v.studentId, v.kind, v.label, v.institutionName ?? null, v.schoolYear ?? null, v.levelLabel ?? null, v.seriesLabel ?? null, v.obtainedOn ?? null, v.referenceNumber ?? null, v.note ?? null, now],
  );
}

export async function updatePriorEducation(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: Record<"kind" | "label" | "institutionName" | "schoolYear" | "levelLabel" | "seriesLabel" | "obtainedOn" | "referenceNumber" | "note", string | null | undefined>,
  now: Date,
): Promise<void> {
  await updateById(
    tx,
    "people.student_prior_education",
    tenantId,
    id,
    {
      kind: patch.kind,
      label: patch.label,
      institution_name: patch.institutionName,
      school_year: patch.schoolYear,
      level_label: patch.levelLabel,
      series_label: patch.seriesLabel,
      obtained_on: patch.obtainedOn,
      reference_number: patch.referenceNumber,
      note: patch.note,
    },
    now,
  );
}

export async function deletePriorEducation(tx: Tx, tenantId: string, studentId: string, id: string): Promise<number> {
  const res = await tx.query(`DELETE FROM people.student_prior_education WHERE tenant_id = $1 AND student_id = $2 AND id = $3`, [tenantId, studentId, id]);
  return res.rowCount;
}

/** Anonymisation : neutralise les antécédents (références, pièces, notes) en conservant la nature et l'année. */
export async function neutralizePriorEducation(tx: Tx, tenantId: string, studentId: string, now: Date): Promise<string[]> {
  const keys = await tx.many<{ key: string | null }>(
    `SELECT attachment_object_key AS key FROM people.student_prior_education WHERE tenant_id = $1 AND student_id = $2 AND attachment_object_key IS NOT NULL`,
    [tenantId, studentId],
  );
  await tx.query(
    `UPDATE people.student_prior_education
        SET institution_name = NULL, reference_number = NULL, attachment_object_key = NULL, document_ref = NULL, note = NULL, label = 'Antécédent', updated_at = $3
      WHERE tenant_id = $1 AND student_id = $2`,
    [tenantId, studentId, now],
  );
  return keys.map((r) => r.key).filter((k): k is string => Boolean(k));
}

// ---------------------------------------------------------------------------
// Projection d'inscriptions d'un élève
// ---------------------------------------------------------------------------

export interface EnrollmentSummaryRow {
  enrollmentId: string;
  academicYearId: string;
  institutionId: string;
  classroomId: string;
  classroomName: string | null;
  programLabel: string | null;
  gradeLevelLabel: string | null;
  mode: string;
  status: string;
  fundingType: string;
  registrationNumber: string | null;
  enrolledOn: string;
}

export async function listEnrollmentSummaries(tx: Tx, tenantId: string, studentId: string): Promise<EnrollmentSummaryRow[]> {
  return tx.many<EnrollmentSummaryRow>(
    `SELECT enrollment_id AS "enrollmentId", academic_year_id AS "academicYearId", institution_id AS "institutionId", classroom_id AS "classroomId",
            classroom_name AS "classroomName", program_label AS "programLabel", grade_level_label AS "gradeLevelLabel", mode, status,
            funding_type AS "fundingType", registration_number AS "registrationNumber", enrolled_on::text AS "enrolledOn"
       FROM people.student_enrollment_summaries WHERE tenant_id = $1 AND student_id = $2 ORDER BY enrolled_on DESC, enrollment_id`,
    [tenantId, studentId],
  );
}
