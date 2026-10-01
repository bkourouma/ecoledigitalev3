/** Entités du domaine -> DTO des contrats (`packages/contracts/src/v2/tenancy.ts`). */
import type {
  Campus,
  CountryProfile,
  Institution,
  TenantProfile,
} from "@ecoledigitale/contracts/src/v2/tenancy";
import type {
  CampusRecord,
  CountryProfileRecord,
  InstitutionRecord,
  TenantProfileRecord,
} from "../domain/entities";

export const toTenantProfileDto = (p: TenantProfileRecord): TenantProfile => ({
  tenantId: p.tenantId,
  slug: p.slug,
  legalName: p.legalName,
  tradeName: p.tradeName,
  countryCode: p.countryCode,
  contactName: p.contactName,
  contactEmail: p.contactEmail,
  contactPhone: p.contactPhone,
  address: p.address,
  branding: {
    logoUrl: p.logoUrl,
    primaryColor: p.primaryColor,
    secondaryColor: p.secondaryColor,
    customDomain: p.customDomain,
  },
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toInstitutionDto = (i: InstitutionRecord): Institution => ({
  id: i.id,
  tenantId: i.tenantId,
  code: i.code,
  name: i.name,
  pack: i.pack,
  educationSystem: i.educationSystem,
  countryCode: i.countryCode,
  status: i.status,
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
});

export const toCampusDto = (c: CampusRecord): Campus => ({
  id: c.id,
  tenantId: c.tenantId,
  institutionId: c.institutionId,
  code: c.code,
  name: c.name,
  address: c.address,
  city: c.city,
  phone: c.phone,
  isDefault: c.isDefault,
  status: c.status,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const toCountryDto = (c: CountryProfileRecord): CountryProfile => ({ ...c });
