/**
 * Paramètres du tenant (`people.settings`, une ligne), référentiels (types de liens, catégories de personnel, types de
 * contrat) et compteurs gapless (`people.next_number`). Tables de TENANT (RLS forcée).
 */
import type { Tx } from "@ecoledigitale/database";
import {
  DEFAULT_CONTRACT_TYPES,
  DEFAULT_RELATIONSHIP_TYPES,
  DEFAULT_SETTINGS,
  DEFAULT_STAFF_CATEGORIES,
} from "../domain/reference-data";
import { updateById } from "./sql";

export interface SettingsRow {
  studentNumberPattern: string;
  staffNumberPattern: string;
  numberPrefix: string | null;
  duplicateCheckEnabled: boolean;
  expiryAlertDays: number | null;
  studentRetentionDays: number | null;
}

const SETTINGS_COLUMNS = `student_number_pattern AS "studentNumberPattern", staff_number_pattern AS "staffNumberPattern",
  number_prefix AS "numberPrefix", duplicate_check_enabled AS "duplicateCheckEnabled", expiry_alert_days AS "expiryAlertDays",
  student_retention_days AS "studentRetentionDays"`;

export async function getSettings(tx: Tx, tenantId: string): Promise<SettingsRow | null> {
  return tx.queryOne<SettingsRow>(`SELECT ${SETTINGS_COLUMNS} FROM people.settings WHERE tenant_id = $1`, [tenantId]);
}

/**
 * Garantit les paramètres et les référentiels par défaut du tenant (idempotent : `ON CONFLICT DO NOTHING`, une ligne
 * personnalisée n'est jamais écrasée). Renvoie les paramètres. Appelé à `tenancy.tenant.provisioned` et au premier usage
 * du module pour les tenants déjà existants (rattrapage legacy).
 */
export async function ensureTenantDefaults(tx: Tx, tenantId: string, newId: () => string, now: Date): Promise<SettingsRow> {
  const existing = await getSettings(tx, tenantId);
  if (existing) return existing;
  await tx.query(
    `INSERT INTO people.settings (tenant_id, student_number_pattern, staff_number_pattern, duplicate_check_enabled, expiry_alert_days, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, DEFAULT_SETTINGS.studentNumberPattern, DEFAULT_SETTINGS.staffNumberPattern, DEFAULT_SETTINGS.duplicateCheckEnabled, DEFAULT_SETTINGS.expiryAlertDays, now],
  );
  let order = 0;
  for (const t of DEFAULT_RELATIONSHIP_TYPES) {
    order += 10;
    await tx.query(
      `INSERT INTO people.relationship_types (id, tenant_id, code, label, kind, sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [newId(), tenantId, t.code, t.label, t.kind, order],
    );
  }
  order = 0;
  for (const c of DEFAULT_STAFF_CATEGORIES) {
    order += 10;
    await tx.query(
      `INSERT INTO people.staff_categories (id, tenant_id, code, label, can_teach, can_supervise, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [newId(), tenantId, c.code, c.label, c.canTeach, c.canSupervise, order],
    );
  }
  for (const c of DEFAULT_CONTRACT_TYPES) {
    await tx.query(
      `INSERT INTO people.contract_types (id, tenant_id, code, label, kind) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [newId(), tenantId, c.code, c.label, c.kind],
    );
  }
  const settings = await getSettings(tx, tenantId);
  if (!settings) throw new Error("people.settings introuvable après instanciation.");
  return settings;
}

export interface SettingsPatchValues {
  studentNumberPattern?: string | undefined;
  staffNumberPattern?: string | undefined;
  numberPrefix?: string | null | undefined;
  duplicateCheckEnabled?: boolean | undefined;
  expiryAlertDays?: number | null | undefined;
  studentRetentionDays?: number | null | undefined;
}

export async function updateSettings(tx: Tx, tenantId: string, patch: SettingsPatchValues, now: Date): Promise<void> {
  await updateById(
    tx,
    "people.settings",
    tenantId,
    tenantId,
    {
      student_number_pattern: patch.studentNumberPattern,
      staff_number_pattern: patch.staffNumberPattern,
      number_prefix: patch.numberPrefix,
      duplicate_check_enabled: patch.duplicateCheckEnabled,
      expiry_alert_days: patch.expiryAlertDays,
      student_retention_days: patch.studentRetentionDays,
    },
    now,
    "tenant_id",
  );
}

/** Compteur gapless du tenant (`people.next_number`). À appeler le plus TARD possible dans la transaction (verrou jusqu'au COMMIT). */
export async function nextNumber(tx: Tx, kind: "STUDENT" | "STAFF"): Promise<number> {
  const row = await tx.queryOne<{ n: string }>("SELECT people.next_number($1) AS n", [kind]);
  if (!row) throw new Error("people.next_number n'a rien renvoyé.");
  return Number(row.n);
}

// ---------------------------------------------------------------------------
// Types de liens
// ---------------------------------------------------------------------------

export interface RelationshipTypeRow {
  id: string;
  code: string;
  label: string;
  kind: "GUARDIAN" | "EMERGENCY" | "OTHER";
  sortOrder: number;
  active: boolean;
}
const REL_COLUMNS = `id, code, label, kind, sort_order AS "sortOrder", active`;

export const listRelationshipTypes = (tx: Tx, tenantId: string): Promise<RelationshipTypeRow[]> =>
  tx.many<RelationshipTypeRow>(`SELECT ${REL_COLUMNS} FROM people.relationship_types WHERE tenant_id = $1 ORDER BY sort_order, code`, [tenantId]);

export const getRelationshipType = (tx: Tx, tenantId: string, code: string): Promise<RelationshipTypeRow | null> =>
  tx.queryOne<RelationshipTypeRow>(`SELECT ${REL_COLUMNS} FROM people.relationship_types WHERE tenant_id = $1 AND code = $2`, [tenantId, code]);

