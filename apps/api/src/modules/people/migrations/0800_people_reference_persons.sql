-- =============================================================================
-- 0800 — Module people : schéma, référentiels, numérotation, personnes
-- =============================================================================
--
-- Plage de numéros réservée au module people : 0800–0899 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; plage à inscrire dans ce tableau).
--   008-students-guardians : 0800 (référentiels, personnes), 0801 (élèves, tuteurs)
--   009-teachers-staff     : 0802 (personnel), 0803 (affectations d'enseignement)
--   transverse             : 0804 (invariants)
--
-- Règles : voir 0700 (academic). En particulier : AUCUNE clé étrangère vers un autre schéma
-- que `kernel.tenants` ; les références vers `iam` (identité), `tenancy` (établissement,
-- campus) et `academic` (année, classe, nœud de curriculum, matière) sont des UUID vérifiés
-- par l'API publique de ces modules.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS people;
REVOKE ALL ON SCHEMA people FROM PUBLIC;
GRANT USAGE ON SCHEMA people TO app_user;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;   -- contraintes d'exclusion (contrats, affiliations)

-- Clé de recherche normalisée : minuscules, sans accents (« Kouamé » = « kouame »).
-- IMMUTABLE par construction (dictionnaire fixé) pour pouvoir servir de colonne générée.
CREATE FUNCTION people.normalize_search(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_text, '')))
$$;

