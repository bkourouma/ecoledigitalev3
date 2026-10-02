/**
 * SQL des paramètres d'établissement. Une ligne par tenant, créée à la première modification ; sans ligne, les défauts du
 * code (`DEFAULT_TENANT_SETTINGS`, identiques aux défauts de la table) s'appliquent.
 */
import type { Tx } from "@ecoledigitale/database";
import type { NotifChannel, NotifConsentModel } from "@ecoledigitale/contracts/src/v2/notifications";
import { DEFAULT_TENANT_SETTINGS, type TenantSettings } from "../domain/types";

interface SettingsRow {
  enabledChannels: NotifChannel[];
  senderName: string | null;
  replyTo: string | null;
  timezone: string;
  defaultDialCode: string;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  dailyCaps: Partial<Record<NotifChannel, number>>;
  perRecipientDailyCap: number;
  consentModels: Partial<Record<NotifChannel, NotifConsentModel>>;
  urgentBypassesRevocations: boolean;
  maxAttempts: number;
  journalRetentionDays: number;
  legalFooter: string | null;
  updatedAt: Date;
}

const COLS = `enabled_channels AS "enabledChannels", sender_name AS "senderName", reply_to AS "replyTo", timezone,
  default_dial_code AS "defaultDialCode", quiet_hours_enabled AS "quietHoursEnabled",
  to_char(quiet_start, 'HH24:MI') AS "quietStart", to_char(quiet_end, 'HH24:MI') AS "quietEnd",
  daily_caps AS "dailyCaps", per_recipient_daily_cap AS "perRecipientDailyCap", consent_models AS "consentModels",
  urgent_bypasses_revocations AS "urgentBypassesRevocations", max_attempts AS "maxAttempts",
  journal_retention_days AS "journalRetentionDays", legal_footer AS "legalFooter", updated_at AS "updatedAt"`;

const toSettings = (r: SettingsRow): TenantSettings => ({ ...r });

export async function getSettings(tx: Tx, tenantId: string): Promise<TenantSettings> {
  const row = await tx.queryOne<SettingsRow>(`SELECT ${COLS} FROM notifications.settings WHERE tenant_id = $1`, [tenantId]);
  return row ? toSettings(row) : DEFAULT_TENANT_SETTINGS;
}

/** Remplace la ligne par `next` (déjà fusionné par l'appelant). */
export async function putSettings(tx: Tx, tenantId: string, next: TenantSettings, actor: string | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.settings (tenant_id, enabled_channels, sender_name, reply_to, timezone, default_dial_code, quiet_hours_enabled,
        quiet_start, quiet_end, daily_caps, per_recipient_daily_cap, consent_models, urgent_bypasses_revocations, max_attempts,
        journal_retention_days, legal_footer, updated_by, updated_at)
     VALUES ($1,$2::text[],$3,$4,$5,$6,$7,$8::time,$9::time,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (tenant_id) DO UPDATE SET enabled_channels = EXCLUDED.enabled_channels, sender_name = EXCLUDED.sender_name,
        reply_to = EXCLUDED.reply_to, timezone = EXCLUDED.timezone, default_dial_code = EXCLUDED.default_dial_code,
        quiet_hours_enabled = EXCLUDED.quiet_hours_enabled, quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
        daily_caps = EXCLUDED.daily_caps, per_recipient_daily_cap = EXCLUDED.per_recipient_daily_cap,
        consent_models = EXCLUDED.consent_models, urgent_bypasses_revocations = EXCLUDED.urgent_bypasses_revocations,
        max_attempts = EXCLUDED.max_attempts, journal_retention_days = EXCLUDED.journal_retention_days,
        legal_footer = EXCLUDED.legal_footer, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [
      tenantId,
      [...next.enabledChannels],
      next.senderName,
      next.replyTo,
      next.timezone,
      next.defaultDialCode,
      next.quietHoursEnabled,
      next.quietStart,
      next.quietEnd,
      JSON.stringify(next.dailyCaps),
      next.perRecipientDailyCap,
      JSON.stringify(next.consentModels),
      next.urgentBypassesRevocations,
      next.maxAttempts,
      next.journalRetentionDays,
      next.legalFooter,
      actor,
      now,
    ],
  );
}
