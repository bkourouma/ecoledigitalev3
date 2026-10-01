/**
 * Dépôt SQL du personnel : fiche (`staff`), affiliations, contrats (ni tarif ni salaire), qualifications, compétences,
 * disponibilités, historique de statut. Tables de TENANT (RLS forcée). Aucun DELETE sur `staff` ni sur les contrats.
 */
import type { Tx } from "@ecoledigitale/database";
import { PERSON_COLUMNS, type PersonRow } from "./persons-repo";
import { Where, hhmm, numOrNull, updateById } from "./sql";

export interface StaffRow extends PersonRow {
  staffId: string;
  staffNumber: string;
  categoryCode: string;
  jobTitle: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "LEFT";
  hiredOn: string | null;
  leftOn: string | null;
  primaryInstitutionId: string | null;
  primaryCampusId: string | null;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  portalStatus: string | null;
  plannedHours: string | null;
}

export const STAFF_COLUMNS = `
  ${PERSON_COLUMNS},
  st.id AS "staffId", st.staff_number AS "staffNumber", st.category_code AS "categoryCode", st.job_title AS "jobTitle", st.status,
  st.hired_on::text AS "hiredOn", st.left_on::text AS "leftOn", st.primary_institution_id AS "primaryInstitutionId",
  st.primary_campus_id AS "primaryCampusId", st.external_ref AS "externalRef", st.created_at AS "createdAt", st.updated_at AS "updatedAt",
  im.status AS "portalStatus"`;

export const STAFF_FROM = `
  FROM people.staff st
  JOIN people.persons p ON p.tenant_id = st.tenant_id AND p.id = st.person_id
  LEFT JOIN people.identity_memberships im ON im.tenant_id = p.tenant_id AND im.identity_id = p.identity_id`;

export async function getStaffRow(tx: Tx, tenantId: string, staffId: string): Promise<StaffRow | null> {
  return tx.queryOne<StaffRow>(`SELECT ${STAFF_COLUMNS}, NULL::text AS "plannedHours" ${STAFF_FROM} WHERE st.tenant_id = $1 AND st.id = $2`, [tenantId, staffId]);
}

export async function lockStaff(tx: Tx, tenantId: string, staffId: string): Promise<{ id: string; personId: string; status: StaffRow["status"]; categoryCode: string } | null> {
  return tx.queryOne(`SELECT id, person_id AS "personId", status, category_code AS "categoryCode" FROM people.staff WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, staffId]);
}

export async function getStaffRows(tx: Tx, tenantId: string, ids: readonly string[]): Promise<StaffRow[]> {
  if (ids.length === 0) return [];
  return tx.many<StaffRow>(`SELECT ${STAFF_COLUMNS}, NULL::text AS "plannedHours" ${STAFF_FROM} WHERE st.tenant_id = $1 AND st.id = ANY($2::uuid[])`, [tenantId, ids]);
}

export async function findStaffByPerson(tx: Tx, tenantId: string, personId: string): Promise<StaffRow | null> {
  return tx.queryOne<StaffRow>(`SELECT ${STAFF_COLUMNS}, NULL::text AS "plannedHours" ${STAFF_FROM} WHERE st.tenant_id = $1 AND st.person_id = $2`, [tenantId, personId]);
}

export async function findStaffByIdentity(tx: Tx, tenantId: string, identityId: string): Promise<StaffRow | null> {
  return tx.queryOne<StaffRow>(`SELECT ${STAFF_COLUMNS}, NULL::text AS "plannedHours" ${STAFF_FROM} WHERE st.tenant_id = $1 AND p.identity_id = $2`, [tenantId, identityId]);
}

export async function findStaffByExternalRef(tx: Tx, tenantId: string, externalRef: string): Promise<StaffRow | null> {
  return tx.queryOne<StaffRow>(`SELECT ${STAFF_COLUMNS}, NULL::text AS "plannedHours" ${STAFF_FROM} WHERE st.tenant_id = $1 AND st.external_ref = $2`, [tenantId, externalRef]);
}

export interface NewStaff {
  id: string;
  personId: string;
  staffNumber: string;
  categoryCode: string;
  jobTitle?: string | undefined;
  hiredOn?: string | undefined;
  primaryInstitutionId?: string | undefined;
  primaryCampusId?: string | undefined;
  attributes?: Record<string, unknown> | undefined;
  externalRef?: string | undefined;
}

export async function insertStaff(tx: Tx, tenantId: string, s: NewStaff, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO people.staff
       (id, tenant_id, person_id, staff_number, category_code, job_title, status, hired_on, primary_institution_id, primary_campus_id, attributes, external_ref, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7::date,$8,$9,$10::jsonb,$11,$12,$12)`,
    [s.id, tenantId, s.personId, s.staffNumber, s.categoryCode, s.jobTitle ?? null, s.hiredOn ?? null, s.primaryInstitutionId ?? null, s.primaryCampusId ?? null, JSON.stringify(s.attributes ?? {}), s.externalRef ?? null, now],
  );
}

