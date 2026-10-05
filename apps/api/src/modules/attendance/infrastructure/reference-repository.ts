/** Référentiels de pack : statuts, motifs, types de congé, politiques d'appel, paramètres. */
import type { Tx } from "@ecoledigitale/database";
import { parseAlertRules, type AlertRule } from "../domain/alerts";
import type { AttendancePackTemplate } from "../domain/reference-pack";
import type { AttachmentType, CallPolicy, StatusDefinition, SubjectKind, Uuid } from "../domain/types";
import { CALL_POLICY_COLUMNS, STATUS_COLUMNS, toCallPolicy, toStatus, type CallPolicyRow, type StatusRow } from "./rows";

export interface JustificationReason {
  readonly id: Uuid;
  readonly code: string;
  readonly label: string;
  readonly requiresAttachment: boolean;
  readonly sortOrder: number;
  readonly active: boolean;
}
export interface LeaveType {
  readonly id: Uuid;
  readonly code: string;
  readonly label: string;
  readonly isPaid: boolean;
  readonly requiresApproval: boolean;
  readonly requiresAttachment: boolean;
  readonly active: boolean;
}
export interface AttendanceSettings {
  readonly attachmentMaxBytes: number | null;
  readonly allowedAttachmentTypes: readonly AttachmentType[] | null;
  readonly allowFutureJustifications: boolean;
  readonly alertRules: readonly AlertRule[];
}
export const DEFAULT_SETTINGS: AttendanceSettings = Object.freeze({
  attachmentMaxBytes: null,
  allowedAttachmentTypes: null,
  allowFutureJustifications: false,
  alertRules: [],
});

// --- statuts ----------------------------------------------------------------

export async function listStatuses(tx: Tx, kind?: SubjectKind): Promise<StatusDefinition[]> {
  const rows = kind
    ? await tx.many<StatusRow>(`SELECT ${STATUS_COLUMNS} FROM attendance.status_definitions WHERE subject_kind = $1 ORDER BY sort_order, code`, [kind])
    : await tx.many<StatusRow>(`SELECT ${STATUS_COLUMNS} FROM attendance.status_definitions ORDER BY subject_kind, sort_order, code`);
  return rows.map(toStatus);
}

export async function upsertStatus(tx: Tx, tenantId: Uuid, id: Uuid, def: StatusDefinition): Promise<void> {
  await tx.query(
    `INSERT INTO attendance.status_definitions (id, tenant_id, subject_kind, code, label, counts_as_present, counts_as_absence, counts_as_late,
                                                is_justified, requires_justification, sort_order, is_system, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, subject_kind, code) DO UPDATE
       SET label = EXCLUDED.label, counts_as_present = EXCLUDED.counts_as_present, counts_as_absence = EXCLUDED.counts_as_absence,
           counts_as_late = EXCLUDED.counts_as_late, is_justified = EXCLUDED.is_justified,
           requires_justification = EXCLUDED.requires_justification, sort_order = EXCLUDED.sort_order,
           active = EXCLUDED.active, updated_at = now()`,
    [
      id, tenantId, def.subjectKind, def.code, def.label, def.countsAsPresent, def.countsAsAbsence, def.countsAsLate,
      def.isJustified, def.requiresJustification, def.sortOrder, def.isSystem, def.active,
    ],
  );
}

// --- motifs -----------------------------------------------------------------

interface ReasonRow {
  id: Uuid; code: string; label: string; requires_attachment: boolean; sort_order: number; active: boolean;
}
const toReason = (r: ReasonRow): JustificationReason => ({
  id: r.id, code: r.code, label: r.label, requiresAttachment: r.requires_attachment, sortOrder: r.sort_order, active: r.active,
});

export async function listReasons(tx: Tx): Promise<JustificationReason[]> {
  return (await tx.many<ReasonRow>("SELECT id, code, label, requires_attachment, sort_order, active FROM attendance.justification_reasons ORDER BY sort_order, code")).map(toReason);
}
export async function getReason(tx: Tx, code: string): Promise<JustificationReason | null> {
  const r = await tx.queryOne<ReasonRow>("SELECT id, code, label, requires_attachment, sort_order, active FROM attendance.justification_reasons WHERE code = $1", [code]);
  return r ? toReason(r) : null;
}
export async function upsertReason(
  tx: Tx, tenantId: Uuid, id: Uuid, input: { code: string; label: string; requiresAttachment: boolean; sortOrder: number; active: boolean },
): Promise<JustificationReason> {
  const r = await tx.many<ReasonRow>(
    `INSERT INTO attendance.justification_reasons (id, tenant_id, code, label, requires_attachment, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, requires_attachment = EXCLUDED.requires_attachment,
       sort_order = EXCLUDED.sort_order, active = EXCLUDED.active, updated_at = now()
     RETURNING id, code, label, requires_attachment, sort_order, active`,
    [id, tenantId, input.code, input.label, input.requiresAttachment, input.sortOrder, input.active],
  );
  return toReason(r[0] as ReasonRow);
}

