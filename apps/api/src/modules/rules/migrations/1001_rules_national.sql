-- =============================================================================
-- 1001 — Module rules : CATALOGUE NATIONAL (tables globales, écriture `system`)
-- =============================================================================
--
-- Les RuleSets nationaux (réglementaires ou de plateforme) sont identiques pour tous les
-- tenants : tables SANS `tenant_id`, policy de lecture ouverte, écriture réservée à l'acteur
-- `system` (SystemDb : console du super-administrateur). Un tenant (`app_user` sous un contexte
-- `user`) ne peut ni insérer ni modifier : la RLS FORCE l'en empêche.
--
--   national_rule_sets          famille de règles (ex. CI-HIGHER-LMD)
--   national_rule_versions      versions (machine d'états draft→…→retired, gardes en 1003)
--   national_rule_definitions   règles d'une version (expression, paramètres bornés, libellés)
--   national_version_events     historique append-only de gouvernance
--
-- Le HASH de définition (SHA-256 du JSON canonique) est calculé par l'APPLICATION (implémentation
-- unique : pas de seconde implémentation SQL qui pourrait dériver) ; la base exige sa présence dès
-- la proposition et l'application le revérifie à l'approbation, à la publication et à chaque chargement.
-- =============================================================================

CREATE TABLE rules.national_rule_sets (
  id               uuid PRIMARY KEY,
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,63}$'),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  country_code     text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  regulation       text,
  education_system text,
  level            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rules.national_rule_versions (
  id                 uuid PRIMARY KEY,
  rule_set_id        uuid NOT NULL REFERENCES rules.national_rule_sets (id),
  version            integer NOT NULL CHECK (version >= 1),
  status             text NOT NULL CHECK (status IN ('draft', 'simulated', 'proposed', 'approved', 'published', 'retired')),
  contract_id        text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  effective_from     date NOT NULL,
  effective_to       date,
  source_kind        text NOT NULL CHECK (source_kind IN ('regulation', 'institution', 'platform')),
  source_reference   text,
  source_url         text,
  source_description text,
  definition_hash    text CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$'),
  notes              text,
  created_by         uuid,
  approved_by        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, version),
  CONSTRAINT national_rule_versions_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- le hash existe dès la proposition ; l'approbation est signée
  CONSTRAINT national_rule_versions_hash_ck CHECK (status IN ('draft', 'simulated') OR definition_hash IS NOT NULL),
  CONSTRAINT national_rule_versions_approver_ck CHECK (status NOT IN ('approved', 'published') OR approved_by IS NOT NULL),
  -- deux versions ACTIVES d'un même jeu et d'un même contrat ne se chevauchent jamais (AC3.3)
  CONSTRAINT national_rule_versions_no_overlap EXCLUDE USING gist (
    rule_set_id WITH =,
    contract_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status IN ('approved', 'published'))
);
CREATE INDEX national_rule_versions_active_idx
  ON rules.national_rule_versions (rule_set_id, effective_from)
  WHERE status IN ('approved', 'published');

CREATE TABLE rules.national_rule_definitions (
  id              uuid PRIMARY KEY,
  rule_version_id uuid NOT NULL REFERENCES rules.national_rule_versions (id),
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
  UNIQUE (rule_version_id, key),
  UNIQUE (rule_version_id, position)
);

CREATE TABLE rules.national_version_events (
  id              uuid PRIMARY KEY,
  rule_version_id uuid NOT NULL REFERENCES rules.national_rule_versions (id),
  from_status     text,
  to_status       text NOT NULL,
  actor_id        uuid,
  actor_name      text NOT NULL,
  comment         text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX national_version_events_version_idx
  ON rules.national_version_events (rule_version_id, occurred_at);

-- -----------------------------------------------------------------------------
-- RLS : lecture pour tous, écriture `system` uniquement. JAMAIS de DELETE sur les
-- ensembles et les versions (AC4.5) ; les règles d'un brouillon peuvent être retirées.
-- -----------------------------------------------------------------------------
ALTER TABLE rules.national_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.national_rule_sets FORCE ROW LEVEL SECURITY;
CREATE POLICY nrs_read ON rules.national_rule_sets FOR SELECT USING (true);
CREATE POLICY nrs_insert ON rules.national_rule_sets FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY nrs_update ON rules.national_rule_sets FOR UPDATE
  USING (kernel.current_actor() = 'system') WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE ON rules.national_rule_sets TO app_user;

ALTER TABLE rules.national_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.national_rule_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY nrv_read ON rules.national_rule_versions FOR SELECT USING (true);
CREATE POLICY nrv_insert ON rules.national_rule_versions FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY nrv_update ON rules.national_rule_versions FOR UPDATE
  USING (kernel.current_actor() = 'system') WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE ON rules.national_rule_versions TO app_user;

ALTER TABLE rules.national_rule_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.national_rule_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY nrd_read ON rules.national_rule_definitions FOR SELECT USING (true);
CREATE POLICY nrd_insert ON rules.national_rule_definitions FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY nrd_update ON rules.national_rule_definitions FOR UPDATE
  USING (kernel.current_actor() = 'system') WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY nrd_delete ON rules.national_rule_definitions FOR DELETE USING (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE, DELETE ON rules.national_rule_definitions TO app_user;

ALTER TABLE rules.national_version_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.national_version_events FORCE ROW LEVEL SECURITY;
CREATE POLICY nve_read ON rules.national_version_events FOR SELECT USING (true);
CREATE POLICY nve_insert ON rules.national_version_events FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT ON rules.national_version_events TO app_user;
