/**
 * Lignes SQL -> objets du domaine. Les `date` sont toujours lues en texte (`::text`) pour éviter les décalages de fuseau du
 * pilote `pg` ; les `bigint` aussi (`::text` puis `Number`).
 */
import type {
  BatchItemRecord,
  BatchRecord,
  Branding,
  PlatformTemplate,
  RenderRecord,
  ReportCardRecord,
  ReportcardsSettings,
  Signatory,
  TemplateConfig,
} from "../domain/types";

type Row = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export const BRANDING_COLUMNS =
  "id, institution_id, version, is_current, legal_name, short_name, header_left, header_right, address, phone, email, website, registration_ref, " +
  "logo_object_key, emblem_object_key, primary_color, secondary_color, footer_text, created_at";

export function toBranding(r: Row): Branding {
  return {
    id: r.id,
    institutionId: r.institution_id,
    version: Number(r.version),
    isCurrent: r.is_current,
    legalName: r.legal_name,
    shortName: r.short_name,
    headerLeft: Array.isArray(r.header_left) ? r.header_left.map(String) : [],
    headerRight: Array.isArray(r.header_right) ? r.header_right.map(String) : [],
    address: r.address,
    phone: r.phone,
    email: r.email,
    website: r.website,
    registrationRef: r.registration_ref,
    logoObjectKey: r.logo_object_key,
    emblemObjectKey: r.emblem_object_key,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    footerText: r.footer_text,
    createdAt: date(r.created_at)!,
  };
}

export const SIGNATORY_COLUMNS =
  "id, institution_id, full_name, title, job_function, signature_object_key, staff_id, active, valid_from::text AS valid_from, valid_to::text AS valid_to, created_at, updated_at";

export function toSignatory(r: Row): Signatory {
  return {
    id: r.id,
    institutionId: r.institution_id,
    fullName: r.full_name,
    title: r.title,
    jobFunction: r.job_function,
    signatureObjectKey: r.signature_object_key,
    staffId: r.staff_id,
    active: r.active,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  };
}

export const TEMPLATE_COLUMNS =
  "key, version, document_kind, pack, snapshot_schema, title, body, css, options_schema, signature_slots, status, content_hash, published_at";

export function toPlatformTemplate(r: Row): PlatformTemplate {
  return {
    key: r.key,
    version: Number(r.version),
    documentKind: r.document_kind,
    pack: r.pack,
    snapshotSchema: r.snapshot_schema,
    title: r.title,
    body: r.body,
    css: r.css,
    optionsSchema: r.options_schema,
    signatureSlots: Array.isArray(r.signature_slots) ? r.signature_slots : [],
    status: r.status,
    contentHash: r.content_hash,
    publishedAt: date(r.published_at),
  };
}

export const CONFIG_COLUMNS =
  "id, institution_id, document_kind, pack, template_key, template_version, config_version, is_current, options, signature_assignments, created_at";

export function toTemplateConfig(r: Row): TemplateConfig {
  return {
    id: r.id,
    institutionId: r.institution_id,
    documentKind: r.document_kind,
    pack: r.pack,
    templateKey: r.template_key,
    templateVersion: Number(r.template_version),
    configVersion: Number(r.config_version),
    isCurrent: r.is_current,
    options: r.options ?? {},
    signatureAssignments: Array.isArray(r.signature_assignments) ? r.signature_assignments : [],
    createdAt: date(r.created_at)!,
  };
}

export function toSettings(r: Row | null): ReportcardsSettings | null {
  if (!r) return null;
  return {
    blockIfUnpaid: r.block_if_unpaid,
    requireDeliberation: r.require_deliberation,
    verificationShowsMention: r.verification_shows_mention,
    updatedAt: date(r.updated_at),
  };
}

/** Colonnes d'un bulletin SANS le contenu (snapshot, trace) : seuls le titre et le nom de l'élève sont extraits pour les listes. */
export const CARD_COLUMNS =
  "id, document_kind, enrollment_id, student_id, classroom_id, academic_year_id, academic_period_id, scope, version, status, provisional, snapshot_schema, " +
  "snapshot_hash, rule_set_code, rule_version_id, results_state_id, results_version, closure_hash, template_key, template_version, config_version, " +
  "verification_code, signing_key_id, signature, issued_at, issued_by, issued_by_name, supersedes_id, supersede_reason, superseded_at, superseded_by_id, " +
  "revoked_at, revoked_by, revoke_reason, published_at, published_by, withdrawn_at, render_status, current_render_id, batch_id, " +
  "snapshot #>> '{meta,title}' AS title, " +
  "btrim(concat(snapshot #>> '{student,lastName}', ' ', snapshot #>> '{student,firstNames}')) AS student_name";

