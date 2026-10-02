/**
 * Données d'établissement : paramètres, lien public (`public_form_index`, seule table globale), classes de priorité, motifs de
 * décision, textes de consentement versionnés, pièces exigées. SQL paramétré, `Tx` reçu en paramètre.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  AdmissionsConsentTextDto,
  AdmissionsDecisionReasonDto,
  AdmissionsDocumentRequirementDto,
  AdmissionsPriorityClassDto,
  AdmissionsSettingsDto,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { buildSet, ts } from "./sql";

type SettingsRow = Omit<AdmissionsSettingsDto, "publicFormSlug" | "publicFormLinkEnabled">;

const SETTINGS_SELECT = `institution_id AS "institutionId", public_form_enabled AS "publicFormEnabled", capacity_policy AS "capacityPolicy",
  duplicate_policy AS "duplicatePolicy", waitlist_enabled AS "waitlistEnabled", consent_required AS "consentRequired",
  consent_text_version AS "consentTextVersion", offer_validity_days AS "offerValidityDays", payment_deadline_days AS "paymentDeadlineDays",
  waitlist_promotion AS "waitlistPromotion", minimum_form_seconds AS "minimumFormSeconds", captcha_required AS "captchaRequired",
  submissions_per_10_min AS "submissionsPer10Min", rejected_retention_months AS "rejectedRetentionMonths",
  application_number_pattern AS "applicationNumberPattern"`;

export async function getSettingsRow(tx: Tx, institutionId: string): Promise<SettingsRow | null> {
  return tx.queryOne<SettingsRow>(`SELECT ${SETTINGS_SELECT} FROM admissions.settings WHERE institution_id = $1`, [institutionId]);
}

/** Crée la ligne de paramètres (valeurs par défaut de la base) si elle n'existe pas ; idempotent. */
export async function ensureSettingsRow(tx: Tx, tenantId: string, institutionId: string): Promise<SettingsRow> {
  await tx.query(`INSERT INTO admissions.settings (tenant_id, institution_id) VALUES ($1, $2) ON CONFLICT (tenant_id, institution_id) DO NOTHING`, [tenantId, institutionId]);
  return (await getSettingsRow(tx, institutionId)) as SettingsRow;
}

const SETTINGS_COLUMNS: Readonly<Record<string, string>> = {
  publicFormEnabled: "public_form_enabled",
  capacityPolicy: "capacity_policy",
  duplicatePolicy: "duplicate_policy",
  waitlistEnabled: "waitlist_enabled",
  consentRequired: "consent_required",
  consentTextVersion: "consent_text_version",
  offerValidityDays: "offer_validity_days",
  paymentDeadlineDays: "payment_deadline_days",
  waitlistPromotion: "waitlist_promotion",
  minimumFormSeconds: "minimum_form_seconds",
  captchaRequired: "captcha_required",
  submissionsPer10Min: "submissions_per_10_min",
  rejectedRetentionMonths: "rejected_retention_months",
  applicationNumberPattern: "application_number_pattern",
};

export async function updateSettingsRow(tx: Tx, institutionId: string, patch: Record<string, unknown>): Promise<void> {
  const built = buildSet(patch, SETTINGS_COLUMNS, 2);
  if (!built) return;
  await tx.query(`UPDATE admissions.settings SET ${built.set}, updated_at = now() WHERE institution_id = $1`, [institutionId, ...built.params]);
}

// ---------------------------------------------------------------------------
// Lien public
// ---------------------------------------------------------------------------

export interface PublicIndexRow {
  readonly slug: string;
  readonly tenantId: string;
  readonly institutionId: string;
  readonly enabled: boolean;
}

export async function getIndexOfInstitution(tx: Tx, institutionId: string): Promise<PublicIndexRow | null> {
  return tx.queryOne<PublicIndexRow>(`SELECT slug, tenant_id AS "tenantId", institution_id AS "institutionId", enabled FROM admissions.public_form_index WHERE institution_id = $1 AND tenant_id = kernel.current_tenant_id()`, [institutionId]);
}

export async function insertIndex(tx: Tx, input: { slug: string; tenantId: string; institutionId: string; enabled: boolean }): Promise<void> {
  await tx.query(`INSERT INTO admissions.public_form_index (slug, tenant_id, institution_id, enabled) VALUES ($1, $2, $3, $4)`, [input.slug, input.tenantId, input.institutionId, input.enabled]);
}

export async function replaceIndexSlug(tx: Tx, institutionId: string, slug: string, enabled: boolean): Promise<void> {
  await tx.query(`UPDATE admissions.public_form_index SET slug = $2, enabled = $3, updated_at = now() WHERE institution_id = $1 AND tenant_id = kernel.current_tenant_id()`, [institutionId, slug, enabled]);
}

