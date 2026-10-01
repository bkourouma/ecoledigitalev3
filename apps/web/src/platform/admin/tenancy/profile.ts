/**
 * Formulaire du profil d'établissement (fonctions pures, testées).
 *
 * La validation est celle du CONTRAT (`UpdateTenantProfileSchema`) : aucune règle dupliquée côté écran. Les champs vides
 * deviennent `null` (effacement), et seuls les champs modifiés partent dans le `PATCH`.
 */

import {
  CreateCampusSchema,
  CreateInstitutionSchema,
  UpdateCampusSchema,
  UpdateInstitutionSchema,
  UpdateTenantProfileSchema,
  type Campus,
  type CreateCampusInput,
  type CreateInstitutionInput,
  type Institution,
  type InstitutionPack,
  type TenantProfile,
  type UpdateTenantProfileInput,
} from "@ecoledigitale/contracts/v2/tenancy";

export interface ProfileFormState {
  legalName: string;
  tradeName: string;
  countryCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  customDomain: string;
}

export const PROFILE_FIELDS = [
  "legalName",
  "tradeName",
  "countryCode",
  "contactName",
  "contactEmail",
  "contactPhone",
  "address",
  "logoUrl",
  "primaryColor",
  "secondaryColor",
  "customDomain",
] as const satisfies readonly (keyof ProfileFormState)[];

export function toFormState(p: TenantProfile): ProfileFormState {
  return {
    legalName: p.legalName,
    tradeName: p.tradeName ?? "",
    countryCode: p.countryCode,
    contactName: p.contactName ?? "",
    contactEmail: p.contactEmail ?? "",
    contactPhone: p.contactPhone ?? "",
    address: p.address ?? "",
    logoUrl: p.branding.logoUrl ?? "",
    primaryColor: p.branding.primaryColor ?? "",
    secondaryColor: p.branding.secondaryColor ?? "",
    customDomain: p.branding.customDomain ?? "",
  };
}

function currentValues(p: TenantProfile): Record<(typeof PROFILE_FIELDS)[number], string | null> {
  return {
    legalName: p.legalName,
    tradeName: p.tradeName,
    countryCode: p.countryCode,
    contactName: p.contactName,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone,
    address: p.address,
    logoUrl: p.branding.logoUrl,
    primaryColor: p.branding.primaryColor,
    secondaryColor: p.branding.secondaryColor,
    customDomain: p.branding.customDomain,
  };
}

/** Champs modifiés (`null` = effacer). Vide si rien n'a changé. */
export function diffProfile(form: ProfileFormState, profile: TenantProfile): Record<string, string | null> {
  const current = currentValues(profile);
  const patch: Record<string, string | null> = {};
  for (const field of PROFILE_FIELDS) {
    const next = form[field].trim();
    const value = next === "" && field !== "legalName" && field !== "countryCode" ? null : next;
    if (value !== current[field]) patch[field] = value;
  }
  return patch;
}

export interface ProfileValidation {
  data: UpdateTenantProfileInput | null;
  errors: Partial<Record<keyof ProfileFormState, string>>;
}

/** Valide le patch avec le schéma du contrat ; renvoie les messages (français) par champ. */
export function validateProfilePatch(patch: Record<string, string | null>): ProfileValidation {
  const parsed = UpdateTenantProfileSchema.safeParse(patch);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors: ProfileValidation["errors"] = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && (PROFILE_FIELDS as readonly string[]).includes(field) && !(field in errors)) {
      errors[field as keyof ProfileFormState] = issue.message;
    }
  }
  return { data: null, errors };
}

// --------------------------------------------------------------------------- établissements / campus

export const PACK_KEYS: readonly InstitutionPack[] = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"];

export interface InstitutionFormState {
  name: string;
  pack: InstitutionPack | "";
  code: string;
  educationSystem: string;
}

export function validateInstitutionCreate(f: InstitutionFormState): { data: CreateInstitutionInput | null; errors: Partial<Record<keyof InstitutionFormState, string>> } {
  const candidate: Record<string, unknown> = { name: f.name.trim(), pack: f.pack };
  if (f.code.trim()) candidate.code = f.code.trim();
  if (f.educationSystem.trim()) candidate.educationSystem = f.educationSystem.trim();
  const parsed = CreateInstitutionSchema.safeParse(candidate);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors: Partial<Record<keyof InstitutionFormState, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof InstitutionFormState;
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return { data: null, errors };
}

export function validateInstitutionUpdate(
  f: { name: string; educationSystem: string; status: Institution["status"] },
  current: Institution,
): { data: Record<string, string> | null; errors: Partial<Record<"name" | "educationSystem", string>> } {
  const patch: Record<string, string> = {};
  if (f.name.trim() !== current.name) patch.name = f.name.trim();
  if (f.educationSystem.trim() !== current.educationSystem) patch.educationSystem = f.educationSystem.trim();
  if (f.status !== current.status) patch.status = f.status;
  if (Object.keys(patch).length === 0) return { data: null, errors: {} };
  const parsed = UpdateInstitutionSchema.safeParse(patch);
  if (parsed.success) return { data: patch, errors: {} };
  const errors: Partial<Record<"name" | "educationSystem", string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "educationSystem") && !(field in errors)) errors[field] = issue.message;
  }
  return { data: null, errors };
}

export interface CampusFormState {
  name: string;
  code: string;
  address: string;
  city: string;
  phone: string;
}

export const EMPTY_CAMPUS_FORM: CampusFormState = { name: "", code: "", address: "", city: "", phone: "" };

export function campusFormFrom(c: Campus): CampusFormState {
  return { name: c.name, code: c.code, address: c.address ?? "", city: c.city ?? "", phone: c.phone ?? "" };
}

export function validateCampusCreate(f: CampusFormState): { data: CreateCampusInput | null; errors: Partial<Record<keyof CampusFormState, string>> } {
  const candidate: Record<string, unknown> = { name: f.name.trim() };
  if (f.code.trim()) candidate.code = f.code.trim();
  if (f.address.trim()) candidate.address = f.address.trim();
  if (f.city.trim()) candidate.city = f.city.trim();
  if (f.phone.trim()) candidate.phone = f.phone.trim();
  const parsed = CreateCampusSchema.safeParse(candidate);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors: Partial<Record<keyof CampusFormState, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof CampusFormState;
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return { data: null, errors };
}

/** Patch d'un campus : champs modifiés seulement (`null` pour effacer une valeur facultative). */
export function validateCampusUpdate(
  f: CampusFormState & { status: Campus["status"] },
  current: Campus,
): { data: Record<string, string | null> | null; errors: Partial<Record<keyof CampusFormState, string>> } {
  const patch: Record<string, string | null> = {};
  const optional = (v: string) => (v.trim() === "" ? null : v.trim());
  if (f.name.trim() !== current.name) patch.name = f.name.trim();
  if (optional(f.address) !== current.address) patch.address = optional(f.address);
  if (optional(f.city) !== current.city) patch.city = optional(f.city);
  if (optional(f.phone) !== current.phone) patch.phone = optional(f.phone);
  if (f.status !== current.status) patch.status = f.status;
  if (Object.keys(patch).length === 0) return { data: null, errors: {} };
  const parsed = UpdateCampusSchema.safeParse(patch);
  if (parsed.success) return { data: patch, errors: {} };
  const errors: Partial<Record<keyof CampusFormState, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof CampusFormState;
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return { data: null, errors };
}
