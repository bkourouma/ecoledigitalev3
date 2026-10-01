import type { Tx } from "@ecoledigitale/database";
import type { TenantProfileRecord } from "../domain/entities";
import { updateRow } from "./sql";

interface ProfileRow {
  tenant_id: string;
  slug: string;
  legal_name: string;
  trade_name: string | null;
  country_code: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  custom_domain: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT p.tenant_id, t.slug, p.legal_name, p.trade_name, p.country_code, p.contact_name,
       p.contact_email, p.contact_phone, p.address, p.logo_url, p.primary_color, p.secondary_color,
       p.custom_domain, p.created_at, p.updated_at
  FROM tenancy.tenant_profiles p
  JOIN kernel.tenants t ON t.id = p.tenant_id`;

const toRecord = (r: ProfileRow): TenantProfileRecord => ({
  tenantId: r.tenant_id,
  slug: r.slug,
  legalName: r.legal_name,
  tradeName: r.trade_name,
  countryCode: r.country_code,
  contactName: r.contact_name,
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  address: r.address,
  logoUrl: r.logo_url,
  primaryColor: r.primary_color,
  secondaryColor: r.secondary_color,
  customDomain: r.custom_domain,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewProfile {
  tenantId: string;
  legalName: string;
  countryCode: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export async function insertProfile(tx: Tx, p: NewProfile, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO tenancy.tenant_profiles
       (tenant_id, legal_name, country_code, contact_name, contact_email, contact_phone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [p.tenantId, p.legalName, p.countryCode, p.contactName ?? null, p.contactEmail ?? null, p.contactPhone ?? null, now],
  );
}

export async function getProfile(tx: Tx, tenantId: string): Promise<TenantProfileRecord | null> {
  const row = await tx.queryOne<ProfileRow>(`${SELECT} WHERE p.tenant_id = $1`, [tenantId]);
  return row ? toRecord(row) : null;
}

const UPDATABLE = {
  legalName: "legal_name",
  tradeName: "trade_name",
  countryCode: "country_code",
  contactName: "contact_name",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  address: "address",
  logoUrl: "logo_url",
  primaryColor: "primary_color",
  secondaryColor: "secondary_color",
  customDomain: "custom_domain",
} as const;

export type ProfilePatch = Partial<Record<keyof typeof UPDATABLE, string | null>>;

/** `null` si le profil n'existe pas (ou si le patch est vide). */
export async function updateProfile(
  tx: Tx,
  tenantId: string,
  patch: ProfilePatch,
  now: Date,
): Promise<TenantProfileRecord | null> {
  const res = await updateRow(tx, "tenancy.tenant_profiles", UPDATABLE, patch, now, {
    sql: "tenant_id = $1",
    params: [tenantId],
  });
  if (!res || res.rows.length === 0) return null;
  return getProfile(tx, tenantId);
}
