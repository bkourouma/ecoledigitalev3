/**
 * Colonnes SQL et mappeurs ligne -> domaine. Les dates calendaires sont lues en TEXTE (`::text`) pour qu'aucun fuseau
 * du processus ne décale un jour ; les `numeric` arrivent en chaîne (moyennes conservées EXACTES) ; les crédits
 * (`numeric(8,2)`) sont convertis en nombre à deux décimales.
 */
import { parseCredits } from "../domain/credits";
import type {
  AcquiredVia,
  AwardStatus,
  AwardedVia,
  DiplomaAward,
  DiplomaDefinition,
  DiplomaRequirement,
  DiplomaStatus,
  DocumentKind,
  DocumentSlot,
  DocumentStatus,
  LedgerEntry,
  LedgerStatus,
  OfficialDocument,
  Prerequisite,
  PrerequisiteMode,
  RequirementsSnapshot,
  ResitRegistration,
  ResitWindow,
  SlotKey,
  SnapshotSchema,
  UeDebt,
  Uuid,
} from "../domain/types";

// --- registre de crédits ------------------------------------------------------------------------------------------
export const LEDGER_COLUMNS = `id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, credits::text AS credits,
  average_exact::text AS average_exact, acquired_via, session_obtained, status, compensated_ecue_count, override_id, source_result_id,
  source_results_version, valid_until::text AS valid_until, acquired_at, revoked_at, revoke_reason, expired_at, tenant_id`;

export interface LedgerRow {
  id: Uuid; tenant_id: Uuid; student_id: Uuid; enrollment_id: Uuid; ue_node_id: Uuid; academic_year_id: Uuid; academic_period_id: Uuid;
  credits: string; average_exact: string | null; acquired_via: AcquiredVia; session_obtained: number; status: LedgerStatus;
  compensated_ecue_count: number; override_id: Uuid | null; source_result_id: Uuid; source_results_version: number;
  valid_until: string | null; acquired_at: Date; revoked_at: Date | null; revoke_reason: string | null; expired_at: Date | null;
}

export const toLedgerEntry = (r: LedgerRow): LedgerEntry => ({
  id: r.id, tenantId: r.tenant_id, studentId: r.student_id, enrollmentId: r.enrollment_id, ueNodeId: r.ue_node_id,
  academicYearId: r.academic_year_id, academicPeriodId: r.academic_period_id, credits: parseCredits(r.credits), averageExact: r.average_exact,
  acquiredVia: r.acquired_via, sessionObtained: r.session_obtained === 2 ? 2 : 1, status: r.status, compensatedEcueCount: r.compensated_ecue_count,
  overrideId: r.override_id, sourceResultId: r.source_result_id, sourceResultsVersion: r.source_results_version, validUntil: r.valid_until,
  acquiredAt: r.acquired_at, revokedAt: r.revoked_at, revokeReason: r.revoke_reason, expiredAt: r.expired_at,
});

export const DEBT_COLUMNS = `id, student_id, enrollment_id, ue_node_id, academic_year_id, academic_period_id, status, detected_at, cleared_at`;
export interface DebtRow {
  id: Uuid; student_id: Uuid; enrollment_id: Uuid; ue_node_id: Uuid; academic_year_id: Uuid; academic_period_id: Uuid;
  status: "OPEN" | "CLEARED"; detected_at: Date; cleared_at: Date | null;
}
export const toDebt = (r: DebtRow): UeDebt => ({
  id: r.id, studentId: r.student_id, enrollmentId: r.enrollment_id, ueNodeId: r.ue_node_id, academicYearId: r.academic_year_id,
  academicPeriodId: r.academic_period_id, status: r.status, detectedAt: r.detected_at, clearedAt: r.cleared_at,
});

// --- prérequis ----------------------------------------------------------------------------------------------------
export const PREREQUISITE_COLUMNS = `id, ue_node_id, prerequisite_node_id, mode, min_average::text AS min_average`;
export interface PrerequisiteRow { id: Uuid; ue_node_id: Uuid; prerequisite_node_id: Uuid; mode: PrerequisiteMode; min_average: string | null }
export const toPrerequisite = (r: PrerequisiteRow): Prerequisite => ({
  id: r.id, ueNodeId: r.ue_node_id, prerequisiteNodeId: r.prerequisite_node_id, mode: r.mode, minAverage: r.min_average,
});

// --- rattrapage ---------------------------------------------------------------------------------------------------
export const WINDOW_COLUMNS = `id, classroom_id, academic_period_id, results_state_id, opens_on::text AS opens_on, closes_on::text AS closes_on,
  node_ids, status, opened_by, opened_at, closed_by, closed_at`;
