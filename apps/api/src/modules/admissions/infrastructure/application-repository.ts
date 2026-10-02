/**
 * Prospects, candidatures, tuteurs, consentements, historique. Les déclencheurs SQL (`applications_guard`, `decisions_guard`,
 * `consents_*`) imposent les règles de passage ; ce fichier ne contient que des lectures et des écritures paramétrées.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  AdmissionsApplicationSummaryDto,
  AdmissionsConsentDto,
  AdmissionsGuardianDto,
  AdmissionsHistoryDto,
  AdmissionsProspectDto,
  AdmissionsStageDto,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { buildSet, dt, likePattern, ts } from "./sql";
import { STAGE_SELECT } from "./workflow-repository";

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

const PROSPECT_SELECT = `id, institution_id AS "institutionId", first_name AS "firstName", last_name AS "lastName", contact_phone AS "contactPhone",
  contact_email AS "contactEmail", interested_grade_level_code AS "interestedGradeLevelCode", source_channel AS "sourceChannel",
  referrer_label AS "referrerLabel", status, lost_reason AS "lostReason", assigned_to AS "assignedTo", converted_application_id AS "convertedApplicationId",
  notes, ${ts("created_at", "createdAt")}`;

export async function insertProspect(
  tx: Tx,
  input: { id: string; tenantId: string; institutionId: string; firstName: string; lastName: string; contactPhone: string | null; contactEmail: string | null; gradeLevelCode: string | null; sourceChannel: string; referrerLabel: string | null; notes: string | null; assignedTo: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.prospects (id, tenant_id, institution_id, first_name, last_name, contact_phone, contact_email, interested_grade_level_code, source_channel, referrer_label, notes, assigned_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [input.id, input.tenantId, input.institutionId, input.firstName, input.lastName, input.contactPhone, input.contactEmail, input.gradeLevelCode, input.sourceChannel, input.referrerLabel, input.notes, input.assignedTo],
  );
}

export async function getProspect(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<AdmissionsProspectDto | null> {
  return tx.queryOne<AdmissionsProspectDto>(`SELECT ${PROSPECT_SELECT} FROM admissions.prospects WHERE id = $1 ${options.forUpdate ? "FOR UPDATE" : ""}`, [id]);
}

export async function listProspects(tx: Tx, input: { institutionId: string; status?: string | undefined; q?: string | undefined; limit: number; offset: number }): Promise<{ items: AdmissionsProspectDto[]; total: number }> {
  const params: unknown[] = [input.institutionId];
  let where = "institution_id = $1";
  if (input.status) {
    params.push(input.status);
    where += ` AND status = $${params.length}`;
  }
  if (input.q) {
    params.push(likePattern(input.q));
    where += ` AND (first_name || ' ' || last_name ILIKE $${params.length} OR coalesce(contact_email, '') ILIKE $${params.length} OR coalesce(contact_phone, '') ILIKE $${params.length})`;
  }
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admissions.prospects WHERE ${where}`, params);
  const items = await tx.many<AdmissionsProspectDto>(
    `SELECT ${PROSPECT_SELECT} FROM admissions.prospects WHERE ${where} ORDER BY created_at DESC, id LIMIT ${Number(input.limit)} OFFSET ${Number(input.offset)}`,
    params,
  );
  return { items, total: total?.n ?? 0 };
}

const PROSPECT_COLUMNS: Readonly<Record<string, string>> = {
  firstName: "first_name",
  lastName: "last_name",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
  interestedGradeLevelCode: "interested_grade_level_code",
  referrerLabel: "referrer_label",
  notes: "notes",
  assignedTo: "assigned_to",
  status: "status",
  lostReason: "lost_reason",
};

export async function updateProspect(tx: Tx, id: string, patch: Record<string, unknown>): Promise<void> {
  const built = buildSet(patch, PROSPECT_COLUMNS, 2);
  if (!built) return;
  await tx.query(`UPDATE admissions.prospects SET ${built.set}, updated_at = now() WHERE id = $1`, [id, ...built.params]);
}

export async function markProspectConverted(tx: Tx, id: string, applicationId: string): Promise<void> {
  await tx.query(`UPDATE admissions.prospects SET status = 'CONVERTED', converted_application_id = $2, updated_at = now() WHERE id = $1`, [id, applicationId]);
}

// ---------------------------------------------------------------------------
// Candidatures
// ---------------------------------------------------------------------------

export interface ApplicationRow {
  readonly id: string;
  readonly institutionId: string;
  readonly campaignId: string;
  readonly workflowId: string;
  readonly stageId: string;
  readonly status: string;
  readonly applicationNumber: string;
  readonly createdVia: string;
  readonly prospectId: string | null;
  readonly applicantFirstName: string;
  readonly applicantLastName: string;
  readonly applicantBirthDate: string;
  readonly applicantBirthPlace: string | null;
  readonly applicantGender: "FEMALE" | "MALE" | null;
  readonly applicantNationality: string | null;
  readonly previousSchool: string | null;
  readonly previousGradeLevelCode: string | null;
  readonly isRepeating: boolean;
  readonly identityKey: string;
  readonly desiredGradeLevelCode: string;
  readonly desiredProgramId: string | null;
  readonly fundingTypeRequested: string;
  readonly assignmentReference: string | null;
  readonly priorityClassCode: string | null;
  readonly sourceChannel: string;
  readonly referrerLabel: string | null;
  readonly extra: Record<string, unknown>;
  readonly capacityOverrideReason: string | null;
  readonly waitlistEnteredAt: string | null;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly closedAt: string | null;
  readonly studentId: string | null;
  readonly enrollmentId: string | null;
  readonly invoiceId: string | null;
  readonly enrollmentConfirmedAt: string | null;
  readonly enrolledAt: string | null;
  readonly anonymizedAt: string | null;
  readonly rowVersion: number;
  readonly updatedAt: string;
  readonly stageCode: string;
  readonly stageLabel: string;
  readonly stageCanonicalStatus: string;
  readonly stageHoldsSeat: boolean;
  readonly stageIsTerminal: boolean;
  readonly stageCreatesEnrollment: boolean;
  readonly stageRequiresDecision: boolean;
  readonly stageClosureKind: string | null;
  readonly stageSlaHours: number | null;
  readonly stageNotifyTemplateCode: string | null;
}

const APPLICATION_SELECT = `a.id, a.institution_id AS "institutionId", a.campaign_id AS "campaignId", a.workflow_id AS "workflowId", a.stage_id AS "stageId", a.status,
  a.application_number AS "applicationNumber", a.created_via AS "createdVia", a.prospect_id AS "prospectId",
  a.applicant_first_name AS "applicantFirstName", a.applicant_last_name AS "applicantLastName", ${dt("a.applicant_birth_date", "applicantBirthDate")},
  a.applicant_birth_place AS "applicantBirthPlace", a.applicant_gender AS "applicantGender", a.applicant_nationality AS "applicantNationality",
  a.previous_school AS "previousSchool", a.previous_grade_level_code AS "previousGradeLevelCode", a.is_repeating AS "isRepeating", a.identity_key AS "identityKey",
  a.desired_grade_level_code AS "desiredGradeLevelCode", a.desired_program_id AS "desiredProgramId", a.funding_type_requested AS "fundingTypeRequested",
  a.assignment_reference AS "assignmentReference", a.priority_class_code AS "priorityClassCode", a.source_channel AS "sourceChannel", a.referrer_label AS "referrerLabel",
  a.extra, a.capacity_override_reason AS "capacityOverrideReason", ${ts("a.waitlist_entered_at", "waitlistEnteredAt")}, ${ts("a.submitted_at", "submittedAt")},
  ${ts("a.decided_at", "decidedAt")}, ${ts("a.closed_at", "closedAt")}, a.student_id AS "studentId", a.enrollment_id AS "enrollmentId", a.invoice_id AS "invoiceId",
  ${ts("a.enrollment_confirmed_at", "enrollmentConfirmedAt")}, ${ts("a.enrolled_at", "enrolledAt")}, ${ts("a.anonymized_at", "anonymizedAt")},
  a.row_version AS "rowVersion", ${ts("a.updated_at", "updatedAt")},
  s.code AS "stageCode", s.label AS "stageLabel", s.canonical_status AS "stageCanonicalStatus", s.holds_seat AS "stageHoldsSeat", s.is_terminal AS "stageIsTerminal",
  s.creates_enrollment AS "stageCreatesEnrollment", s.requires_decision AS "stageRequiresDecision", s.closure_kind AS "stageClosureKind", s.sla_hours AS "stageSlaHours",
  s.notify_template_code AS "stageNotifyTemplateCode"`;

export async function getApplicationRow(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<ApplicationRow | null> {
  return tx.queryOne<ApplicationRow>(
    `SELECT ${APPLICATION_SELECT} FROM admissions.applications a JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
      WHERE a.id = $1 ${options.forUpdate ? "FOR UPDATE OF a" : ""}`,
    [id],
  );
}

export async function getApplicationByEnrollment(tx: Tx, enrollmentId: string, options: { forUpdate?: boolean } = {}): Promise<ApplicationRow | null> {
  return tx.queryOne<ApplicationRow>(
    `SELECT ${APPLICATION_SELECT} FROM admissions.applications a JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
      WHERE a.enrollment_id = $1 ${options.forUpdate ? "FOR UPDATE OF a" : ""}`,
    [enrollmentId],
  );
}

export async function getApplicationByTracking(tx: Tx, codeHash: string): Promise<ApplicationRow | null> {
  return tx.queryOne<ApplicationRow>(
    `SELECT ${APPLICATION_SELECT} FROM admissions.applications a JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
      WHERE a.tracking_code_hash = $1`,
    [codeHash],
  );
}

export async function findLiveApplicationByIdentity(tx: Tx, campaignId: string, identityKey: string): Promise<string | null> {
  const r = await tx.queryOne<{ id: string }>(`SELECT id FROM admissions.applications WHERE campaign_id = $1 AND identity_key = $2 AND status <> 'REJECTED' LIMIT 1`, [campaignId, identityKey]);
  return r?.id ?? null;
}

export async function nextApplicationSequence(tx: Tx, campaignId: string): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT admissions.next_number($1)::text AS n`, [`app:${campaignId}`]);
  return Number(r?.n ?? 0);
}

export interface ApplicationInsert {
  readonly id: string;
  readonly tenantId: string;
  readonly institutionId: string;
  readonly campaignId: string;
  readonly workflowId: string;
  readonly stageId: string;
  readonly applicationNumber: string;
  readonly createdVia: string;
  readonly prospectId: string | null;
  readonly applicantFirstName: string;
  readonly applicantLastName: string;
  readonly applicantBirthDate: string;
  readonly applicantBirthPlace: string | null;
  readonly applicantGender: string | null;
  readonly applicantNationality: string | null;
  readonly previousSchool: string | null;
  readonly previousGradeLevelCode: string | null;
  readonly isRepeating: boolean;
  readonly desiredGradeLevelCode: string;
  readonly desiredProgramId: string | null;
  readonly fundingTypeRequested: string;
  readonly assignmentReference: string | null;
  readonly priorityClassCode: string | null;
  readonly sourceChannel: string;
  readonly referrerLabel: string | null;
  readonly trackingCodeHash: string | null;
  readonly extra: Record<string, unknown>;
  readonly createdBy: string | null;
}

export async function insertApplication(tx: Tx, a: ApplicationInsert): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.applications (id, tenant_id, institution_id, campaign_id, workflow_id, stage_id, application_number, created_via, prospect_id,
       applicant_first_name, applicant_last_name, applicant_birth_date, applicant_birth_place, applicant_gender, applicant_nationality, previous_school,
       previous_grade_level_code, is_repeating, desired_grade_level_code, desired_program_id, funding_type_requested, assignment_reference, priority_class_code,
       source_channel, referrer_label, tracking_code_hash, extra, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, $28)`,
    [a.id, a.tenantId, a.institutionId, a.campaignId, a.workflowId, a.stageId, a.applicationNumber, a.createdVia, a.prospectId, a.applicantFirstName, a.applicantLastName, a.applicantBirthDate, a.applicantBirthPlace, a.applicantGender, a.applicantNationality, a.previousSchool, a.previousGradeLevelCode, a.isRepeating, a.desiredGradeLevelCode, a.desiredProgramId, a.fundingTypeRequested, a.assignmentReference, a.priorityClassCode, a.sourceChannel, a.referrerLabel, a.trackingCodeHash, JSON.stringify(a.extra), a.createdBy],
  );
}

const APPLICATION_COLUMNS: Readonly<Record<string, string>> = {
  applicantFirstName: "applicant_first_name",
  applicantLastName: "applicant_last_name",
  applicantBirthDate: "applicant_birth_date",
  applicantBirthPlace: "applicant_birth_place",
  applicantGender: "applicant_gender",
  applicantNationality: "applicant_nationality",
  previousSchool: "previous_school",
  previousGradeLevelCode: "previous_grade_level_code",
  isRepeating: "is_repeating",
  desiredGradeLevelCode: "desired_grade_level_code",
  desiredProgramId: "desired_program_id",
  fundingTypeRequested: "funding_type_requested",
  assignmentReference: "assignment_reference",
  priorityClassCode: "priority_class_code",
  sourceChannel: "source_channel",
  referrerLabel: "referrer_label",
};

export async function updateApplicationFields(tx: Tx, id: string, patch: Record<string, unknown>): Promise<void> {
  const built = buildSet(patch, APPLICATION_COLUMNS, 2);
  if (!built) return;
  await tx.query(`UPDATE admissions.applications SET ${built.set} WHERE id = $1`, [id, ...built.params]);
}

/** Changement d'étape : le déclencheur `applications_guard` valide la transition et dérive le statut. */
export async function moveApplicationStage(tx: Tx, id: string, stageId: string, extra: { capacityOverrideReason?: string | null } = {}): Promise<void> {
  await tx.query(`UPDATE admissions.applications SET stage_id = $2, capacity_override_reason = coalesce($3, capacity_override_reason) WHERE id = $1`, [id, stageId, extra.capacityOverrideReason ?? null]);
}