export async function setIndexEnabled(tx: Tx, institutionId: string, enabled: boolean): Promise<void> {
  await tx.query(`UPDATE admissions.public_form_index SET enabled = $2, updated_at = now() WHERE institution_id = $1 AND tenant_id = kernel.current_tenant_id()`, [institutionId, enabled]);
}

/** Résolution d'un slug (lecture ouverte : exécutée par `SystemDb.run`, AVANT tout contexte de tenant). */
export async function lookupSlug(tx: Tx, slug: string): Promise<PublicIndexRow | null> {
  return tx.queryOne<PublicIndexRow>(`SELECT slug, tenant_id AS "tenantId", institution_id AS "institutionId", enabled FROM admissions.public_form_index WHERE slug = $1`, [slug]);
}

// ---------------------------------------------------------------------------
// Classes de priorité
// ---------------------------------------------------------------------------

const PRIORITY_SELECT = `id, code, label, rank, active`;

export async function listPriorityClasses(tx: Tx, institutionId: string): Promise<AdmissionsPriorityClassDto[]> {
  return tx.many<AdmissionsPriorityClassDto>(`SELECT ${PRIORITY_SELECT} FROM admissions.priority_classes WHERE institution_id = $1 ORDER BY rank, code`, [institutionId]);
}

export async function upsertPriorityClass(tx: Tx, input: { id: string; tenantId: string; institutionId: string; code: string; label: string; rank: number; active: boolean }): Promise<AdmissionsPriorityClassDto> {
  const row = await tx.queryOne<AdmissionsPriorityClassDto>(
    `INSERT INTO admissions.priority_classes (id, tenant_id, institution_id, code, label, rank, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, institution_id, code) DO UPDATE SET label = EXCLUDED.label, rank = EXCLUDED.rank, active = EXCLUDED.active
     RETURNING ${PRIORITY_SELECT}`,
    [input.id, input.tenantId, input.institutionId, input.code, input.label, input.rank, input.active],
  );
  return row as AdmissionsPriorityClassDto;
}

// ---------------------------------------------------------------------------
// Motifs de décision
// ---------------------------------------------------------------------------

const REASON_SELECT = `id, code, kind, label, active`;

export async function listDecisionReasons(tx: Tx, institutionId: string): Promise<AdmissionsDecisionReasonDto[]> {
  return tx.many<AdmissionsDecisionReasonDto>(`SELECT ${REASON_SELECT} FROM admissions.decision_reasons WHERE institution_id = $1 ORDER BY kind, code`, [institutionId]);
}

export async function getDecisionReason(tx: Tx, institutionId: string, code: string): Promise<AdmissionsDecisionReasonDto | null> {
  return tx.queryOne<AdmissionsDecisionReasonDto>(`SELECT ${REASON_SELECT} FROM admissions.decision_reasons WHERE institution_id = $1 AND code = $2`, [institutionId, code]);
}

export async function upsertDecisionReason(tx: Tx, input: { id: string; tenantId: string; institutionId: string; code: string; kind: string; label: string; active: boolean }): Promise<AdmissionsDecisionReasonDto> {
  const row = await tx.queryOne<AdmissionsDecisionReasonDto>(
    `INSERT INTO admissions.decision_reasons (id, tenant_id, institution_id, code, kind, label, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, institution_id, code) DO UPDATE SET kind = EXCLUDED.kind, label = EXCLUDED.label, active = EXCLUDED.active
     RETURNING ${REASON_SELECT}`,
    [input.id, input.tenantId, input.institutionId, input.code, input.kind, input.label, input.active],
  );
  return row as AdmissionsDecisionReasonDto;
}

