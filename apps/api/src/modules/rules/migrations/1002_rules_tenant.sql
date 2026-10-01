-- =============================================================================
-- 1002 — Module rules : variantes d'établissement, liaisons, simulations (tables de TENANT)
-- =============================================================================
--
-- Toutes ces tables portent `tenant_id` + la policy `tenant_isolation` (kernel.enable_tenant_rls).
-- Les clés étrangères internes sont COMPOSITES (tenant_id, id) : une ligne ne peut pas référencer la
-- ligne d'un autre tenant, même en connaissant son UUID. Seules références hors tenant : les tables
-- du catalogue national (`based_on_*`), identiques pour tous.
-- =============================================================================

CREATE TABLE rules.rule_sets (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,63}$'),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  country_code     text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  regulation       text,
  education_system text,
  level            text,
  based_on_set_id  uuid REFERENCES rules.national_rule_sets (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('rules.rule_sets');
GRANT SELECT, INSERT, UPDATE ON rules.rule_sets TO app_user;

CREATE TABLE rules.rule_versions (
  id                           uuid PRIMARY KEY,
  tenant_id                    uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_set_id                  uuid NOT NULL,
  version                      integer NOT NULL CHECK (version >= 1),
  status                       text NOT NULL CHECK (status IN ('draft', 'simulated', 'proposed', 'approved', 'published', 'retired')),
  contract_id                  text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  based_on_version_id          uuid REFERENCES rules.national_rule_versions (id),
  effective_from               date NOT NULL,
  effective_to                 date,
  source_kind                  text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform')),
  source_reference             text,
  source_url                   text,
  source_description           text,
  definition_hash              text CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$'),
  last_simulation_id           uuid,
  decision_impact_confirmed_by uuid,
  decision_impact_confirmed_at timestamptz,
  notes                        text,
  created_by                   uuid NOT NULL,
  approved_by                  uuid,
  row_version                  integer NOT NULL DEFAULT 1,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (rule_set_id, version),
  FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rules.rule_sets (tenant_id, id),
  CONSTRAINT rule_versions_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT rule_versions_hash_ck CHECK (status IN ('draft', 'simulated') OR definition_hash IS NOT NULL),
  CONSTRAINT rule_versions_approver_ck CHECK (status NOT IN ('approved', 'published') OR approved_by IS NOT NULL),
  -- une variante proposée a été simulée (AC2.1)
  CONSTRAINT rule_versions_simulated_ck CHECK (status IN ('draft', 'simulated') OR last_simulation_id IS NOT NULL),
  CONSTRAINT rule_versions_no_overlap EXCLUDE USING gist (
    rule_set_id WITH =,
    contract_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status IN ('approved', 'published'))
);
SELECT kernel.enable_tenant_rls('rules.rule_versions');
CREATE INDEX rule_versions_active_idx
  ON rules.rule_versions (tenant_id, rule_set_id, effective_from)
  WHERE status IN ('approved', 'published');
CREATE INDEX rule_versions_status_idx ON rules.rule_versions (tenant_id, status);
GRANT SELECT, INSERT, UPDATE ON rules.rule_versions TO app_user;

CREATE TABLE rules.rule_definitions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_version_id uuid NOT NULL,
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  type            text NOT NULL CHECK (type IN (
                    'grading_scale', 'assessment_aggregation', 'period_average', 'annual_average', 'ranking',
                    'rounding', 'mention', 'promotion', 'repetition', 'orientation', 'credit_validation',
                    'compensation', 'eliminatory_grade')),
  position        integer NOT NULL CHECK (position >= 0),
  expression      text NOT NULL CHECK (length(expression) BETWEEN 1 AND 10000),
  description     text,
  parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_schema    jsonb,
  result_type     text CHECK (result_type IN ('number', 'number?', 'string', 'string?', 'boolean', 'boolean?')),
  label_map       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_optional     boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  UNIQUE (rule_version_id, key),
  UNIQUE (rule_version_id, position),
  FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rules.rule_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('rules.rule_definitions');
-- DELETE : uniquement sur une version en brouillon/simulée (garde en 1003).
GRANT SELECT, INSERT, UPDATE, DELETE ON rules.rule_definitions TO app_user;

CREATE TABLE rules.version_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_version_id uuid NOT NULL,
  from_status     text,
  to_status       text NOT NULL,
  actor_id        uuid,
  actor_name      text NOT NULL,
  actor_kind      text NOT NULL CHECK (actor_kind IN ('tenant_admin', 'super_admin', 'system')),
  comment         text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rules.rule_versions (tenant_id, id)
);
CREATE INDEX version_events_version_idx ON rules.version_events (tenant_id, rule_version_id, occurred_at);
SELECT kernel.enable_tenant_rls('rules.version_events');
GRANT SELECT, INSERT ON rules.version_events TO app_user;