export interface WindowRow {
  id: Uuid; classroom_id: Uuid; academic_period_id: Uuid; results_state_id: Uuid | null; opens_on: string; closes_on: string;
  node_ids: Uuid[] | null; status: ResitWindow["status"]; opened_by: Uuid; opened_at: Date; closed_by: Uuid | null; closed_at: Date | null;
}
export const toWindow = (r: WindowRow): ResitWindow => ({
  id: r.id, classroomId: r.classroom_id, academicPeriodId: r.academic_period_id, resultsStateId: r.results_state_id, opensOn: r.opens_on,
  closesOn: r.closes_on, nodeIds: r.node_ids, status: r.status, openedBy: r.opened_by, openedAt: r.opened_at, closedBy: r.closed_by, closedAt: r.closed_at,
});

export const REGISTRATION_COLUMNS = `id, window_id, enrollment_id, student_id, academic_period_id, ecue_node_id, ue_node_id,
  session1_average::text AS session1_average, status, outcome`;
export interface RegistrationRow {
  id: Uuid; window_id: Uuid; enrollment_id: Uuid; student_id: Uuid; academic_period_id: Uuid; ecue_node_id: Uuid; ue_node_id: Uuid;
  session1_average: string | null; status: ResitRegistration["status"]; outcome: ResitRegistration["outcome"];
}
export const toRegistration = (r: RegistrationRow): ResitRegistration => ({
  id: r.id, windowId: r.window_id, enrollmentId: r.enrollment_id, studentId: r.student_id, academicPeriodId: r.academic_period_id,
  ecueNodeId: r.ecue_node_id, ueNodeId: r.ue_node_id, session1Average: r.session1_average, status: r.status, outcome: r.outcome,
});

// --- diplômes -----------------------------------------------------------------------------------------------------
export const DEFINITION_COLUMNS = `id, institution_id, code, label, grade_code, curriculum_node_id, uv_required::text AS uv_required, auto_award, status,
  description, last_synced_at, created_at, updated_at`;