export interface StaffPatchValues {
  categoryCode?: string | undefined;
  jobTitle?: string | null | undefined;
  hiredOn?: string | null | undefined;
  primaryInstitutionId?: string | null | undefined;
  primaryCampusId?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
  externalRef?: string | null | undefined;
}

export async function updateStaff(tx: Tx, tenantId: string, staffId: string, p: StaffPatchValues, now: Date): Promise<void> {
  await updateById(
    tx,
    "people.staff",
    tenantId,
    staffId,
    {
      category_code: p.categoryCode,
      job_title: p.jobTitle,
      hired_on: p.hiredOn,
      primary_institution_id: p.primaryInstitutionId,
      primary_campus_id: p.primaryCampusId,
      attributes: p.attributes === undefined ? undefined : JSON.stringify(p.attributes),
      external_ref: p.externalRef,
    },
    now,
  );
}

export async function setStaffStatus(tx: Tx, tenantId: string, staffId: string, status: string, leftOn: string | null | undefined, now: Date): Promise<void> {
  await updateById(tx, "people.staff", tenantId, staffId, { status, left_on: leftOn }, now);
}

export interface StaffListFilter {
  q?: string | undefined;
  qPhone?: string | null | undefined;
  status?: string | undefined;
  categoryCode?: string | undefined;
  institutionId?: string | undefined;
  canTeach?: boolean | undefined;
  /** Tri par charge prévue de cette année (heures affectées). */
  loadYearId?: string | undefined;
  sortByLoad?: boolean | undefined;
  today: string;
  limit: number;
  offset: number;
}

