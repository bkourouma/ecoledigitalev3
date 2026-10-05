/**
 * SQL des paramètres d'établissement et des catégories (+ droits de catégorie).
 */
import type { Tx } from "@ecoledigitale/database";
import type { DocumentConfidentiality, DocumentKind } from "../domain/types";
import { DEFAULT_CATEGORIES } from "../domain/default-categories";
import type { Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

export interface SettingsRow {
  maxBytes: number;
  storageQuotaBytes: number | null;
  defaultAlertDays: number[];
  archiveRetentionDays: number;
  quarantineRetentionDays: number;
  maxVersions: number;
  updatedAt: Date | null;
}

/** Défauts du code : identiques à ceux de la table (vérifié par test). */
export const DEFAULT_SETTINGS: SettingsRow = Object.freeze({
  maxBytes: 15_728_640,
  storageQuotaBytes: null,
  defaultAlertDays: [30, 7, 1],
  archiveRetentionDays: 0, // Q-03 : 0 = les pièces archivées ne sont JAMAIS purgées (aucune rétention légale)
  quarantineRetentionDays: 30,
  maxVersions: 50,
  updatedAt: null,
});

const SETTINGS_COLS = `max_bytes AS "maxBytes", storage_quota_bytes::text AS "storageQuotaBytes", default_alert_days AS "defaultAlertDays",
  archive_retention_days AS "archiveRetentionDays", quarantine_retention_days AS "quarantineRetentionDays", max_versions AS "maxVersions",
  updated_at AS "updatedAt"`;

interface RawSettings extends Omit<SettingsRow, "storageQuotaBytes"> {
  storageQuotaBytes: string | null;
}

const toSettings = (r: RawSettings): SettingsRow => ({ ...r, storageQuotaBytes: r.storageQuotaBytes === null ? null : Number(r.storageQuotaBytes) });

/** Paramètres du tenant de la transaction ; sans ligne, les défauts du code. */
export async function getSettings(tx: Tx, tenantId: Uuid): Promise<SettingsRow> {
  const row = await tx.queryOne<RawSettings>(`SELECT ${SETTINGS_COLS} FROM documents.settings WHERE tenant_id = $1`, [tenantId]);
  return row ? toSettings(row) : DEFAULT_SETTINGS;
}

/** Crée la ligne de paramètres si absente ; renvoie `true` si elle vient d'être créée (le jeu de catégories de départ suit). */
export async function ensureSettingsRow(tx: Tx, tenantId: Uuid, now: Date): Promise<boolean> {
  const r = await tx.query(`INSERT INTO documents.settings (tenant_id, updated_at) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, now]);
  return (r.rowCount ?? 0) > 0;
}

export async function updateSettingsRow(tx: Tx, tenantId: Uuid, s: SettingsRow, by: Uuid | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.settings (tenant_id, max_bytes, storage_quota_bytes, default_alert_days, archive_retention_days, quarantine_retention_days, max_versions, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id) DO UPDATE SET max_bytes = EXCLUDED.max_bytes, storage_quota_bytes = EXCLUDED.storage_quota_bytes,
        default_alert_days = EXCLUDED.default_alert_days, archive_retention_days = EXCLUDED.archive_retention_days,
        quarantine_retention_days = EXCLUDED.quarantine_retention_days, max_versions = EXCLUDED.max_versions,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, s.maxBytes, s.storageQuotaBytes, [...s.defaultAlertDays], s.archiveRetentionDays, s.quarantineRetentionDays, s.maxVersions, by, now],
  );
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export interface CategoryRow {
  id: Uuid;
  code: string;
  label: string;
  description: string | null;
  kind: DocumentKind;
  confidentiality: DocumentConfidentiality;
  allowedExtensions: string[];
  maxBytes: number | null;
  audienceOwner: boolean;
  audienceGuardians: boolean;
  ownerUpload: boolean;
  requiresExpiry: boolean;
  alertDays: number[] | null;
  retentionDays: number | null;
  status: "ACTIVE" | "ARCHIVED";
  isSystem: boolean;
  sortOrder: number;
}

export const CATEGORY_COLS = `c.id, c.code, c.label, c.description, c.kind, c.confidentiality, c.allowed_extensions AS "allowedExtensions",
  c.max_bytes AS "maxBytes", c.audience_owner AS "audienceOwner", c.audience_guardians AS "audienceGuardians", c.owner_upload AS "ownerUpload",
  c.requires_expiry AS "requiresExpiry", c.alert_days AS "alertDays", c.retention_days AS "retentionDays", c.status, c.is_system AS "isSystem",
  c.sort_order AS "sortOrder"`;

/** Jeu de catégories de départ ; idempotent (clé `(tenant_id, code)`). Une seule requête. */
export async function seedDefaultCategories(tx: Tx, tenantId: Uuid, newId: () => string, now: Date): Promise<void> {
  const d = DEFAULT_CATEGORIES;
  await tx.query(
    `INSERT INTO documents.categories (id, tenant_id, code, label, description, kind, confidentiality, allowed_extensions, audience_owner, audience_guardians,
        owner_upload, requires_expiry, is_system, sort_order, created_at, updated_at)
     SELECT t.id, $1, t.code, t.label, t.description, t.kind, t.confidentiality, string_to_array(t.exts, ','), t.aud_owner, t.aud_guardians,
            t.owner_upload, t.requires_expiry, true, t.sort_order, $2, $2
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::boolean[], $11::boolean[], $12::boolean[], $13::boolean[], $14::int[])
            AS t(id, code, label, description, kind, confidentiality, exts, aud_owner, aud_guardians, owner_upload, requires_expiry, sort_order)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [
      tenantId,
      now,
      d.map(() => newId()),
      d.map((c) => c.code),
      d.map((c) => c.label),
      d.map((c) => c.description),
      d.map((c) => c.kind),
      d.map((c) => c.confidentiality),
      d.map((c) => c.allowedExtensions.join(",")),
      d.map((c) => c.audienceOwner),
      d.map((c) => c.audienceGuardians),
      d.map((c) => c.ownerUpload),
      d.map((c) => c.requiresExpiry),
      d.map((c) => c.sortOrder),
    ],
  );
}