export interface DefinitionRow {
  id: Uuid; institution_id: Uuid | null; code: string; label: string; grade_code: string; curriculum_node_id: Uuid; uv_required: string;
  auto_award: boolean; status: DiplomaStatus; description: string | null; last_synced_at: Date | null; created_at: Date; updated_at: Date;
}
export const toDefinition = (r: DefinitionRow): DiplomaDefinition => ({
  id: r.id, institutionId: r.institution_id, code: r.code, label: r.label, gradeCode: r.grade_code, curriculumNodeId: r.curriculum_node_id,
  uvRequired: parseCredits(r.uv_required), autoAward: r.auto_award, status: r.status, description: r.description, lastSyncedAt: r.last_synced_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export const REQUIREMENT_COLUMNS = `id, definition_id, ue_node_id, ue_code, ue_label, credits::text AS credits, mandatory, position, removed_from_curriculum`;
export interface RequirementRow {
  id: Uuid; definition_id: Uuid; ue_node_id: Uuid; ue_code: string | null; ue_label: string | null; credits: string; mandatory: boolean;
  position: number; removed_from_curriculum: boolean;
}
export const toRequirement = (r: RequirementRow): DiplomaRequirement => ({
  id: r.id, definitionId: r.definition_id, ueNodeId: r.ue_node_id, ueCode: r.ue_code, ueLabel: r.ue_label, credits: parseCredits(r.credits),
  mandatory: r.mandatory, position: r.position, removedFromCurriculum: r.removed_from_curriculum,
});

export const AWARD_COLUMNS = `id, definition_id, student_id, last_enrollment_id, academic_year_id, reference, reference_year, reference_seq::text AS reference_seq,
  status, awarded_via, forced_reason, credits_total::text AS credits_total, requirements_snapshot, eligibility, cycle_average::text AS cycle_average,
  mention_code, rule_set_code, rule_version_id, rule_version_no, definition_hash, awarded_at, awarded_by, awarded_by_name,
  acquired_date::text AS acquired_date, revoked_at, revoked_by, revoked_by_name, revoke_reason, predecessor_award_id, reaward_decision`;
export interface AwardRow {
  id: Uuid; definition_id: Uuid; student_id: Uuid; last_enrollment_id: Uuid | null; academic_year_id: Uuid | null; reference: string; reference_year: number;
  reference_seq: string; status: AwardStatus; awarded_via: AwardedVia; forced_reason: string | null; credits_total: string;
  requirements_snapshot: RequirementsSnapshot; eligibility: Record<string, unknown>; cycle_average: string | null; mention_code: string | null;
  rule_set_code: string; rule_version_id: Uuid; rule_version_no: number; definition_hash: string; awarded_at: Date; awarded_by: Uuid | null;
  awarded_by_name: string; acquired_date: string | null; revoked_at: Date | null; revoked_by: Uuid | null; revoked_by_name: string | null;
  revoke_reason: string | null; predecessor_award_id: Uuid | null; reaward_decision: string | null;
}
export const toAward = (r: AwardRow): DiplomaAward => ({
  id: r.id, definitionId: r.definition_id, studentId: r.student_id, lastEnrollmentId: r.last_enrollment_id, academicYearId: r.academic_year_id,
  reference: r.reference, referenceYear: r.reference_year, referenceSeq: Number(r.reference_seq), status: r.status, awardedVia: r.awarded_via,
  forcedReason: r.forced_reason, creditsTotal: parseCredits(r.credits_total), requirementsSnapshot: r.requirements_snapshot, eligibility: r.eligibility,
  cycleAverage: r.cycle_average, mentionCode: r.mention_code, ruleSetCode: r.rule_set_code, ruleVersionId: r.rule_version_id,
  ruleVersionNo: r.rule_version_no, definitionHash: r.definition_hash, awardedAt: r.awarded_at, awardedBy: r.awarded_by,
  awardedByName: r.awarded_by_name, acquiredDate: r.acquired_date, revokedAt: r.revoked_at, revokedBy: r.revoked_by, revokedByName: r.revoked_by_name,
  revokeReason: r.revoke_reason, predecessorAwardId: r.predecessor_award_id, reawardDecision: r.reaward_decision,
});

// --- documents ----------------------------------------------------------------------------------------------------
export const DOCUMENT_COLUMNS = `id, document_kind, award_id, student_id, program_node_id, reference, reference_year, reference_seq::text AS reference_seq,
  version, supersedes_id, status, snapshot_schema, snapshot, snapshot_hash, verification_code, signing_key_id, signature, template_key,
  render_status, object_key, pdf_hash, issued_at, issued_by, issued_by_name, published_at, revoked_at, revoke_reason`;
export interface DocumentRow {
  id: Uuid; document_kind: DocumentKind; award_id: Uuid | null; student_id: Uuid; program_node_id: Uuid | null; reference: string;
  reference_year: number; reference_seq: string; version: number; supersedes_id: Uuid | null; status: DocumentStatus; snapshot_schema: SnapshotSchema;
  snapshot: Record<string, unknown>; snapshot_hash: string; verification_code: string; signing_key_id: string | null; signature: string | null;
  template_key: string | null; render_status: OfficialDocument["renderStatus"]; object_key: string | null; pdf_hash: string | null; issued_at: Date; issued_by: Uuid;
  issued_by_name: string; published_at: Date | null; revoked_at: Date | null; revoke_reason: string | null;
}
export const toDocument = (r: DocumentRow): OfficialDocument => ({
  id: r.id, documentKind: r.document_kind, awardId: r.award_id, studentId: r.student_id, programNodeId: r.program_node_id, reference: r.reference,
  referenceYear: r.reference_year, referenceSeq: Number(r.reference_seq), version: r.version, supersedesId: r.supersedes_id, status: r.status,
  snapshotSchema: r.snapshot_schema, snapshot: r.snapshot, snapshotHash: r.snapshot_hash, verificationCode: r.verification_code,
  signingKeyId: r.signing_key_id, signature: r.signature, templateKey: r.template_key, renderStatus: r.render_status, objectKey: r.object_key, pdfHash: r.pdf_hash,
  issuedAt: r.issued_at, issuedBy: r.issued_by, issuedByName: r.issued_by_name, publishedAt: r.published_at, revokedAt: r.revoked_at, revokeReason: r.revoke_reason,
});

export const SLOT_COLUMNS = `id, slot_key, signatory_id, valid_from::text AS valid_from, valid_to::text AS valid_to, created_by, created_at`;
export interface SlotRow { id: Uuid; slot_key: SlotKey; signatory_id: Uuid; valid_from: string; valid_to: string | null; created_by: Uuid; created_at: Date }
export const toSlot = (r: SlotRow): DocumentSlot => ({
  id: r.id, slotKey: r.slot_key, signatoryId: r.signatory_id, validFrom: r.valid_from, validTo: r.valid_to, createdBy: r.created_by, createdAt: r.created_at,
});

// --- pagination par curseur ----------------------------------------------------------------------------------------
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
export function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