/** Insère un motif livré par défaut sans écraser une personnalisation existante. */
export async function insertDecisionReasonIfAbsent(tx: Tx, input: { id: string; tenantId: string; institutionId: string; code: string; kind: string; label: string }): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO admissions.decision_reasons (id, tenant_id, institution_id, code, kind, label) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, institution_id, code) DO NOTHING`,
    [input.id, input.tenantId, input.institutionId, input.code, input.kind, input.label],
  );
  return r.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Textes de consentement (versionnés, preuve)
// ---------------------------------------------------------------------------

const CONSENT_SELECT = `id, kind, version, language, body, ${ts("published_at", "publishedAt")}, ${ts("retired_at", "retiredAt")}`;

export async function listConsentTexts(tx: Tx, institutionId: string): Promise<AdmissionsConsentTextDto[]> {
  return tx.many<AdmissionsConsentTextDto>(`SELECT ${CONSENT_SELECT} FROM admissions.consent_texts WHERE institution_id = $1 ORDER BY kind, published_at DESC, version DESC`, [institutionId]);
}

export async function getConsentText(tx: Tx, institutionId: string, kind: string, version: string): Promise<AdmissionsConsentTextDto | null> {
  return tx.queryOne<AdmissionsConsentTextDto>(`SELECT ${CONSENT_SELECT} FROM admissions.consent_texts WHERE institution_id = $1 AND kind = $2 AND version = $3`, [institutionId, kind, version]);
}

/** Texte EN VIGUEUR d'un type : la version désignée par les paramètres si elle n'est pas retirée. */
export async function getCurrentConsentText(tx: Tx, institutionId: string, kind: string): Promise<AdmissionsConsentTextDto | null> {
  return tx.queryOne<AdmissionsConsentTextDto>(
    `SELECT ${CONSENT_SELECT} FROM admissions.consent_texts t
      WHERE t.institution_id = $1 AND t.kind = $2 AND t.retired_at IS NULL
        AND t.version = (SELECT consent_text_version FROM admissions.settings WHERE institution_id = $1)
      LIMIT 1`,
    [institutionId, kind],
  );
}

export async function insertConsentText(tx: Tx, input: { id: string; tenantId: string; institutionId: string; kind: string; version: string; language: string; body: string; publishedBy: string | null }): Promise<AdmissionsConsentTextDto> {
  const row = await tx.queryOne<AdmissionsConsentTextDto>(
    `INSERT INTO admissions.consent_texts (id, tenant_id, institution_id, kind, version, language, body, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${CONSENT_SELECT}`,
    [input.id, input.tenantId, input.institutionId, input.kind, input.version, input.language, input.body, input.publishedBy],
  );
  return row as AdmissionsConsentTextDto;
}

export async function retireConsentText(tx: Tx, institutionId: string, kind: string, version: string): Promise<boolean> {
  const r = await tx.query(`UPDATE admissions.consent_texts SET retired_at = now() WHERE institution_id = $1 AND kind = $2 AND version = $3 AND retired_at IS NULL`, [institutionId, kind, version]);
  return r.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Pièces exigées
// ---------------------------------------------------------------------------

const REQUIREMENT_SELECT = `id, code, label, grade_level_code AS "gradeLevelCode", applies_to_funding AS "appliesToFunding", required,
  accepts_mime AS "acceptsMime", max_size_kb AS "maxSizeKb", sort_order AS "sortOrder", active`;

export async function listRequirements(tx: Tx, institutionId: string, options: { activeOnly?: boolean } = {}): Promise<AdmissionsDocumentRequirementDto[]> {
  return tx.many<AdmissionsDocumentRequirementDto>(
    `SELECT ${REQUIREMENT_SELECT} FROM admissions.document_requirements WHERE institution_id = $1 ${options.activeOnly ? "AND active" : ""} ORDER BY sort_order, code`,
    [institutionId],
  );
}

export async function getRequirement(tx: Tx, requirementId: string): Promise<(AdmissionsDocumentRequirementDto & { institutionId: string }) | null> {
  return tx.queryOne(`SELECT ${REQUIREMENT_SELECT}, institution_id AS "institutionId" FROM admissions.document_requirements WHERE id = $1`, [requirementId]);
}

export async function upsertRequirement(
  tx: Tx,
  input: { id: string; tenantId: string; institutionId: string; code: string; label: string; gradeLevelCode: string | null; appliesToFunding: string | null; required: boolean; acceptsMime: string[]; maxSizeKb: number; sortOrder: number; active: boolean },
): Promise<AdmissionsDocumentRequirementDto> {
  const row = await tx.queryOne<AdmissionsDocumentRequirementDto>(
    `INSERT INTO admissions.document_requirements (id, tenant_id, institution_id, code, label, grade_level_code, applies_to_funding, required, accepts_mime, max_size_kb, sort_order, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (tenant_id, institution_id, code) DO UPDATE SET label = EXCLUDED.label, grade_level_code = EXCLUDED.grade_level_code,
       applies_to_funding = EXCLUDED.applies_to_funding, required = EXCLUDED.required, accepts_mime = EXCLUDED.accepts_mime,
       max_size_kb = EXCLUDED.max_size_kb, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active
     RETURNING ${REQUIREMENT_SELECT}`,
    [input.id, input.tenantId, input.institutionId, input.code, input.label, input.gradeLevelCode, input.appliesToFunding, input.required, input.acceptsMime, input.maxSizeKb, input.sortOrder, input.active],
  );
  return row as AdmissionsDocumentRequirementDto;
}
