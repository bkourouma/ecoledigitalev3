/**
 * Workflows (étapes, transitions), campagnes et capacités. Les déclencheurs SQL (`workflow_structure_guard`, `workflows_guard`,
 * `campaigns_guard`) restent l'autorité : un workflow publié est figé, la publication valide la structure.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  AdmissionsCampaignDto,
  AdmissionsCapacityDto,
  AdmissionsStageDto,
  AdmissionsTransitionDto,
  AdmissionsWorkflowDto,
  AdmissionsWorkflowSummaryDto,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { ts } from "./sql";

const WORKFLOW_SELECT = `w.id, w.institution_id AS "institutionId", w.code, w.version, w.label, w.education_level_code AS "educationLevelCode", w.status, ${ts("w.published_at", "publishedAt")}`;

export const STAGE_SELECT = `s.id, s.code, s.label, s.canonical_status AS "canonicalStatus", s.ordinal, s.is_initial AS "isInitial", s.is_terminal AS "isTerminal",
  s.holds_seat AS "holdsSeat", s.requires_consent AS "requiresConsent", s.requires_documents_complete AS "requiresDocumentsComplete",
  s.requires_interview_done AS "requiresInterviewDone", s.requires_decision AS "requiresDecision", s.creates_enrollment AS "createsEnrollment",
  s.closure_kind AS "closureKind", s.sla_hours AS "slaHours", s.notify_template_code AS "notifyTemplateCode"`;

const TRANSITION_SELECT = `t.id, t.from_stage_id AS "fromStageId", t.to_stage_id AS "toStageId", t.permission_key AS "permissionKey", t.requires_reason AS "requiresReason", t.is_automatic AS "isAutomatic"`;

export async function listWorkflows(tx: Tx, institutionId: string): Promise<AdmissionsWorkflowSummaryDto[]> {
  return tx.many<AdmissionsWorkflowSummaryDto>(
    `SELECT ${WORKFLOW_SELECT}, (SELECT count(*)::int FROM admissions.workflow_stages s WHERE s.tenant_id = w.tenant_id AND s.workflow_id = w.id) AS "stageCount"
       FROM admissions.workflows w WHERE w.institution_id = $1 ORDER BY w.code, w.version DESC`,
    [institutionId],
  );
}

export async function getWorkflowHeader(tx: Tx, workflowId: string, options: { forUpdate?: boolean } = {}): Promise<Omit<AdmissionsWorkflowDto, "stages" | "transitions"> | null> {
  return tx.queryOne(`SELECT ${WORKFLOW_SELECT} FROM admissions.workflows w WHERE w.id = $1 ${options.forUpdate ? "FOR UPDATE OF w" : ""}`, [workflowId]);
}

export async function listStages(tx: Tx, workflowId: string): Promise<AdmissionsStageDto[]> {
  return tx.many<AdmissionsStageDto>(`SELECT ${STAGE_SELECT} FROM admissions.workflow_stages s WHERE s.workflow_id = $1 ORDER BY s.ordinal`, [workflowId]);
}

export async function listTransitions(tx: Tx, workflowId: string): Promise<AdmissionsTransitionDto[]> {
  return tx.many<AdmissionsTransitionDto>(`SELECT ${TRANSITION_SELECT} FROM admissions.workflow_transitions t WHERE t.workflow_id = $1`, [workflowId]);
}

export async function getWorkflow(tx: Tx, workflowId: string): Promise<AdmissionsWorkflowDto | null> {
  const header = await getWorkflowHeader(tx, workflowId);
  if (!header) return null;
  return { ...header, stages: await listStages(tx, workflowId), transitions: await listTransitions(tx, workflowId) };
}

export async function maxVersion(tx: Tx, institutionId: string, code: string): Promise<number> {
  const r = await tx.queryOne<{ v: number | null }>(`SELECT max(version)::int AS v FROM admissions.workflows WHERE institution_id = $1 AND code = $2`, [institutionId, code]);
  return r?.v ?? 0;
}

export async function insertWorkflow(tx: Tx, input: { id: string; tenantId: string; institutionId: string; code: string; version: number; label: string; educationLevelCode: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.workflows (id, tenant_id, institution_id, code, version, label, education_level_code) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.id, input.tenantId, input.institutionId, input.code, input.version, input.label, input.educationLevelCode],
  );
}

export async function updateWorkflowHeader(tx: Tx, workflowId: string, patch: { label?: string; educationLevelCode?: string | null }): Promise<void> {
  if (patch.label !== undefined) await tx.query(`UPDATE admissions.workflows SET label = $2 WHERE id = $1`, [workflowId, patch.label]);
  if (patch.educationLevelCode !== undefined) await tx.query(`UPDATE admissions.workflows SET education_level_code = $2 WHERE id = $1`, [workflowId, patch.educationLevelCode]);
}

export async function deleteWorkflow(tx: Tx, workflowId: string): Promise<void> {
  await tx.query(`DELETE FROM admissions.workflow_transitions WHERE workflow_id = $1`, [workflowId]);
  await tx.query(`DELETE FROM admissions.workflow_stages WHERE workflow_id = $1`, [workflowId]);
  await tx.query(`DELETE FROM admissions.workflows WHERE id = $1`, [workflowId]);
}

export interface StageInsert {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly canonicalStatus: string;
  readonly ordinal: number;
  readonly isInitial: boolean;
  readonly isTerminal: boolean;
  readonly holdsSeat: boolean;
  readonly requiresConsent: boolean;
  readonly requiresDocumentsComplete: boolean;
  readonly requiresInterviewDone: boolean;
  readonly requiresDecision: boolean;
  readonly createsEnrollment: boolean;
  readonly closureKind: string | null;
  readonly slaHours: number | null;
  readonly notifyTemplateCode: string | null;
}

export async function insertStage(tx: Tx, tenantId: string, workflowId: string, s: StageInsert): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.workflow_stages (id, tenant_id, workflow_id, code, label, canonical_status, ordinal, is_initial, is_terminal, holds_seat,
       requires_consent, requires_documents_complete, requires_interview_done, requires_decision, creates_enrollment, closure_kind, sla_hours, notify_template_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [s.id, tenantId, workflowId, s.code, s.label, s.canonicalStatus, s.ordinal, s.isInitial, s.isTerminal, s.holdsSeat, s.requiresConsent, s.requiresDocumentsComplete, s.requiresInterviewDone, s.requiresDecision, s.createsEnrollment, s.closureKind, s.slaHours, s.notifyTemplateCode],
  );
}

export async function insertTransition(
  tx: Tx,
  input: { id: string; tenantId: string; workflowId: string; fromStageId: string; toStageId: string; permissionKey: string; requiresReason: boolean; isAutomatic: boolean },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.workflow_transitions (id, tenant_id, workflow_id, from_stage_id, to_stage_id, permission_key, requires_reason, is_automatic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.id, input.tenantId, input.workflowId, input.fromStageId, input.toStageId, input.permissionKey, input.requiresReason, input.isAutomatic],
  );
}

export interface TransitionByCode {
  readonly fromStage: string;
  readonly toStage: string;
  readonly permissionKey: string;
  readonly requiresReason: boolean;
  readonly isAutomatic: boolean;
}

export async function listTransitionsByCode(tx: Tx, workflowId: string): Promise<TransitionByCode[]> {
  return tx.many<TransitionByCode>(
    `SELECT f.code AS "fromStage", d.code AS "toStage", t.permission_key AS "permissionKey", t.requires_reason AS "requiresReason", t.is_automatic AS "isAutomatic"
       FROM admissions.workflow_transitions t
       JOIN admissions.workflow_stages f ON f.tenant_id = t.tenant_id AND f.id = t.from_stage_id
       JOIN admissions.workflow_stages d ON d.tenant_id = t.tenant_id AND d.id = t.to_stage_id
      WHERE t.workflow_id = $1 ORDER BY f.ordinal, d.ordinal`,
    [workflowId],
  );
}

export async function clearTransitions(tx: Tx, workflowId: string): Promise<void> {
  await tx.query(`DELETE FROM admissions.workflow_transitions WHERE workflow_id = $1`, [workflowId]);
}

export async function clearStages(tx: Tx, workflowId: string): Promise<void> {
  await tx.query(`DELETE FROM admissions.workflow_stages WHERE workflow_id = $1`, [workflowId]);
}

export async function publishWorkflowRow(tx: Tx, workflowId: string, userId: string | null): Promise<void> {
  await tx.query(`UPDATE admissions.workflows SET status = 'PUBLISHED', published_at = now(), published_by = $2 WHERE id = $1`, [workflowId, userId]);
}

/** Archive le workflow publié du même (établissement, cycle) : un seul publié à la fois. */
export async function archivePublishedOf(tx: Tx, institutionId: string, educationLevelCode: string | null, exceptId: string): Promise<string[]> {
  const rows = await tx.many<{ id: string }>(
    `UPDATE admissions.workflows SET status = 'ARCHIVED'
      WHERE institution_id = $1 AND coalesce(education_level_code, '') = coalesce($2, '') AND status = 'PUBLISHED' AND id <> $3
      RETURNING id`,
    [institutionId, educationLevelCode, exceptId],
  );
  return rows.map((r) => r.id);
}