export async function listCategories(tx: Tx, tenantId: Uuid, filter: { kind?: DocumentKind | undefined; includeArchived: boolean }): Promise<CategoryRow[]> {
  return tx.many<CategoryRow>(
    `SELECT ${CATEGORY_COLS} FROM documents.categories c
      WHERE c.tenant_id = $1 AND ($2::text IS NULL OR c.kind = $2) AND ($3::boolean OR c.status = 'ACTIVE')
      ORDER BY c.sort_order, c.label, c.id`,
    [tenantId, filter.kind ?? null, filter.includeArchived],
  );
}

export async function getCategory(tx: Tx, tenantId: Uuid, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<CategoryRow | null> {
  return tx.queryOne<CategoryRow>(`SELECT ${CATEGORY_COLS} FROM documents.categories c WHERE c.tenant_id = $1 AND c.id = $2${options.forUpdate ? " FOR UPDATE" : ""}`, [tenantId, id]);
}

export async function getCategoryByCode(tx: Tx, tenantId: Uuid, code: string): Promise<CategoryRow | null> {
  return tx.queryOne<CategoryRow>(`SELECT ${CATEGORY_COLS} FROM documents.categories c WHERE c.tenant_id = $1 AND c.code = $2`, [tenantId, code]);
}

export async function countDocumentsByCategory(tx: Tx, tenantId: Uuid): Promise<Map<Uuid, number>> {
  const rows = await tx.many<{ id: Uuid; n: string }>(`SELECT category_id AS id, count(*)::text AS n FROM documents.documents WHERE tenant_id = $1 GROUP BY category_id`, [tenantId]);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

export async function countDocumentsInCategory(tx: Tx, tenantId: Uuid, categoryId: Uuid): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM documents.documents WHERE tenant_id = $1 AND category_id = $2`, [tenantId, categoryId]);
  return Number(r?.n ?? 0);
}

export interface NewCategory {
  id: Uuid;
  code: string;
  label: string;
  description: string | null;
  kind: DocumentKind;
  confidentiality: DocumentConfidentiality;
  allowedExtensions: readonly string[];
  maxBytes: number | null;
  audienceOwner: boolean;
  audienceGuardians: boolean;
  ownerUpload: boolean;
  requiresExpiry: boolean;
  alertDays: readonly number[] | null;
  retentionDays: number | null;
  sortOrder: number;
}

export async function insertCategory(tx: Tx, tenantId: Uuid, c: NewCategory, now: Date): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO documents.categories (id, tenant_id, code, label, description, kind, confidentiality, allowed_extensions, max_bytes, audience_owner,
        audience_guardians, owner_upload, requires_expiry, alert_days, retention_days, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [c.id, tenantId, c.code, c.label, c.description, c.kind, c.confidentiality, [...c.allowedExtensions], c.maxBytes, c.audienceOwner, c.audienceGuardians,
      c.ownerUpload, c.requiresExpiry, c.alertDays ? [...c.alertDays] : null, c.retentionDays, c.sortOrder, now],
  );
  return (r.rowCount ?? 0) > 0;
}

export type CategoryPatch = Partial<Omit<NewCategory, "id" | "code" | "kind">>;

export async function updateCategory(tx: Tx, tenantId: Uuid, id: Uuid, patch: CategoryPatch, now: Date): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id, now];
  const add = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.label !== undefined) add("label", patch.label);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.confidentiality !== undefined) add("confidentiality", patch.confidentiality);
  if (patch.allowedExtensions !== undefined) add("allowed_extensions", [...patch.allowedExtensions]);
  if (patch.maxBytes !== undefined) add("max_bytes", patch.maxBytes);
  if (patch.audienceOwner !== undefined) add("audience_owner", patch.audienceOwner);
  if (patch.audienceGuardians !== undefined) add("audience_guardians", patch.audienceGuardians);
  if (patch.ownerUpload !== undefined) add("owner_upload", patch.ownerUpload);
  if (patch.requiresExpiry !== undefined) add("requires_expiry", patch.requiresExpiry);
  if (patch.alertDays !== undefined) add("alert_days", patch.alertDays ? [...patch.alertDays] : null);
  if (patch.retentionDays !== undefined) add("retention_days", patch.retentionDays);
  if (patch.sortOrder !== undefined) add("sort_order", patch.sortOrder);
  if (sets.length === 0) return;
  await tx.query(`UPDATE documents.categories SET ${sets.join(", ")}, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, params);
}

