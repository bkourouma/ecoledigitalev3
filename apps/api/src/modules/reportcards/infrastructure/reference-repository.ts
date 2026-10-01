/**
 * Requêtes SQL de l'identité (branding), des signataires, des configurations de gabarit, des réglages et du catalogue de
 * gabarits plateforme (lecture). Toutes reçoivent le `Tx` d'une transaction `TenantDb` : la RLS fait le reste. Jamais de
 * valeur concaténée dans le SQL.
 */
import type { Tx } from "@ecoledigitale/database";
import {
  BRANDING_COLUMNS,
  CONFIG_COLUMNS,
  SIGNATORY_COLUMNS,
  TEMPLATE_COLUMNS,
  toBranding,
  toPlatformTemplate,
  toSettings,
  toSignatory,
  toTemplateConfig,
} from "./rows";
import { DEFAULT_SETTINGS, type Branding, type DocumentKind, type Pack, type PlatformTemplate, type ReportcardsSettings, type Signatory, type TemplateConfig, type Uuid } from "../domain/types";

const NIL = "00000000-0000-0000-0000-000000000000";

// --- Identité ---------------------------------------------------------------

/** Version courante pour l'établissement ; à défaut, celle du tenant entier (`institution_id` NULL). */
export async function getCurrentBranding(tx: Tx, institutionId: Uuid | null): Promise<Branding | null> {
  const rows = await tx.many(
    `SELECT ${BRANDING_COLUMNS} FROM reportcards.branding_versions
      WHERE is_current AND coalesce(institution_id, $1::uuid) IN ($2::uuid, $1::uuid)
      ORDER BY (institution_id IS NULL) ASC LIMIT 1`,
    [NIL, institutionId ?? NIL],
  );
  return rows[0] ? toBranding(rows[0]) : null;
}

export async function listBrandingVersions(tx: Tx, institutionId: Uuid | null): Promise<Branding[]> {
  const rows = await tx.many(
    `SELECT ${BRANDING_COLUMNS} FROM reportcards.branding_versions
      WHERE coalesce(institution_id, $1::uuid) = $2::uuid ORDER BY version DESC`,
    [NIL, institutionId ?? NIL],
  );
  return rows.map(toBranding);
}

export interface NewBranding {
  id: Uuid;
  tenantId: Uuid;
  institutionId: Uuid | null;
  legalName: string;
  shortName: string | null;
  headerLeft: readonly string[];
  headerRight: readonly string[];
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  registrationRef: string | null;
  logoObjectKey: string | null;
  emblemObjectKey: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  footerText: string | null;
  createdBy: Uuid;
}

/** Crée la version suivante et la rend courante (l'ancienne cesse de l'être). */
export async function insertBrandingVersion(tx: Tx, b: NewBranding): Promise<Branding> {
  await tx.query(
    `UPDATE reportcards.branding_versions SET is_current = false
      WHERE is_current AND coalesce(institution_id, $1::uuid) = $2::uuid`,
    [NIL, b.institutionId ?? NIL],
  );
  const next = await tx.queryOne<{ v: number }>(
    `SELECT coalesce(max(version), 0) + 1 AS v FROM reportcards.branding_versions WHERE coalesce(institution_id, $1::uuid) = $2::uuid`,
    [NIL, b.institutionId ?? NIL],
  );
  const rows = await tx.many(
    `INSERT INTO reportcards.branding_versions
       (id, tenant_id, institution_id, version, is_current, legal_name, short_name, header_left, header_right, address, phone, email, website,
        registration_ref, logo_object_key, emblem_object_key, primary_color, secondary_color, footer_text, created_by)
     VALUES ($1, $2, $3, $4, true, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING ${BRANDING_COLUMNS}`,
    [
      b.id, b.tenantId, b.institutionId, Number(next!.v), b.legalName, b.shortName, JSON.stringify(b.headerLeft), JSON.stringify(b.headerRight),
      b.address, b.phone, b.email, b.website, b.registrationRef, b.logoObjectKey, b.emblemObjectKey, b.primaryColor, b.secondaryColor, b.footerText, b.createdBy,
    ],
  );
  return toBranding(rows[0]!);
}

