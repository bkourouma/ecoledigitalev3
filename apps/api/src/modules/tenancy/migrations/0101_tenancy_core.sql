-- =============================================================================
-- 0101 — Module `tenancy` : schéma et référentiel global des pays
-- =============================================================================
--
-- Numérotation : les versions de migration sont GLOBALES à tous les modules
-- (loader du package database). Plage réservée : tenancy = 0100-0149,
-- entitlements = 0150-0199. Exécutée sous `migrator` par le runner.
--
-- `tenancy.country_profiles` est une table GLOBALE de référence (pas de
-- tenant_id, pas de RLS) : elle figure dans `isolation-allowlist.tenancy.ts`.
-- L'application n'a que SELECT : ajouter un pays est une DONNÉE livrée par
-- migration (ADR-007), jamais une constante dans le code.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS tenancy;

REVOKE ALL ON SCHEMA tenancy FROM PUBLIC;
GRANT USAGE ON SCHEMA tenancy TO app_user;

CREATE TABLE tenancy.country_profiles (
  code              text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name              text NOT NULL CHECK (length(btrim(name)) > 0),
  currency_code     text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  -- Exposant de la devise (XOF = 0, EUR = 2) : lu en base, jamais codé en dur (ADR-007).
  currency_exponent smallint NOT NULL DEFAULT 0 CHECK (currency_exponent BETWEEN 0 AND 4),
  locale            text NOT NULL CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  timezone          text NOT NULL CHECK (length(btrim(timezone)) > 0),
  phone_prefix      text NOT NULL CHECK (phone_prefix ~ '^\+[0-9]{1,4}$'),
  education_system  text NOT NULL CHECK (length(btrim(education_system)) > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON tenancy.country_profiles TO app_user;

-- Seed de référence : Côte d'Ivoire (marché initial, plan §3.4).
INSERT INTO tenancy.country_profiles
  (code, name, currency_code, currency_exponent, locale, timezone, phone_prefix, education_system)
VALUES
  ('CI', 'Côte d''Ivoire', 'XOF', 0, 'fr-CI', 'Africa/Abidjan', '+225', 'CI')
ON CONFLICT (code) DO NOTHING;
