-- =============================================================================
-- 2200 — Module schoollife : schéma, paramètres, types d'événements, barèmes de points de conduite
-- =============================================================================
--
-- Plage de numéros du module schoollife : 2200–2299 (docs/architecture/module-conventions.md).
--
-- Vie scolaire (PRD §34) : incidents, avertissements, sanctions, exclusions temporaires, encouragements,
-- observations, convocations, points de conduite. Les retards et absences NE sont PAS dupliqués : ils
-- restent dans `attendance` (010), le module en publie une VUE (aucune table ici).
--
-- Règles : un module = un schéma ; aucune FK vers un autre schéma que `kernel.tenants` (élèves,
-- inscriptions, classes, tuteurs = UUID vérifiés par des ports) ; RLS forcée ; FK internes composites.
-- AUCUNE valeur réglementaire : types d'événements, niveaux de gravité, barèmes de points sont des DONNÉES
-- d'établissement (ou de modèle de pack marqué `placeholder`), jamais des constantes du code.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS schoollife;
REVOKE ALL ON SCHEMA schoollife FROM PUBLIC;
GRANT USAGE ON SCHEMA schoollife TO app_user;

-- Pour les contraintes d'exclusion (exclusions temporaires qui se chevauchent, barèmes actifs concurrents).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE FUNCTION schoollife.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'schoollife.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Un acte disciplinaire (proposer, valider, notifier, révoquer, rédiger une observation) exige une session
-- d'UTILISATEUR identifié : jamais un job ni une règle.
CREATE FUNCTION schoollife.require_human_actor() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid := kernel.current_user_id();
BEGIN
  IF v_user IS NULL OR coalesce(kernel.current_actor(), '') <> 'user' THEN
    RAISE EXCEPTION 'schoollife.human_actor_required: cet acte exige un utilisateur identifié (acteur %)', coalesce(kernel.current_actor(), 'inconnu')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_user;
END
$$;

