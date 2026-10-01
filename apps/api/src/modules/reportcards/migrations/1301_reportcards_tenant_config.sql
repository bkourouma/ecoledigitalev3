-- =============================================================================
-- 1301 — Module reportcards : identité, signataires, gabarits et réglages du TENANT
-- =============================================================================
--
-- Tout ce qui s'imprime sur un document est une DONNÉE du tenant (jamais du code) :
--   branding_versions   identité versionnée (noms, lignes officielles, logo, emblème, couleurs) ; une version est immuable,
--                       seul `is_current` bascule ;
--   signatories         registre des signataires (AUCUN par défaut : un document ne se génère pas sans signataire
--                       assigné aux emplacements obligatoires du gabarit) ; jamais de DELETE (désactivation) ;
--   template_configs    configuration de gabarit versionnée par (établissement, nature, pack) : options validées par le
--                       schéma du gabarit, emplacements de signature ; une version est immuable ;
--   settings            réglages du tenant (blocage si impayé, délibération requise, politique de vérification publique).
-- Les objets binaires (logo, signature) ne sont référencés que par clé d'objet StoragePort.
-- =============================================================================

CREATE TABLE reportcards.branding_versions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id     uuid,
  version            integer NOT NULL CHECK (version >= 1),
  is_current         boolean NOT NULL DEFAULT false,
  legal_name         text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  short_name         text,
  header_left        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(header_left) = 'array'),
  header_right       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(header_right) = 'array'),
  address            text,
  phone              text,
  email              text,
  website            text,
  registration_ref   text,
  logo_object_key    text,
  emblem_object_key  text,
  primary_color      text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color    text CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  footer_text        text,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX branding_version_uq ON reportcards.branding_versions
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE UNIQUE INDEX branding_current_uq ON reportcards.branding_versions
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_current;
SELECT kernel.enable_tenant_rls('reportcards.branding_versions');
GRANT SELECT, INSERT, UPDATE ON reportcards.branding_versions TO app_user;

CREATE TABLE reportcards.signatories (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid,
  full_name             text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 160),
  title                 text,
  job_function          text,
  signature_object_key  text,
  staff_id              uuid,
  active                boolean NOT NULL DEFAULT true,
  valid_from            date,
  valid_to              date,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
SELECT kernel.enable_tenant_rls('reportcards.signatories');
GRANT SELECT, INSERT, UPDATE ON reportcards.signatories TO app_user;

CREATE TABLE reportcards.template_configs (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id         uuid,
  document_kind          text NOT NULL CHECK (document_kind IN ('REPORT_CARD', 'TRANSCRIPT')),
  pack                   text NOT NULL CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL', 'CORE')),
  template_key           text NOT NULL,
  template_version       integer NOT NULL,
  config_version         integer NOT NULL CHECK (config_version >= 1),
  is_current             boolean NOT NULL DEFAULT false,
  options                jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_assignments  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(signature_assignments) = 'array'),
  created_by             uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (template_key, template_version) REFERENCES reportcards.platform_templates (key, version)
);
CREATE UNIQUE INDEX template_configs_current_uq ON reportcards.template_configs
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind, pack) WHERE is_current;
CREATE UNIQUE INDEX template_configs_version_uq ON reportcards.template_configs
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind, pack, config_version);
SELECT kernel.enable_tenant_rls('reportcards.template_configs');
GRANT SELECT, INSERT, UPDATE ON reportcards.template_configs TO app_user;

CREATE TABLE reportcards.settings (
  tenant_id                    uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  block_if_unpaid              boolean NOT NULL DEFAULT false,
  require_deliberation         boolean NOT NULL DEFAULT false,
  verification_shows_mention   boolean NOT NULL DEFAULT false,
  updated_by                   uuid,
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('reportcards.settings');
GRANT SELECT, INSERT, UPDATE ON reportcards.settings TO app_user;