// --- types de congé ---------------------------------------------------------

interface LeaveTypeRow {
  id: Uuid; code: string; label: string; is_paid: boolean; requires_approval: boolean; requires_attachment: boolean; active: boolean;
}
const toLeaveType = (r: LeaveTypeRow): LeaveType => ({
  id: r.id, code: r.code, label: r.label, isPaid: r.is_paid, requiresApproval: r.requires_approval, requiresAttachment: r.requires_attachment, active: r.active,
});
export async function listLeaveTypes(tx: Tx): Promise<LeaveType[]> {
  return (await tx.many<LeaveTypeRow>("SELECT id, code, label, is_paid, requires_approval, requires_attachment, active FROM attendance.leave_types ORDER BY code")).map(toLeaveType);
}
export async function getLeaveType(tx: Tx, code: string): Promise<LeaveType | null> {
  const r = await tx.queryOne<LeaveTypeRow>("SELECT id, code, label, is_paid, requires_approval, requires_attachment, active FROM attendance.leave_types WHERE code = $1", [code]);
  return r ? toLeaveType(r) : null;
}
export async function upsertLeaveType(
  tx: Tx, tenantId: Uuid, id: Uuid, input: { code: string; label: string; isPaid: boolean; requiresApproval: boolean; requiresAttachment: boolean; active: boolean },
): Promise<LeaveType> {
  const r = await tx.many<LeaveTypeRow>(
    `INSERT INTO attendance.leave_types (id, tenant_id, code, label, is_paid, requires_approval, requires_attachment, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, is_paid = EXCLUDED.is_paid, requires_approval = EXCLUDED.requires_approval,
       requires_attachment = EXCLUDED.requires_attachment, active = EXCLUDED.active, updated_at = now()
     RETURNING id, code, label, is_paid, requires_approval, requires_attachment, active`,
    [id, tenantId, input.code, input.label, input.isPaid, input.requiresApproval, input.requiresAttachment, input.active],
  );
  return toLeaveType(r[0] as LeaveTypeRow);
}

// --- politiques d'appel -----------------------------------------------------

export async function listCallPolicies(tx: Tx): Promise<CallPolicy[]> {
  return (await tx.many<CallPolicyRow>(`SELECT ${CALL_POLICY_COLUMNS} FROM attendance.call_policies ORDER BY institution_id, education_level_code`)).map(toCallPolicy);
}
export async function upsertCallPolicy(tx: Tx, tenantId: Uuid, p: CallPolicy): Promise<CallPolicy> {
  const r = await tx.many<CallPolicyRow>(
    `INSERT INTO attendance.call_policies (tenant_id, institution_id, education_level_code, call_scope, edit_window_minutes, late_requires_minutes, daily_minutes, daily_call_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, institution_id, education_level_code) DO UPDATE
       SET call_scope = EXCLUDED.call_scope, edit_window_minutes = EXCLUDED.edit_window_minutes,
           late_requires_minutes = EXCLUDED.late_requires_minutes, daily_minutes = EXCLUDED.daily_minutes,
           daily_call_mode = EXCLUDED.daily_call_mode, updated_at = now()
     RETURNING ${CALL_POLICY_COLUMNS}`,
    [tenantId, p.institutionId, p.educationLevelCode, p.callScope, p.editWindowMinutes, p.lateRequiresMinutes, p.dailyMinutes, p.dailyCallMode],
  );
  return toCallPolicy(r[0] as CallPolicyRow);
}

// --- paramètres -------------------------------------------------------------

interface SettingsRow {
  attachment_max_bytes: number | null;
  allowed_attachment_types: AttachmentType[] | null;
  allow_future_justifications: boolean;
  alert_rules: unknown;
}

export async function getSettings(tx: Tx): Promise<AttendanceSettings> {
  const r = await tx.queryOne<SettingsRow>(
    "SELECT attachment_max_bytes, allowed_attachment_types, allow_future_justifications, alert_rules FROM attendance.settings",
  );
  if (!r) return DEFAULT_SETTINGS;
  const rules = parseAlertRules(r.alert_rules);
  return {
    attachmentMaxBytes: r.attachment_max_bytes,
    allowedAttachmentTypes: r.allowed_attachment_types,
    allowFutureJustifications: r.allow_future_justifications,
    alertRules: rules.ok ? rules.value : [],
  };
}