export async function listStaffRows(tx: Tx, tenantId: string, f: StaffListFilter): Promise<{ rows: StaffRow[]; total: number }> {
  const w = new Where([tenantId]);
  w.and(`p.anonymized_at IS NULL`);
  if (f.status) w.and(`st.status = ${w.bind(f.status)}`);
  if (f.categoryCode) w.and(`st.category_code = ${w.bind(f.categoryCode)}`);
  if (f.canTeach !== undefined) {
    w.and(`EXISTS (SELECT 1 FROM people.staff_categories c WHERE c.tenant_id = st.tenant_id AND c.code = st.category_code AND c.can_teach = ${w.bind(f.canTeach)})`);
  }
  if (f.institutionId) {
    const inst = w.bind(f.institutionId);
    const today = w.bind(f.today);
    w.and(
      `(st.primary_institution_id = ${inst} OR EXISTS (SELECT 1 FROM people.staff_affiliations a WHERE a.tenant_id = st.tenant_id AND a.staff_id = st.id AND a.institution_id = ${inst}
         AND a.valid_from <= ${today}::date AND (a.valid_to IS NULL OR a.valid_to >= ${today}::date)))`,
    );
  }
  const q = f.q?.trim();
  if (q) {
    const folded = w.bind(q);
    const parts = [
      `p.search_key LIKE '%' || people.normalize_search(${folded}) || '%'`,
      `p.search_key % people.normalize_search(${folded})`,
      `st.staff_number ILIKE ${w.bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} ESCAPE '\\'`,
      `lower(p.email) = lower(${folded})`,
    ];
    if (f.qPhone) parts.push(`p.phone = ${w.bind(f.qPhone)}`);
    w.and(`(${parts.join(" OR ")})`);
  }
  let loadSelect = `NULL::text AS "plannedHours"`;
  let order = `lower(p.last_name), lower(p.first_name), st.id`;
  if (f.loadYearId) {
    const year = w.bind(f.loadYearId);
    loadSelect = `(SELECT COALESCE(sum(a.planned_hours), 0)::text FROM people.teaching_assignments a WHERE a.tenant_id = st.tenant_id AND a.staff_id = st.id AND a.academic_year_id = ${year} AND a.status = 'ACTIVE') AS "plannedHours"`;
    if (f.sortByLoad) order = `(SELECT COALESCE(sum(a.planned_hours), 0) FROM people.teaching_assignments a WHERE a.tenant_id = st.tenant_id AND a.staff_id = st.id AND a.academic_year_id = ${year} AND a.status = 'ACTIVE') DESC, ${order}`;
  }
  const limit = w.bind(f.limit);
  const offset = w.bind(f.offset);
  const rows = await tx.many<StaffRow & { total: string }>(
    `SELECT ${STAFF_COLUMNS}, ${loadSelect}, count(*) OVER() AS total ${STAFF_FROM} WHERE st.tenant_id = $1${w.sql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { rows, total: rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0 };
}

export const plannedHoursOf = (row: Pick<StaffRow, "plannedHours">): number | null => numOrNull(row.plannedHours);

// ---------------------------------------------------------------------------
// Historique de statut
// ---------------------------------------------------------------------------

export interface StaffStatusHistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reasonText: string | null;
  effectiveOn: string;
  changedBy: string | null;
  changedAt: Date;
}

export async function insertStaffStatusHistory(
  tx: Tx,
  tenantId: string,
  h: { id: string; staffId: string; fromStatus: string | null; toStatus: string; reasonText?: string | undefined; effectiveOn: string; changedBy: string | null },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.staff_status_history (id, tenant_id, staff_id, from_status, to_status, reason_text, effective_on, changed_by, changed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9)`,
    [h.id, tenantId, h.staffId, h.fromStatus, h.toStatus, h.reasonText ?? null, h.effectiveOn, h.changedBy, now],
  );
}

export async function listStaffStatusHistory(tx: Tx, tenantId: string, staffId: string): Promise<StaffStatusHistoryRow[]> {
  return tx.many<StaffStatusHistoryRow>(
    `SELECT id, from_status AS "fromStatus", to_status AS "toStatus", reason_text AS "reasonText", effective_on::text AS "effectiveOn", changed_by AS "changedBy", changed_at AS "changedAt"
       FROM people.staff_status_history WHERE tenant_id = $1 AND staff_id = $2 ORDER BY changed_at DESC, id DESC`,
    [tenantId, staffId],
  );
}

// ---------------------------------------------------------------------------
// Affiliations
// ---------------------------------------------------------------------------

export interface AffiliationRow {
  id: string;
  institutionId: string;
  campusId: string | null;
  validFrom: string;
  validTo: string | null;
}

export const listAffiliations = (tx: Tx, tenantId: string, staffId: string): Promise<AffiliationRow[]> =>
  tx.many<AffiliationRow>(
    `SELECT id, institution_id AS "institutionId", campus_id AS "campusId", valid_from::text AS "validFrom", valid_to::text AS "validTo"
       FROM people.staff_affiliations WHERE tenant_id = $1 AND staff_id = $2 ORDER BY valid_from, id`,
    [tenantId, staffId],
  );

export async function replaceAffiliations(
  tx: Tx,
  tenantId: string,
  staffId: string,
  items: ReadonlyArray<{ id: string; institutionId: string; campusId: string | null; validFrom: string; validTo: string | null }>,
  now: Date,
): Promise<void> {
  await tx.query(`DELETE FROM people.staff_affiliations WHERE tenant_id = $1 AND staff_id = $2`, [tenantId, staffId]);
  for (const a of items) {
    await tx.query(
      `INSERT INTO people.staff_affiliations (id, tenant_id, staff_id, institution_id, campus_id, valid_from, valid_to, created_at) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8)`,
      [a.id, tenantId, staffId, a.institutionId, a.campusId, a.validFrom, a.validTo, now],
    );
  }
}

