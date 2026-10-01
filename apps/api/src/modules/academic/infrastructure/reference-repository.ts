/**
 * Référentiels pilotés par les modèles de pack : cycles, niveaux, types de périodes, plans de périodes, types de
 * financement, issues d'inscription, grammaire du curriculum, paramètres d'établissement, applications de modèle.
 *
 * Deux écritures distinctes :
 *  - `upsert*` (administration, PUT /reference/*) : crée ou met à jour PAR CODE ; `updated_at` avance, ce qui marque
 *    la ligne comme PERSONNALISÉE ;
 *  - `tpl*` (application d'un modèle de pack) : crée, ou met à jour une ligne NON personnalisée
 *    (`updated_at = created_at`) en préservant ce marqueur ; une ligne personnalisée n'est jamais modifiée.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AcademicPack } from "@ecoledigitale/contracts/src/v2/academic";
import type {
  EducationLevel,
  EnrollmentOutcome,
  FundingType,
  GradeLevel,
  InstitutionSettings,
  NodeType,
  PeriodPlan,
  PeriodPlanSlot,
  PeriodType,
} from "../domain/records";
import {
  EDUCATION_LEVEL_COLS,
  FUNDING_TYPE_COLS,
  GRADE_LEVEL_COLS,
  NODE_TYPE_COLS,
  OUTCOME_COLS,
  PERIOD_PLAN_COLS,
  PERIOD_TYPE_COLS,
  SETTINGS_COLS,
  mapEducationLevel,
  mapFundingType,
  mapGradeLevel,
  mapNodeType,
  mapOutcome,
  mapPeriodPlan,
  mapPeriodType,
  mapSettings,
} from "./mappers";

export const listEducationLevels = async (tx: Tx): Promise<EducationLevel[]> =>
  (await tx.many(`SELECT ${EDUCATION_LEVEL_COLS} FROM academic.education_levels ORDER BY ordinal, code`)).map(mapEducationLevel);
export const listGradeLevels = async (tx: Tx): Promise<GradeLevel[]> =>
  (await tx.many(`SELECT ${GRADE_LEVEL_COLS} FROM academic.grade_levels ORDER BY education_level_id, ordinal, code`)).map(mapGradeLevel);
export const listPeriodTypes = async (tx: Tx): Promise<PeriodType[]> =>
  (await tx.many(`SELECT ${PERIOD_TYPE_COLS} FROM academic.period_types ORDER BY kind, code`)).map(mapPeriodType);
export const listPeriodPlans = async (tx: Tx): Promise<PeriodPlan[]> =>
  (await tx.many(`SELECT ${PERIOD_PLAN_COLS} FROM academic.period_plans ORDER BY code`)).map(mapPeriodPlan);
export const listFundingTypes = async (tx: Tx): Promise<FundingType[]> =>
  (await tx.many(`SELECT ${FUNDING_TYPE_COLS} FROM academic.funding_types ORDER BY sort_order, code`)).map(mapFundingType);
export const listOutcomes = async (tx: Tx): Promise<EnrollmentOutcome[]> =>
  (await tx.many(`SELECT ${OUTCOME_COLS} FROM academic.enrollment_outcomes ORDER BY code`)).map(mapOutcome);
export const listNodeTypes = async (tx: Tx): Promise<NodeType[]> =>
  (await tx.many(`SELECT ${NODE_TYPE_COLS} FROM academic.curriculum_node_types ORDER BY sort_order, code`)).map(mapNodeType);

export async function getGradeLevel(tx: Tx, id: string): Promise<GradeLevel | null> {
  const r = await tx.queryOne(`SELECT ${GRADE_LEVEL_COLS} FROM academic.grade_levels WHERE id = $1`, [id]);
  return r ? mapGradeLevel(r) : null;
}
export async function getEducationLevel(tx: Tx, id: string): Promise<EducationLevel | null> {
  const r = await tx.queryOne(`SELECT ${EDUCATION_LEVEL_COLS} FROM academic.education_levels WHERE id = $1`, [id]);
  return r ? mapEducationLevel(r) : null;
}

// ---------------------------------------------------------------------------
// Écritures d'administration (par code)
// ---------------------------------------------------------------------------

export interface UpsertOutcome {
  inserted: boolean;
}

export async function upsertEducationLevel(
  tx: Tx,
  id: string,
  v: { code: string; label: string; ordinal: number; pack: AcademicPack | null; active: boolean },
): Promise<UpsertOutcome> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.education_levels (id, tenant_id, code, label, ordinal, pack, active)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, ordinal = EXCLUDED.ordinal, pack = EXCLUDED.pack, active = EXCLUDED.active, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, v.ordinal, v.pack, v.active],
  );
  return { inserted: r?.inserted === true };
}

export async function upsertGradeLevel(
  tx: Tx,
  id: string,
  v: { code: string; label: string; shortLabel: string | null; educationLevelId: string; ordinal: number; isFinal: boolean; active: boolean },
): Promise<UpsertOutcome> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.grade_levels (id, tenant_id, code, label, short_label, education_level_id, ordinal, is_final, active)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, short_label = EXCLUDED.short_label, education_level_id = EXCLUDED.education_level_id,
       ordinal = EXCLUDED.ordinal, is_final = EXCLUDED.is_final, active = EXCLUDED.active, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, v.shortLabel, v.educationLevelId, v.ordinal, v.isFinal, v.active],
  );
  return { inserted: r?.inserted === true };
}

export async function setGradeLevelNext(tx: Tx, code: string, nextCode: string | null, isFinal: boolean): Promise<void> {
  await tx.query(
    `UPDATE academic.grade_levels g
        SET next_grade_level_id = (SELECT n.id FROM academic.grade_levels n WHERE n.tenant_id = g.tenant_id AND n.code = $2),
            is_final = $3, updated_at = now()
      WHERE g.code = $1`,
    [code, nextCode, isFinal],
  );
}

export async function upsertPeriodType(tx: Tx, id: string, v: { code: string; label: string; kind: string; active: boolean }): Promise<UpsertOutcome> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.period_types (id, tenant_id, code, label, kind, active)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, active = EXCLUDED.active, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, v.kind, v.active],
  );
  return { inserted: r?.inserted === true };
}

export async function upsertPeriodPlan(tx: Tx, id: string, v: { code: string; label: string; slots: readonly PeriodPlanSlot[]; active: boolean }): Promise<UpsertOutcome> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.period_plans (id, tenant_id, code, label, slots, active)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4::jsonb, $5)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, slots = EXCLUDED.slots, active = EXCLUDED.active, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, JSON.stringify(v.slots), v.active],
  );
  return { inserted: r?.inserted === true };
}

export async function upsertFundingType(
  tx: Tx,
  id: string,
  v: { code: string; label: string; requiresReference: boolean; requiresFunder: boolean; sortOrder: number; active: boolean },
): Promise<UpsertOutcome> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.funding_types (id, tenant_id, code, label, requires_reference, requires_funder, sort_order, active)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, requires_reference = EXCLUDED.requires_reference,
       requires_funder = EXCLUDED.requires_funder, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, v.requiresReference, v.requiresFunder, v.sortOrder, v.active],
  );
  return { inserted: r?.inserted === true };
}

export async function upsertOutcome(tx: Tx, id: string, v: { code: string; label: string; kind: string; active: boolean }): Promise<UpsertOutcome> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.enrollment_outcomes (id, tenant_id, code, label, kind, active)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, active = EXCLUDED.active, updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, v.kind, v.active],
  );
  return { inserted: r?.inserted === true };
}

export interface NodeTypeValues {
  code: string;
  label: string;
  allowedParentCodes: string[];
  requiresGradeLevel: boolean;
  requiresPeriodSlot: boolean;
  requiresSubject: boolean;
  allowsCoefficient: boolean;
  allowsCredits: boolean;
  creditsMustEqualChildren: boolean;
  isEnrollable: boolean;
  isSystem: boolean;
  sortOrder: number;
}

/** Ne touche JAMAIS un type `is_system` (la clause WHERE le garantit) ; renvoie `null` si la ligne est protégée. */
export async function upsertNodeType(tx: Tx, id: string, v: NodeTypeValues): Promise<UpsertOutcome | null> {
  const r = await tx.queryOne<{ inserted: boolean }>(
    `INSERT INTO academic.curriculum_node_types (id, tenant_id, code, label, allowed_parent_codes, requires_grade_level, requires_period_slot, requires_subject,
        allows_coefficient, allows_credits, credits_must_equal_children, is_enrollable, is_system, sort_order)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, allowed_parent_codes = EXCLUDED.allowed_parent_codes,
        requires_grade_level = EXCLUDED.requires_grade_level, requires_period_slot = EXCLUDED.requires_period_slot, requires_subject = EXCLUDED.requires_subject,
        allows_coefficient = EXCLUDED.allows_coefficient, allows_credits = EXCLUDED.allows_credits, credits_must_equal_children = EXCLUDED.credits_must_equal_children,
        is_enrollable = EXCLUDED.is_enrollable, sort_order = EXCLUDED.sort_order, updated_at = now()
      WHERE NOT academic.curriculum_node_types.is_system
     RETURNING (xmax = 0) AS inserted`,
    [id, v.code, v.label, v.allowedParentCodes, v.requiresGradeLevel, v.requiresPeriodSlot, v.requiresSubject, v.allowsCoefficient, v.allowsCredits, v.creditsMustEqualChildren, v.isEnrollable, v.isSystem, v.sortOrder],
  );
  return r ? { inserted: r.inserted === true } : null;
}

