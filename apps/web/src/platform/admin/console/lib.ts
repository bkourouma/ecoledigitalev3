/**
 * Logique pure de la console plateforme (testée) : identifiant dérivé du nom, transitions de statut, formulaires
 * validés par les schémas du contrat (aucune règle dupliquée côté écran).
 */

import {
  CatalogKeySchema,
  SetFeatureOverrideSchema,
  SetSubscriptionSchema,
  UpsertPlanSchema,
  type SetFeatureOverrideInput,
  type SetSubscriptionInput,
  type Subscription,
  type SubscriptionStatus,
  type UpsertPlanInput,
} from "@ecoledigitale/contracts/v2/entitlements";
import { PlatformProvisionTenantBodySchema, type PlatformProvisionTenantBody } from "@ecoledigitale/contracts/v2/platform";
import type { InstitutionPack, TenantStatus } from "@ecoledigitale/contracts/v2/tenancy";
import { toIsoInstant } from "../audit/filters";
import { toLocalInput } from "../roles/assignments";

export const PACKS: readonly InstitutionPack[] = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"];
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];

/** « Lycée Saint-Joseph d'Abidjan » -> `lycee-saint-joseph-d-abidjan` (50 caractères max). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

function collect<K extends string>(issues: readonly { path: (string | number)[]; message: string }[], map: (path: (string | number)[]) => K | null): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const issue of issues) {
    const field = map(issue.path);
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return errors;
}

// --------------------------------------------------------------------------- statut d'une organisation

/** Statuts atteignables depuis `current` (l'API reste juge des transitions). */
export function statusTargets(current: TenantStatus): TenantStatus[] {
  switch (current) {
    case "active":
      return ["suspended", "archived"];
    case "suspended":
      return ["active", "archived"];
    case "archived":
      return ["active"];
  }
}

export const STATUS_ACTION_KEY: Record<TenantStatus, "reactivate" | "suspend" | "archive"> = {
  active: "reactivate",
  suspended: "suspend",
  archived: "archive",
};

// --------------------------------------------------------------------------- provisionnement

export interface ProvisionFormState {
  name: string;
  slug: string;
  countryCode: string;
  packs: readonly InstitutionPack[];
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  trialPlan: string;
  trialDays: string;
}

export const EMPTY_PROVISION: ProvisionFormState = {
  name: "",
  slug: "",
  countryCode: "CI",
  packs: [],
  adminName: "",
  adminEmail: "",
  adminPhone: "",
  trialPlan: "",
  trialDays: "",
};

export type ProvisionField = "name" | "slug" | "countryCode" | "packs" | "adminName" | "adminEmail" | "adminPhone" | "trialPlan" | "trialDays";

export function validateProvision(f: ProvisionFormState): { data: PlatformProvisionTenantBody | null; errors: FieldErrors<ProvisionField> } {
  const trial: Record<string, unknown> = {};
  if (f.trialPlan) trial.planKey = f.trialPlan;
  if (f.trialDays.trim()) trial.days = Number(f.trialDays);
  const candidate = {
    name: f.name.trim(),
    slug: f.slug.trim(),
    countryCode: f.countryCode.trim().toUpperCase(),
    packs: [...f.packs],
    adminContact: {
      name: f.adminName.trim(),
      email: f.adminEmail.trim(),
      ...(f.adminPhone.trim() ? { phone: f.adminPhone.trim() } : {}),
    },
    ...(Object.keys(trial).length > 0 ? { trial } : {}),
  };
  const parsed = PlatformProvisionTenantBodySchema.safeParse(candidate);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors = collect<ProvisionField>(parsed.error.issues, (path) => {
    const [head, second] = path;
    if (head === "adminContact") return second === "name" ? "adminName" : second === "email" ? "adminEmail" : second === "phone" ? "adminPhone" : null;
    if (head === "trial") return second === "planKey" ? "trialPlan" : "trialDays";
    return typeof head === "string" && ["name", "slug", "countryCode", "packs"].includes(head) ? (head as ProvisionField) : null;
  });
  // Message par défaut de Zod (anglais) pour « aucun pack » : remplacé par un code que l'écran traduit.
  if (errors.packs) errors.packs = "packs";
  return { data: null, errors };
}

// --------------------------------------------------------------------------- abonnement

export interface SubscriptionFormState {
  planKey: string;
  packs: readonly InstitutionPack[];
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  learnerTierMax: string;
}

