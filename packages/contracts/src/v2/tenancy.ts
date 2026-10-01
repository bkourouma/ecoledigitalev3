/**
 * Contrats v2 du module `tenancy` (organisation, établissements, campus,
 * profil de pays, provisioning, onboarding).
 *
 * Identifiants de code en anglais, libellés en français (ADR-007). Les dates
 * sont des chaînes ISO-8601 UTC (`...Z`) ; les identifiants des UUID.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

/** Packs vendables : un établissement relève d'exactement un pack. */
export const INSTITUTION_PACKS = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] as const;
export const InstitutionPackSchema = z.enum(INSTITUTION_PACKS);
export type InstitutionPack = z.infer<typeof InstitutionPackSchema>;

export const EntityStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

export const TenantStatusSchema = z.enum(["active", "suspended", "archived"]);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

/** ISO 3166-1 alpha-2, en majuscules. */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Code pays ISO 3166-1 alpha-2 attendu (ex. CI).");

/** Code lisible, unique dans son périmètre (par tenant pour un établissement, par établissement pour un campus). */
export const TenancyCodeSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,30}$/, "Code en minuscules, chiffres et tirets (31 caractères max).");

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur hexadécimale attendue (ex. #1A73E8).");

/** Nom de domaine en minuscules (sans schéma ni chemin). */
export const CustomDomainSchema = z
  .string()
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
    "Nom de domaine en minuscules attendu (ex. ecole.example.org).",
  );

/** Slug d'organisation : identique à la contrainte de `kernel.tenants`. */
export const TenantSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/, "Slug de 2 à 50 caractères : minuscules, chiffres et tirets.");

const IsoDate = z.string();
const UuidSchema = z.string().uuid();
const PhoneSchema = z.string().trim().regex(/^\+?[0-9 ().-]{6,24}$/, "Numéro de téléphone invalide.");

// ---------------------------------------------------------------------------
// Profil de pays (référentiel global)
// ---------------------------------------------------------------------------

export const CountryProfileSchema = z.object({
  code: CountryCodeSchema,
  name: z.string(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  /** Exposant de la devise (0 pour XOF) : jamais une constante dans le code (ADR-007). */
  currencyExponent: z.number().int().min(0).max(4),
  locale: z.string(),
  timezone: z.string(),
  phonePrefix: z.string().regex(/^\+[0-9]{1,4}$/),
  educationSystem: z.string(),
});
export type CountryProfile = z.infer<typeof CountryProfileSchema>;

export const ListCountriesResponseSchema = z.object({ items: z.array(CountryProfileSchema) });

// ---------------------------------------------------------------------------
// Profil de l'organisation (1:1 avec le tenant)
// ---------------------------------------------------------------------------

export const TenantProfileSchema = z.object({
  tenantId: UuidSchema,
  slug: z.string(),
  legalName: z.string(),
  tradeName: z.string().nullable(),
  countryCode: CountryCodeSchema,
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
  branding: z.object({
    logoUrl: z.string().nullable(),
    primaryColor: HexColorSchema.nullable(),
    secondaryColor: HexColorSchema.nullable(),
    customDomain: z.string().nullable(),
  }),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type TenantProfile = z.infer<typeof TenantProfileSchema>;

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const UpdateTenantProfileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    tradeName: nullableText(200),
    countryCode: CountryCodeSchema,
    contactName: nullableText(200),
    contactEmail: z.string().trim().toLowerCase().email().max(254).nullable(),
    contactPhone: PhoneSchema.nullable(),
    address: nullableText(500),
    logoUrl: z.string().trim().url().max(2048).nullable(),
    primaryColor: HexColorSchema.nullable(),
    secondaryColor: HexColorSchema.nullable(),
    customDomain: CustomDomainSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Au moins un champ à modifier." });
export type UpdateTenantProfileInput = z.infer<typeof UpdateTenantProfileSchema>;

// ---------------------------------------------------------------------------
// Établissements et campus
// ---------------------------------------------------------------------------

export const InstitutionSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  code: TenancyCodeSchema,
  name: z.string(),
  pack: InstitutionPackSchema,
  educationSystem: z.string(),
  countryCode: CountryCodeSchema,
  status: EntityStatusSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Institution = z.infer<typeof InstitutionSchema>;

export const CreateInstitutionSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    pack: InstitutionPackSchema,
    /** Défaut : dérivé du pack (puis suffixé si déjà pris). */
    code: TenancyCodeSchema.optional(),
    /** Défaut : pays du profil de l'organisation. */
    countryCode: CountryCodeSchema.optional(),
    /** Défaut : système éducatif du pays. */
    educationSystem: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type CreateInstitutionInput = z.infer<typeof CreateInstitutionSchema>;

export const UpdateInstitutionSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    educationSystem: z.string().trim().min(1).max(40),
    status: EntityStatusSchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Au moins un champ à modifier." });
export type UpdateInstitutionInput = z.infer<typeof UpdateInstitutionSchema>;

export const ListInstitutionsResponseSchema = z.object({ items: z.array(InstitutionSchema) });

export const CampusSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  institutionId: UuidSchema,
  code: TenancyCodeSchema,
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  isDefault: z.boolean(),
  status: EntityStatusSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Campus = z.infer<typeof CampusSchema>;

export const CreateCampusSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    code: TenancyCodeSchema.optional(),
    address: nullableText(500).optional(),
    city: nullableText(120).optional(),
    phone: PhoneSchema.nullable().optional(),
  })
  .strict();
export type CreateCampusInput = z.infer<typeof CreateCampusSchema>;

export const UpdateCampusSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    address: nullableText(500),
    city: nullableText(120),
    phone: PhoneSchema.nullable(),
    status: EntityStatusSchema,
    /** Seule la promotion est possible : le campus par défaut précédent est rétrogradé. */
    isDefault: z.literal(true),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Au moins un champ à modifier." });
export type UpdateCampusInput = z.infer<typeof UpdateCampusSchema>;

export const ListCampusesResponseSchema = z.object({ items: z.array(CampusSchema) });

// ---------------------------------------------------------------------------
// Onboarding (PRD §56)
// ---------------------------------------------------------------------------

export const ONBOARDING_STEP_KEYS = [
  "ACCOUNT",
  "INSTITUTION",
  "COUNTRY",
  "INSTITUTION_TYPE",
  "PACK",
  "ACADEMIC_YEAR",
  "STUDENT_IMPORT",
  "CLASSES",
  "TEACHERS",
  "FINANCE",
  "GO_LIVE",
] as const;
export const OnboardingStepKeySchema = z.enum(ONBOARDING_STEP_KEYS);
export type OnboardingStepKey = z.infer<typeof OnboardingStepKeySchema>;

export const OnboardingStepStatusSchema = z.enum(["PENDING", "COMPLETED", "SKIPPED"]);
export type OnboardingStepStatus = z.infer<typeof OnboardingStepStatusSchema>;

export const OnboardingStepSchema = z.object({
  key: OnboardingStepKeySchema,
  order: z.number().int(),
  optional: z.boolean(),
  status: OnboardingStepStatusSchema,
  /** `true` si l'étape peut être terminée (ou ignorée) maintenant. */
  available: z.boolean(),
  completedAt: IsoDate.nullable(),
});
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

export const OnboardingStatusSchema = z.enum(["IN_PROGRESS", "LIVE"]);
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

export const OnboardingStateSchema = z.object({
  status: OnboardingStatusSchema,
  /** Première étape à traiter ; `null` une fois en production. */
  currentStep: OnboardingStepKeySchema.nullable(),
  progress: z.object({
    done: z.number().int(),
    total: z.number().int(),
    percent: z.number().int().min(0).max(100),
  }),
  steps: z.array(OnboardingStepSchema),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export const AdminContactSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: PhoneSchema.optional(),
  })
  .strict();
export type AdminContact = z.infer<typeof AdminContactSchema>;

export const ProvisionTenantInputSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: TenantSlugSchema,
    countryCode: CountryCodeSchema,
    packs: z.array(InstitutionPackSchema).min(1).max(INSTITUTION_PACKS.length),
    adminContact: AdminContactSchema,
  })
  .strict();