-- Rang d'un niveau de confidentialité (STANDARD < RESTRICTED < CONFIDENTIAL).
CREATE FUNCTION schoollife.confidentiality_rank(p_level text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 'STANDARD' THEN 1 WHEN 'RESTRICTED' THEN 2 WHEN 'CONFIDENTIAL' THEN 3 END
$$;

-- -----------------------------------------------------------------------------
-- Réglages par établissement (une ligne)
--   conduct_points_enabled  active les points de conduite (barèmes ci-dessous) ; faux par défaut
--   retention_days          durée de conservation des données disciplinaires ; NULL = non définie
--                           (aucune durée légale codée : à fixer par l'établissement, question ouverte)
-- -----------------------------------------------------------------------------
CREATE TABLE schoollife.settings (
  tenant_id                    uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id               uuid NOT NULL,
  conduct_points_enabled       boolean NOT NULL DEFAULT false,
  confidential_read_requires_purpose boolean NOT NULL DEFAULT true,
  retention_days               integer CHECK (retention_days IS NULL OR retention_days > 0),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('schoollife.settings');
GRANT SELECT, INSERT, UPDATE ON schoollife.settings TO app_user;

-- Niveaux de gravité (données) : le rang ordonne, le code et le libellé sont libres.
CREATE TABLE schoollife.severity_levels (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  rank       integer NOT NULL CHECK (rank >= 1),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, rank)
);
SELECT kernel.enable_tenant_rls('schoollife.severity_levels');
GRANT SELECT, INSERT, UPDATE ON schoollife.severity_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Types d'événements de vie scolaire. `kind` = la FAMILLE (PRD §34) ; code et libellé = données.
--   requires_validation    la mesure (sanction, exclusion) n'est effective qu'après validation par une autre étape
--   requires_four_eyes     le validateur n'est pas le proposant
--   approver_permission    permission exigée du validateur (contrôlée par l'application via le RBAC)
--   notify_guardians       une notification est préparée pour les tuteurs lors de la notification de la mesure
--   visible_to_guardians   les tuteurs peuvent voir l'événement (sous réserve de confidentialité)
--   requires_dates         exclusion temporaire : dates de début et de fin obligatoires
--   appealable             la mesure peut faire l'objet d'un recours
--   is_placeholder         type générique de démonstration (modèle de pack), à remplacer par l'établissement
-- Une exclusion temporaire exige TOUJOURS une validation (contrainte de table).
-- -----------------------------------------------------------------------------
CREATE TABLE schoollife.event_types (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  code                   text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                  text NOT NULL CHECK (length(btrim(label)) > 0),
  kind                   text NOT NULL CHECK (kind IN ('INCIDENT', 'SANCTION', 'WARNING', 'ENCOURAGEMENT', 'TEMP_EXCLUSION', 'OBSERVATION')),
  default_severity_code  text,
  requires_validation    boolean NOT NULL DEFAULT false,
  requires_four_eyes     boolean NOT NULL DEFAULT false,
  approver_permission    text CHECK (approver_permission IS NULL OR approver_permission ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  notify_guardians       boolean NOT NULL DEFAULT false,
  visible_to_guardians   boolean NOT NULL DEFAULT true,
  confidentiality_default text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality_default IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  requires_dates         boolean NOT NULL DEFAULT false,
  appealable             boolean NOT NULL DEFAULT false,
  is_placeholder         boolean NOT NULL DEFAULT false,
  sort_order             integer NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, default_severity_code) REFERENCES schoollife.severity_levels (tenant_id, code),
  CHECK (requires_dates = (kind = 'TEMP_EXCLUSION')),
  CHECK (NOT requires_four_eyes OR requires_validation),
  CHECK (kind <> 'TEMP_EXCLUSION' OR requires_validation),
  CHECK (kind NOT IN ('INCIDENT', 'ENCOURAGEMENT', 'OBSERVATION') OR (NOT requires_validation AND NOT appealable)),
  CHECK (kind IN ('SANCTION', 'TEMP_EXCLUSION') OR NOT appealable)
);
SELECT kernel.enable_tenant_rls('schoollife.event_types');
GRANT SELECT, INSERT, UPDATE ON schoollife.event_types TO app_user;

-- -----------------------------------------------------------------------------
-- Barèmes de points de conduite : PARAMÈTRES d'établissement, jamais du code.
--   Une échelle = points initiaux, bornes facultatives, périmètre de remise à zéro, période d'effet.
--   Un seul barème ACTIF par (établissement, niveau ou « tous niveaux ») et par période d'effet.
--   Un barème ACTIF ou RETIRÉ ne change plus (on en crée un nouveau) : les mouvements restent expliquables.
--   source_kind : 'regulation' | 'institution' | 'placeholder' (jeu de démonstration, jamais réglementaire).
-- -----------------------------------------------------------------------------
CREATE TABLE schoollife.conduct_scales (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  code            text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label           text NOT NULL CHECK (length(btrim(label)) > 0),
  grade_level_id  uuid,                                   -- academic.grade_levels.id ; NULL = tous les niveaux
  initial_points  integer NOT NULL,
  min_points      integer,
  max_points      integer,
  reset_scope     text NOT NULL CHECK (reset_scope IN ('PERIOD', 'YEAR', 'NEVER')),
  effective_from  date NOT NULL,
  effective_to    date,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  source_kind     text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'placeholder')),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (min_points IS NULL OR max_points IS NULL OR min_points <= max_points),
  CHECK (min_points IS NULL OR initial_points >= min_points),
  CHECK (max_points IS NULL OR initial_points <= max_points),
  EXCLUDE USING gist (
    tenant_id WITH =,
    institution_id WITH =,
    (coalesce(grade_level_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status = 'ACTIVE')
);
SELECT kernel.enable_tenant_rls('schoollife.conduct_scales');
GRANT SELECT, INSERT, UPDATE ON schoollife.conduct_scales TO app_user;

-- Valeur d'un type d'événement dans un barème (points en moins pour une sanction, en plus pour un encouragement).
CREATE TABLE schoollife.conduct_scale_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  scale_id       uuid NOT NULL,
  event_type_id  uuid NOT NULL,
  points_delta   integer NOT NULL CHECK (points_delta <> 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scale_id, event_type_id),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES schoollife.conduct_scales (tenant_id, id),
  FOREIGN KEY (tenant_id, event_type_id) REFERENCES schoollife.event_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.conduct_scale_items');
GRANT SELECT, INSERT, UPDATE, DELETE ON schoollife.conduct_scale_items TO app_user;   -- brouillon seulement (déclencheur 2202)
