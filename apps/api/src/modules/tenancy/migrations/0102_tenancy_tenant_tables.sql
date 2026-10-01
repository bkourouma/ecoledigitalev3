-- =============================================================================
-- 0102 — Module `tenancy` : tables de tenant (RLS forcée)
-- =============================================================================
--
-- Hiérarchie (ADR-002) : kernel.tenants (= organisation, 1:1 avec
-- tenant_profiles) -> institutions -> campuses. `tenant_id` est la seule clé
-- d'isolation RLS ; institution/campus sont des dimensions de périmètre.
-- Aucune FK vers le schéma d'un autre module (seule kernel.tenants est admise).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Profil de l'organisation (1:1 avec kernel.tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE tenancy.tenant_profiles (
  tenant_id       uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  legal_name      text NOT NULL CHECK (length(btrim(legal_name)) > 0),
  trade_name      text,
  country_code    text NOT NULL REFERENCES tenancy.country_profiles (code),
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  address         text,
  -- Branding (thème de tenant côté web)
  logo_url        text,
  primary_color   text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  custom_domain   text CHECK (custom_domain IS NULL OR custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Un domaine personnalisé ne peut servir qu'un seul tenant (résolution domaine -> tenant).
CREATE UNIQUE INDEX tenant_profiles_custom_domain_uniq
  ON tenancy.tenant_profiles (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

SELECT kernel.enable_tenant_rls('tenancy.tenant_profiles');
GRANT SELECT, INSERT, UPDATE ON tenancy.tenant_profiles TO app_user;

-- ---------------------------------------------------------------------------
-- Établissements
-- ---------------------------------------------------------------------------
CREATE TABLE tenancy.institutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  pack             text NOT NULL CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL')),
  education_system text NOT NULL CHECK (length(btrim(education_system)) > 0),
  country_code     text NOT NULL REFERENCES tenancy.country_profiles (code),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

SELECT kernel.enable_tenant_rls('tenancy.institutions');
-- Pas de DELETE : un établissement s'archive (ses données académiques le référenceront).
GRANT SELECT, INSERT, UPDATE ON tenancy.institutions TO app_user;

-- ---------------------------------------------------------------------------
-- Campus
-- ---------------------------------------------------------------------------
CREATE TABLE tenancy.campuses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL REFERENCES tenancy.institutions (id),
  code           text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  address        text,
  city           text,
  phone          text,
  is_default     boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);

CREATE INDEX campuses_institution_idx ON tenancy.campuses (tenant_id, institution_id);
-- Au plus un campus par défaut par établissement.
CREATE UNIQUE INDEX campuses_one_default_per_institution
  ON tenancy.campuses (institution_id)
  WHERE is_default;

SELECT kernel.enable_tenant_rls('tenancy.campuses');
GRANT SELECT, INSERT, UPDATE, DELETE ON tenancy.campuses TO app_user;

-- Cohérence inter-tenants : l'établissement d'un campus appartient au MÊME tenant.
-- (Les contrôles de FK contournent la RLS : sans ce garde-fou, un tenant qui
-- connaîtrait l'UUID d'un établissement étranger pourrait y rattacher un campus.)
-- La fonction s'exécute avec les droits de l'appelant : la RLS s'y applique, un
-- établissement d'un autre tenant est donc invisible.
CREATE FUNCTION tenancy.campus_institution_same_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenancy.institutions i
     WHERE i.id = NEW.institution_id AND i.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Établissement % introuvable pour le tenant %', NEW.institution_id, NEW.tenant_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER campuses_institution_same_tenant
  BEFORE INSERT OR UPDATE OF institution_id, tenant_id ON tenancy.campuses
  FOR EACH ROW EXECUTE FUNCTION tenancy.campus_institution_same_tenant();

-- ---------------------------------------------------------------------------
-- Onboarding : une ligne par étape et par tenant (PRD §56). La machine d'états
-- est PURE (domain/onboarding.ts) ; la base ne fait que la persister.
-- ---------------------------------------------------------------------------
CREATE TABLE tenancy.onboarding_steps (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  step_key     text NOT NULL CHECK (step_key IN (
                 'ACCOUNT', 'INSTITUTION', 'COUNTRY', 'INSTITUTION_TYPE', 'PACK',
                 'ACADEMIC_YEAR', 'STUDENT_IMPORT', 'CLASSES', 'TEACHERS', 'FINANCE', 'GO_LIVE')),
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'SKIPPED')),
  completed_at timestamptz,
  completed_by uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, step_key),
  CHECK ((status = 'PENDING') = (completed_at IS NULL))
);

SELECT kernel.enable_tenant_rls('tenancy.onboarding_steps');
GRANT SELECT, INSERT, UPDATE ON tenancy.onboarding_steps TO app_user;