export async function setCategoryStatus(tx: Tx, tenantId: Uuid, id: Uuid, status: "ACTIVE" | "ARCHIVED", now: Date): Promise<void> {
  await tx.query(`UPDATE documents.categories SET status = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, status, now]);
}

// ---------------------------------------------------------------------------
// Droits de catégorie par personne
// ---------------------------------------------------------------------------

export interface GrantRow {
  id: Uuid;
  categoryId: Uuid;
  userId: Uuid;
  level: "READ" | "WRITE";
  expiresAt: Date | null;
  note: string | null;
  createdBy: Uuid;
  createdAt: Date;
  revokedAt: Date | null;
}

const GRANT_COLS = `id, category_id AS "categoryId", user_id AS "userId", level, expires_at AS "expiresAt", note, created_by AS "createdBy", created_at AS "createdAt", revoked_at AS "revokedAt"`;

export async function listGrants(tx: Tx, tenantId: Uuid, categoryId: Uuid): Promise<GrantRow[]> {
  return tx.many<GrantRow>(`SELECT ${GRANT_COLS} FROM documents.category_grants WHERE tenant_id = $1 AND category_id = $2 ORDER BY created_at DESC, id`, [tenantId, categoryId]);
}

export async function getGrant(tx: Tx, tenantId: Uuid, categoryId: Uuid, id: Uuid): Promise<GrantRow | null> {
  return tx.queryOne<GrantRow>(`SELECT ${GRANT_COLS} FROM documents.category_grants WHERE tenant_id = $1 AND category_id = $2 AND id = $3 FOR UPDATE`, [tenantId, categoryId, id]);
}

export async function getActiveGrantOfUser(tx: Tx, tenantId: Uuid, categoryId: Uuid, userId: Uuid, now: Date): Promise<GrantRow | null> {
  return tx.queryOne<GrantRow>(
    `SELECT ${GRANT_COLS} FROM documents.category_grants
      WHERE tenant_id = $1 AND category_id = $2 AND user_id = $3 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $4)`,
    [tenantId, categoryId, userId, now],
  );
}

/** Niveau du droit de catégorie ACTIF de l'utilisateur, par catégorie (WRITE l'emporte). */
export async function activeGrantLevels(tx: Tx, tenantId: Uuid, userId: Uuid, now: Date): Promise<Map<Uuid, "READ" | "WRITE">> {
  const rows = await tx.many<{ categoryId: Uuid; level: "READ" | "WRITE" }>(
    `SELECT category_id AS "categoryId", level FROM documents.category_grants
      WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $3)`,
    [tenantId, userId, now],
  );
  return new Map(rows.map((r) => [r.categoryId, r.level]));
}

export async function insertGrant(tx: Tx, tenantId: Uuid, g: { id: Uuid; categoryId: Uuid; userId: Uuid; level: "READ" | "WRITE"; expiresAt: Date | null; note: string | null; createdBy: Uuid }, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.category_grants (id, tenant_id, category_id, user_id, level, expires_at, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [g.id, tenantId, g.categoryId, g.userId, g.level, g.expiresAt, g.note, g.createdBy, now],
  );
}

export async function revokeGrant(tx: Tx, tenantId: Uuid, id: Uuid, by: Uuid, now: Date): Promise<void> {
  await tx.query(`UPDATE documents.category_grants SET revoked_at = $3, revoked_by = $4 WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`, [tenantId, id, now, by]);
}