// ---------------------------------------------------------------------------
// Application d'un modèle de pack : création ou mise à jour des lignes NON personnalisées
// ---------------------------------------------------------------------------

export type TplResult = "created" | "updated" | "kept";

function tplResult(row: { inserted: boolean } | null): TplResult {
  if (!row) return "kept";
  return row.inserted ? "created" : "updated";
}

export async function tplEducationLevel(tx: Tx, id: string, pack: AcademicPack, v: { code: string; label: string; ordinal: number }): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.education_levels (id, tenant_id, code, label, ordinal, pack)
       VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, ordinal = EXCLUDED.ordinal, pack = EXCLUDED.pack, updated_at = academic.education_levels.created_at
        WHERE academic.education_levels.updated_at = academic.education_levels.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, v.ordinal, pack],
    ),
  );
}

export async function tplGradeLevel(
  tx: Tx,
  id: string,
  v: { code: string; label: string; shortLabel: string | null; educationLevelCode: string; ordinal: number },
): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.grade_levels (id, tenant_id, code, label, short_label, education_level_id, ordinal)
       SELECT $1, kernel.current_tenant_id(), $2, $3, $4, el.id, $6 FROM academic.education_levels el WHERE el.code = $5
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, short_label = EXCLUDED.short_label, education_level_id = EXCLUDED.education_level_id,
          ordinal = EXCLUDED.ordinal, updated_at = academic.grade_levels.created_at
        WHERE academic.grade_levels.updated_at = academic.grade_levels.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, v.shortLabel, v.educationLevelCode, v.ordinal],
    ),
  );
}

