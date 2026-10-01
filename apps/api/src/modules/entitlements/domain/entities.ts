/** Entités du module `entitlements` (objets simples, dates en `Date`). */
import type {
  FeaturePack,
  OverrideEffect,
  SubscriptionStatus,
  UsageMetric,
} from "@ecoledigitale/contracts/src/v2/entitlements";

export interface PlanRecord {
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  featureKeys: string[];
}

export interface PackRecord {
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface FeatureRecord {
  key: string;
  label: string;
  moduleKey: string;
  packs: FeaturePack[];
  retired: boolean;
}

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  planKey: string;
  packs: string[];
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
  learnerTierMax: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OverrideRecord {
  id: string;
  tenantId: string;
  featureKey: string;
  effect: OverrideEffect;
  reason: string;
  expiresAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageCounterRecord {
  metric: UsageMetric;
  /** Premier jour du mois UTC, `YYYY-MM-DD`. */
  period: string;
  value: number;
  updatedAt: Date;
}
