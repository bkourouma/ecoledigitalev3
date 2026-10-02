/**
 * SQL des gabarits : versions immuables (`template_versions`) et pointeur de version active (`templates`).
 * Une version n'est jamais modifiée ni supprimée : la correction est une nouvelle version, le retour arrière change le pointeur.
 */
import type { Tx } from "@ecoledigitale/database";
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";

export interface TemplateRef {
  code: string;
  channel: NotifChannel;
  locale: string;
}

export interface ActiveTemplate {
  version: number;
  enabled: boolean;
  subject: string | null;
  body: string;
  variables: string[];
  updatedAt: Date;
}

/** Pointeur de gabarit d'un établissement (même sans version active : `activeVersion` nul = gabarit livré). */
export interface TemplatePointer extends TemplateRef {
  activeVersion: number | null;
  enabled: boolean;
  updatedAt: Date;
}

export interface VersionRow {
  version: number;
  subject: string | null;
  body: string;
  variables: string[];
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** Gabarit actif de l'établissement : `null` si aucune surcharge (utiliser le gabarit livré). Retourne aussi un gabarit désactivé. */
export async function getActiveTemplate(tx: Tx, tenantId: string, ref: TemplateRef): Promise<ActiveTemplate | { enabled: boolean; shipped: true } | null> {
  const row = await tx.queryOne<{ version: number | null; enabled: boolean; subject: string | null; body: string | null; variables: string[] | null; updatedAt: Date }>(
    `SELECT t.active_version AS version, t.enabled, v.subject, v.body, v.variables, t.updated_at AS "updatedAt"
       FROM notifications.templates t
       LEFT JOIN notifications.template_versions v
         ON v.tenant_id = t.tenant_id AND v.code = t.code AND v.channel = t.channel AND v.locale = t.locale AND v.version = t.active_version
      WHERE t.tenant_id = $1 AND t.code = $2 AND t.channel = $3 AND t.locale = $4`,
    [tenantId, ref.code, ref.channel, ref.locale],
  );
  if (!row) return null;
  if (row.version === null || row.body === null) return { enabled: row.enabled, shipped: true };
  return { version: row.version, enabled: row.enabled, subject: row.subject, body: row.body, variables: row.variables ?? [], updatedAt: row.updatedAt };
}

export async function listPointers(tx: Tx, tenantId: string): Promise<Array<TemplatePointer & { subject: string | null; body: string | null; variables: string[] | null }>> {
  return tx.many(
    `SELECT t.code, t.channel, t.locale, t.active_version AS "activeVersion", t.enabled, t.updated_at AS "updatedAt",
            v.subject, v.body, v.variables
       FROM notifications.templates t
       LEFT JOIN notifications.template_versions v
         ON v.tenant_id = t.tenant_id AND v.code = t.code AND v.channel = t.channel AND v.locale = t.locale AND v.version = t.active_version
      WHERE t.tenant_id = $1`,
    [tenantId],
  );
}

export async function listVersions(tx: Tx, tenantId: string, ref: TemplateRef): Promise<{ versions: VersionRow[]; active: number | null }> {
  const versions = await tx.many<VersionRow>(
    `SELECT version, subject, body, variables, note, created_by AS "createdBy", created_at AS "createdAt"
       FROM notifications.template_versions
      WHERE tenant_id = $1 AND code = $2 AND channel = $3 AND locale = $4
      ORDER BY version DESC`,
    [tenantId, ref.code, ref.channel, ref.locale],
  );
  const pointer = await tx.queryOne<{ activeVersion: number | null }>(
    `SELECT active_version AS "activeVersion" FROM notifications.templates WHERE tenant_id = $1 AND code = $2 AND channel = $3 AND locale = $4`,
    [tenantId, ref.code, ref.channel, ref.locale],
  );
  return { versions, active: pointer?.activeVersion ?? null };
}

export async function versionExists(tx: Tx, tenantId: string, ref: TemplateRef, version: number): Promise<boolean> {
  const r = await tx.queryOne(
    `SELECT 1 AS one FROM notifications.template_versions WHERE tenant_id = $1 AND code = $2 AND channel = $3 AND locale = $4 AND version = $5`,
    [tenantId, ref.code, ref.channel, ref.locale, version],
  );
  return r !== null;
}

/** Insère la version suivante (numéro attribué sous verrou du pointeur) et la rend active. Retourne son numéro. */
export async function publishVersion(
  tx: Tx,
  input: { tenantId: string; ref: TemplateRef; id: string; subject: string | null; body: string; variables: readonly string[]; note: string | null; actor: string | null; now: Date },
): Promise<number> {
  const { tenantId, ref } = input;
  // Verrou de ligne du pointeur (créé au besoin) : deux publications simultanées s'ordonnent.
  await tx.query(
    `INSERT INTO notifications.templates (tenant_id, code, channel, locale, active_version, enabled, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,NULL,true,$5,$6) ON CONFLICT (tenant_id, code, channel, locale) DO NOTHING`,
    [tenantId, ref.code, ref.channel, ref.locale, input.actor, input.now],
  );
  await tx.query(`SELECT 1 FROM notifications.templates WHERE tenant_id = $1 AND code = $2 AND channel = $3 AND locale = $4 FOR UPDATE`, [tenantId, ref.code, ref.channel, ref.locale]);
  const next = await tx.queryOne<{ next: number }>(
    `SELECT coalesce(max(version), 0) + 1 AS next FROM notifications.template_versions WHERE tenant_id = $1 AND code = $2 AND channel = $3 AND locale = $4`,
    [tenantId, ref.code, ref.channel, ref.locale],
  );
  const version = Number(next?.next ?? 1);
  await tx.query(
    `INSERT INTO notifications.template_versions (id, tenant_id, code, channel, locale, version, subject, body, variables, note, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12)`,
    [input.id, tenantId, ref.code, ref.channel, ref.locale, version, input.subject, input.body, [...input.variables], input.note, input.actor, input.now],
  );
  await tx.query(
    `UPDATE notifications.templates SET active_version = $5, updated_by = $6, updated_at = $7 WHERE tenant_id = $1 AND code = $2 AND channel = $3 AND locale = $4`,
    [tenantId, ref.code, ref.channel, ref.locale, version, input.actor, input.now],
  );
  return version;
}

/** Change la version active (0 = retour au gabarit livré). */
export async function setActiveVersion(tx: Tx, tenantId: string, ref: TemplateRef, version: number | null, actor: string | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.templates (tenant_id, code, channel, locale, active_version, enabled, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,true,$6,$7)
     ON CONFLICT (tenant_id, code, channel, locale) DO UPDATE SET active_version = EXCLUDED.active_version, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, ref.code, ref.channel, ref.locale, version, actor, now],
  );
}

export async function setTemplateEnabled(tx: Tx, tenantId: string, ref: TemplateRef, enabled: boolean, actor: string | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO notifications.templates (tenant_id, code, channel, locale, active_version, enabled, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,$7)
     ON CONFLICT (tenant_id, code, channel, locale) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, ref.code, ref.channel, ref.locale, enabled, actor, now],
  );
}