// ---------------------------------------------------------------------------
// Contrats
// ---------------------------------------------------------------------------

export interface ContractRow {
  id: string;
  staffId: string;
  contractTypeCode: string;
  startsOn: string;
  endsOn: string | null;
  committedHours: string | null;
  committedHoursUnit: "PER_WEEK" | "PER_YEAR" | null;
  status: "DRAFT" | "ACTIVE" | "ENDED" | "CANCELLED";
  note: string | null;
}
const CONTRACT_COLUMNS = `id, staff_id AS "staffId", contract_type_code AS "contractTypeCode", starts_on::text AS "startsOn", ends_on::text AS "endsOn",
  committed_hours::text AS "committedHours", committed_hours_unit AS "committedHoursUnit", status, note`;

export const listContracts = (tx: Tx, tenantId: string, staffId: string): Promise<ContractRow[]> =>
  tx.many<ContractRow>(`SELECT ${CONTRACT_COLUMNS} FROM people.staff_contracts WHERE tenant_id = $1 AND staff_id = $2 ORDER BY starts_on DESC, id`, [tenantId, staffId]);

export const getContract = (tx: Tx, tenantId: string, staffId: string, id: string): Promise<ContractRow | null> =>
  tx.queryOne<ContractRow>(`SELECT ${CONTRACT_COLUMNS} FROM people.staff_contracts WHERE tenant_id = $1 AND staff_id = $2 AND id = $3`, [tenantId, staffId, id]);

export async function insertContract(
  tx: Tx,
  tenantId: string,
  c: { id: string; staffId: string; contractTypeCode: string; startsOn: string; endsOn?: string | undefined; committedHours?: number | undefined; committedHoursUnit?: string | undefined; status: string; note?: string | undefined },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.staff_contracts (id, tenant_id, staff_id, contract_type_code, starts_on, ends_on, committed_hours, committed_hours_unit, status, note, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$11)`,
    [c.id, tenantId, c.staffId, c.contractTypeCode, c.startsOn, c.endsOn ?? null, c.committedHours ?? null, c.committedHoursUnit ?? null, c.status, c.note ?? null, now],
  );
}

export async function updateContract(
  tx: Tx,
  tenantId: string,
  id: string,
  p: { startsOn?: string | undefined; endsOn?: string | null | undefined; committedHours?: number | null | undefined; committedHoursUnit?: string | null | undefined; status?: string | undefined; note?: string | null | undefined },
  now: Date,
): Promise<void> {
  await updateById(
    tx,
    "people.staff_contracts",
    tenantId,
    id,
    { starts_on: p.startsOn, ends_on: p.endsOn, committed_hours: p.committedHours, committed_hours_unit: p.committedHoursUnit, status: p.status, note: p.note },
    now,
  );
}

export async function listAllContractsOfStaffIds(tx: Tx, tenantId: string, staffIds: readonly string[]): Promise<ContractRow[]> {
  if (staffIds.length === 0) return [];
  return tx.many<ContractRow>(`SELECT ${CONTRACT_COLUMNS} FROM people.staff_contracts WHERE tenant_id = $1 AND staff_id = ANY($2::uuid[]) ORDER BY starts_on DESC, id`, [tenantId, staffIds]);
}

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------

export interface QualificationRow {
  id: string;
  staffId: string;
  kind: "DIPLOMA" | "CERTIFICATION" | "AUTHORIZATION" | "OTHER";
  label: string;
  issuer: string | null;
  obtainedOn: string | null;
  expiresOn: string | null;
  note: string | null;
}
const QUAL_COLUMNS = `id, staff_id AS "staffId", kind, label, issuer, obtained_on::text AS "obtainedOn", expires_on::text AS "expiresOn", note`;

export const listQualifications = (tx: Tx, tenantId: string, staffId: string): Promise<QualificationRow[]> =>
  tx.many<QualificationRow>(`SELECT ${QUAL_COLUMNS} FROM people.staff_qualifications WHERE tenant_id = $1 AND staff_id = $2 ORDER BY expires_on NULLS LAST, id`, [tenantId, staffId]);

export const getQualification = (tx: Tx, tenantId: string, staffId: string, id: string): Promise<QualificationRow | null> =>
  tx.queryOne<QualificationRow>(`SELECT ${QUAL_COLUMNS} FROM people.staff_qualifications WHERE tenant_id = $1 AND staff_id = $2 AND id = $3`, [tenantId, staffId, id]);

export async function insertQualification(
  tx: Tx,
  tenantId: string,
  q: { id: string; staffId: string; kind: string; label: string; issuer?: string | undefined; obtainedOn?: string | undefined; expiresOn?: string | undefined; note?: string | undefined },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.staff_qualifications (id, tenant_id, staff_id, kind, label, issuer, obtained_on, expires_on, note, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$10)`,
    [q.id, tenantId, q.staffId, q.kind, q.label, q.issuer ?? null, q.obtainedOn ?? null, q.expiresOn ?? null, q.note ?? null, now],
  );
}

