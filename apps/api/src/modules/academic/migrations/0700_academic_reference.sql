-- =============================================================================
-- 0700 — Module academic : schéma et référentiels pilotés par les modèles de pack
-- =============================================================================
--
-- Plage de numéros réservée au module academic : 0700–0799 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; plage à inscrire dans ce tableau).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma (`academic`) ; AUCUNE clé étrangère vers le schéma d'un autre
--     module, sauf `kernel.tenants(id)`. Les références vers `tenancy` (établissement,
--     campus), `people` (élève) et `assess` sont des UUID vérifiés par l'API publique ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis
--     `kernel.enable_tenant_rls()`, puis GRANT explicite à `app_user` ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) : une ligne ne peut pas pointer la
--     ligne d'un autre tenant, même en connaissant son UUID (les contrôles de FK contournent
--     la RLS) ;
--   - horodatages `timestamptz` en UTC, dates civiles en `date`, identifiants `uuid` fournis
--     par l'application (`newId()`), pas de montant dans ce module ;
--   - AUCUNE constante réglementaire : seuils et formules relèvent des RuleSets. Les
--     référentiels ci-dessous (niveaux, types de périodes, grammaire du curriculum, types de
--     financement, issues d'année) sont de la DONNÉE instanciée depuis les modèles de pack.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS academic;
REVOKE ALL ON SCHEMA academic FROM PUBLIC;
GRANT USAGE ON SCHEMA academic TO app_user;

-- Extension « de confiance » (PG >= 13) : nécessaire aux contraintes d'exclusion qui mêlent
-- égalité (uuid, text) et chevauchement de plages.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Cycles d'enseignement (maternelle, primaire, collège, lycée, licence, master, BTS…)
-- -----------------------------------------------------------------------------
CREATE TABLE academic.education_levels (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal    integer NOT NULL CHECK (ordinal >= 0),
  pack       text CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.education_levels');
GRANT SELECT, INSERT, UPDATE ON academic.education_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Niveaux (PS, CP1, 6e, Tle, L1, M2, BTS1…). `next_grade_level_id` est la DONNÉE qui dit
-- vers quel niveau mène un passage ; NULL + is_final = fin de parcours.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.grade_levels (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  education_level_id  uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  short_label         text,
  ordinal             integer NOT NULL CHECK (ordinal >= 0),
  next_grade_level_id uuid,
  is_final            boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, education_level_id) REFERENCES academic.education_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, next_grade_level_id) REFERENCES academic.grade_levels (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (next_grade_level_id IS NULL OR next_grade_level_id <> id),
  CHECK (NOT (is_final AND next_grade_level_id IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('academic.grade_levels');
GRANT SELECT, INSERT, UPDATE ON academic.grade_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Types de périodes (composition, trimestre, semestre, session, module…). Aucune
-- périodicité n'est codée en dur : un type est une ligne de données.
--   kind = TEACHING_PERIOD : période d'enseignement (trimestre, semestre, module)
--   kind = EXAM_SESSION    : session d'examen (normale, rattrapage)
-- -----------------------------------------------------------------------------
CREATE TABLE academic.period_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL CHECK (kind IN ('TEACHING_PERIOD', 'EXAM_SESSION')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.period_types');
GRANT SELECT, INSERT, UPDATE ON academic.period_types TO app_user;

-- -----------------------------------------------------------------------------
-- Types de financement de l'apprenant (PRD §20). Le jeu de codes reste celui du module
-- finance (CHECK de finance.learner_accounts) ; ici la DONNÉE est le libellé et l'exigence
-- de référence d'affectation.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.funding_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code IN ('PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  requires_reference  boolean NOT NULL DEFAULT false,
  requires_funder     boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.funding_types');
GRANT SELECT, INSERT, UPDATE ON academic.funding_types TO app_user;

-- -----------------------------------------------------------------------------
-- Issues de fin d'inscription (promu, redoublant, diplômé, orienté, exclu…). `kind` pilote
-- la reconduction annuelle : ADVANCE -> niveau suivant ; REPEAT -> même niveau ;
-- REDIRECT -> programme/niveau désigné ; EXIT -> aucune inscription l'année suivante.
-- La décision elle-même (et ses seuils) vient du module de bulletins / RuleSet.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.enrollment_outcomes (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  kind       text NOT NULL CHECK (kind IN ('ADVANCE', 'REPEAT', 'REDIRECT', 'EXIT')),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_outcomes');
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_outcomes TO app_user;

-- -----------------------------------------------------------------------------
-- Grammaire de l'arbre de curriculum : quels types de nœuds existent, sous quels parents,
-- avec quels attributs. C'est ce qui rend l'arbre polymorphe : le primaire/secondaire
-- utilisent LEVEL > SUBJECT, le supérieur LEVEL > PERIOD > UE > ECUE.
-- `allowed_parent_codes` contient 'ROOT' pour un nœud de premier niveau.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.curriculum_node_types (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  allowed_parent_codes text[] NOT NULL CHECK (cardinality(allowed_parent_codes) >= 1),
  requires_grade_level boolean NOT NULL DEFAULT false,
  requires_period_slot boolean NOT NULL DEFAULT false,
  requires_subject     boolean NOT NULL DEFAULT false,
  allows_coefficient   boolean NOT NULL DEFAULT false,
  allows_credits       boolean NOT NULL DEFAULT false,
  credits_must_equal_children boolean NOT NULL DEFAULT false,   -- UE : crédits = somme des crédits des ECUE (contrôlé à la publication)
  is_enrollable        boolean NOT NULL DEFAULT false,
  is_system            boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (NOT (requires_grade_level AND requires_period_slot))
);
SELECT kernel.enable_tenant_rls('academic.curriculum_node_types');
GRANT SELECT, INSERT, UPDATE ON academic.curriculum_node_types TO app_user;

-- -----------------------------------------------------------------------------
-- Paramètres par établissement (une ligne). Politiques d'établissement, PAS des règles
-- réglementaires : leurs valeurs par défaut viennent du modèle de pack.
--   enrollment_confirmation_policy : quand une inscription devient ACTIVE
--       AUTO                        dès la création (écoles sans préalable financier)
--       ON_REGISTRATION_FEE_PAID    quand les frais d'inscription sont soldés ou inexistants
--       ON_FULL_PAYMENT             quand la facture d'inscription est intégralement soldée
--       MANUAL                      par action d'un utilisateur habilité
--   pending_hold_minutes : durée pendant laquelle une place PENDING est réservée (NULL = sans
--       expiration)
--   registration_number_pattern : motif du numéro d'inscription, jetons {PREFIX} {PROGRAM}
--       {LEVEL} {STUDENT_SEQ:n} {YEAR} ; NULL = pas de numéro d'inscription (registre
--       `registration_numbers` : un numéro par apprenant, programme et niveau, stable)
-- -----------------------------------------------------------------------------
CREATE TABLE academic.institution_settings (
  tenant_id                      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id                 uuid NOT NULL,
  enrollment_confirmation_policy text NOT NULL DEFAULT 'AUTO'
    CHECK (enrollment_confirmation_policy IN ('AUTO', 'ON_REGISTRATION_FEE_PAID', 'ON_FULL_PAYMENT', 'MANUAL')),
  -- Confirmation d'une SÉLECTION de cours à la carte (indépendante de celle de l'inscription) :
  --   AUTO          dès la demande ; ON_LINE_PAID  quand la ligne de facture de la sélection est
  --   soldée (sourceRef = enrollmentCourseId) ; MANUAL  par action d'un utilisateur habilité.
  course_confirmation_policy     text NOT NULL DEFAULT 'ON_LINE_PAID'
    CHECK (course_confirmation_policy IN ('AUTO', 'ON_LINE_PAID', 'MANUAL')),
  pending_hold_minutes           integer CHECK (pending_hold_minutes IS NULL OR pending_hold_minutes > 0),
  registration_number_prefix     text CHECK (registration_number_prefix IS NULL OR registration_number_prefix ~ '^[A-Z0-9]{1,12}$'),
  registration_number_pattern    text CHECK (registration_number_pattern IS NULL OR length(registration_number_pattern) BETWEEN 3 AND 80),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('academic.institution_settings');
GRANT SELECT, INSERT, UPDATE ON academic.institution_settings TO app_user;

-- Versions de modèle de pack appliquées (idempotence de instantiatePackReferenceData).
CREATE TABLE academic.template_applications (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  pack            text NOT NULL CHECK (pack IN ('PRIMARY', 'SECONDARY', 'HIGHER', 'VIRTUAL')),
  education_system text NOT NULL,
  template_version integer NOT NULL CHECK (template_version >= 1),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  applied_by      uuid,
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, pack, education_system, template_version)
);
SELECT kernel.enable_tenant_rls('academic.template_applications');
GRANT SELECT, INSERT ON academic.template_applications TO app_user;
