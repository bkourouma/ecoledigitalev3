/**
 * Éléments d'un dossier : pièces, entretiens, offres, décisions (ajout seul), doublons, journal de notifications.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  AdmissionsApplicationDocumentDto,
  AdmissionsDuplicateDto,
  AdmissionsInterviewDto,
  AdmissionsOfferDto,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { buildSet, ts } from "./sql";

// ---------------------------------------------------------------------------
// Pièces
// ---------------------------------------------------------------------------

/** Pièces EXIGÉES applicables au dossier (établissement, niveau, financement) avec l'état de leur dépôt. */
export async function listApplicationDocuments(tx: Tx, applicationId: string): Promise<AdmissionsApplicationDocumentDto[]> {
  return tx.many<AdmissionsApplicationDocumentDto>(
    `SELECT r.id AS "requirementId", r.code AS "requirementCode", r.label AS "requirementLabel", r.required,
            (r.active AND (r.grade_level_code IS NULL OR r.grade_level_code = a.desired_grade_level_code)
                      AND (r.applies_to_funding IS NULL OR r.applies_to_funding = a.funding_type_requested)) AS applicable,
            coalesce(d.status, 'MISSING') AS status, d.content_type AS "contentType", d.size_bytes::int AS "sizeBytes", coalesce(d.attempts, 0) AS attempts,
            d.rejection_reason AS "rejectionReason", ${ts("d.submitted_at", "submittedAt")}, ${ts("d.reviewed_at", "reviewedAt")}
       FROM admissions.applications a
       JOIN admissions.document_requirements r ON r.tenant_id = a.tenant_id AND r.institution_id = a.institution_id
       LEFT JOIN admissions.application_documents d ON d.tenant_id = a.tenant_id AND d.application_id = a.id AND d.requirement_id = r.id
      WHERE a.id = $1
        AND ((r.active AND (r.grade_level_code IS NULL OR r.grade_level_code = a.desired_grade_level_code)
              AND (r.applies_to_funding IS NULL OR r.applies_to_funding = a.funding_type_requested)) OR d.id IS NOT NULL)
      ORDER BY r.sort_order, r.code`,
    [applicationId],
  );
}

export interface DocumentRow {
  readonly id: string;
  readonly requirementId: string;
  readonly status: string;
  readonly documentRef: string | null;
  readonly storageKey: string | null;
  readonly contentType: string | null;
  readonly attempts: number;
}

export async function getDocumentRow(tx: Tx, applicationId: string, requirementId: string): Promise<DocumentRow | null> {
  return tx.queryOne<DocumentRow>(
    `SELECT id, requirement_id AS "requirementId", status, document_ref AS "documentRef", storage_key AS "storageKey", content_type AS "contentType", attempts
       FROM admissions.application_documents WHERE application_id = $1 AND requirement_id = $2`,
    [applicationId, requirementId],
  );
}

export async function listDocumentFiles(tx: Tx, applicationId: string): Promise<Array<{ requirementId: string; storageKey: string | null; documentRef: string | null; contentType: string | null }>> {
  return tx.many(
    `SELECT requirement_id AS "requirementId", storage_key AS "storageKey", document_ref AS "documentRef", content_type AS "contentType"
       FROM admissions.application_documents WHERE application_id = $1 AND (storage_key IS NOT NULL OR document_ref IS NOT NULL)`,
    [applicationId],
  );
}

export async function upsertSubmittedDocument(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; requirementId: string; documentRef: string | null; storageKey: string; contentType: string; sizeBytes: number; sha256: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.application_documents (id, tenant_id, application_id, requirement_id, status, document_ref, storage_key, content_type, size_bytes, sha256, attempts, submitted_at)
     VALUES ($1, $2, $3, $4, 'SUBMITTED', $5, $6, $7, $8, $9, 1, now())
     ON CONFLICT (tenant_id, application_id, requirement_id) DO UPDATE SET status = 'SUBMITTED', document_ref = EXCLUDED.document_ref, storage_key = EXCLUDED.storage_key,
       content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256, attempts = admissions.application_documents.attempts + 1,
       rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, submitted_at = now(), updated_at = now()`,
    [input.id, input.tenantId, input.applicationId, input.requirementId, input.documentRef, input.storageKey, input.contentType, input.sizeBytes, input.sha256],
  );
}

export async function reviewDocument(tx: Tx, applicationId: string, requirementId: string, input: { status: "ACCEPTED" | "REJECTED"; reason: string | null; reviewerId: string }): Promise<boolean> {
  const r = await tx.query(
    `UPDATE admissions.application_documents SET status = $3, rejection_reason = $4, reviewed_by = $5, reviewed_at = now(), updated_at = now()
      WHERE application_id = $1 AND requirement_id = $2 AND status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED')`,
    [applicationId, requirementId, input.status, input.reason, input.reviewerId],
  );
  return r.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Entretiens et tests