export async function setEnrollmentRefs(tx: Tx, id: string, refs: { studentId: string; enrollmentId: string; invoiceId: string | null }): Promise<void> {
  await tx.query(`UPDATE admissions.applications SET student_id = $2, enrollment_id = $3, invoice_id = $4 WHERE id = $1`, [id, refs.studentId, refs.enrollmentId, refs.invoiceId]);
}

export async function setEnrollmentConfirmed(tx: Tx, id: string, at: string): Promise<void> {
  await tx.query(`UPDATE admissions.applications SET enrollment_confirmed_at = $2::timestamptz WHERE id = $1`, [id, at]);
}

export async function setTrackingHash(tx: Tx, id: string, hash: string): Promise<void> {
  await tx.query(`UPDATE admissions.applications SET tracking_code_hash = $2 WHERE id = $1`, [id, hash]);
}

// ---------------------------------------------------------------------------
// Liste, tableau (kanban), recherche
// ---------------------------------------------------------------------------

const SUMMARY_SELECT = `a.id, a.application_number AS "applicationNumber", a.campaign_id AS "campaignId", a.stage_id AS "stageId", s.code AS "stageCode", s.label AS "stageLabel", a.status,
  a.applicant_first_name AS "applicantFirstName", a.applicant_last_name AS "applicantLastName", a.desired_grade_level_code AS "desiredGradeLevelCode",
  a.funding_type_requested AS "fundingTypeRequested", a.priority_class_code AS "priorityClassCode", a.source_channel AS "sourceChannel", a.created_via AS "createdVia",
  ${ts("a.submitted_at", "submittedAt")}, ${ts("a.updated_at", "updatedAt")}, ${ts("se.at", "stageEnteredAt")}, s.sla_hours AS "slaHours",
  (s.sla_hours IS NOT NULL AND NOT s.is_terminal AND se.at IS NOT NULL AND se.at + (s.sla_hours * interval '1 hour') < $1::timestamptz) AS overdue,
  (a.anonymized_at IS NOT NULL) AS anonymized`;

