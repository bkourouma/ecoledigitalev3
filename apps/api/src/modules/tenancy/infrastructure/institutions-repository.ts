import type { Tx } from "@ecoledigitale/database";
import type { EntityStatus, InstitutionPack } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { InstitutionRecord } from "../domain/entities";
import { updateRow } from "./sql";

interface InstitutionRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  pack: InstitutionPack;
  education_system: string;
  country_code: string;
  status: EntityStatus;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, tenant_id, code, name, pack, education_system, country_code, status, created_at, updated_at";

const toRecord = (r: InstitutionRow): InstitutionRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  code: r.code,
  name: r.name,
  pack: r.pack,
  educationSystem: r.education_system,
  countryCode: r.country_code,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewInstitution {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  pack: InstitutionPack;
  educationSystem: string;
  countryCode: string;
}

export async function insertInstitution(tx: Tx, i: NewInstitution, now: Date): Promise<InstitutionRecord> {
  const row = await tx.queryOne<InstitutionRow>(
    `INSERT INTO tenancy.institutions
       (id, tenant_id, code, name, pack, education_system, country_code, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $8)
     RETURNING ${COLUMNS}`,
    [i.id, i.tenantId, i.code, i.name, i.pack, i.educationSystem, i.countryCode, now],
  );
  return toRecord(row as InstitutionRow);
}

export async function listInstitutions(tx: Tx, filter: { status?: EntityStatus } = {}): Promise<InstitutionRecord[]> {
  const rows = filter.status
    ? await tx.many<InstitutionRow>(
        `SELECT ${COLUMNS} FROM tenancy.institutions WHERE status = $1 ORDER BY created_at, id`,
        [filter.status],
      )
    : await tx.many<InstitutionRow>(`SELECT ${COLUMNS} FROM tenancy.institutions ORDER BY created_at, id`);
  return rows.map(toRecord);
}

export async function getInstitution(tx: Tx, id: string): Promise<InstitutionRecord | null> {
  const row = await tx.queryOne<InstitutionRow>(`SELECT ${COLUMNS} FROM tenancy.institutions WHERE id = $1`, [id]);
  return row ? toRecord(row) : null;
}

export async function listInstitutionCodes(tx: Tx): Promise<Set<string>> {
  return new Set((await tx.many<{ code: string }>("SELECT code FROM tenancy.institutions")).map((r) => r.code));
}

const UPDATABLE = { name: "name", educationSystem: "education_system", status: "status" } as const;
export type InstitutionPatch = Partial<Record<keyof typeof UPDATABLE, string>>;

export async function updateInstitution(
  tx: Tx,
  id: string,
  patch: InstitutionPatch,
  now: Date,
): Promise<InstitutionRecord | null> {
  const res = await updateRow(tx, "tenancy.institutions", UPDATABLE, patch, now, { sql: "id = $1", params: [id] });
  const row = res?.rows[0] as InstitutionRow | undefined;
  return row ? toRecord(row) : null;
}
