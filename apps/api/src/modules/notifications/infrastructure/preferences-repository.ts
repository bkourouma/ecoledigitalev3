/**
 * SQL des préférences, du consentement (journal de preuve), des heures calmes personnelles et de la liste de suppression.
 */
import type { Tx } from "@ecoledigitale/database";
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";
import type { PreferenceRow, QuietOverride } from "../domain/consent";

export async function listPreferences(tx: Tx, tenantId: string, subjectKeys: readonly string[]): Promise<Array<PreferenceRow & { subjectKey: string }>> {
  if (subjectKeys.length === 0) return [];
  return tx.many(
    `SELECT subject_key AS "subjectKey", channel, category, enabled FROM notifications.channel_preferences
      WHERE tenant_id = $1 AND subject_key = ANY($2::text[])`,
    [tenantId, [...subjectKeys]],
  );
}

export async function putPreference(tx: Tx, tenantId: string, input: { subjectKey: string; channel: NotifChannel; category: string; enabled: boolean; at: Date }): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.channel_preferences (tenant_id, subject_key, channel, category, enabled, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, subject_key, channel, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
    [tenantId, input.subjectKey, input.channel, input.category, input.enabled, input.at],
  );
}

export async function getSubjectPreferences(tx: Tx, tenantId: string, subjectKeys: readonly string[]): Promise<Map<string, QuietOverride & { language: string | null }>> {
  if (subjectKeys.length === 0) return new Map();
  const rows = await tx.many<{ subjectKey: string; enabled: boolean | null; start: string | null; end: string | null; language: string | null }>(
    `SELECT subject_key AS "subjectKey", quiet_enabled AS enabled, to_char(quiet_start, 'HH24:MI') AS start, to_char(quiet_end, 'HH24:MI') AS "end", language
       FROM notifications.subject_preferences WHERE tenant_id = $1 AND subject_key = ANY($2::text[])`,
    [tenantId, [...subjectKeys]],
  );
  return new Map(rows.map((r) => [r.subjectKey, { enabled: r.enabled, start: r.start, end: r.end, language: r.language }]));
}

export async function putQuietHours(tx: Tx, tenantId: string, input: { subjectKey: string; enabled: boolean | null; start: string | null; end: string | null; at: Date }): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.subject_preferences (tenant_id, subject_key, quiet_enabled, quiet_start, quiet_end, updated_at)
     VALUES ($1,$2,$3,$4::time,$5::time,$6)
     ON CONFLICT (tenant_id, subject_key) DO UPDATE SET quiet_enabled = EXCLUDED.quiet_enabled, quiet_start = EXCLUDED.quiet_start,
        quiet_end = EXCLUDED.quiet_end, updated_at = EXCLUDED.updated_at`,
    [tenantId, input.subjectKey, input.enabled, input.start, input.end, input.at],
  );
}

export type ConsentSource = "SELF" | "ADMIN" | "UNSUBSCRIBE_LINK" | "BOUNCE" | "IMPORT";

export async function insertConsentLog(
  tx: Tx,
  tenantId: string,
  entry: { id: string; at: Date; subjectKey: string; userId: string | null; channel: NotifChannel; category: string; enabled: boolean; source: ConsentSource; actorUserId: string | null; note: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.consent_log (id, tenant_id, at, subject_key, user_id, channel, category, enabled, source, actor_user_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [entry.id, tenantId, entry.at, entry.subjectKey, entry.userId, entry.channel, entry.category, entry.enabled, entry.source, entry.actorUserId, entry.note],
  );
}

export async function listConsentLog(tx: Tx, tenantId: string, subjectKeys: readonly string[], limit: number): Promise<Array<{ at: Date; channel: NotifChannel; category: string; enabled: boolean; source: ConsentSource; actorUserId: string | null }>> {
  return tx.many(
    `SELECT at, channel, category, enabled, source, actor_user_id AS "actorUserId" FROM notifications.consent_log
      WHERE tenant_id = $1 AND subject_key = ANY($2::text[]) ORDER BY at DESC, id DESC LIMIT $3`,
    [tenantId, [...subjectKeys], limit],
  );
}

// ---------------------------------------------------------------------------
// Liste de suppression
// ---------------------------------------------------------------------------

export async function suppressedHashes(tx: Tx, tenantId: string, channel: NotifChannel, hashes: readonly string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await tx.many<{ hash: string }>(
    `SELECT address_hash AS hash FROM notifications.suppressions WHERE tenant_id = $1 AND channel = $2 AND address_hash = ANY($3::text[])`,
    [tenantId, channel, [...hashes]],
  );
  return new Set(rows.map((r) => r.hash));
}

export async function addSuppression(
  tx: Tx,
  tenantId: string,
  input: { channel: NotifChannel; hash: string; masked: string; reason: "HARD_BOUNCE" | "COMPLAINT" | "INVALID" | "MANUAL"; deliveryId: string | null; at: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.suppressions (tenant_id, channel, address_hash, address_masked, reason, created_at, delivery_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, channel, address_hash) DO NOTHING`,
    [tenantId, input.channel, input.hash, input.masked, input.reason, input.at, input.deliveryId],
  );
}

export async function listSuppressions(tx: Tx, tenantId: string, limit: number): Promise<Array<{ channel: NotifChannel; masked: string; reason: string; createdAt: Date }>> {
  return tx.many(
    `SELECT channel, address_masked AS masked, reason, created_at AS "createdAt" FROM notifications.suppressions
      WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit],
  );
}