export function subscriptionFormFrom(s: Subscription | null | undefined): SubscriptionFormState {
  return {
    planKey: s?.planKey ?? "",
    packs: s?.packs ?? [],
    status: s?.status ?? "ACTIVE",
    startsAt: toLocalInput(s?.startsAt ?? null),
    endsAt: toLocalInput(s?.endsAt ?? null),
    learnerTierMax: s?.learnerTierMax ? String(s.learnerTierMax) : "",
  };
}

export type SubscriptionField = "planKey" | "packs" | "startsAt" | "endsAt" | "learnerTierMax";

export function validateSubscription(f: SubscriptionFormState): { data: SetSubscriptionInput | null; errors: FieldErrors<SubscriptionField> } {
  const errors: FieldErrors<SubscriptionField> = {};
  if (!f.planKey) errors.planKey = "plan";
  const startsAt = toIsoInstant(f.startsAt);
  const endsAt = toIsoInstant(f.endsAt);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) errors.endsAt = "period";
  let tier: number | null = null;
  if (f.learnerTierMax.trim()) {
    tier = Number(f.learnerTierMax);
    if (!Number.isInteger(tier) || tier <= 0) errors.learnerTierMax = "learnerTier";
  }
  if (Object.keys(errors).length > 0) return { data: null, errors };
  const parsed = SetSubscriptionSchema.safeParse({
    planKey: f.planKey,
    packs: [...f.packs],
    status: f.status,
    ...(startsAt ? { startsAt } : {}),
    endsAt: endsAt ?? null,
    learnerTierMax: tier,
  });
  if (parsed.success) return { data: parsed.data, errors: {} };
  const mapped = collect<SubscriptionField>(parsed.error.issues, (path) => (typeof path[0] === "string" && ["planKey", "packs", "startsAt", "endsAt", "learnerTierMax"].includes(path[0]) ? (path[0] as SubscriptionField) : null));
  return { data: null, errors: mapped };
}

// --------------------------------------------------------------------------- dérogation

export interface OverrideFormState {
  featureKey: string;
  effect: "GRANT" | "DENY";
  reason: string;
  expiresAt: string;
}

export const EMPTY_OVERRIDE: OverrideFormState = { featureKey: "", effect: "GRANT", reason: "", expiresAt: "" };

export type OverrideField = "featureKey" | "reason" | "expiresAt";

export function validateOverride(f: OverrideFormState): { data: SetFeatureOverrideInput | null; errors: FieldErrors<OverrideField> } {
  const errors: FieldErrors<OverrideField> = {};
  if (!f.featureKey) errors.featureKey = "feature";
  const expiresAt = toIsoInstant(f.expiresAt);
  const parsed = SetFeatureOverrideSchema.safeParse({ effect: f.effect, reason: f.reason.trim(), ...(f.expiresAt ? { expiresAt } : {}) });
  if (!parsed.success) {
    Object.assign(errors, collect<OverrideField>(parsed.error.issues, (path) => (path[0] === "reason" ? "reason" : path[0] === "expiresAt" ? "expiresAt" : null)));
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { data: null, errors };
  return { data: parsed.data, errors: {} };
}

// --------------------------------------------------------------------------- plan

export interface PlanFormState {
  key: string;
  label: string;
  description: string;
  sortOrder: string;
  active: boolean;
}

export const EMPTY_PLAN: PlanFormState = { key: "", label: "", description: "", sortOrder: "100", active: true };

export type PlanField = "key" | "label" | "description" | "sortOrder";

export function validatePlan(f: PlanFormState, creating: boolean): { data: ({ key: string } & UpsertPlanInput) | null; errors: FieldErrors<PlanField> } {
  const errors: FieldErrors<PlanField> = {};
  if (creating) {
    const key = CatalogKeySchema.safeParse(f.key.trim());
    if (!key.success) errors.key = key.error.issues[0]?.message ?? "";
  }
  const sortOrder = f.sortOrder.trim() === "" ? undefined : Number(f.sortOrder);
  const parsed = UpsertPlanSchema.safeParse({
    label: f.label.trim(),
    description: f.description.trim() === "" ? null : f.description.trim(),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    active: f.active,
  });
  if (!parsed.success) {
    Object.assign(errors, collect<PlanField>(parsed.error.issues, (path) => (typeof path[0] === "string" && ["label", "description", "sortOrder"].includes(path[0]) ? (path[0] as PlanField) : null)));
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { data: null, errors };
  return { data: { key: f.key.trim(), ...parsed.data }, errors: {} };
}