// ---------------------------------------------------------------------------

const INTERVIEW_SELECT = `id, kind, ${ts("scheduled_at", "scheduledAt")}, venue, status, conducted_by_staff_id AS "conductedByStaffId", score::text AS score,
  scale_max::text AS "scaleMax", result_code AS "resultCode", notes`;

export async function insertInterview(tx: Tx, input: { id: string; tenantId: string; applicationId: string; kind: string; scheduledAt: string; venue: string | null; conductedByStaffId: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.interviews (id, tenant_id, application_id, kind, scheduled_at, venue, conducted_by_staff_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.id, input.tenantId, input.applicationId, input.kind, input.scheduledAt, input.venue, input.conductedByStaffId],
  );
}

export async function listInterviews(tx: Tx, applicationId: string): Promise<AdmissionsInterviewDto[]> {
  return tx.many<AdmissionsInterviewDto>(`SELECT ${INTERVIEW_SELECT} FROM admissions.interviews WHERE application_id = $1 ORDER BY scheduled_at, id`, [applicationId]);
}

export async function getInterview(tx: Tx, applicationId: string, interviewId: string): Promise<AdmissionsInterviewDto | null> {
  return tx.queryOne<AdmissionsInterviewDto>(`SELECT ${INTERVIEW_SELECT} FROM admissions.interviews WHERE application_id = $1 AND id = $2`, [applicationId, interviewId]);
}

const INTERVIEW_COLUMNS: Readonly<Record<string, string>> = {
  scheduledAt: "scheduled_at",
  venue: "venue",
  conductedByStaffId: "conducted_by_staff_id",
  status: "status",
  score: "score",
  scaleMax: "scale_max",
  resultCode: "result_code",
  notes: "notes",
};

export async function updateInterview(tx: Tx, applicationId: string, interviewId: string, patch: Record<string, unknown>): Promise<void> {
  const built = buildSet(patch, INTERVIEW_COLUMNS, 3);
  if (!built) return;
  await tx.query(`UPDATE admissions.interviews SET ${built.set}, updated_at = now() WHERE application_id = $1 AND id = $2`, [applicationId, interviewId, ...built.params]);
}

// ---------------------------------------------------------------------------
// Offres
// ---------------------------------------------------------------------------

const OFFER_SELECT = `id, status, grade_level_code AS "gradeLevelCode", classroom_id AS "classroomId", ${ts("issued_at", "issuedAt")}, ${ts("expires_at", "expiresAt")},
  ${ts("responded_at", "respondedAt")}, responded_by_guardian_id AS "respondedByGuardianId", conditions`;

export interface OfferRow extends AdmissionsOfferDto {
  readonly applicationId: string;
}

