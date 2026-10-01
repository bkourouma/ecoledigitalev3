/**
 * Contrats v2 du module `entitlements` (plans, packs, features, abonnements,
 * surcharges, mesure d'usage).
 *
 * Le socle ne FACTURE pas : il mesure et il autorise (plan §3.5).
 */
import { z } from "zod";

const IsoDate = z.string();
const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

/** Clés de catalogue (plan, pack) : majuscules et `_`. */
export const CatalogKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Clé en majuscules (ex. PROFESSIONAL).");

/** Clé de feature : `module.nom-de-feature` (cf. manifestes). */
export const FeatureKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_-]*){1,3}$/, "Clé de feature attendue (ex. finance.online-payment).");

/** Packs pouvant figurer dans une feature : `CORE` = toujours disponible. */
export const FeaturePackSchema = z.enum(["CORE", "PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
export type FeaturePack = z.infer<typeof FeaturePackSchema>;

export const SubscribablePackSchema = z.enum(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);

export const SubscriptionStatusSchema = z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const OverrideEffectSchema = z.enum(["GRANT", "DENY"]);
export type OverrideEffect = z.infer<typeof OverrideEffectSchema>;

export const UsageMetricSchema = z.enum(["ACTIVE_LEARNERS", "STORAGE_BYTES", "SMS_SENT"]);
export type UsageMetric = z.infer<typeof UsageMetricSchema>;

// ---------------------------------------------------------------------------
// Catalogue (global)
// ---------------------------------------------------------------------------

export const PlanSchema = z.object({
  key: CatalogKeySchema,
  label: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  featureKeys: z.array(FeatureKeySchema),
});
export type Plan = z.infer<typeof PlanSchema>;

export const UpsertPlanSchema = z
  .object({
    label: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpsertPlanInput = z.infer<typeof UpsertPlanSchema>;

export const SetPlanFeaturesSchema = z.object({ featureKeys: z.array(FeatureKeySchema).max(500) }).strict();
export type SetPlanFeaturesInput = z.infer<typeof SetPlanFeaturesSchema>;

export const PackSchema = z.object({
  key: CatalogKeySchema,
  label: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type Pack = z.infer<typeof PackSchema>;

export const FeatureSchema = z.object({
  key: FeatureKeySchema,
  label: z.string(),
  moduleKey: z.string(),
  /** Packs qui incluent la feature par défaut (`CORE` = toujours). */
  packs: z.array(FeaturePackSchema),
  retired: z.boolean(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const CatalogResponseSchema = z.object({
  plans: z.array(PlanSchema),
  packs: z.array(PackSchema),
  features: z.array(FeatureSchema),
});

// ---------------------------------------------------------------------------
// Abonnement et surcharges (par tenant)
// ---------------------------------------------------------------------------

export const SubscriptionSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  planKey: CatalogKeySchema,
  packs: z.array(SubscribablePackSchema),
  status: SubscriptionStatusSchema,
  startsAt: IsoDate,
  endsAt: IsoDate.nullable(),
  /** Tranche d'apprenants : plafond de la tranche (`null` = illimité). Mesuré, non bloquant à ce stade. */
  learnerTierMax: z.number().int().positive().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const SetSubscriptionSchema = z
  .object({
    planKey: CatalogKeySchema,
    packs: z.array(SubscribablePackSchema).max(4),
    status: SubscriptionStatusSchema.default("ACTIVE"),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    learnerTierMax: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type SetSubscriptionInput = z.infer<typeof SetSubscriptionSchema>;

export const FeatureOverrideSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  featureKey: FeatureKeySchema,
  effect: OverrideEffectSchema,
  reason: z.string(),
  expiresAt: IsoDate.nullable(),
  createdBy: UuidSchema.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type FeatureOverride = z.infer<typeof FeatureOverrideSchema>;

export const SetFeatureOverrideSchema = z
  .object({
    effect: OverrideEffectSchema,
    /** Motif obligatoire : une surcharge sans justification n'est pas auditable. */
    reason: z.string().trim().min(5).max(500),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type SetFeatureOverrideInput = z.infer<typeof SetFeatureOverrideSchema>;

// ---------------------------------------------------------------------------
// Droits effectifs
// ---------------------------------------------------------------------------

export const EntitlementReasonSchema = z.enum([
  "OK",
  "TENANT_SUSPENDED",
  "TENANT_ARCHIVED",
  "NO_SUBSCRIPTION",
  "SUBSCRIPTION_INACTIVE",
]);
export type EntitlementReason = z.infer<typeof EntitlementReasonSchema>;

export const FeatureSourceSchema = z.enum(["CORE", "PLAN", "PACK", "OVERRIDE"]);
export type FeatureSource = z.infer<typeof FeatureSourceSchema>;

export const EffectiveEntitlementsSchema = z.object({
  tenantId: UuidSchema,
  /** `OK` si l'abonnement est actif ; sinon seules les features CORE sont accordées. */
  reason: EntitlementReasonSchema,
  planKey: CatalogKeySchema.nullable(),
  packs: z.array(SubscribablePackSchema),
  subscriptionStatus: SubscriptionStatusSchema.nullable(),
  features: z.array(FeatureKeySchema),
  /** Pourquoi chaque feature est accordée (console super-admin, support). */
  sources: z.record(FeatureKeySchema, FeatureSourceSchema),
  limits: z.object({ learnerTierMax: z.number().int().positive().nullable() }),
  /** Instant à partir duquel ce résultat peut changer sans événement (expiration d'une surcharge, fin d'abonnement). */
  validUntil: IsoDate.nullable(),
  computedAt: IsoDate,
});
export type EffectiveEntitlementsDto = z.infer<typeof EffectiveEntitlementsSchema>;

export const UsageCounterSchema = z.object({
  metric: UsageMetricSchema,
  /** Premier jour du mois UTC (`YYYY-MM-DD`). */
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().int().nonnegative(),
  updatedAt: IsoDate,
});
export type UsageCounter = z.infer<typeof UsageCounterSchema>;

export const UsageQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
    metric: UsageMetricSchema.optional(),
  })
  .strict();
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

export const RecordUsageSchema = z
  .object({
    metric: UsageMetricSchema,
    amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** INCREMENT : cumul (SMS) ; SET : jauge (stockage) ; MAX : pic de la période (apprenants actifs). */
    mode: z.enum(["INCREMENT", "SET", "MAX"]).optional(),
  })
  .strict();
export type RecordUsageInput = z.infer<typeof RecordUsageSchema>;

// ---------------------------------------------------------------------------
// Événements publiés (outbox ; payload versionné `{ v: 1, ... }`)
// ---------------------------------------------------------------------------

const SubscriptionSnapshot = z.object({
  planKey: CatalogKeySchema,
  packs: z.array(SubscribablePackSchema),
  status: SubscriptionStatusSchema,
  startsAt: IsoDate,
  endsAt: IsoDate.nullable(),
  learnerTierMax: z.number().int().positive().nullable(),
});

export const EntitlementsSubscriptionChangedPayloadSchema = z.object({
  v: z.literal(1),
  subscriptionId: UuidSchema,
  current: SubscriptionSnapshot,
  previous: SubscriptionSnapshot.nullable(),
});
export type EntitlementsSubscriptionChangedPayload = z.infer<typeof EntitlementsSubscriptionChangedPayloadSchema>;

export const EntitlementsOverrideChangedPayloadSchema = z.object({
  v: z.literal(1),
  featureKey: FeatureKeySchema,
  /** `null` = surcharge supprimée. */
  effect: OverrideEffectSchema.nullable(),
  previousEffect: OverrideEffectSchema.nullable(),
  reason: z.string().nullable(),
  expiresAt: IsoDate.nullable(),
});
export type EntitlementsOverrideChangedPayload = z.infer<typeof EntitlementsOverrideChangedPayloadSchema>;

/** Schéma de charge utile de chaque événement PUBLIÉ par entitlements (validé par les tests de contrat). */
export const entitlementsEventPayloadSchemas = {
  "entitlements.subscription.changed": EntitlementsSubscriptionChangedPayloadSchema,
  "entitlements.override.changed": EntitlementsOverrideChangedPayloadSchema,
} as const;