export async function upsertRelationshipType(
  tx: Tx,
  tenantId: string,
  id: string,
  v: { code: string; label: string; kind: string; sortOrder?: number | undefined; active?: boolean | undefined },
  now: Date,
): Promise<RelationshipTypeRow> {
  const row = await tx.queryOne<RelationshipTypeRow>(
    `INSERT INTO people.relationship_types (id, tenant_id, code, label, kind, sort_order, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, 100),COALESCE($7, true),$8,$8)
     ON CONFLICT (tenant_id, code) DO UPDATE
       SET label = EXCLUDED.label, kind = EXCLUDED.kind,
           sort_order = COALESCE($6, people.relationship_types.sort_order), active = COALESCE($7, people.relationship_types.active), updated_at = $8
     RETURNING ${REL_COLUMNS}`,
    [id, tenantId, v.code, v.label, v.kind, v.sortOrder ?? null, v.active ?? null, now],
  );
  if (!row) throw new Error("upsert relationship_types sans résultat.");
  return row;
}

// ---------------------------------------------------------------------------
// Catégories de personnel
// ---------------------------------------------------------------------------

export interface StaffCategoryRow {
  id: string;
  code: string;
  label: string;
  canTeach: boolean;
  canSupervise: boolean;
  sortOrder: number;
  active: boolean;
}
const CAT_COLUMNS = `id, code, label, can_teach AS "canTeach", can_supervise AS "canSupervise", sort_order AS "sortOrder", active`;

export const listStaffCategories = (tx: Tx, tenantId: string): Promise<StaffCategoryRow[]> =>
  tx.many<StaffCategoryRow>(`SELECT ${CAT_COLUMNS} FROM people.staff_categories WHERE tenant_id = $1 ORDER BY sort_order, code`, [tenantId]);

export const getStaffCategory = (tx: Tx, tenantId: string, code: string): Promise<StaffCategoryRow | null> =>
  tx.queryOne<StaffCategoryRow>(`SELECT ${CAT_COLUMNS} FROM people.staff_categories WHERE tenant_id = $1 AND code = $2`, [tenantId, code]);

export async function upsertStaffCategory(
  tx: Tx,
  tenantId: string,
  id: string,
  v: { code: string; label: string; canTeach?: boolean | undefined; canSupervise?: boolean | undefined; sortOrder?: number | undefined; active?: boolean | undefined },
  now: Date,
): Promise<StaffCategoryRow> {
  const row = await tx.queryOne<StaffCategoryRow>(
    `INSERT INTO people.staff_categories (id, tenant_id, code, label, can_teach, can_supervise, sort_order, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,COALESCE($5,false),COALESCE($6,false),COALESCE($7,100),COALESCE($8,true),$9,$9)
     ON CONFLICT (tenant_id, code) DO UPDATE
       SET label = EXCLUDED.label,
           can_teach = COALESCE($5, people.staff_categories.can_teach), can_supervise = COALESCE($6, people.staff_categories.can_supervise),
           sort_order = COALESCE($7, people.staff_categories.sort_order), active = COALESCE($8, people.staff_categories.active), updated_at = $9
     RETURNING ${CAT_COLUMNS}`,
    [id, tenantId, v.code, v.label, v.canTeach ?? null, v.canSupervise ?? null, v.sortOrder ?? null, v.active ?? null, now],
  );
  if (!row) throw new Error("upsert staff_categories sans résultat.");
  return row;
}

/** Nombre d'affectations d'enseignement ACTIVES portées par des membres de la catégorie (retirer `can_teach` est alors interdit). */
export async function countActiveTeachingAssignmentsOfCategory(tx: Tx, tenantId: string, categoryCode: string): Promise<number> {
  const row = await tx.queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM people.teaching_assignments a
       JOIN people.staff s ON s.tenant_id = a.tenant_id AND s.id = a.staff_id
      WHERE a.tenant_id = $1 AND s.category_code = $2 AND a.status = 'ACTIVE'`,
    [tenantId, categoryCode],
  );
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Types de contrat
// ---------------------------------------------------------------------------

export interface ContractTypeRow {
  id: string;
  code: string;
  label: string;
  kind: "PERMANENT" | "FIXED_TERM" | "CASUAL" | "OTHER";
  active: boolean;
}
const CT_COLUMNS = `id, code, label, kind, active`;

export const listContractTypes = (tx: Tx, tenantId: string): Promise<ContractTypeRow[]> =>
  tx.many<ContractTypeRow>(`SELECT ${CT_COLUMNS} FROM people.contract_types WHERE tenant_id = $1 ORDER BY code`, [tenantId]);

export const getContractType = (tx: Tx, tenantId: string, code: string): Promise<ContractTypeRow | null> =>
  tx.queryOne<ContractTypeRow>(`SELECT ${CT_COLUMNS} FROM people.contract_types WHERE tenant_id = $1 AND code = $2`, [tenantId, code]);

export async function upsertContractType(
  tx: Tx,
  tenantId: string,
  id: string,
  v: { code: string; label: string; kind: string; active?: boolean | undefined },
  now: Date,
): Promise<ContractTypeRow> {
  const row = await tx.queryOne<ContractTypeRow>(
    `INSERT INTO people.contract_types (id, tenant_id, code, label, kind, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),$7,$7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, active = COALESCE($6, people.contract_types.active), updated_at = $7
     RETURNING ${CT_COLUMNS}`,
    [id, tenantId, v.code, v.label, v.kind, v.active ?? null, now],
  );
  if (!row) throw new Error("upsert contract_types sans résultat.");
  return row;
}