export async function insertOffer(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; gradeLevelCode: string; issuedAt: string; expiresAt: string; classroomId: string | null; tokenHash: string; conditions: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.offers (id, tenant_id, application_id, grade_level_code, issued_at, expires_at, classroom_id, response_token_hash, conditions)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9)`,
    [input.id, input.tenantId, input.applicationId, input.gradeLevelCode, input.issuedAt, input.expiresAt, input.classroomId, input.tokenHash, input.conditions],
  );
}

export async function listOffers(tx: Tx, applicationId: string): Promise<AdmissionsOfferDto[]> {
  return tx.many<AdmissionsOfferDto>(`SELECT ${OFFER_SELECT} FROM admissions.offers WHERE application_id = $1 ORDER BY issued_at, id`, [applicationId]);
}

export async function getOffer(tx: Tx, offerId: string, options: { forUpdate?: boolean } = {}): Promise<OfferRow | null> {
  return tx.queryOne<OfferRow>(`SELECT ${OFFER_SELECT}, application_id AS "applicationId" FROM admissions.offers WHERE id = $1 ${options.forUpdate ? "FOR UPDATE" : ""}`, [offerId]);
}

export async function getOfferByTokenHash(tx: Tx, tokenHash: string): Promise<(OfferRow & { tokenConsumed: boolean }) | null> {
  return tx.queryOne(`SELECT ${OFFER_SELECT}, application_id AS "applicationId", (response_token_consumed_at IS NOT NULL) AS "tokenConsumed" FROM admissions.offers WHERE response_token_hash = $1`, [tokenHash]);
}

export async function getPendingOffer(tx: Tx, applicationId: string): Promise<OfferRow | null> {
  return tx.queryOne<OfferRow>(`SELECT ${OFFER_SELECT}, application_id AS "applicationId" FROM admissions.offers WHERE application_id = $1 AND status = 'PENDING'`, [applicationId]);
}

export async function getAcceptedOffer(tx: Tx, applicationId: string): Promise<OfferRow | null> {
  return tx.queryOne<OfferRow>(`SELECT ${OFFER_SELECT}, application_id AS "applicationId" FROM admissions.offers WHERE application_id = $1 AND status = 'ACCEPTED' ORDER BY issued_at DESC LIMIT 1`, [applicationId]);
}

export async function setOfferClassroom(tx: Tx, offerId: string, classroomId: string): Promise<void> {
  await tx.query(`UPDATE admissions.offers SET classroom_id = $2 WHERE id = $1 AND status = 'PENDING'`, [offerId, classroomId]);
}

export async function markOfferAccepted(tx: Tx, offerId: string, input: { guardianId: string; classroomId: string; at: string }): Promise<void> {
  await tx.query(
    `UPDATE admissions.offers SET status = 'ACCEPTED', responded_at = $4::timestamptz, responded_by_guardian_id = $2, classroom_id = $3, response_token_consumed_at = $4::timestamptz WHERE id = $1`,
    [offerId, input.guardianId, input.classroomId, input.at],
  );
}

export async function markOfferDeclined(tx: Tx, offerId: string, input: { guardianId: string; at: string }): Promise<void> {
  await tx.query(`UPDATE admissions.offers SET status = 'DECLINED', responded_at = $3::timestamptz, responded_by_guardian_id = $2, response_token_consumed_at = $3::timestamptz WHERE id = $1`, [offerId, input.guardianId, input.at]);
}

export async function setOfferStatus(tx: Tx, offerId: string, status: "EXPIRED" | "WITHDRAWN"): Promise<void> {
  await tx.query(`UPDATE admissions.offers SET status = $2 WHERE id = $1 AND status = 'PENDING'`, [offerId, status]);
}

export async function listExpiredPendingOffers(tx: Tx, now: string, limit: number): Promise<Array<{ offerId: string; applicationId: string }>> {
  return tx.many(`SELECT id AS "offerId", application_id AS "applicationId" FROM admissions.offers WHERE status = 'PENDING' AND expires_at <= $1::timestamptz ORDER BY expires_at LIMIT ${Number(limit)}`, [now]);
}

// ---------------------------------------------------------------------------
// Décisions (ajout seul)
// ---------------------------------------------------------------------------

export async function insertDecision(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; kind: string; fromStageId: string; toStageId: string; reasonCode: string | null; reasonText: string | null; conditions: string | null; offerId: string | null; overrideCapacity: boolean; decidedBy: string; decidedByName: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.decisions (id, tenant_id, application_id, kind, from_stage_id, to_stage_id, reason_code, reason_text, conditions, offer_id, override_capacity, decided_by, decided_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [input.id, input.tenantId, input.applicationId, input.kind, input.fromStageId, input.toStageId, input.reasonCode, input.reasonText, input.conditions, input.offerId, input.overrideCapacity, input.decidedBy, input.decidedByName],
  );
}

// ---------------------------------------------------------------------------
// Doublons
// ---------------------------------------------------------------------------

const DUPLICATE_SELECT = `id, matched_kind AS "matchedKind", matched_id AS "matchedId", score, reasons, status, ${ts("reviewed_at", "reviewedAt")}`;

export async function upsertDuplicate(tx: Tx, input: { id: string; tenantId: string; applicationId: string; matchedKind: string; matchedId: string; score: number; reasons: readonly string[] }): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO admissions.duplicate_candidates (id, tenant_id, application_id, matched_kind, matched_id, score, reasons) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, application_id, matched_kind, matched_id) DO UPDATE SET score = EXCLUDED.score, reasons = EXCLUDED.reasons WHERE admissions.duplicate_candidates.status = 'OPEN'`,
    [input.id, input.tenantId, input.applicationId, input.matchedKind, input.matchedId, input.score, input.reasons],
  );
  return r.rowCount > 0;
}

export async function listDuplicates(tx: Tx, applicationId: string): Promise<AdmissionsDuplicateDto[]> {
  return tx.many<AdmissionsDuplicateDto>(`SELECT ${DUPLICATE_SELECT} FROM admissions.duplicate_candidates WHERE application_id = $1 ORDER BY score DESC, id`, [applicationId]);
}

export async function getDuplicate(tx: Tx, applicationId: string, duplicateId: string): Promise<AdmissionsDuplicateDto | null> {
  return tx.queryOne<AdmissionsDuplicateDto>(`SELECT ${DUPLICATE_SELECT} FROM admissions.duplicate_candidates WHERE application_id = $1 AND id = $2`, [applicationId, duplicateId]);
}