// --- Signataires ------------------------------------------------------------

export async function listSignatories(tx: Tx, filter: { activeOnly?: boolean } = {}): Promise<Signatory[]> {
  const rows = await tx.many(
    `SELECT ${SIGNATORY_COLUMNS} FROM reportcards.signatories ${filter.activeOnly ? "WHERE active" : ""} ORDER BY full_name, id`,
  );
  return rows.map(toSignatory);
}

export async function getSignatory(tx: Tx, id: Uuid): Promise<Signatory | null> {
  const row = await tx.queryOne(`SELECT ${SIGNATORY_COLUMNS} FROM reportcards.signatories WHERE id = $1`, [id]);
  return row ? toSignatory(row) : null;
}

export interface NewSignatory {
  id: Uuid;
  tenantId: Uuid;
  institutionId: Uuid | null;
  fullName: string;
  title: string | null;
  jobFunction: string | null;
  signatureObjectKey: string | null;
  staffId: Uuid | null;
  validFrom: string | null;
  validTo: string | null;
  createdBy: Uuid;
}

export async function insertSignatory(tx: Tx, s: NewSignatory): Promise<Signatory> {
  const rows = await tx.many(
    `INSERT INTO reportcards.signatories
       (id, tenant_id, institution_id, full_name, title, job_function, signature_object_key, staff_id, valid_from, valid_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11)
     RETURNING ${SIGNATORY_COLUMNS}`,
    [s.id, s.tenantId, s.institutionId, s.fullName, s.title, s.jobFunction, s.signatureObjectKey, s.staffId, s.validFrom, s.validTo, s.createdBy],
  );
  return toSignatory(rows[0]!);
}

export async function updateSignatory(tx: Tx, id: Uuid, patch: Omit<Signatory, "id" | "createdAt" | "updatedAt" | "institutionId"> & { updatedAt: Date }): Promise<Signatory> {
  const rows = await tx.many(
    `UPDATE reportcards.signatories
        SET full_name = $2, title = $3, job_function = $4, signature_object_key = $5, staff_id = $6, active = $7,
            valid_from = $8::date, valid_to = $9::date, updated_at = $10
      WHERE id = $1
      RETURNING ${SIGNATORY_COLUMNS}`,
    [id, patch.fullName, patch.title, patch.jobFunction, patch.signatureObjectKey, patch.staffId, patch.active, patch.validFrom, patch.validTo, patch.updatedAt],
  );
  return toSignatory(rows[0]!);
}

// --- Gabarits plateforme (lecture) ------------------------------------------

export async function listPlatformTemplates(tx: Tx, filter: { status?: "PUBLISHED" } = {}): Promise<PlatformTemplate[]> {
  const rows = await tx.many(
    `SELECT ${TEMPLATE_COLUMNS} FROM reportcards.platform_templates ${filter.status ? "WHERE status = 'PUBLISHED'" : ""} ORDER BY key, version DESC`,
  );
  return rows.map(toPlatformTemplate);
}

/** Version exacte, ou la plus récente PUBLIÉE si `version` est omis. Un gabarit RETIRÉ reste lisible par sa version (AC §13). */
export async function getPlatformTemplate(tx: Tx, key: string, version?: number): Promise<PlatformTemplate | null> {
  const rows = version
    ? await tx.many(`SELECT ${TEMPLATE_COLUMNS} FROM reportcards.platform_templates WHERE key = $1 AND version = $2`, [key, version])
    : await tx.many(`SELECT ${TEMPLATE_COLUMNS} FROM reportcards.platform_templates WHERE key = $1 AND status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`, [key]);
  return rows[0] ? toPlatformTemplate(rows[0]) : null;
}

// --- Configurations de gabarit ----------------------------------------------

export async function getCurrentTemplateConfig(
  tx: Tx,
  query: { institutionId: Uuid | null; documentKind: DocumentKind; pack: Pack },
): Promise<TemplateConfig | null> {
  const rows = await tx.many(
    `SELECT ${CONFIG_COLUMNS} FROM reportcards.template_configs
      WHERE is_current AND document_kind = $3 AND pack = $4 AND coalesce(institution_id, $1::uuid) IN ($2::uuid, $1::uuid)
      ORDER BY (institution_id IS NULL) ASC LIMIT 1`,
    [NIL, query.institutionId ?? NIL, query.documentKind, query.pack],
  );
  return rows[0] ? toTemplateConfig(rows[0]) : null;
}