export async function updateQualification(
  tx: Tx,
  tenantId: string,
  id: string,
  p: { kind?: string | undefined; label?: string | undefined; issuer?: string | null | undefined; obtainedOn?: string | null | undefined; expiresOn?: string | null | undefined; note?: string | null | undefined },
  now: Date,
): Promise<void> {
  await updateById(tx, "people.staff_qualifications", tenantId, id, { kind: p.kind, label: p.label, issuer: p.issuer, obtained_on: p.obtainedOn, expires_on: p.expiresOn, note: p.note }, now);
}

export async function deleteQualification(tx: Tx, tenantId: string, staffId: string, id: string): Promise<number> {
  const res = await tx.query(`DELETE FROM people.staff_qualifications WHERE tenant_id = $1 AND staff_id = $2 AND id = $3`, [tenantId, staffId, id]);
  return res.rowCount;
}

export interface ExpiringRow {
  qualificationId: string;
  staffId: string;
  label: string;
  expiresOn: string;
  daysLeft: number;
}

/** Qualifications qui expirent dans la fenêtre (fonction SQL `people.expiring_qualifications`, personnel ACTIF ou en congé). */
export async function listExpiring(tx: Tx, asOf: string, withinDays: number): Promise<ExpiringRow[]> {
  return tx.many<ExpiringRow>(
    `SELECT qualification_id AS "qualificationId", staff_id AS "staffId", label, expires_on::text AS "expiresOn", days_left AS "daysLeft"
       FROM people.expiring_qualifications($1::date, $2::int) ORDER BY expires_on, qualification_id`,
    [asOf, withinDays],
  );
}

/**
 * Qualifications à signaler : expirées ou qui expirent dans `withinDays`, pour un personnel actif ou en congé, ET pas
 * encore signalées pour CETTE date d'expiration (`expiry_alerted_for`) — « une alerte par franchissement de seuil ».
 * Verrouille les lignes (concurrence de deux exécutions du job).
 */
export async function lockUnalertedExpiring(tx: Tx, tenantId: string, asOf: string, withinDays: number): Promise<ExpiringRow[]> {
  return tx.many<ExpiringRow>(
    `SELECT q.id AS "qualificationId", q.staff_id AS "staffId", q.label, q.expires_on::text AS "expiresOn", (q.expires_on - $2::date)::int AS "daysLeft"
       FROM people.staff_qualifications q
       JOIN people.staff s ON s.tenant_id = q.tenant_id AND s.id = q.staff_id
      WHERE q.tenant_id = $1 AND s.status IN ('ACTIVE', 'ON_LEAVE') AND q.expires_on IS NOT NULL
        AND q.expires_on <= $2::date + $3::int AND q.expiry_alerted_for IS DISTINCT FROM q.expires_on
      ORDER BY q.expires_on, q.id
      FOR UPDATE OF q SKIP LOCKED`,
    [tenantId, asOf, withinDays],
  );
}

export async function markQualificationAlerted(tx: Tx, tenantId: string, id: string, expiresOn: string): Promise<void> {
  await tx.query(`UPDATE people.staff_qualifications SET expiry_alerted_for = $3::date WHERE tenant_id = $1 AND id = $2`, [tenantId, id, expiresOn]);
}

