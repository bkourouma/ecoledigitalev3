/** Référentiels d'établissement : rôles de participants, types de conseil, types de décision, réglages (DONNÉES, vides par défaut). */
import type { Tx } from "@ecoledigitale/database";
import type { CouncilTypeRow, DecisionTypeRow, RoleRow, SettingsRow } from "./rows";

// ---------------------------------------------------------------------------------------------------------------------
// Rôles de participants
// ---------------------------------------------------------------------------------------------------------------------

const ROLE_COLS = `id, code, label, is_voting AS "isVoting", counts_for_quorum AS "countsForQuorum", may_sign AS "maySign", can_decide AS "canDecide",
  is_external AS "isExternal", sort_order AS "sortOrder", active`;

export const listRoles = (tx: Tx): Promise<RoleRow[]> => tx.many<RoleRow>(`SELECT ${ROLE_COLS} FROM councils.participant_roles ORDER BY sort_order, code`);
export const getRoleByCode = (tx: Tx, code: string): Promise<RoleRow | null> => tx.queryOne<RoleRow>(`SELECT ${ROLE_COLS} FROM councils.participant_roles WHERE code = $1`, [code]);

export type RoleValues = Omit<RoleRow, "id">;

export async function upsertRole(tx: Tx, tenantId: string, id: string, v: RoleValues): Promise<RoleRow> {
  await tx.query(
    `INSERT INTO councils.participant_roles (id, tenant_id, code, label, is_voting, counts_for_quorum, may_sign, can_decide, is_external, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, is_voting = EXCLUDED.is_voting, counts_for_quorum = EXCLUDED.counts_for_quorum,
        may_sign = EXCLUDED.may_sign, can_decide = EXCLUDED.can_decide, is_external = EXCLUDED.is_external, sort_order = EXCLUDED.sort_order,
        active = EXCLUDED.active, updated_at = now()`,
    [id, tenantId, v.code, v.label, v.isVoting, v.countsForQuorum, v.maySign, v.canDecide, v.isExternal, v.sortOrder, v.active],
  );
  return (await getRoleByCode(tx, v.code)) as RoleRow;
}

// ---------------------------------------------------------------------------------------------------------------------
// Types de conseil
// ---------------------------------------------------------------------------------------------------------------------

const TYPE_COLS = `id, code, label, scope, min_results_status AS "minResultsStatus", min_participants AS "minParticipants", required_role_codes AS "requiredRoleCodes",
  signer_functions AS "signerFunctions", signer_role_codes AS "signerRoleCodes", requires_decision_per_student AS "requiresDecisionPerStudent",
  sort_order AS "sortOrder", active`;

export const listCouncilTypes = (tx: Tx): Promise<CouncilTypeRow[]> => tx.many<CouncilTypeRow>(`SELECT ${TYPE_COLS} FROM councils.council_types ORDER BY sort_order, code`);
export const getCouncilType = (tx: Tx, id: string): Promise<CouncilTypeRow | null> => tx.queryOne<CouncilTypeRow>(`SELECT ${TYPE_COLS} FROM councils.council_types WHERE id = $1`, [id]);
export const getCouncilTypeByCode = (tx: Tx, code: string): Promise<CouncilTypeRow | null> => tx.queryOne<CouncilTypeRow>(`SELECT ${TYPE_COLS} FROM councils.council_types WHERE code = $1`, [code]);
export const getCouncilTypesByIds = (tx: Tx, ids: readonly string[]): Promise<CouncilTypeRow[]> =>
  ids.length === 0 ? Promise.resolve([]) : tx.many<CouncilTypeRow>(`SELECT ${TYPE_COLS} FROM councils.council_types WHERE id = ANY($1::uuid[])`, [ids]);

export type CouncilTypeValues = Omit<CouncilTypeRow, "id">;