-- -----------------------------------------------------------------------------
-- Liaisons : quel jeu de règles pour quel périmètre (contrat × établissement/nœud/niveau × dates).
-- Spécificité : nœud de curriculum > niveau > établissement > tout le tenant.
-- -----------------------------------------------------------------------------
CREATE TABLE rules.rule_bindings (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  contract_id        text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  rule_set_code      text NOT NULL CHECK (rule_set_code ~ '^[A-Z][A-Z0-9_-]{2,63}$'),
  institution_id     uuid,
  curriculum_node_id uuid,
  level_code         text,
  effective_from     date NOT NULL,
  effective_to       date,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT rule_bindings_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- au plus un critère précis (nœud OU niveau)
  CONSTRAINT rule_bindings_scope_ck CHECK ((curriculum_node_id IS NOT NULL)::int + (level_code IS NOT NULL)::int <= 1),
  CONSTRAINT rule_bindings_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    contract_id WITH =,
    (coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (coalesce(level_code, '')) WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('rules.rule_bindings');
GRANT SELECT, INSERT, UPDATE, DELETE ON rules.rule_bindings TO app_user;

-- -----------------------------------------------------------------------------
-- Simulations et différences.
-- -----------------------------------------------------------------------------
CREATE TABLE rules.simulations (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  target_version_kind      text NOT NULL CHECK (target_version_kind IN ('TENANT', 'NATIONAL')),
  target_version_id        uuid NOT NULL,
  base_version_kind        text NOT NULL CHECK (base_version_kind IN ('TENANT', 'NATIONAL')),
  base_version_id          uuid NOT NULL,
  target_definition_hash   text NOT NULL CHECK (target_definition_hash ~ '^[0-9a-f]{64}$'),
  contract_id              text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  dataset                  jsonb NOT NULL,
  status                   text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  progress_percent         smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  cases_count              integer,
  summary                  jsonb,
  rule_stats               jsonb,
  decision_changed_percent numeric(7, 4),
  differences_truncated    boolean NOT NULL DEFAULT false,
  error                    text,
  requested_by             uuid NOT NULL,
  started_at               timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('rules.simulations');
CREATE INDEX simulations_target_idx ON rules.simulations (tenant_id, target_version_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON rules.simulations TO app_user;

CREATE TABLE rules.simulation_differences (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  simulation_id uuid NOT NULL,
  case_ref      text NOT NULL,
  rule_key      text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('value_changed', 'error_introduced', 'error_resolved', 'error_changed')),
  old_outcome   jsonb NOT NULL,
  new_outcome   jsonb NOT NULL,
  delta         text,
  FOREIGN KEY (tenant_id, simulation_id) REFERENCES rules.simulations (tenant_id, id)
);
CREATE INDEX simulation_differences_idx ON rules.simulation_differences (tenant_id, simulation_id, rule_key);
SELECT kernel.enable_tenant_rls('rules.simulation_differences');
GRANT SELECT, INSERT ON rules.simulation_differences TO app_user;

-- -----------------------------------------------------------------------------
-- Journal des échecs d'évaluation en production (purge à 90 jours par job).
-- Message en français, SANS donnée personnelle ; l'élève n'est jamais nommé.
-- -----------------------------------------------------------------------------
CREATE TABLE rules.evaluation_failures (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_version_kind text NOT NULL CHECK (rule_version_kind IN ('TENANT', 'NATIONAL')),
  rule_version_id   uuid NOT NULL,
  rule_key          text NOT NULL,
  error_code        text NOT NULL,
  message           text NOT NULL,
  inputs_hash       text,
  request_id        text,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluation_failures_idx ON rules.evaluation_failures (tenant_id, occurred_at DESC);
SELECT kernel.enable_tenant_rls('rules.evaluation_failures');
GRANT SELECT, INSERT, DELETE ON rules.evaluation_failures TO app_user;
