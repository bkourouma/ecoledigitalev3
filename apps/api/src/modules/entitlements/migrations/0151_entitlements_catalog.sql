-- =============================================================================
-- 0151 — Module `entitlements` : catalogues GLOBAUX (plans, packs, features)
-- =============================================================================
--
-- Numérotation : versions de migration GLOBALES à tous les modules.
-- Plage réservée : entitlements = 0150-0199 (dépend de tenancy = 0100-0149).
--
-- Tables GLOBALES (sans tenant_id, hors RLS), déclarées dans
-- `isolation-allowlist.entitlements.ts` : ce sont des catalogues commerciaux
-- identiques pour tous les tenants, sans donnée de tenant ni donnée personnelle.
--
--   plans          STARTER, PROFESSIONAL, ENTERPRISE (seed)
--   packs          PRIMARY, SECONDARY, HIGHER, VIRTUAL (seed) ; CORE est implicite
--                  (toujours actif) et n'est donc pas une ligne vendable
--   features       alimentée par `syncFeatureCatalog(manifests)` depuis les manifestes
--   plan_features  features accordées par un plan
--
-- Une feature est accordée si : packs contient CORE, OU le plan l'inclut
-- (plan_features), OU un pack souscrit l'inclut (features.packs), OU une
-- surcharge GRANT la donne — moins les surcharges DENY (jamais sur CORE).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS entitlements;

REVOKE ALL ON SCHEMA entitlements FROM PUBLIC;
GRANT USAGE ON SCHEMA entitlements TO app_user;

CREATE TABLE entitlements.plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlements.packs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlements.features (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE
              CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_-]*){1,3}$'),
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  module_key  text NOT NULL CHECK (module_key ~ '^[a-z][a-z0-9_]*$'),
  -- Packs qui incluent la feature par défaut ('CORE' = toujours disponible).
  packs       text[] NOT NULL DEFAULT '{}'
              CHECK (packs <@ ARRAY['CORE', 'PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL']::text[]),
  -- Feature disparue des manifestes : conservée (les surcharges existantes la référencent) mais sans effet.
  retired_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlements.plan_features (
  plan_key    text NOT NULL REFERENCES entitlements.plans (key),
  feature_key text NOT NULL REFERENCES entitlements.features (key),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_key, feature_key)
);
CREATE INDEX plan_features_feature_idx ON entitlements.plan_features (feature_key);

-- Droits : le catalogue est administré par la console plateforme (SuperAdminAuthorizer
-- côté application) ; la base ne peut pas distinguer un opérateur d'un tenant, donc
-- AUCUN DELETE et seulement les écritures nécessaires.
GRANT SELECT, INSERT, UPDATE ON entitlements.plans TO app_user;
GRANT SELECT, INSERT, UPDATE ON entitlements.packs TO app_user;
GRANT SELECT, INSERT, UPDATE ON entitlements.features TO app_user;
GRANT SELECT, INSERT, DELETE ON entitlements.plan_features TO app_user;

INSERT INTO entitlements.plans (key, label, description, sort_order) VALUES
  ('STARTER',      'Starter',      'Pour démarrer : un établissement, fonctions essentielles.', 10),
  ('PROFESSIONAL', 'Professionnel', 'Pour les établissements établis : fonctions avancées.',     20),
  ('ENTERPRISE',   'Entreprise',    'Pour les groupes scolaires : multi-établissements, sur mesure.', 30)
ON CONFLICT (key) DO NOTHING;

INSERT INTO entitlements.packs (key, label, description, sort_order) VALUES
  ('PRIMARY',   'Primaire',   'Écoles primaires.',                    10),
  ('SECONDARY', 'Secondaire', 'Collèges et lycées.',                  20),
  ('HIGHER',    'Supérieur',  'Enseignement supérieur (UE/ECUE).',    30),
  ('VIRTUAL',   'Virtuel',    'Établissements et cours en ligne.',    40)
ON CONFLICT (key) DO NOTHING;