export async function upsertCouncilType(tx: Tx, tenantId: string, id: string, v: CouncilTypeValues): Promise<CouncilTypeRow> {
  await tx.query(
    `INSERT INTO councils.council_types (id, tenant_id, code, label, scope, min_results_status, min_participants, required_role_codes, signer_functions, signer_role_codes,
        requires_decision_per_student, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10::text[],$11,$12,$13)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, scope = EXCLUDED.scope, min_results_status = EXCLUDED.min_results_status,
        min_participants = EXCLUDED.min_participants, required_role_codes = EXCLUDED.required_role_codes, signer_functions = EXCLUDED.signer_functions,
        signer_role_codes = EXCLUDED.signer_role_codes, requires_decision_per_student = EXCLUDED.requires_decision_per_student,
        sort_order = EXCLUDED.sort_order, active = EXCLUDED.active, updated_at = now()`,
    [id, tenantId, v.code, v.label, v.scope, v.minResultsStatus, v.minParticipants, v.requiredRoleCodes, v.signerFunctions, v.signerRoleCodes, v.requiresDecisionPerStudent, v.sortOrder, v.active],
  );
  return (await getCouncilTypeByCode(tx, v.code)) as CouncilTypeRow;
}

// ---------------------------------------------------------------------------------------------------------------------
// Types de décision
// ---------------------------------------------------------------------------------------------------------------------

const DTYPE_COLS = `id, code, label, family, applies_to AS "appliesTo", exclusive_group AS "exclusiveGroup", requires_justification AS "requiresJustification",
  requires_vote AS "requiresVote", requires_target AS "requiresTarget", results_decision_kind AS "resultsDecisionKind", results_final_code AS "resultsFinalCode",
  academic_outcome_code AS "academicOutcomeCode", needs_human_application AS "needsHumanApplication", student_status AS "studentStatus", is_system AS "isSystem",
  sort_order AS "sortOrder", active`;

export const listDecisionTypes = (tx: Tx): Promise<DecisionTypeRow[]> => tx.many<DecisionTypeRow>(`SELECT ${DTYPE_COLS} FROM councils.decision_types ORDER BY sort_order, code`);
export const getDecisionType = (tx: Tx, id: string): Promise<DecisionTypeRow | null> => tx.queryOne<DecisionTypeRow>(`SELECT ${DTYPE_COLS} FROM councils.decision_types WHERE id = $1`, [id]);
export const getDecisionTypeByCode = (tx: Tx, code: string): Promise<DecisionTypeRow | null> => tx.queryOne<DecisionTypeRow>(`SELECT ${DTYPE_COLS} FROM councils.decision_types WHERE code = $1`, [code]);
export const getDecisionTypesByIds = (tx: Tx, ids: readonly string[]): Promise<DecisionTypeRow[]> =>
  ids.length === 0 ? Promise.resolve([]) : tx.many<DecisionTypeRow>(`SELECT ${DTYPE_COLS} FROM councils.decision_types WHERE id = ANY($1::uuid[])`, [ids]);

export type DecisionTypeValues = Omit<DecisionTypeRow, "id" | "isSystem">;

export async function upsertDecisionType(tx: Tx, tenantId: string, id: string, v: DecisionTypeValues, isSystem = false): Promise<DecisionTypeRow> {
  await tx.query(
    `INSERT INTO councils.decision_types (id, tenant_id, code, label, family, applies_to, exclusive_group, requires_justification, requires_vote, requires_target,
        results_decision_kind, results_final_code, academic_outcome_code, needs_human_application, student_status, is_system, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, family = EXCLUDED.family, applies_to = EXCLUDED.applies_to,
        exclusive_group = EXCLUDED.exclusive_group, requires_justification = EXCLUDED.requires_justification, requires_vote = EXCLUDED.requires_vote,
        requires_target = EXCLUDED.requires_target, results_decision_kind = EXCLUDED.results_decision_kind, results_final_code = EXCLUDED.results_final_code,
        academic_outcome_code = EXCLUDED.academic_outcome_code, needs_human_application = EXCLUDED.needs_human_application, student_status = EXCLUDED.student_status,
        sort_order = EXCLUDED.sort_order, active = EXCLUDED.active, updated_at = now()`,
    [id, tenantId, v.code, v.label, v.family, v.appliesTo, v.exclusiveGroup, v.requiresJustification, v.requiresVote, v.requiresTarget, v.resultsDecisionKind, v.resultsFinalCode, v.academicOutcomeCode, v.needsHumanApplication, v.studentStatus, isSystem, v.sortOrder, v.active],
  );
  return (await getDecisionTypeByCode(tx, v.code)) as DecisionTypeRow;
}

