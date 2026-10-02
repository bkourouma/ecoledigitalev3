/** Paramètres d'établissement : réglages, niveaux de gravité, types d'événements (DONNÉES, vides par défaut). */
import type { Tx } from "@ecoledigitale/database";
import type { EventTypeRow, SettingsRow, SeverityRow } from "./rows";

const SETTINGS_COLS = `institution_id AS "institutionId", conduct_points_enabled AS "conductPointsEnabled",
  confidential_read_requires_purpose AS "confidentialReadRequiresPurpose", retention_days AS "retentionDays",
  convocation_reminder_hours AS "convocationReminderHours", exclusion_boundary_notices AS "exclusionBoundaryNotices"`;

export const listSettings = (tx: Tx): Promise<SettingsRow[]> => tx.many<SettingsRow>(`SELECT ${SETTINGS_COLS} FROM schoollife.settings ORDER BY institution_id`);

export const getSettings = (tx: Tx, institutionId: string): Promise<SettingsRow | null> =>
  tx.queryOne<SettingsRow>(`SELECT ${SETTINGS_COLS} FROM schoollife.settings WHERE institution_id = $1`, [institutionId]);

export interface SettingsPatch {
  conductPointsEnabled?: boolean | undefined;
  confidentialReadRequiresPurpose?: boolean | undefined;
  retentionDays?: number | null | undefined;
  convocationReminderHours?: number | null | undefined;
  exclusionBoundaryNotices?: boolean | undefined;
}

export async function upsertSettings(tx: Tx, tenantId: string, institutionId: string, patch: SettingsPatch): Promise<SettingsRow> {
  const existing = await getSettings(tx, institutionId);
  if (!existing) {
    await tx.query(
      `INSERT INTO schoollife.settings (tenant_id, institution_id, conduct_points_enabled, confidential_read_requires_purpose, retention_days, convocation_reminder_hours, exclusion_boundary_notices)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, institutionId, patch.conductPointsEnabled ?? false, patch.confidentialReadRequiresPurpose ?? true, patch.retentionDays ?? null, patch.convocationReminderHours ?? null, patch.exclusionBoundaryNotices ?? false],
    );
  } else {
    await tx.query(
      `UPDATE schoollife.settings SET conduct_points_enabled = $3, confidential_read_requires_purpose = $4, retention_days = $5,
              convocation_reminder_hours = $6, exclusion_boundary_notices = $7, updated_at = now()
        WHERE tenant_id = $1 AND institution_id = $2`,
      [
        tenantId,
        institutionId,
        patch.conductPointsEnabled ?? existing.conductPointsEnabled,
        patch.confidentialReadRequiresPurpose ?? existing.confidentialReadRequiresPurpose,
        patch.retentionDays === undefined ? existing.retentionDays : patch.retentionDays,
        patch.convocationReminderHours === undefined ? existing.convocationReminderHours : patch.convocationReminderHours,
        patch.exclusionBoundaryNotices ?? existing.exclusionBoundaryNotices,
      ],
    );
  }
  return (await getSettings(tx, institutionId)) as SettingsRow;
}

const SEV_COLS = `id, code, label, rank, active`;
export const listSeverities = (tx: Tx): Promise<SeverityRow[]> => tx.many<SeverityRow>(`SELECT ${SEV_COLS} FROM schoollife.severity_levels ORDER BY rank`);
export const getSeverityByCode = (tx: Tx, code: string): Promise<SeverityRow | null> => tx.queryOne<SeverityRow>(`SELECT ${SEV_COLS} FROM schoollife.severity_levels WHERE code = $1`, [code]);

export async function upsertSeverity(tx: Tx, tenantId: string, id: string, v: { code: string; label: string; rank: number; active: boolean }): Promise<SeverityRow> {
  await tx.query(
    `INSERT INTO schoollife.severity_levels (id, tenant_id, code, label, rank, active) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, rank = EXCLUDED.rank, active = EXCLUDED.active, updated_at = now()`,
    [id, tenantId, v.code, v.label, v.rank, v.active],
  );
  return (await getSeverityByCode(tx, v.code)) as SeverityRow;
}

const TYPE_COLS = `id, code, label, kind, default_severity_code AS "defaultSeverityCode", requires_validation AS "requiresValidation",
  requires_four_eyes AS "requiresFourEyes", approver_permission AS "approverPermission", notify_guardians AS "notifyGuardians",
  visible_to_guardians AS "visibleToGuardians", confidentiality_default AS "confidentialityDefault", requires_dates AS "requiresDates",
  appealable, is_placeholder AS "isPlaceholder", sort_order AS "sortOrder", active`;

export const listEventTypes = (tx: Tx): Promise<EventTypeRow[]> => tx.many<EventTypeRow>(`SELECT ${TYPE_COLS} FROM schoollife.event_types ORDER BY sort_order, code`);
export const getEventType = (tx: Tx, id: string): Promise<EventTypeRow | null> => tx.queryOne<EventTypeRow>(`SELECT ${TYPE_COLS} FROM schoollife.event_types WHERE id = $1`, [id]);
export const getEventTypeByCode = (tx: Tx, code: string): Promise<EventTypeRow | null> => tx.queryOne<EventTypeRow>(`SELECT ${TYPE_COLS} FROM schoollife.event_types WHERE code = $1`, [code]);
export const getEventTypesByIds = (tx: Tx, ids: readonly string[]): Promise<EventTypeRow[]> =>
  ids.length === 0 ? Promise.resolve([]) : tx.many<EventTypeRow>(`SELECT ${TYPE_COLS} FROM schoollife.event_types WHERE id = ANY($1::uuid[])`, [ids]);

export interface EventTypeValues {
  code: string;
  label: string;
  kind: EventTypeRow["kind"];
  defaultSeverityCode: string | null;
  requiresValidation: boolean;
  requiresFourEyes: boolean;
  approverPermission: string | null;
  notifyGuardians: boolean;
  visibleToGuardians: boolean;
  confidentialityDefault: EventTypeRow["confidentialityDefault"];
  requiresDates: boolean;
  appealable: boolean;
  isPlaceholder: boolean;
  sortOrder: number;
  active: boolean;
}

export async function upsertEventType(tx: Tx, tenantId: string, id: string, v: EventTypeValues): Promise<EventTypeRow> {
  await tx.query(
    `INSERT INTO schoollife.event_types (id, tenant_id, code, label, kind, default_severity_code, requires_validation, requires_four_eyes, approver_permission,
        notify_guardians, visible_to_guardians, confidentiality_default, requires_dates, appealable, is_placeholder, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, default_severity_code = EXCLUDED.default_severity_code,
        requires_validation = EXCLUDED.requires_validation, requires_four_eyes = EXCLUDED.requires_four_eyes, approver_permission = EXCLUDED.approver_permission,
        notify_guardians = EXCLUDED.notify_guardians, visible_to_guardians = EXCLUDED.visible_to_guardians, confidentiality_default = EXCLUDED.confidentiality_default,
        requires_dates = EXCLUDED.requires_dates, appealable = EXCLUDED.appealable, is_placeholder = EXCLUDED.is_placeholder,
        sort_order = EXCLUDED.sort_order, active = EXCLUDED.active`,
    [id, tenantId, v.code, v.label, v.kind, v.defaultSeverityCode, v.requiresValidation, v.requiresFourEyes, v.approverPermission, v.notifyGuardians, v.visibleToGuardians, v.confidentialityDefault, v.requiresDates, v.appealable, v.isPlaceholder, v.sortOrder, v.active],
  );
  return (await getEventTypeByCode(tx, v.code)) as EventTypeRow;
}
