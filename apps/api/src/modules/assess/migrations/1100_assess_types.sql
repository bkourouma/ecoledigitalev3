-- =============================================================================
-- 1100 — Module assess : schéma, types d'évaluation configurables, réglages
-- =============================================================================
--
-- Plage de numéros réservée au module assess : 1100–1199 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md, tableau des plages).
--
-- Référence : specs/v2/011-assessments-grades/data-model.md §1. Les références vers les modules academic et
-- people (classe, nœud de curriculum, période, année, inscription, élève, enseignant) sont des UUID SANS clé
-- étrangère. Notes = numeric exact (aucun flottant). Aucune formule, aucun seuil académique dans ce module :
-- la moyenne, le rang, la mention sont calculés par le module `results` à travers `rules`.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS assess;
REVOKE ALL ON SCHEMA assess FROM PUBLIC;
GRANT USAGE ON SCHEMA assess TO app_user;

CREATE TABLE assess.assessment_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label               text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  -- groupe d'agrégation lu par les règles / par `results` (CONTINUOUS, EXAM, PROJECT…) : une DONNÉE du tenant
  aggregation_group   text NOT NULL CHECK (aggregation_group ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  default_scale_max   numeric(8,3) NOT NULL DEFAULT 20 CHECK (default_scale_max > 0),
  default_weight      numeric(8,3) NOT NULL DEFAULT 1  CHECK (default_weight >= 0),
  publication_mode    text NOT NULL DEFAULT 'MANUAL' CHECK (publication_mode IN ('MANUAL', 'AUTO_ON_APPROVAL')),
  visible_to_students boolean NOT NULL DEFAULT true,
  allows_session2     boolean NOT NULL DEFAULT false,
  is_system           boolean NOT NULL DEFAULT false,
  template_key        text,
  position            integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('assess.assessment_types');
-- jamais DELETE : un type utilisé ne se supprime pas, il se désactive (R-ASS-06)
GRANT SELECT, INSERT, UPDATE ON assess.assessment_types TO app_user;

CREATE TABLE assess.settings (
  tenant_id                  uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  require_separate_reviewer  boolean NOT NULL DEFAULT true,
  require_separate_approver  boolean NOT NULL DEFAULT true,
  max_score_decimals         smallint NOT NULL DEFAULT 2 CHECK (max_score_decimals BETWEEN 0 AND 3),
  late_grade_policy          text NOT NULL DEFAULT 'REVISION' CHECK (late_grade_policy IN ('REVISION')),
  updated_by                 uuid,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('assess.settings');
GRANT SELECT, INSERT, UPDATE ON assess.settings TO app_user;