// ---------------------------------------------------------------------------------------------------------------------
// Réglages d'établissement
// ---------------------------------------------------------------------------------------------------------------------

const SETTINGS_COLS = `institution_id AS "institutionId", require_separate_unlocker AS "requireSeparateUnlocker", effects_trigger AS "effectsTrigger",
  guardian_visibility AS "guardianVisibility", allow_quorum_waiver AS "allowQuorumWaiver", minutes_template_key AS "minutesTemplateKey"`;

export const listSettings = (tx: Tx): Promise<SettingsRow[]> => tx.many<SettingsRow>(`SELECT ${SETTINGS_COLS} FROM councils.settings ORDER BY institution_id`);
export const getSettings = (tx: Tx, institutionId: string): Promise<SettingsRow | null> =>
  tx.queryOne<SettingsRow>(`SELECT ${SETTINGS_COLS} FROM councils.settings WHERE institution_id = $1`, [institutionId]);

export type SettingsPatch = Partial<Omit<SettingsRow, "institutionId">>;

/** Défauts prudents (aucun n'est une règle officielle) — spec 006 D6-21. */
export const DEFAULT_SETTINGS: Omit<SettingsRow, "institutionId"> = Object.freeze({
  requireSeparateUnlocker: true,
  effectsTrigger: "SIGNED",
  guardianVisibility: "AFTER_NOTIFICATION",
  allowQuorumWaiver: true,
  minutesTemplateKey: null,
});

export async function upsertSettings(tx: Tx, tenantId: string, institutionId: string, patch: SettingsPatch): Promise<SettingsRow> {
  const existing = await getSettings(tx, institutionId);
  const next = { ...DEFAULT_SETTINGS, ...(existing ?? {}), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Omit<SettingsRow, "institutionId">;
  if (!existing) {
    await tx.query(
      `INSERT INTO councils.settings (tenant_id, institution_id, require_separate_unlocker, effects_trigger, guardian_visibility, allow_quorum_waiver, minutes_template_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, institutionId, next.requireSeparateUnlocker, next.effectsTrigger, next.guardianVisibility, next.allowQuorumWaiver, next.minutesTemplateKey],
    );
  } else {
    await tx.query(
      `UPDATE councils.settings SET require_separate_unlocker = $3, effects_trigger = $4, guardian_visibility = $5, allow_quorum_waiver = $6, minutes_template_key = $7, updated_at = now()
        WHERE tenant_id = $1 AND institution_id = $2`,
      [tenantId, institutionId, next.requireSeparateUnlocker, next.effectsTrigger, next.guardianVisibility, next.allowQuorumWaiver, next.minutesTemplateKey],
    );
  }
  return (await getSettings(tx, institutionId)) as SettingsRow;
}

/** Insère les réglages SEULEMENT s'ils n'existent pas (instanciation du modèle de pack : jamais d'écrasement). */
export async function insertSettingsIfAbsent(tx: Tx, tenantId: string, institutionId: string, v: Omit<SettingsRow, "institutionId">): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO councils.settings (tenant_id, institution_id, require_separate_unlocker, effects_trigger, guardian_visibility, allow_quorum_waiver, minutes_template_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, institution_id) DO NOTHING`,
    [tenantId, institutionId, v.requireSeparateUnlocker, v.effectsTrigger, v.guardianVisibility, v.allowQuorumWaiver, v.minutesTemplateKey],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Usage et verrous
// ---------------------------------------------------------------------------------------------------------------------

/** Le type de conseil est-il déjà utilisé par une séance ? (sa portée ne change alors plus). */
export const countCouncilsOfType = async (tx: Tx, typeId: string): Promise<number> => (await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM councils.councils WHERE council_type_id = $1", [typeId]))?.n ?? 0;
/** Le type de décision est-il déjà utilisé par une décision ? (sa famille ne change alors plus). */
export const countDecisionsOfType = async (tx: Tx, typeId: string): Promise<number> => (await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM councils.decisions WHERE decision_type_id = $1", [typeId]))?.n ?? 0;
/** Sérialise deux instanciations simultanées du modèle de pack pour un même établissement. */
export const lockTemplateInstantiation = (tx: Tx, key: string): Promise<unknown> => tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