export function toCard(r: Row): ReportCardRecord {
  return {
    id: r.id,
    documentKind: r.document_kind,
    enrollmentId: r.enrollment_id,
    studentId: r.student_id,
    classroomId: r.classroom_id,
    academicYearId: r.academic_year_id,
    academicPeriodId: r.academic_period_id,
    scope: r.scope,
    version: Number(r.version),
    status: r.status,
    provisional: r.provisional,
    snapshotSchema: r.snapshot_schema,
    snapshotHash: r.snapshot_hash,
    ruleSetCode: r.rule_set_code,
    ruleVersionId: r.rule_version_id,
    resultsStateId: r.results_state_id,
    resultsVersion: Number(r.results_version),
    closureHash: r.closure_hash,
    templateKey: r.template_key,
    templateVersion: Number(r.template_version),
    configVersion: Number(r.config_version),
    verificationCode: r.verification_code,
    signingKeyId: r.signing_key_id,
    signature: r.signature,
    issuedAt: date(r.issued_at)!,
    issuedBy: r.issued_by,
    issuedByName: r.issued_by_name,
    supersedesId: r.supersedes_id,
    supersedeReason: r.supersede_reason,
    supersededAt: date(r.superseded_at),
    supersededById: r.superseded_by_id,
    revokedAt: date(r.revoked_at),
    revokedBy: r.revoked_by,
    revokeReason: r.revoke_reason,
    publishedAt: date(r.published_at),
    publishedBy: r.published_by,
    withdrawnAt: date(r.withdrawn_at),
    renderStatus: r.render_status,
    currentRenderId: r.current_render_id,
    batchId: r.batch_id,
    title: r.title ?? "",
    studentName: r.student_name ?? "",
  };
}

export const RENDER_COLUMNS =
  "id, report_card_id, status, object_key, pdf_hash, size_bytes::text AS size_bytes, pages, renderer_version, duration_ms, attempts, error, requested_at, finished_at";

export function toRender(r: Row): RenderRecord {
  return {
    id: r.id,
    reportCardId: r.report_card_id,
    status: r.status,
    objectKey: r.object_key,
    pdfHash: r.pdf_hash,
    sizeBytes: num(r.size_bytes),
    pages: num(r.pages),
    rendererVersion: r.renderer_version,
    durationMs: num(r.duration_ms),
    attempts: Number(r.attempts),
    error: r.error,
    requestedAt: date(r.requested_at)!,
    finishedAt: date(r.finished_at),
  };
}

export const BATCH_COLUMNS =
  "id, document_kind, classroom_id, academic_period_id, results_state_id, results_version, idempotency_key, provisional, status, total, issued, excluded, " +
  "failed, rendered, combined_pdf_key, requested_by, requested_at, finished_at";

export function toBatch(r: Row): BatchRecord {
  return {
    id: r.id,
    documentKind: r.document_kind,
    classroomId: r.classroom_id,
    academicPeriodId: r.academic_period_id,
    resultsStateId: r.results_state_id,
    resultsVersion: Number(r.results_version),
    idempotencyKey: r.idempotency_key,
    provisional: r.provisional,
    status: r.status,
    total: Number(r.total),
    issued: Number(r.issued),
    excluded: Number(r.excluded),
    failed: Number(r.failed),
    rendered: Number(r.rendered),
    combinedPdfKey: r.combined_pdf_key,
    requestedBy: r.requested_by,
    requestedAt: date(r.requested_at)!,
    finishedAt: date(r.finished_at),
  };
}

export function toBatchItem(r: Row): BatchItemRecord {
  return {
    id: r.id,
    batchId: r.batch_id,
    enrollmentId: r.enrollment_id,
    reportCardId: r.report_card_id,
    outcome: r.outcome,
    reasonCode: r.reason_code,
    message: r.message,
  };
}