export type ProvisionTenantInput = z.infer<typeof ProvisionTenantInputSchema>;

export const ProvisionTenantResultSchema = z.object({
  tenantId: UuidSchema,
  slug: z.string(),
  institutions: z.array(
    z.object({ id: UuidSchema, code: z.string(), pack: InstitutionPackSchema, defaultCampusId: UuidSchema }),
  ),
  onboarding: OnboardingStateSchema,
});
export type ProvisionTenantResult = z.infer<typeof ProvisionTenantResultSchema>;

// ---------------------------------------------------------------------------
// Événements publiés (outbox ; payload versionné `{ v: 1, ... }`)
// ---------------------------------------------------------------------------

export const TenancyInstitutionCreatedPayloadSchema = z.object({
  v: z.literal(1),
  institutionId: UuidSchema,
  code: z.string(),
  name: z.string(),
  pack: InstitutionPackSchema,
  countryCode: CountryCodeSchema,
  educationSystem: z.string(),
  defaultCampusId: UuidSchema,
});
export type TenancyInstitutionCreatedPayload = z.infer<typeof TenancyInstitutionCreatedPayloadSchema>;

export const TenancyTenantProvisionedPayloadSchema = z.object({
  v: z.literal(1),
  tenantId: UuidSchema,
  slug: z.string(),
  name: z.string(),
  countryCode: CountryCodeSchema,
  packs: z.array(InstitutionPackSchema),
  institutionIds: z.array(UuidSchema),
  adminContact: AdminContactSchema,
});
export type TenancyTenantProvisionedPayload = z.infer<typeof TenancyTenantProvisionedPayloadSchema>;

export const TenancyTenantStatusChangedPayloadSchema = z.object({
  v: z.literal(1),
  tenantId: UuidSchema,
  status: TenantStatusSchema,
  previousStatus: TenantStatusSchema,
  reason: z.string().nullable(),
});
export type TenancyTenantStatusChangedPayload = z.infer<typeof TenancyTenantStatusChangedPayloadSchema>;