export async function upsertSettings(tx: Tx, tenantId: Uuid, s: AttendanceSettings): Promise<void> {
  await tx.query(
    `INSERT INTO attendance.settings (tenant_id, attachment_max_bytes, allowed_attachment_types, allow_future_justifications, alert_rules)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE
       SET attachment_max_bytes = EXCLUDED.attachment_max_bytes, allowed_attachment_types = EXCLUDED.allowed_attachment_types,
           allow_future_justifications = EXCLUDED.allow_future_justifications, alert_rules = EXCLUDED.alert_rules, updated_at = now()`,
    [tenantId, s.attachmentMaxBytes, s.allowedAttachmentTypes ? [...s.allowedAttachmentTypes] : null, s.allowFutureJustifications, JSON.stringify(s.alertRules)],
  );
}

// --- amorçage depuis un modèle de pack --------------------------------------

export async function hasReferenceData(tx: Tx): Promise<boolean> {
  return (await tx.queryOne("SELECT 1 AS x FROM attendance.status_definitions LIMIT 1")) !== null;
}

/**
 * Instancie un modèle de pack, de façon IDEMPOTENTE et NON DESTRUCTIVE : ce qui existe déjà (y compris modifié par
 * l'établissement) n'est jamais écrasé. Les politiques d'appel ne sont créées que pour les établissements fournis.
 */
export async function seedFromPack(
  tx: Tx,
  tenantId: Uuid,
  pack: AttendancePackTemplate,
  newId: () => string,
  institutionIds: readonly Uuid[] = [],
): Promise<{ statuses: number; reasons: number; leaveTypes: number; policies: number }> {
  let statuses = 0;
  let reasons = 0;
  let leaveTypes = 0;
  let policies = 0;
  for (const [i, s] of pack.statusDefinitions.entries()) {
    const res = await tx.query(
      `INSERT INTO attendance.status_definitions (id, tenant_id, subject_kind, code, label, counts_as_present, counts_as_absence, counts_as_late,
                                                  is_justified, requires_justification, sort_order, is_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, subject_kind, code) DO NOTHING`,
      [newId(), tenantId, s.subject, s.code, s.label, s.present ?? false, s.absence ?? false, s.late ?? false, s.justified ?? false, s.requiresJustification ?? false, i * 10, s.system ?? false],
    );
    statuses += res.rowCount;
  }
  for (const [i, r] of pack.justificationReasons.entries()) {
    const res = await tx.query(
      `INSERT INTO attendance.justification_reasons (id, tenant_id, code, label, requires_attachment, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [newId(), tenantId, r.code, r.label, r.requiresAttachment ?? false, i * 10],
    );
    reasons += res.rowCount;
  }
  for (const l of pack.leaveTypes) {
    const res = await tx.query(
      `INSERT INTO attendance.leave_types (id, tenant_id, code, label, is_paid, requires_approval, requires_attachment)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [newId(), tenantId, l.code, l.label, l.paid ?? true, l.requiresApproval ?? true, l.requiresAttachment ?? false],
    );
    leaveTypes += res.rowCount;
  }
  for (const institutionId of institutionIds) {
    for (const p of pack.callPolicies) {
      const res = await tx.query(
        `INSERT INTO attendance.call_policies (tenant_id, institution_id, education_level_code, call_scope, edit_window_minutes, late_requires_minutes, daily_minutes, daily_call_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, institution_id, education_level_code) DO NOTHING`,
        [tenantId, institutionId, p.educationLevel, p.callScope, p.editWindowMinutes ?? null, p.lateRequiresMinutes ?? false, p.dailyMinutes ?? null, p.dailyCallMode ?? "SINGLE"],
      );
      policies += res.rowCount;
    }
  }
  await tx.query(
    `INSERT INTO attendance.settings (tenant_id, attachment_max_bytes, allowed_attachment_types, allow_future_justifications, alert_rules)
     VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (tenant_id) DO NOTHING`,
    [
      tenantId,
      pack.settings.attachmentMaxBytes ?? null,
      pack.settings.allowedAttachmentTypes ? [...pack.settings.allowedAttachmentTypes] : null,
      pack.settings.allowFutureJustifications ?? false,
      JSON.stringify(pack.settings.alertRules ?? []),
    ],
  );
  return { statuses, reasons, leaveTypes, policies };
}
