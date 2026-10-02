-- =============================================================================
-- 1800 — Module imports : imports Excel / CSV (assistant en 7 étapes)
-- =============================================================================
-- Spec v2/031-imports. Plage 1800-1899.
-- Règles du module :
--   - un schéma `imports` ; toute table de tenant : tenant_id + RLS forcée + GRANT app_user ;
--   - AUCUNE clé étrangère vers un autre module : élèves, classes, évaluations... sont des UUID produits par les ports ;
--   - clés composites (tenant_id, id) entre nos propres tables : une ligne ne peut pas pointer un autre tenant ;
--   - les lignes brutes (données personnelles) sont purgées après la rétention (raw / normalized mis à NULL) ; les
--     résultats par ligne (numéro, code d'erreur, identifiant d'entité) restent pour le rapport.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS imports;
REVOKE ALL ON SCHEMA imports FROM PUBLIC;
GRANT USAGE ON SCHEMA imports TO app_user;

-- -----------------------------------------------------------------------------
-- Paramètres du tenant (une ligne créée à la première modification ; défauts = ceux du code)
-- -----------------------------------------------------------------------------
CREATE TABLE imports.settings (
  tenant_id               uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  max_rows                integer NOT NULL DEFAULT 5000 CHECK (max_rows BETWEEN 1 AND 20000),
  max_columns             integer NOT NULL DEFAULT 100 CHECK (max_columns BETWEEN 1 AND 200),
  max_file_bytes          integer NOT NULL DEFAULT 5242880 CHECK (max_file_bytes BETWEEN 1024 AND 20971520),
  batch_size              integer NOT NULL DEFAULT 200 CHECK (batch_size BETWEEN 1 AND 500),
  all_or_nothing_max_rows integer NOT NULL DEFAULT 5000 CHECK (all_or_nothing_max_rows BETWEEN 1 AND 20000),
  max_active_jobs         integer NOT NULL DEFAULT 5 CHECK (max_active_jobs BETWEEN 1 AND 50),
  max_jobs_per_day        integer NOT NULL DEFAULT 50 CHECK (max_jobs_per_day BETWEEN 1 AND 1000),
  retention_days          integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  updated_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('imports.settings');
GRANT SELECT, INSERT, UPDATE ON imports.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Modèles de mapping de colonnes (par tenant et par importeur)
-- -----------------------------------------------------------------------------
CREATE TABLE imports.mapping_templates (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  importer_key text NOT NULL CHECK (importer_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- champ cible -> en-tête de colonne du fichier
  mapping      jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  -- en-têtes vus à l'enregistrement (proposition automatique si >= 80 % retrouvés)
  headers      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(headers) = 'array'),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX mapping_templates_name_uq ON imports.mapping_templates (tenant_id, importer_key, lower(btrim(name)));
SELECT kernel.enable_tenant_rls('imports.mapping_templates');
GRANT SELECT, INSERT, UPDATE, DELETE ON imports.mapping_templates TO app_user;

-- -----------------------------------------------------------------------------
-- Imports (un fichier = un import)
-- -----------------------------------------------------------------------------
CREATE TABLE imports.jobs (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  importer_key          text NOT NULL CHECK (importer_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  status                text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN (
    'UPLOADED', 'MAPPED', 'VALIDATING', 'VALIDATED', 'QUEUED', 'RUNNING',
    'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED')),
  -- Fichier
  file_name             text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_kind             text NOT NULL CHECK (file_kind IN ('XLSX', 'CSV')),
  file_size             integer NOT NULL CHECK (file_size > 0),
  file_sha256           text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key           text,
  sheet_name            text,
  headers               jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(headers) = 'array'),
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  total_rows            integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  duplicate_of_job_id   uuid,                                       -- même empreinte déjà importée (avertissement)
  -- Mapping et options
  mapping               jsonb CHECK (mapping IS NULL OR jsonb_typeof(mapping) = 'object'),
  mapping_template_id   uuid,
  options               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  run_mode              text NOT NULL DEFAULT 'VALID_ONLY' CHECK (run_mode IN ('ALL_OR_NOTHING', 'VALID_ONLY')),
  on_existing           text NOT NULL DEFAULT 'SKIP' CHECK (on_existing IN ('SKIP', 'UPDATE')),
  -- Validation (étapes 3 à 5)
  valid_rows            integer NOT NULL DEFAULT 0,
  invalid_rows          integer NOT NULL DEFAULT 0,
  planned_create        integer NOT NULL DEFAULT 0,
  planned_update        integer NOT NULL DEFAULT 0,
  planned_skip          integer NOT NULL DEFAULT 0,
  validation_progress   integer NOT NULL DEFAULT 0,
  validated_at          timestamptz,
  -- Exécution (étapes 6 et 7)
  processed_count       integer NOT NULL DEFAULT 0,
  created_count         integer NOT NULL DEFAULT 0,
  updated_count         integer NOT NULL DEFAULT 0,
  skipped_count         integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  run_attempts          integer NOT NULL DEFAULT 0,
  run_requested_at      timestamptz,
  run_requested_by      uuid,
  started_at            timestamptz,
  finished_at           timestamptz,
  duration_ms           integer,
  cancel_requested      boolean NOT NULL DEFAULT false,
  -- Bail de l'exécutant (reprise après interruption)
  lease_owner           text,
  lease_until           timestamptz,
  heartbeat_at          timestamptz,
  -- Contexte de l'auteur figé au lancement (le worker n'a pas de requête HTTP)
  actor_user_id         uuid,
  actor_roles           text[] NOT NULL DEFAULT '{}'::text[],
  actor_mfa             boolean NOT NULL DEFAULT false,
  actor_institution_id  uuid,
  actor_campus_id       uuid,
  error_code            text,
  error_message         text,
  raw_purged_at         timestamptz,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX jobs_tenant_created_idx ON imports.jobs (tenant_id, created_at DESC);
CREATE INDEX jobs_sha_idx ON imports.jobs (tenant_id, importer_key, file_sha256);
-- Imports à reprendre (balayage du job de filet) et imports actifs (quota)
CREATE INDEX jobs_active_idx ON imports.jobs (tenant_id, status) WHERE status IN ('UPLOADED', 'MAPPED', 'VALIDATING', 'VALIDATED', 'QUEUED', 'RUNNING');
SELECT kernel.enable_tenant_rls('imports.jobs');
GRANT SELECT, INSERT, UPDATE, DELETE ON imports.jobs TO app_user;

-- -----------------------------------------------------------------------------
-- Lignes (brutes, validées, résultat de l'exécution)
-- -----------------------------------------------------------------------------
CREATE TABLE imports.rows (
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  job_id            uuid NOT NULL,
  row_no            integer NOT NULL CHECK (row_no >= 1),   -- numéro de ligne dans le fichier (1 = en-têtes)
  raw               jsonb,                                   -- cellules en texte, dans l'ordre des en-têtes ; NULL après purge
  normalized        jsonb,                                   -- valeurs typées après mapping + coercion ; NULL après purge
  natural_key       text,
  validation        text NOT NULL DEFAULT 'PENDING' CHECK (validation IN ('PENDING', 'VALID', 'INVALID')),
  planned_action    text CHECK (planned_action IN ('CREATE', 'UPDATE', 'SKIP', 'ERROR')),
  planned_entity_id uuid,
  issues            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  outcome           text CHECK (outcome IN ('CREATED', 'UPDATED', 'SKIPPED', 'FAILED')),
  entity_id         uuid,
  outcome_issues    jsonb CHECK (outcome_issues IS NULL OR jsonb_typeof(outcome_issues) = 'array'),
  processed_at      timestamptz,
  PRIMARY KEY (job_id, row_no),
  FOREIGN KEY (tenant_id, job_id) REFERENCES imports.jobs (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX rows_validation_idx ON imports.rows (job_id, validation, row_no);
CREATE INDEX rows_outcome_idx ON imports.rows (job_id, outcome, row_no);
CREATE INDEX rows_key_idx ON imports.rows (job_id, natural_key) WHERE natural_key IS NOT NULL;
SELECT kernel.enable_tenant_rls('imports.rows');
GRANT SELECT, INSERT, UPDATE, DELETE ON imports.rows TO app_user;

-- -----------------------------------------------------------------------------
-- Références d'idempotence : clé naturelle -> entité créée (un rejeu retrouve l'entité, ne la recrée pas)
-- -----------------------------------------------------------------------------
CREATE TABLE imports.entity_refs (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  importer_key text NOT NULL,
  natural_key  text NOT NULL CHECK (length(natural_key) BETWEEN 1 AND 500),
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  first_job_id uuid NOT NULL,
  last_job_id  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, importer_key, natural_key)
);
SELECT kernel.enable_tenant_rls('imports.entity_refs');
GRANT SELECT, INSERT, UPDATE ON imports.entity_refs TO app_user;