const SUMMARY_FROM = `admissions.applications a
  JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
  LEFT JOIN LATERAL (SELECT max(t.occurred_at) AS at FROM admissions.transitions t WHERE t.tenant_id = a.tenant_id AND t.application_id = a.id AND t.to_stage_id = a.stage_id) se ON true`;

export interface ApplicationFilter {
  readonly campaignId?: string | undefined;
  readonly status?: string | undefined;
  readonly stage?: string | undefined;
  readonly grade?: string | undefined;
  readonly q?: string | undefined;
  readonly overdue?: boolean | undefined;
  readonly institutionId?: string | undefined;
}

function filterSql(filter: ApplicationFilter, params: unknown[]): string {
  const where: string[] = ["true"];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.institutionId) add("a.institution_id = ?", filter.institutionId);
  if (filter.campaignId) add("a.campaign_id = ?", filter.campaignId);
  if (filter.status) add("a.status = ?", filter.status);
  if (filter.stage) add("s.code = ?", filter.stage);
  if (filter.grade) add("a.desired_grade_level_code = ?", filter.grade);
  if (filter.q) {
    params.push(likePattern(filter.q));
    const p = `$${params.length}`;
    where.push(`(a.application_number ILIKE ${p} OR a.applicant_first_name || ' ' || a.applicant_last_name ILIKE ${p} OR a.applicant_last_name || ' ' || a.applicant_first_name ILIKE ${p})`);
  }
  if (filter.overdue) where.push(`(s.sla_hours IS NOT NULL AND NOT s.is_terminal AND se.at IS NOT NULL AND se.at + (s.sla_hours * interval '1 hour') < $1::timestamptz)`);
  return where.join(" AND ");
}