/** Pose le niveau suivant d'une ligne de modèle non personnalisée. */
export async function tplGradeLevelNext(tx: Tx, code: string, nextCode: string | null, isFinal: boolean): Promise<void> {
  await tx.query(
    `UPDATE academic.grade_levels g
        SET next_grade_level_id = (SELECT n.id FROM academic.grade_levels n WHERE n.tenant_id = g.tenant_id AND n.code = $2), is_final = $3, updated_at = g.created_at
      WHERE g.code = $1 AND g.updated_at = g.created_at`,
    [code, nextCode, isFinal],
  );
}

export async function tplPeriodType(tx: Tx, id: string, v: { code: string; label: string; kind: string }): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.period_types (id, tenant_id, code, label, kind) VALUES ($1, kernel.current_tenant_id(), $2, $3, $4)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, updated_at = academic.period_types.created_at
        WHERE academic.period_types.updated_at = academic.period_types.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, v.kind],
    ),
  );
}

export async function tplPeriodPlan(tx: Tx, id: string, v: { code: string; label: string; slots: readonly PeriodPlanSlot[] }): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.period_plans (id, tenant_id, code, label, slots) VALUES ($1, kernel.current_tenant_id(), $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, slots = EXCLUDED.slots, updated_at = academic.period_plans.created_at
        WHERE academic.period_plans.updated_at = academic.period_plans.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, JSON.stringify(v.slots)],
    ),
  );
}

export async function tplFundingType(
  tx: Tx,
  id: string,
  v: { code: string; label: string; requiresReference: boolean; requiresFunder: boolean; sortOrder: number },
): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.funding_types (id, tenant_id, code, label, requires_reference, requires_funder, sort_order)
       VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, requires_reference = EXCLUDED.requires_reference, requires_funder = EXCLUDED.requires_funder,
          sort_order = EXCLUDED.sort_order, updated_at = academic.funding_types.created_at
        WHERE academic.funding_types.updated_at = academic.funding_types.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, v.requiresReference, v.requiresFunder, v.sortOrder],
    ),
  );
}

export async function tplOutcome(tx: Tx, id: string, v: { code: string; label: string; kind: string }): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.enrollment_outcomes (id, tenant_id, code, label, kind) VALUES ($1, kernel.current_tenant_id(), $2, $3, $4)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, updated_at = academic.enrollment_outcomes.created_at
        WHERE academic.enrollment_outcomes.updated_at = academic.enrollment_outcomes.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, v.kind],
    ),
  );
}

