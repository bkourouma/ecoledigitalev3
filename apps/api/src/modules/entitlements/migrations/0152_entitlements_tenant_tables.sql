-- =============================================================================
-- 0152 — Module `entitlements` : tables de tenant (RLS forcée)
-- =============================================================================
-- Références vers les catalogues par CLÉ (stable, lisible). Aucune FK vers le
-- schéma d'un autre module ; seule kernel.tenants est référencée.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Abonnement (plan + packs souscrits + période + statut + tranche d'apprenants)
-- ---------------------------------------------------------------------------
CREATE TABLE entitlements.tenant_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  plan_key         text NOT NULL REFERENCES entitlements.plans (key),
  -- Packs souscrits (CORE est implicite).
  packs            text[] NOT NULL DEFAULT '{}'
                   CHECK (packs <@ ARRAY['PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL']::text[]),
  status           text NOT NULL CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  -- NULL = sans échéance.
  ends_at          timestamptz,
  -- Tranche d'apprenants : plafond de la tranche, NULL = illimité. Mesuré, non bloquant (le socle ne facture pas).
  learner_tier_max integer CHECK (learner_tier_max IS NULL OR learner_tier_max > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- Au plus UN abonnement « vivant » par tenant ; l'historique (CANCELED, EXPIRED) s'accumule.
CREATE UNIQUE INDEX tenant_subscriptions_one_live
  ON entitlements.tenant_subscriptions (tenant_id)
  WHERE status IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

SELECT kernel.enable_tenant_rls('entitlements.tenant_subscriptions');
GRANT SELECT, INSERT, UPDATE ON entitlements.tenant_subscriptions TO app_user;

-- ---------------------------------------------------------------------------
-- Surcharges de feature (grant / deny) : motif obligatoire, expiration facultative.
-- Une surcharge par (tenant, feature).
-- ---------------------------------------------------------------------------
CREATE TABLE entitlements.tenant_feature_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  feature_key text NOT NULL REFERENCES entitlements.features (key),
  effect      text NOT NULL CHECK (effect IN ('GRANT', 'DENY')),
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 5),
  expires_at  timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);

SELECT kernel.enable_tenant_rls('entitlements.tenant_feature_overrides');
GRANT SELECT, INSERT, UPDATE, DELETE ON entitlements.tenant_feature_overrides TO app_user;

-- ---------------------------------------------------------------------------
-- Compteurs d'usage mensuels (apprenants actifs, stockage, SMS) — mesure seulement.
-- `period` = premier jour du mois UTC.
-- ---------------------------------------------------------------------------
CREATE TABLE entitlements.usage_counters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  metric     text NOT NULL CHECK (metric IN ('ACTIVE_LEARNERS', 'STORAGE_BYTES', 'SMS_SENT')),
  period     date NOT NULL CHECK (extract(day FROM period) = 1),
  value      bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric, period)
);

SELECT kernel.enable_tenant_rls('entitlements.usage_counters');
GRANT SELECT, INSERT, UPDATE ON entitlements.usage_counters TO app_user;
