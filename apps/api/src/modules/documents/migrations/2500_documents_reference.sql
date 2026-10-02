-- =============================================================================
-- 2500 — Module documents : schéma, paramètres, catégories, droits de catégorie
-- =============================================================================
-- Spec v2/024-documents (GED légère). Plage 2500-2599 (docs/architecture/module-conventions.md).
-- Règles du module :
--   - un schéma `documents` ; toute table de tenant : tenant_id + RLS forcée + GRANT app_user ;
--   - AUCUNE clé étrangère vers un autre module : élèves, personnel, utilisateurs (identités IAM) sont des UUID vérifiés
--     par le port `OwnerDirectory` (people, iam) ;
--   - clés composites (tenant_id, id) entre nos propres tables : une ligne ne peut pas pointer un autre tenant ;
--   - AUCUN DELETE accordé à app_user : rien ne s'efface (versions immuables, historique append-only, rétention par marqueur).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS documents;
REVOKE ALL ON SCHEMA documents FROM PUBLIC;
GRANT USAGE ON SCHEMA documents TO app_user;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Clé de recherche normalisée (minuscules, sans accents) ; IMMUABLE pour servir d'expression d'index.
CREATE FUNCTION documents.normalize_search(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_text, '')))
$$;

-- -----------------------------------------------------------------------------
-- Paramètres d'établissement (une ligne par tenant, créée à la première lecture ; défauts du code = défauts de la table)
-- -----------------------------------------------------------------------------
CREATE TABLE documents.settings (
  tenant_id                 uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  max_bytes                 integer NOT NULL DEFAULT 15728640 CHECK (max_bytes BETWEEN 1 AND 104857600),
  -- Quota plus strict choisi par l'établissement ; NULL = quota du plan. Jamais supérieur à celui du plan (appliqué par le code).
  storage_quota_bytes       bigint CHECK (storage_quota_bytes IS NULL OR storage_quota_bytes >= 1),
  default_alert_days        integer[] NOT NULL DEFAULT ARRAY[30, 7, 1]
    CHECK (cardinality(default_alert_days) BETWEEN 1 AND 10),
  archive_retention_days    integer NOT NULL DEFAULT 365 CHECK (archive_retention_days BETWEEN 0 AND 3650),
  quarantine_retention_days integer NOT NULL DEFAULT 30 CHECK (quarantine_retention_days BETWEEN 1 AND 365),
  max_versions              integer NOT NULL DEFAULT 50 CHECK (max_versions BETWEEN 1 AND 500),
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('documents.settings');
GRANT SELECT, INSERT, UPDATE ON documents.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Catégories (configurables par tenant ; jeu de départ créé à la première lecture)
-- -----------------------------------------------------------------------------
CREATE TABLE documents.categories (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  description         text CHECK (description IS NULL OR length(description) <= 2000),
  -- Les cinq types du PRD §39 : StudentDocument, TeacherDocument, InstitutionDocument, AcademicDocument, FinancialDocument.
  kind                text NOT NULL CHECK (kind IN ('STUDENT', 'TEACHER', 'INSTITUTION', 'ACADEMIC', 'FINANCIAL')),
  -- Niveau = permission de lecture exigée : INTERNAL (documents.read), RESTRICTED (read.restricted), CONFIDENTIAL (read.confidential).
  confidentiality     text NOT NULL DEFAULT 'RESTRICTED' CHECK (confidentiality IN ('INTERNAL', 'RESTRICTED', 'CONFIDENTIAL')),
  -- Liste blanche d'extensions (sous-ensemble de celles que la plateforme vérifie par octets magiques).
  allowed_extensions  text[] NOT NULL CHECK (cardinality(allowed_extensions) >= 1 AND allowed_extensions <@ ARRAY[
    'pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'txt', 'csv'
  ]::text[]),
  max_bytes           integer CHECK (max_bytes IS NULL OR max_bytes BETWEEN 1 AND 104857600),
  audience_owner      boolean NOT NULL DEFAULT false,   -- le propriétaire (élève, membre du personnel) peut lire
  audience_guardians  boolean NOT NULL DEFAULT false,   -- les tuteurs liés de l'élève propriétaire peuvent lire
  owner_upload        boolean NOT NULL DEFAULT false,   -- le propriétaire / le tuteur lié peut déposer
  requires_expiry     boolean NOT NULL DEFAULT false,
  alert_days          integer[] CHECK (alert_days IS NULL OR cardinality(alert_days) BETWEEN 1 AND 10),
  retention_days      integer CHECK (retention_days IS NULL OR retention_days BETWEEN 0 AND 3650),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  is_system           boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('documents.categories');
GRANT SELECT, INSERT, UPDATE ON documents.categories TO app_user;

-- -----------------------------------------------------------------------------
-- Droits de catégorie par personne (« le médecin scolaire lit les certificats médicaux »)
-- -----------------------------------------------------------------------------
CREATE TABLE documents.category_grants (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  category_id  uuid NOT NULL,
  user_id      uuid NOT NULL,                     -- identité IAM (port)
  level        text NOT NULL CHECK (level IN ('READ', 'WRITE')),
  expires_at   timestamptz,
  note         text CHECK (note IS NULL OR length(note) <= 500),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_by   uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES documents.categories (tenant_id, id),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
SELECT kernel.enable_tenant_rls('documents.category_grants');
CREATE UNIQUE INDEX category_grants_one_active ON documents.category_grants (tenant_id, category_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX category_grants_by_user ON documents.category_grants (tenant_id, user_id) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON documents.category_grants TO app_user;