export async function resolveDuplicate(tx: Tx, applicationId: string, duplicateId: string, status: string, reviewerId: string): Promise<boolean> {
  const r = await tx.query(`UPDATE admissions.duplicate_candidates SET status = $3, reviewed_by = $4, reviewed_at = now() WHERE application_id = $1 AND id = $2 AND status = 'OPEN'`, [applicationId, duplicateId, status, reviewerId]);
  return r.rowCount > 0;
}

export async function countOpenDuplicates(tx: Tx, applicationId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admissions.duplicate_candidates WHERE application_id = $1 AND status = 'OPEN'`, [applicationId]);
  return r?.n ?? 0;
}

/** Autres candidatures vivantes du même enfant (clé d'identité) ou d'un enfant très proche, toutes campagnes de l'établissement. */
export async function findApplicationDuplicates(tx: Tx, input: { applicationId: string; institutionId: string; identityKey: string }): Promise<Array<{ id: string; sameCampaign: boolean }>> {
  return tx.many(
    `SELECT o.id, (o.campaign_id = a.campaign_id) AS "sameCampaign"
       FROM admissions.applications a JOIN admissions.applications o ON o.tenant_id = a.tenant_id AND o.institution_id = a.institution_id AND o.id <> a.id
      WHERE a.id = $1 AND o.identity_key = $3 AND o.status <> 'REJECTED' AND o.institution_id = $2`,
    [input.applicationId, input.institutionId, input.identityKey],
  );
}

export async function findProspectDuplicates(tx: Tx, input: { institutionId: string; emails: string[]; phones: string[]; excludeProspectId: string | null }): Promise<Array<{ id: string }>> {
  if (input.emails.length === 0 && input.phones.length === 0) return [];
  return tx.many(
    `SELECT id FROM admissions.prospects
      WHERE institution_id = $1 AND status IN ('NEW', 'CONTACTED') AND ($4::uuid IS NULL OR id <> $4)
        AND (lower(contact_email) = ANY($2::text[]) OR contact_phone = ANY($3::text[]))`,
    [input.institutionId, input.emails.map((e) => e.toLowerCase()), input.phones, input.excludeProspectId],
  );
}

// ---------------------------------------------------------------------------
// Journal des notifications (idempotent par dedupe_key)
// ---------------------------------------------------------------------------

/** Réserve l'envoi : `null` si la clé existe déjà (envoi déjà fait ou en cours). */
export async function reserveNotification(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; guardianId: string | null; channel: string; templateCode: string; dedupeKey: string },
): Promise<string | null> {
  const r = await tx.queryOne<{ id: string }>(
    `INSERT INTO admissions.notification_log (id, tenant_id, application_id, guardian_id, channel, template_code, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, application_id, template_code, dedupe_key) DO NOTHING RETURNING id`,
    [input.id, input.tenantId, input.applicationId, input.guardianId, input.channel, input.templateCode, input.dedupeKey],
  );
  return r?.id ?? null;
}

export async function finishNotification(tx: Tx, id: string, input: { status: "SENT" | "FAILED" | "SKIPPED" | "QUEUED"; channel?: string; providerRef?: string | null; errorCode?: string | null }): Promise<void> {
  await tx.query(
    `UPDATE admissions.notification_log SET status = $2, channel = coalesce($3, channel), provider_ref = $4, error_code = $5, sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE sent_at END WHERE id = $1`,
    [id, input.status, input.channel ?? null, input.providerRef ?? null, input.errorCode ?? null],
  );
}

/** Une confirmation par contact et par jour : y a-t-il déjà une ligne récente de ce gabarit pour ce tuteur ? */
export async function recentNotificationExists(tx: Tx, input: { guardianContactKey: string; templateCode: string; since: string }): Promise<boolean> {
  const r = await tx.queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM admissions.notification_log WHERE template_code = $1 AND dedupe_key = $2 AND queued_at >= $3::timestamptz) AS ok`,
    [input.templateCode, input.guardianContactKey, input.since],
  );
  return r?.ok === true;
}

export async function listNotifications(tx: Tx, applicationId: string): Promise<Array<{ id: string; templateCode: string; channel: string; status: string; errorCode: string | null; queuedAt: string }>> {
  return tx.many(`SELECT id, template_code AS "templateCode", channel, status, error_code AS "errorCode", ${ts("queued_at", "queuedAt")} FROM admissions.notification_log WHERE application_id = $1 AND dedupe_key NOT LIKE 'contact:%' ORDER BY queued_at DESC, id`, [applicationId]);
}