export async function listTemplateConfigs(tx: Tx, filter: { institutionId?: Uuid | null; documentKind?: DocumentKind; history?: boolean }): Promise<TemplateConfig[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!filter.history) where.push("is_current");
  if (filter.institutionId !== undefined) {
    params.push(NIL, filter.institutionId ?? NIL);
    where.push(`coalesce(institution_id, $1::uuid) = $2::uuid`);
  }
  if (filter.documentKind) {
    params.push(filter.documentKind);
    where.push(`document_kind = $${params.length}`);
  }
  const rows = await tx.many(
    `SELECT ${CONFIG_COLUMNS} FROM reportcards.template_configs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY document_kind, pack, config_version DESC`,
    params,
  );
  return rows.map(toTemplateConfig);
}

export interface NewTemplateConfig {
  id: Uuid;
  tenantId: Uuid;
  institutionId: Uuid | null;
  documentKind: DocumentKind;
  pack: Pack;
  templateKey: string;
  templateVersion: number;
  options: Record<string, unknown>;
  signatureAssignments: ReadonlyArray<{ slot: string; signatoryId: string }>;
  createdBy: Uuid;
}

export async function insertTemplateConfig(tx: Tx, c: NewTemplateConfig): Promise<TemplateConfig> {
  await tx.query(
    `UPDATE reportcards.template_configs SET is_current = false
      WHERE is_current AND document_kind = $3 AND pack = $4 AND coalesce(institution_id, $1::uuid) = $2::uuid`,
    [NIL, c.institutionId ?? NIL, c.documentKind, c.pack],
  );
  const next = await tx.queryOne<{ v: number }>(
    `SELECT coalesce(max(config_version), 0) + 1 AS v FROM reportcards.template_configs
      WHERE document_kind = $3 AND pack = $4 AND coalesce(institution_id, $1::uuid) = $2::uuid`,
    [NIL, c.institutionId ?? NIL, c.documentKind, c.pack],
  );
  const rows = await tx.many(
    `INSERT INTO reportcards.template_configs
       (id, tenant_id, institution_id, document_kind, pack, template_key, template_version, config_version, is_current, options, signature_assignments, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::jsonb, $10::jsonb, $11)
     RETURNING ${CONFIG_COLUMNS}`,
    [c.id, c.tenantId, c.institutionId, c.documentKind, c.pack, c.templateKey, c.templateVersion, Number(next!.v), JSON.stringify(c.options), JSON.stringify(c.signatureAssignments), c.createdBy],
  );
  return toTemplateConfig(rows[0]!);
}

// --- Réglages ---------------------------------------------------------------

export async function getSettings(tx: Tx): Promise<ReportcardsSettings> {
  const row = await tx.queryOne("SELECT block_if_unpaid, require_deliberation, verification_shows_mention, updated_at FROM reportcards.settings");
  return toSettings(row) ?? DEFAULT_SETTINGS;
}

export async function upsertSettings(tx: Tx, tenantId: Uuid, userId: Uuid | null, patch: Partial<Omit<ReportcardsSettings, "updatedAt">>, now: Date): Promise<ReportcardsSettings> {
  const current = await getSettings(tx);
  const next = { ...current, ...patch };
  const row = await tx.queryOne(
    `INSERT INTO reportcards.settings (tenant_id, block_if_unpaid, require_deliberation, verification_shows_mention, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id) DO UPDATE
        SET block_if_unpaid = EXCLUDED.block_if_unpaid, require_deliberation = EXCLUDED.require_deliberation,
            verification_shows_mention = EXCLUDED.verification_shows_mention, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
     RETURNING block_if_unpaid, require_deliberation, verification_shows_mention, updated_at`,
    [tenantId, next.blockIfUnpaid, next.requireDeliberation, next.verificationShowsMention, userId, now],
  );
  return toSettings(row)!;
}
