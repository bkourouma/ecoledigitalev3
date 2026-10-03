/** Entités du module `tenancy` (objets simples, dates en `Date`). */
import type {
  EntityStatus,
  InstitutionPack,
  TenantStatus,
} from "@ecoledigitale/contracts/src/v2/tenancy";

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

export interface CountryProfileRecord {
  code: string;
  name: string;
  currencyCode: string;
  currencyExponent: number;
  locale: string;
  timezone: string;
  phonePrefix: string;
  educationSystem: string;
}

export interface TenantProfileRecord {
  tenantId: string;
  slug: string;
  legalName: string;
  tradeName: string | null;
  countryCode: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  customDomain: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Marque minimale d'affichage (lisible par tout membre du tenant) : aucune donnée de contact ni technique. */
export interface TenantBrandingRecord {
  slug: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  locale: string;
  timezone: string;
  currencyCode: string;
}

export interface InstitutionRecord {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  pack: InstitutionPack;
  educationSystem: string;
  countryCode: string;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampusRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  isDefault: boolean;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
}