export async function listApplicationSummaries(tx: Tx, input: { now: string; filter: ApplicationFilter; limit: number; offset: number }): Promise<{ items: AdmissionsApplicationSummaryDto[]; total: number }> {
  const params: unknown[] = [input.now];
  const where = filterSql(input.filter, params);
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM ${SUMMARY_FROM} WHERE ${where}`, params);
  const items = await tx.many<AdmissionsApplicationSummaryDto>(
    `SELECT ${SUMMARY_SELECT} FROM ${SUMMARY_FROM} WHERE ${where} ORDER BY a.updated_at DESC, a.id LIMIT ${Number(input.limit)} OFFSET ${Number(input.offset)}`,
    params,
  );
  return { items, total: total?.n ?? 0 };
}

export async function getApplicationSummary(tx: Tx, id: string, now: string): Promise<AdmissionsApplicationSummaryDto | null> {
  return tx.queryOne<AdmissionsApplicationSummaryDto>(`SELECT ${SUMMARY_SELECT} FROM ${SUMMARY_FROM} WHERE a.id = $2`, [now, id]);
}

export async function boardCards(tx: Tx, input: { now: string; campaignId: string; grade?: string | undefined; perStage: number }): Promise<AdmissionsApplicationSummaryDto[]> {
  const params: unknown[] = [input.now, input.campaignId, input.perStage];
  let gradeSql = "";
  if (input.grade) {
    params.push(input.grade);
    gradeSql = `AND a.desired_grade_level_code = $${params.length}`;
  }
  return tx.many<AdmissionsApplicationSummaryDto>(
    `SELECT * FROM (
       SELECT ${SUMMARY_SELECT}, row_number() OVER (PARTITION BY a.stage_id ORDER BY a.updated_at DESC, a.id) AS rn
         FROM ${SUMMARY_FROM} WHERE a.campaign_id = $2 ${gradeSql}) ranked
      WHERE rn <= $3 ORDER BY "updatedAt" DESC`,
    params,
  );
}

export async function boardCounts(tx: Tx, campaignId: string, grade?: string): Promise<Map<string, number>> {
  const params: unknown[] = [campaignId];
  let gradeSql = "";
  if (grade) {
    params.push(grade);
    gradeSql = "AND desired_grade_level_code = $2";
  }
  const rows = await tx.many<{ stageId: string; n: number }>(`SELECT stage_id AS "stageId", count(*)::int AS n FROM admissions.applications WHERE campaign_id = $1 ${gradeSql} GROUP BY stage_id`, params);
  return new Map(rows.map((r) => [r.stageId, r.n]));
}

export async function listBoardStages(tx: Tx, workflowId: string): Promise<AdmissionsStageDto[]> {
  return tx.many<AdmissionsStageDto>(`SELECT ${STAGE_SELECT} FROM admissions.workflow_stages s WHERE s.workflow_id = $1 ORDER BY s.ordinal`, [workflowId]);
}

// ---------------------------------------------------------------------------
// Tuteurs et consentements
// ---------------------------------------------------------------------------

const GUARDIAN_SELECT = `id, relationship_code AS "relationshipCode", first_name AS "firstName", last_name AS "lastName", phone, email, profession,
  is_primary AS "isPrimary", is_financial_responsible AS "isFinancialResponsible", can_consent AS "canConsent"`;

export async function insertGuardian(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; relationshipCode: string; firstName: string; lastName: string; phone: string | null; email: string | null; profession: string | null; isPrimary: boolean; isFinancialResponsible: boolean; canConsent: boolean },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.application_guardians (id, tenant_id, application_id, relationship_code, first_name, last_name, phone, email, profession, is_primary, is_financial_responsible, can_consent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [input.id, input.tenantId, input.applicationId, input.relationshipCode, input.firstName, input.lastName, input.phone, input.email, input.profession, input.isPrimary, input.isFinancialResponsible, input.canConsent],
  );
}

export async function listGuardians(tx: Tx, applicationId: string): Promise<AdmissionsGuardianDto[]> {
  return tx.many<AdmissionsGuardianDto>(`SELECT ${GUARDIAN_SELECT} FROM admissions.application_guardians WHERE application_id = $1 ORDER BY is_primary DESC, created_at, id`, [applicationId]);
}

export async function getGuardian(tx: Tx, applicationId: string, guardianId: string): Promise<AdmissionsGuardianDto | null> {
  return tx.queryOne<AdmissionsGuardianDto>(`SELECT ${GUARDIAN_SELECT} FROM admissions.application_guardians WHERE application_id = $1 AND id = $2`, [applicationId, guardianId]);
}

const CONSENT_SELECT = `id, guardian_id AS "guardianId", kind, text_version AS "textVersion", ${ts("given_at", "givenAt")}, given_via AS "givenVia", ${ts("withdrawn_at", "withdrawnAt")}`;

export async function insertConsent(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; guardianId: string; kind: string; textVersion: string; givenVia: string; evidenceRef: string | null; ipHash: string | null; uaHash: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.consents (id, tenant_id, application_id, guardian_id, kind, text_version, given_via, evidence_ref, ip_hash, ua_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [input.id, input.tenantId, input.applicationId, input.guardianId, input.kind, input.textVersion, input.givenVia, input.evidenceRef, input.ipHash, input.uaHash],
  );
}

export async function listConsents(tx: Tx, applicationId: string): Promise<AdmissionsConsentDto[]> {
  return tx.many<AdmissionsConsentDto>(`SELECT ${CONSENT_SELECT} FROM admissions.consents WHERE application_id = $1 ORDER BY given_at, id`, [applicationId]);
}

export async function withdrawConsent(tx: Tx, applicationId: string, consentId: string, reason: string): Promise<boolean> {
  const r = await tx.query(`UPDATE admissions.consents SET withdrawn_at = now(), withdrawn_reason = $3 WHERE application_id = $1 AND id = $2 AND withdrawn_at IS NULL`, [applicationId, consentId, reason]);
  return r.rowCount > 0;
}

export async function hasValidConsent(tx: Tx, applicationId: string): Promise<boolean> {
  const r = await tx.queryOne<{ ok: boolean }>(`SELECT admissions.has_valid_consent($1) AS ok`, [applicationId]);
  return r?.ok === true;
}

// ---------------------------------------------------------------------------
// Transitions autorisées depuis l'étape courante, historique
// ---------------------------------------------------------------------------

export interface TransitionOut {
  readonly transitionId: string;
  readonly toStageId: string;
  readonly toStageCode: string;
  readonly toStageLabel: string;
  readonly toStatus: string;
  readonly permissionKey: string;
  readonly requiresReason: boolean;
  readonly requiresDecision: boolean;
  readonly createsEnrollment: boolean;
  readonly isAutomatic: boolean;
  readonly toClosureKind: string | null;
}

export async function listTransitionsFrom(tx: Tx, workflowId: string, fromStageId: string): Promise<TransitionOut[]> {
  return tx.many<TransitionOut>(
    `SELECT t.id AS "transitionId", d.id AS "toStageId", d.code AS "toStageCode", d.label AS "toStageLabel", d.canonical_status AS "toStatus",
            t.permission_key AS "permissionKey", t.requires_reason AS "requiresReason", d.requires_decision AS "requiresDecision",
            d.creates_enrollment AS "createsEnrollment", t.is_automatic AS "isAutomatic", d.closure_kind AS "toClosureKind"
       FROM admissions.workflow_transitions t JOIN admissions.workflow_stages d ON d.tenant_id = t.tenant_id AND d.id = t.to_stage_id
      WHERE t.workflow_id = $1 AND t.from_stage_id = $2 ORDER BY d.ordinal`,
    [workflowId, fromStageId],
  );
}

export async function getTransitionBetween(tx: Tx, workflowId: string, fromStageId: string, toStageId: string): Promise<TransitionOut | null> {
  const all = await listTransitionsFrom(tx, workflowId, fromStageId);
  return all.find((t) => t.toStageId === toStageId) ?? null;
}

export async function getHistory(tx: Tx, applicationId: string): Promise<AdmissionsHistoryDto> {
  const transitions = await tx.many<AdmissionsHistoryDto["transitions"][number]>(
    `SELECT t.id, t.from_stage_id AS "fromStageId", t.to_stage_id AS "toStageId", t.from_status AS "fromStatus", t.to_status AS "toStatus",
            f.label AS "fromStageLabel", d.label AS "toStageLabel", t.actor_id AS "actorId", t.actor_kind AS "actorKind", ${ts("t.occurred_at", "occurredAt")}
       FROM admissions.transitions t
       LEFT JOIN admissions.workflow_stages f ON f.tenant_id = t.tenant_id AND f.id = t.from_stage_id
       JOIN admissions.workflow_stages d ON d.tenant_id = t.tenant_id AND d.id = t.to_stage_id
      WHERE t.application_id = $1 ORDER BY t.occurred_at, t.id`,
    [applicationId],
  );
  const decisions = await tx.many<AdmissionsHistoryDto["decisions"][number]>(
    `SELECT d.id, d.kind, d.from_stage_id AS "fromStageId", d.to_stage_id AS "toStageId", d.reason_code AS "reasonCode", r.label AS "reasonLabel",
            d.reason_text AS "reasonText", d.conditions, d.override_capacity AS "overrideCapacity", d.decided_by_name AS "decidedByName", ${ts("d.decided_at", "decidedAt")}
       FROM admissions.decisions d
       LEFT JOIN admissions.applications a ON a.tenant_id = d.tenant_id AND a.id = d.application_id
       LEFT JOIN admissions.decision_reasons r ON r.tenant_id = d.tenant_id AND r.institution_id = a.institution_id AND r.code = d.reason_code
      WHERE d.application_id = $1 ORDER BY d.decided_at, d.id`,
    [applicationId],
  );
  return { transitions, decisions };
}

/** Date d'entrée dans l'étape courante (dernière transition vers elle) : délai de paiement, SLA. */
export async function stageEnteredAt(tx: Tx, applicationId: string, stageId: string): Promise<string | null> {
  const r = await tx.queryOne<{ at: string | null }>(
    `SELECT ${ts("max(occurred_at)", "at")} FROM admissions.transitions WHERE application_id = $1 AND to_stage_id = $2`,
    [applicationId, stageId],
  );
  return r?.at ?? null;
}

export async function missingRequiredDocuments(tx: Tx, applicationId: string): Promise<string[]> {
  const r = await tx.queryOne<{ codes: string[] }>(`SELECT admissions.missing_required_documents($1) AS codes`, [applicationId]);
  return r?.codes ?? [];
}
