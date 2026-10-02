/**
 * SQL des notifications in-app et des préférences. L'insertion de masse applique les préférences en SQL (une requête).
 */
import type { Tx } from "@ecoledigitale/database";
import type { Uuid } from "../domain/types";

export type NotificationCategory = "MESSAGE" | "ANNOUNCEMENT" | "SYSTEM" | "MODERATION";

export interface NotificationRow {
  id: Uuid;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string | null;
  occurrences: number;
  createdAt: Date;
  updatedAt: Date;
  readAt: Date | null;
}

const COLS = `id, category, title, body, link, occurrences, created_at AS "createdAt", updated_at AS "updatedAt", read_at AS "readAt"`;

export interface NotificationDraft {
  id: Uuid;
  userId: Uuid;
  title: string;
  body: string | null;
  link: string | null;
  entityId: Uuid | null;
  /** Une notification NON LUE par clé : un nouvel événement incrémente le compteur au lieu d'en créer une autre. */
  dedupeKey: string | null;
}

export interface InsertNotificationsInput {
  tenantId: Uuid;
  category: NotificationCategory;
  entityType: string | null;
  /** `true` : ignore les préférences (modération, annonce urgente). */
  bypassPrefs: boolean;
  now: Date;
  rows: readonly NotificationDraft[];
}

/**
 * Insère (ou agrège) les notifications des destinataires dont les préférences l'autorisent. Retourne le nombre de lignes
 * écrites. Les catégories hors préférences (`MODERATION`) contournent toujours les préférences.
 */
export async function insertNotifications(tx: Tx, input: InsertNotificationsInput): Promise<number> {
  if (input.rows.length === 0) return 0;
  const prefCategory = input.category === "MODERATION" ? "SYSTEM" : input.category;
  const bypass = input.bypassPrefs || input.category === "MODERATION";
  const r = input.rows;
  const result = await tx.query(
    `WITH drafts AS (
       SELECT * FROM unnest($4::uuid[], $5::uuid[], $6::text[], $7::text[], $8::text[], $9::uuid[], $10::text[])
              AS d(id, user_id, title, body, link, entity_id, dedupe_key)
     ), eligible AS (
       SELECT d.* FROM drafts d
         LEFT JOIN messaging.notification_preferences np ON np.tenant_id = $1 AND np.user_id = d.user_id AND np.category = $2
        WHERE $3::boolean OR np.user_id IS NULL OR (np.in_app AND (np.muted_until IS NULL OR np.muted_until <= $11))
     )
     INSERT INTO messaging.notifications (id, tenant_id, user_id, category, title, body, link, entity_type, entity_id, dedupe_key, occurrences, created_at, updated_at)
     SELECT e.id, $1, e.user_id, $12, e.title, e.body, e.link, $13, e.entity_id, e.dedupe_key, 1, $11, $11 FROM eligible e
     ON CONFLICT (tenant_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND read_at IS NULL
     DO UPDATE SET occurrences = messaging.notifications.occurrences + 1, updated_at = EXCLUDED.updated_at, title = EXCLUDED.title, body = EXCLUDED.body`,
    [
      input.tenantId,
      prefCategory,
      bypass,
      r.map((x) => x.id),
      r.map((x) => x.userId),
      r.map((x) => x.title),
      r.map((x) => x.body),
      r.map((x) => x.link),
      r.map((x) => x.entityId),
      r.map((x) => x.dedupeKey),
      input.now,
      input.category,
      input.entityType,
    ],
  );
  return result.rowCount ?? 0;
}

export async function listNotifications(
  tx: Tx,
  tenantId: Uuid,
  userId: Uuid,
  input: { unreadOnly: boolean; cursor: { t: string; id: Uuid } | null; limit: number },
): Promise<NotificationRow[]> {
  return tx.many<NotificationRow>(
    `SELECT ${COLS} FROM messaging.notifications
      WHERE tenant_id = $1 AND user_id = $2 AND ($3::boolean IS NOT TRUE OR read_at IS NULL)
        AND ($4::timestamptz IS NULL OR (updated_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY updated_at DESC, id DESC LIMIT $6`,
    [tenantId, userId, input.unreadOnly, input.cursor?.t ?? null, input.cursor?.id ?? null, input.limit],
  );
}

export async function countUnreadNotifications(tx: Tx, tenantId: Uuid, userId: Uuid): Promise<number> {
  const row = await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM messaging.notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL", [tenantId, userId]);
  return row?.n ?? 0;
}

/** Marque une notification lue (idempotent). `false` si elle n'existe pas pour cet utilisateur. */
export async function markNotificationRead(tx: Tx, tenantId: Uuid, userId: Uuid, id: Uuid, now: Date): Promise<boolean> {
  const row = await tx.queryOne<{ id: Uuid }>(
    "SELECT id FROM messaging.notifications WHERE tenant_id = $1 AND user_id = $2 AND id = $3",
    [tenantId, userId, id],
  );
  if (!row) return false;
  await tx.query("UPDATE messaging.notifications SET read_at = coalesce(read_at, $4) WHERE tenant_id = $1 AND user_id = $2 AND id = $3", [tenantId, userId, id, now]);
  return true;
}

export async function markAllNotificationsRead(tx: Tx, tenantId: Uuid, userId: Uuid, now: Date): Promise<number> {
  const rows = await tx.many<{ id: Uuid }>(
    "UPDATE messaging.notifications SET read_at = $3 WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id",
    [tenantId, userId, now],
  );
  return rows.length;
}

/** Lire un fil / une annonce marque sa notification lue. */
export async function markNotificationReadByKey(tx: Tx, tenantId: Uuid, userId: Uuid, dedupeKey: string, now: Date): Promise<void> {
  await tx.query(
    "UPDATE messaging.notifications SET read_at = $4 WHERE tenant_id = $1 AND user_id = $2 AND dedupe_key = $3 AND read_at IS NULL",
    [tenantId, userId, dedupeKey, now],
  );
}

/** Purge des notifications LUES plus anciennes que `before`. */
export async function purgeReadNotifications(tx: Tx, tenantId: Uuid, before: Date): Promise<number> {
  const rows = await tx.many<{ id: Uuid }>("DELETE FROM messaging.notifications WHERE tenant_id = $1 AND read_at IS NOT NULL AND read_at < $2 RETURNING id", [tenantId, before]);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Préférences
// ---------------------------------------------------------------------------

export interface PreferenceRow {
  category: "MESSAGE" | "ANNOUNCEMENT" | "SYSTEM";
  inApp: boolean;
  externalChannels: string[];
  mutedUntil: Date | null;
}

export async function listPreferences(tx: Tx, tenantId: Uuid, userId: Uuid): Promise<PreferenceRow[]> {
  return tx.many<PreferenceRow>(
    `SELECT category, in_app AS "inApp", external_channels AS "externalChannels", muted_until AS "mutedUntil"
       FROM messaging.notification_preferences WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId],
  );
}

export async function upsertPreference(tx: Tx, tenantId: Uuid, userId: Uuid, p: PreferenceRow, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO messaging.notification_preferences (tenant_id, user_id, category, in_app, external_channels, muted_until, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, user_id, category) DO UPDATE SET in_app = EXCLUDED.in_app, external_channels = EXCLUDED.external_channels,
        muted_until = EXCLUDED.muted_until, updated_at = EXCLUDED.updated_at`,
    [tenantId, userId, p.category, p.inApp, p.externalChannels, p.mutedUntil, now],
  );
}