-- -----------------------------------------------------------------------------
-- Référentiels pilotés par les modèles de pack (données, pas code)
-- -----------------------------------------------------------------------------
-- Liens de parenté / de responsabilité (père, mère, tuteur légal, oncle, contact d'urgence…).
CREATE TABLE people.relationship_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL DEFAULT 'GUARDIAN' CHECK (kind IN ('GUARDIAN', 'EMERGENCY', 'OTHER')),
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.relationship_types');
GRANT SELECT, INSERT, UPDATE ON people.relationship_types TO app_user;

-- Catégories de personnel : enseignant, éducateur, administratif, direction, appui…
CREATE TABLE people.staff_categories (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  code         text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  can_teach    boolean NOT NULL DEFAULT false,
  can_supervise boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.staff_categories');
GRANT SELECT, INSERT, UPDATE ON people.staff_categories TO app_user;

-- Types de contrat : CDI, CDD, vacation… (`kind` sert aux rapports et à la paie, pas à des seuils).
CREATE TABLE people.contract_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL CHECK (kind IN ('PERMANENT', 'FIXED_TERM', 'CASUAL', 'OTHER')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.contract_types');
GRANT SELECT, INSERT, UPDATE ON people.contract_types TO app_user;

-- Paramètres du tenant (une ligne). Formats de numéros : jetons {SEQ:n} {YYYY} {YY} {PREFIX}.
CREATE TABLE people.settings (
  tenant_id               uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  student_number_pattern  text NOT NULL DEFAULT '{SEQ:5}' CHECK (student_number_pattern LIKE '%{SEQ:%}%'),
  staff_number_pattern    text NOT NULL DEFAULT 'P{SEQ:4}' CHECK (staff_number_pattern LIKE '%{SEQ:%}%'),
  number_prefix           text CHECK (number_prefix IS NULL OR number_prefix ~ '^[A-Z0-9]{1,12}$'),
  duplicate_check_enabled boolean NOT NULL DEFAULT true,
  -- Préavis (en jours) des alertes de qualification qui expire ; NULL = alertes désactivées tant
  -- que le modèle de pack ou le tenant n'a pas fixé de valeur (aucune durée en dur dans le code).
  expiry_alert_days       integer CHECK (expiry_alert_days IS NULL OR expiry_alert_days BETWEEN 1 AND 365),
  -- Délai de conservation (en jours) d'un dossier ARCHIVED avant anonymisation possible (droit à
  -- l'effacement, spec 008 AC3.6). NULL = durée non fixée par le tenant : l'anonymisation est refusée
  -- (aucune durée légale n'est codée ici, question O-15).
  student_retention_days  integer CHECK (student_retention_days IS NULL OR student_retention_days BETWEEN 0 AND 36500),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('people.settings');
GRANT SELECT, INSERT, UPDATE ON people.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Numérotation gapless (même technique que finance.next_number) : la ligne de compteur reste
-- verrouillée jusqu'au COMMIT ; une transaction annulée rend son numéro à la suivante.
-- Remplace les SIX numérotations historiques (10001+ réécrit à chaque lecture, IPAM, STU…).
-- -----------------------------------------------------------------------------
CREATE TABLE people.number_sequences (
  tenant_id  uuid   NOT NULL REFERENCES kernel.tenants (id),
  kind       text   NOT NULL CHECK (kind IN ('STUDENT', 'STAFF')),
  scope_key  text   NOT NULL DEFAULT '',
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (tenant_id, kind, scope_key)
);
SELECT kernel.enable_tenant_rls('people.number_sequences');
GRANT SELECT, INSERT, UPDATE ON people.number_sequences TO app_user;

CREATE FUNCTION people.number_sequences_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.scope_key <> OLD.scope_key THEN
    RAISE EXCEPTION 'people.sequence_immutable_key' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.last_value <> OLD.last_value + 1 THEN
    RAISE EXCEPTION 'people.sequence_step: un compteur avance d''un pas exactement (% -> %)', OLD.last_value, NEW.last_value
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER number_sequences_guard BEFORE UPDATE ON people.number_sequences
  FOR EACH ROW EXECUTE FUNCTION people.number_sequences_guard();

CREATE FUNCTION people.next_number(p_kind text, p_scope text DEFAULT '') RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := kernel.current_tenant_id();
  v_value  bigint;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'people.next_number: contexte de tenant absent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO people.number_sequences AS s (tenant_id, kind, scope_key, last_value)
  VALUES (v_tenant, p_kind, p_scope, 1)
  ON CONFLICT (tenant_id, kind, scope_key) DO UPDATE SET last_value = s.last_value + 1
  RETURNING s.last_value INTO v_value;
  RETURN v_value;
END
$$;
REVOKE ALL ON FUNCTION people.next_number(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.next_number(text, text) TO app_user;

-- -----------------------------------------------------------------------------
-- Personnes : l'état civil commun à un élève, un tuteur, un membre du personnel. Une même
-- personne peut cumuler les rôles (un parent qui est enseignant : financement STAFF_CHILD).
-- `identity_id` relie à l'identité de connexion (iam, ADR-008) quand la personne a un compte.
-- -----------------------------------------------------------------------------
CREATE TABLE people.persons (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id   uuid,
  last_name     text NOT NULL CHECK (length(btrim(last_name)) > 0),
  first_name    text NOT NULL CHECK (length(btrim(first_name)) > 0),
  other_names   text,
  sex           text CHECK (sex IN ('M', 'F')),
  birth_date    date CHECK (birth_date IS NULL OR birth_date BETWEEN DATE '1900-01-01' AND DATE '2100-01-01'),
  birth_place   text,
  nationality   text CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  email         text CHECK (email IS NULL OR (length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  phone         text CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 40),
  phone_alt     text CHECK (phone_alt IS NULL OR length(phone_alt) BETWEEN 5 AND 40),
  address_line  text,
  city          text,
  residence     text,
  photo_object_key text,
  external_ref  text CHECK (external_ref IS NULL OR length(btrim(external_ref)) > 0),
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  anonymized_at timestamptz,
  search_key    text GENERATED ALWAYS AS (people.normalize_search(last_name || ' ' || first_name || ' ' || coalesce(other_names, ''))) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.persons');
CREATE UNIQUE INDEX persons_identity_unique ON people.persons (tenant_id, identity_id) WHERE identity_id IS NOT NULL;
CREATE UNIQUE INDEX persons_external_ref_unique ON people.persons (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX persons_search_trgm ON people.persons USING gin (search_key gin_trgm_ops);
CREATE INDEX persons_duplicate_probe ON people.persons (tenant_id, search_key, birth_date);
CREATE INDEX persons_email ON people.persons (tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX persons_phone ON people.persons (tenant_id, phone) WHERE phone IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON people.persons TO app_user;