export async function getPublishedWorkflowId(tx: Tx, institutionId: string, educationLevelCode: string | null = null): Promise<string | null> {
  const r = await tx.queryOne<{ id: string }>(
    `SELECT id FROM admissions.workflows WHERE institution_id = $1 AND status = 'PUBLISHED' AND coalesce(education_level_code, '') = coalesce($2, '') LIMIT 1`,
    [institutionId, educationLevelCode],
  );
  return r?.id ?? null;
}

/** Sérialise les publications d'un même (établissement, cycle) : verrou consultatif de la transaction. */
export async function lockPublicationScope(tx: Tx, institutionId: string, educationLevelCode: string | null): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`admissions:workflow:${institutionId}:${educationLevelCode ?? ""}`]);
}

export async function getPublishedHeader(tx: Tx, institutionId: string, educationLevelCode: string | null): Promise<{ id: string; code: string; version: number } | null> {
  return tx.queryOne(
    `SELECT id, code, version FROM admissions.workflows WHERE institution_id = $1 AND status = 'PUBLISHED' AND coalesce(education_level_code, '') = coalesce($2, '') LIMIT 1`,
    [institutionId, educationLevelCode],
  );
}

export async function countCampaignsUsingWorkflow(tx: Tx, workflowId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admissions.campaigns WHERE workflow_id = $1`, [workflowId]);
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Campagnes et capacités
// ---------------------------------------------------------------------------

const CAMPAIGN_SELECT = `c.id, c.institution_id AS "institutionId", c.academic_year_id AS "academicYearId", c.code, c.label, c.workflow_id AS "workflowId",
  ${ts("c.opens_at", "opensAt")}, ${ts("c.closes_at", "closesAt")}, c.status`;

type CampaignRow = Omit<AdmissionsCampaignDto, "capacities">;

export async function listCampaignRows(tx: Tx, institutionId: string, status?: string): Promise<CampaignRow[]> {
  return tx.many<CampaignRow>(
    `SELECT ${CAMPAIGN_SELECT} FROM admissions.campaigns c WHERE c.institution_id = $1 ${status ? "AND c.status = $2" : ""} ORDER BY c.opens_at DESC, c.code`,
    status ? [institutionId, status] : [institutionId],
  );
}

/** Campagne OUVERTE d'un établissement dans sa fenêtre (la plus récente) : celle du formulaire public. */
export async function findOpenCampaign(tx: Tx, institutionId: string, now: string): Promise<CampaignRow | null> {
  return tx.queryOne<CampaignRow>(
    `SELECT ${CAMPAIGN_SELECT} FROM admissions.campaigns c WHERE c.institution_id = $1 AND c.status = 'OPEN' AND c.opens_at <= $2::timestamptz AND c.closes_at >= $2::timestamptz ORDER BY c.opens_at DESC, c.id LIMIT 1`,
    [institutionId, now],
  );
}

export async function getCampaignRow(tx: Tx, campaignId: string, options: { forUpdate?: boolean } = {}): Promise<CampaignRow | null> {
  return tx.queryOne<CampaignRow>(`SELECT ${CAMPAIGN_SELECT} FROM admissions.campaigns c WHERE c.id = $1 ${options.forUpdate ? "FOR UPDATE OF c" : ""}`, [campaignId]);
}

export async function listCapacities(tx: Tx, campaignId: string): Promise<AdmissionsCapacityDto[]> {
  return tx.many<AdmissionsCapacityDto>(
    `SELECT c.id, c.grade_level_code AS "gradeLevelCode", c.program_id AS "programId", c.seats, c.waitlist_limit AS "waitlistLimit",
            (c.seats - (SELECT count(*)::int FROM admissions.applications a JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
                         WHERE a.tenant_id = c.tenant_id AND a.campaign_id = c.campaign_id AND a.desired_grade_level_code = c.grade_level_code
                           AND (c.program_id IS NULL OR a.desired_program_id IS NOT DISTINCT FROM c.program_id) AND s.holds_seat))::int AS "seatsLeft",
            (SELECT count(*)::int FROM admissions.applications a WHERE a.tenant_id = c.tenant_id AND a.campaign_id = c.campaign_id
                AND a.desired_grade_level_code = c.grade_level_code AND (c.program_id IS NULL OR a.desired_program_id IS NOT DISTINCT FROM c.program_id)
                AND a.status = 'WAITLISTED') AS "waitlistCount"
       FROM admissions.intake_capacities c WHERE c.campaign_id = $1 ORDER BY c.grade_level_code, c.program_id NULLS FIRST`,
    [campaignId],
  );
}

export async function insertCampaign(
  tx: Tx,
  input: { id: string; tenantId: string; institutionId: string; academicYearId: string; code: string; label: string; workflowId: string; opensAt: string; closesAt: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.campaigns (id, tenant_id, institution_id, academic_year_id, code, label, workflow_id, opens_at, closes_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.id, input.tenantId, input.institutionId, input.academicYearId, input.code, input.label, input.workflowId, input.opensAt, input.closesAt],
  );
}

export async function updateCampaignRow(tx: Tx, campaignId: string, patch: { label?: string; workflowId?: string; opensAt?: string; closesAt?: string }): Promise<void> {
  await tx.query(
    `UPDATE admissions.campaigns SET label = coalesce($2, label), workflow_id = coalesce($3, workflow_id), opens_at = coalesce($4, opens_at), closes_at = coalesce($5, closes_at) WHERE id = $1`,
    [campaignId, patch.label ?? null, patch.workflowId ?? null, patch.opensAt ?? null, patch.closesAt ?? null],
  );
}

export async function setCampaignStatus(tx: Tx, campaignId: string, status: string): Promise<void> {
  await tx.query(`UPDATE admissions.campaigns SET status = $2 WHERE id = $1`, [campaignId, status]);
}

/** Les capacités ne se suppriment pas (aucun `DELETE` accordé) : une ligne se met à jour ; l'absence de ligne = pas de plafond. */
export async function upsertCapacity(
  tx: Tx,
  input: { id: string; tenantId: string; campaignId: string; gradeLevelCode: string; programId: string | null; seats: number; waitlistLimit: number | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.intake_capacities (id, tenant_id, campaign_id, grade_level_code, program_id, seats, waitlist_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, campaign_id, grade_level_code, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET seats = EXCLUDED.seats, waitlist_limit = EXCLUDED.waitlist_limit, updated_at = now()`,
    [input.id, input.tenantId, input.campaignId, input.gradeLevelCode, input.programId, input.seats, input.waitlistLimit],
  );
}

/** Verrouille la ligne de capacité d'un niveau (sérialise les concurrents sur la dernière place) ; `null` si aucun plafond. */
export async function seatsLeft(tx: Tx, campaignId: string, grade: string, programId: string | null): Promise<number | null> {
  const r = await tx.queryOne<{ n: number | null }>(`SELECT admissions.seats_left($1, $2, $3) AS n`, [campaignId, grade, programId]);
  return r?.n ?? null;
}

export async function getCapacityLimit(tx: Tx, campaignId: string, grade: string, programId: string | null): Promise<{ seats: number; waitlistLimit: number | null } | null> {
  return tx.queryOne(
    `SELECT seats, waitlist_limit AS "waitlistLimit" FROM admissions.intake_capacities
      WHERE campaign_id = $1 AND grade_level_code = $2 AND (program_id IS NOT DISTINCT FROM $3 OR program_id IS NULL)
      ORDER BY (program_id IS NULL) ASC LIMIT 1`,
    [campaignId, grade, programId],
  );
}
