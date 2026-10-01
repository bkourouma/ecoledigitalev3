import type { Tx } from "@ecoledigitale/database";
import type { EntityStatus } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { CampusRecord } from "../domain/entities";
import { updateRow } from "./sql";

interface CampusRow {
  id: string;
  tenant_id: string;
  institution_id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  is_default: boolean;
  status: EntityStatus;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  "id, tenant_id, institution_id, code, name, address, city, phone, is_default, status, created_at, updated_at";

const toRecord = (r: CampusRow): CampusRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  institutionId: r.institution_id,
  code: r.code,
  name: r.name,
  address: r.address,
  city: r.city,
  phone: r.phone,
  isDefault: r.is_default,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewCampus {
  id: string;
  tenantId: string;
  institutionId: string;
  code: string;
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  isDefault: boolean;
}

export async function insertCampus(tx: Tx, c: NewCampus, now: Date): Promise<CampusRecord> {
  const row = await tx.queryOne<CampusRow>(
    `INSERT INTO tenancy.campuses
       (id, tenant_id, institution_id, code, name, address, city, phone, is_default, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $10)
     RETURNING ${COLUMNS}`,
    [c.id, c.tenantId, c.institutionId, c.code, c.name, c.address ?? null, c.city ?? null, c.phone ?? null, c.isDefault, now],
  );
  return toRecord(row as CampusRow);
}

export async function listCampuses(tx: Tx, institutionId: string): Promise<CampusRecord[]> {
  const rows = await tx.many<CampusRow>(
    `SELECT ${COLUMNS} FROM tenancy.campuses WHERE institution_id = $1 ORDER BY is_default DESC, created_at, id`,
    [institutionId],
  );
  return rows.map(toRecord);
}

export async function getCampus(tx: Tx, id: string): Promise<CampusRecord | null> {
  const row = await tx.queryOne<CampusRow>(`SELECT ${COLUMNS} FROM tenancy.campuses WHERE id = $1`, [id]);
  return row ? toRecord(row) : null;
}

export async function listCampusCodes(tx: Tx, institutionId: string): Promise<Set<string>> {
  const rows = await tx.many<{ code: string }>("SELECT code FROM tenancy.campuses WHERE institution_id = $1", [institutionId]);
  return new Set(rows.map((r) => r.code));
}

const UPDATABLE = { name: "name", address: "address", city: "city", phone: "phone", status: "status" } as const;
export type CampusPatch = Partial<Record<keyof typeof UPDATABLE, string | null>>;

export async function updateCampus(tx: Tx, id: string, patch: CampusPatch, now: Date): Promise<CampusRecord | null> {
  const res = await updateRow(tx, "tenancy.campuses", UPDATABLE, patch, now, { sql: "id = $1", params: [id] });
  const row = res?.rows[0] as CampusRow | undefined;
  return row ? toRecord(row) : null;
}

/** Retire le drapeau « par défaut » des campus de l'établissement (avant d'en promouvoir un autre). */
export async function clearDefaultCampus(tx: Tx, institutionId: string, now: Date): Promise<void> {
  await tx.query(
    "UPDATE tenancy.campuses SET is_default = false, updated_at = $2 WHERE institution_id = $1 AND is_default",
    [institutionId, now],
  );
}

export async function setDefaultCampus(tx: Tx, id: string, now: Date): Promise<CampusRecord | null> {
  const row = await tx.queryOne<CampusRow>(
    `UPDATE tenancy.campuses SET is_default = true, updated_at = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, now],
  );
  return row ? toRecord(row) : null;
}

export async function deleteCampus(tx: Tx, id: string): Promise<boolean> {
  const res = await tx.query("DELETE FROM tenancy.campuses WHERE id = $1", [id]);
  return res.rowCount > 0;
}