// ---------------------------------------------------------------------------
// Compétences et disponibilités
// ---------------------------------------------------------------------------

export interface CompetencyRow {
  subjectId: string;
  gradeLevelCodes: string[];
}
export const listCompetencies = (tx: Tx, tenantId: string, staffId: string): Promise<CompetencyRow[]> =>
  tx.many<CompetencyRow>(`SELECT subject_id AS "subjectId", grade_level_codes AS "gradeLevelCodes" FROM people.staff_competencies WHERE tenant_id = $1 AND staff_id = $2 ORDER BY subject_id`, [tenantId, staffId]);

export const listCompetenciesOfStaffIds = (tx: Tx, tenantId: string, staffIds: readonly string[]): Promise<Array<CompetencyRow & { staffId: string }>> =>
  tx.many(`SELECT staff_id AS "staffId", subject_id AS "subjectId", grade_level_codes AS "gradeLevelCodes" FROM people.staff_competencies WHERE tenant_id = $1 AND staff_id = ANY($2::uuid[]) ORDER BY staff_id, subject_id`, [tenantId, staffIds]);

export async function replaceCompetencies(tx: Tx, tenantId: string, staffId: string, items: ReadonlyArray<{ id: string; subjectId: string; gradeLevelCodes: readonly string[] }>, now: Date): Promise<void> {
  await tx.query(`DELETE FROM people.staff_competencies WHERE tenant_id = $1 AND staff_id = $2`, [tenantId, staffId]);
  for (const c of items) {
    await tx.query(`INSERT INTO people.staff_competencies (id, tenant_id, staff_id, subject_id, grade_level_codes, created_at) VALUES ($1,$2,$3,$4,$5::text[],$6)`, [c.id, tenantId, staffId, c.subjectId, c.gradeLevelCodes, now]);
  }
}

export interface AvailabilityRow {
  id: string;
  staffId: string;
  campusId: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  kind: "AVAILABLE" | "UNAVAILABLE";
  validFrom: string | null;
  validTo: string | null;
  reason: string | null;
}
const AV_COLUMNS = `id, staff_id AS "staffId", campus_id AS "campusId", weekday::int AS weekday, start_time::text AS "startTime", end_time::text AS "endTime", kind,
  valid_from::text AS "validFrom", valid_to::text AS "validTo", reason`;

export async function listAvailabilities(tx: Tx, tenantId: string, staffIds: readonly string[], range?: { from?: string | undefined; to?: string | undefined }): Promise<AvailabilityRow[]> {
  const w = new Where([tenantId, staffIds]);
  if (range?.from) w.and(`(valid_to IS NULL OR valid_to >= ${w.bind(range.from)}::date)`);
  if (range?.to) w.and(`(valid_from IS NULL OR valid_from <= ${w.bind(range.to)}::date)`);
  const rows = await tx.many<AvailabilityRow>(
    `SELECT ${AV_COLUMNS} FROM people.staff_availabilities WHERE tenant_id = $1 AND staff_id = ANY($2::uuid[])${w.sql} ORDER BY staff_id, weekday, start_time, id`,
    w.params,
  );
  return rows.map((r) => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) }));
}

export async function replaceAvailabilities(
  tx: Tx,
  tenantId: string,
  staffId: string,
  items: ReadonlyArray<{ id: string; campusId: string | null; weekday: number; startTime: string; endTime: string; kind: string; validFrom: string | null; validTo: string | null; reason: string | null }>,
  now: Date,
): Promise<void> {
  await tx.query(`DELETE FROM people.staff_availabilities WHERE tenant_id = $1 AND staff_id = $2`, [tenantId, staffId]);
  for (const a of items) {
    await tx.query(
      `INSERT INTO people.staff_availabilities (id, tenant_id, staff_id, campus_id, weekday, start_time, end_time, kind, valid_from, valid_to, reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::time,$7::time,$8,$9::date,$10::date,$11,$12,$12)`,
      [a.id, tenantId, staffId, a.campusId, a.weekday, a.startTime, a.endTime, a.kind, a.validFrom, a.validTo, a.reason, now],
    );
  }
}