export async function tplNodeType(tx: Tx, id: string, v: NodeTypeValues): Promise<TplResult> {
  return tplResult(
    await tx.queryOne<{ inserted: boolean }>(
      `INSERT INTO academic.curriculum_node_types (id, tenant_id, code, label, allowed_parent_codes, requires_grade_level, requires_period_slot, requires_subject,
          allows_coefficient, allows_credits, credits_must_equal_children, is_enrollable, is_system, sort_order)
       VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, allowed_parent_codes = EXCLUDED.allowed_parent_codes,
          requires_grade_level = EXCLUDED.requires_grade_level, requires_period_slot = EXCLUDED.requires_period_slot, requires_subject = EXCLUDED.requires_subject,
          allows_coefficient = EXCLUDED.allows_coefficient, allows_credits = EXCLUDED.allows_credits, credits_must_equal_children = EXCLUDED.credits_must_equal_children,
          is_enrollable = EXCLUDED.is_enrollable, sort_order = EXCLUDED.sort_order, updated_at = academic.curriculum_node_types.created_at
        WHERE academic.curriculum_node_types.updated_at = academic.curriculum_node_types.created_at
       RETURNING (xmax = 0) AS inserted`,
      [id, v.code, v.label, v.allowedParentCodes, v.requiresGradeLevel, v.requiresPeriodSlot, v.requiresSubject, v.allowsCoefficient, v.allowsCredits, v.creditsMustEqualChildren, v.isEnrollable, v.isSystem, v.sortOrder],
    ),
  );
}

// ---------------------------------------------------------------------------
// Paramètres d'établissement et applications de modèle
// ---------------------------------------------------------------------------

export async function getSettings(tx: Tx, institutionId: string): Promise<InstitutionSettings | null> {
  const r = await tx.queryOne(`SELECT ${SETTINGS_COLS} FROM academic.institution_settings WHERE institution_id = $1`, [institutionId]);
  return r ? mapSettings(r) : null;
}

export async function upsertSettings(tx: Tx, institutionId: string, v: Omit<InstitutionSettings, "institutionId">): Promise<void> {
  await tx.query(
    `INSERT INTO academic.institution_settings (tenant_id, institution_id, enrollment_confirmation_policy, course_confirmation_policy, pending_hold_minutes,
        registration_number_prefix, registration_number_pattern)
     VALUES (kernel.current_tenant_id(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, institution_id) DO UPDATE SET enrollment_confirmation_policy = EXCLUDED.enrollment_confirmation_policy,
        course_confirmation_policy = EXCLUDED.course_confirmation_policy, pending_hold_minutes = EXCLUDED.pending_hold_minutes,
        registration_number_prefix = EXCLUDED.registration_number_prefix, registration_number_pattern = EXCLUDED.registration_number_pattern, updated_at = now()`,
    [institutionId, v.enrollmentConfirmationPolicy, v.courseConfirmationPolicy, v.pendingHoldMinutes, v.registrationNumberPrefix, v.registrationNumberPattern],
  );
}

/** Crée les paramètres d'un modèle SEULEMENT s'ils n'existent pas (jamais d'écrasement). Renvoie `true` si créés. */
export async function insertSettingsIfAbsent(tx: Tx, institutionId: string, v: Omit<InstitutionSettings, "institutionId">): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO academic.institution_settings (tenant_id, institution_id, enrollment_confirmation_policy, course_confirmation_policy, pending_hold_minutes,
        registration_number_prefix, registration_number_pattern)
     VALUES (kernel.current_tenant_id(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, institution_id) DO NOTHING`,
    [institutionId, v.enrollmentConfirmationPolicy, v.courseConfirmationPolicy, v.pendingHoldMinutes, v.registrationNumberPrefix, v.registrationNumberPattern],
  );
  return res.rowCount > 0;
}

export async function recordTemplateApplication(
  tx: Tx,
  v: { id: string; institutionId: string; pack: AcademicPack; educationSystem: string; templateVersion: number; appliedBy: string | null; summary: unknown },
): Promise<boolean> {
  const res = await tx.query(
    `INSERT INTO academic.template_applications (id, tenant_id, institution_id, pack, education_system, template_version, applied_by, summary)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (tenant_id, institution_id, pack, education_system, template_version) DO NOTHING`,
    [v.id, v.institutionId, v.pack, v.educationSystem, v.templateVersion, v.appliedBy, JSON.stringify(v.summary)],
  );
  return res.rowCount > 0;
}
