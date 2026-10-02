-- =============================================================================
-- 2103 — Module councils : orientation, réorientation, passage d'une série à l'autre
-- =============================================================================
--
-- Les séries, options et langues sont des DONNÉES de `academic` (programmes enfants d'un programme
-- « lycée », nœuds GROUP à choix {min,max}, matières du catalogue) : ce module n'en fige aucune.
-- Il ajoute ce qui MANQUE : (1) les parcours AUTORISÉS d'une série/niveau vers une autre
-- (`orientation_paths`, donnée de l'établissement ou du pack, VIDE par défaut : aucun parcours
-- officiel n'est inventé) ; (2) le dossier d'orientation d'un élève avec les vœux de la famille ;
-- (3) le transfert de série, qui n'existe que par une décision HUMAINE (décision du conseil ou
-- acte de la direction), appliqué à `academic` par un port.
-- =============================================================================

CREATE TABLE councils.orientation_paths (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid,                         -- NULL = tout l'établissement du tenant
  kind                      text NOT NULL CHECK (kind IN ('ORIENTATION', 'REORIENTATION', 'SERIES_CHANGE')),
  from_program_id           uuid,                         -- academic.programs.id ; NULL = toute série de départ
  from_grade_level_id       uuid NOT NULL,                -- academic.grade_levels.id
  to_program_id             uuid NOT NULL,
  to_grade_level_id         uuid NOT NULL,
  label                     text,
  requires_council_opinion  boolean NOT NULL DEFAULT true,
  requires_guardian_consent boolean NOT NULL DEFAULT false,
  active                    boolean NOT NULL DEFAULT true,
  source_kind               text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'placeholder')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.orientation_paths');
CREATE UNIQUE INDEX orientation_paths_uq ON councils.orientation_paths
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), kind,
   coalesce(from_program_id, '00000000-0000-0000-0000-000000000000'::uuid), from_grade_level_id, to_program_id, to_grade_level_id);
GRANT SELECT, INSERT, UPDATE ON councils.orientation_paths TO app_user;

-- Dossier d'orientation : un par inscription.
--   guardian_consent : exigé ou non par le parcours retenu (donnée du parcours).
CREATE TABLE councils.orientation_files (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,
  academic_year_id      uuid NOT NULL,
  enrollment_id         uuid NOT NULL,                    -- academic.enrollments.id
  student_id            uuid NOT NULL,
  current_program_id    uuid NOT NULL,
  current_grade_level_id uuid NOT NULL,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WISHES_COLLECTED', 'PROPOSED', 'DECIDED', 'APPLIED', 'CLOSED', 'CANCELLED')),
  guardian_consent      text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (guardian_consent IN ('NOT_REQUIRED', 'PENDING', 'GIVEN', 'REFUSED')),
  consent_recorded_by   uuid,
  consent_recorded_at   timestamptz,
  decision_id           uuid,                             -- décision du conseil retenue
  notes                 text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES councils.decisions (tenant_id, id),
  CHECK (guardian_consent NOT IN ('GIVEN', 'REFUSED') OR (consent_recorded_by IS NOT NULL AND consent_recorded_at IS NOT NULL)),
  CHECK (status NOT IN ('DECIDED', 'APPLIED') OR decision_id IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.orientation_files');
CREATE INDEX orientation_files_by_year ON councils.orientation_files (tenant_id, academic_year_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE ON councils.orientation_files TO app_user;

-- Vœux (par ordre de préférence) ; les options choisies (langue vivante, option…) sont des identifiants
-- de matières / nœuds `academic`, jamais des libellés.
CREATE TABLE councils.orientation_wishes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  file_id           uuid NOT NULL,
  rank              integer NOT NULL CHECK (rank >= 1),
  to_program_id     uuid NOT NULL,
  to_grade_level_id uuid NOT NULL,
  option_ids        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(option_ids) = 'array'),
  source            text NOT NULL CHECK (source IN ('GUARDIAN', 'STUDENT', 'STAFF', 'COUNSELLOR')),
  expressed_by      uuid NOT NULL,
  expressed_at      timestamptz NOT NULL DEFAULT now(),
  comment           text,
  withdrawn_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, file_id) REFERENCES councils.orientation_files (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.orientation_wishes');
CREATE UNIQUE INDEX orientation_wishes_rank ON councils.orientation_wishes (tenant_id, file_id, rank) WHERE withdrawn_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON councils.orientation_wishes TO app_user;

-- Transfert de série (passage d'une série à l'autre). Il n'existe que par une DÉCISION HUMAINE :
--   decided_via = 'COUNCIL'       -> `decision_id` (décision du conseil) obligatoire ;
--   decided_via = 'DIRECTOR_ACT'  -> `act_reference` obligatoire (acte de la direction hors séance).
-- Le parcours doit exister dans `orientation_paths`, sinon dérogation motivée (>= 20 caractères) par un
-- utilisateur ; contrôlé par la base (2104).
CREATE TABLE councils.series_transfers (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,
  enrollment_id         uuid NOT NULL,
  student_id            uuid NOT NULL,
  from_program_id       uuid NOT NULL,
  from_grade_level_id   uuid NOT NULL,
  to_program_id         uuid NOT NULL,
  to_grade_level_id     uuid NOT NULL,
  effective_kind        text NOT NULL CHECK (effective_kind IN ('NEXT_YEAR', 'MID_YEAR')),
  effective_on          date,
  decided_via           text NOT NULL CHECK (decided_via IN ('COUNCIL', 'DIRECTOR_ACT')),
  decision_id           uuid,
  act_reference         text,
  act_issued_by         uuid,
  path_id               uuid,
  path_override_reason  text,
  path_override_by      uuid,
  status                text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'APPLIED', 'CANCELLED', 'FAILED')),
  applied_at            timestamptz,
  applied_ref           uuid,                             -- academic : placement ou inscription créé(e)
  last_error            text,
  cancel_reason         text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES councils.decisions (tenant_id, id),
  FOREIGN KEY (tenant_id, path_id) REFERENCES councils.orientation_paths (tenant_id, id),
  CHECK ((decided_via = 'COUNCIL') = (decision_id IS NOT NULL)),
  CHECK ((decided_via = 'DIRECTOR_ACT') = (act_reference IS NOT NULL AND act_issued_by IS NOT NULL)),
  CHECK (effective_kind <> 'MID_YEAR' OR effective_on IS NOT NULL),
  CHECK (path_id IS NOT NULL OR length(btrim(coalesce(path_override_reason, ''))) >= 20),
  CHECK (path_override_reason IS NULL OR path_override_by IS NOT NULL),
  CHECK (status <> 'APPLIED' OR (applied_at IS NOT NULL AND applied_ref IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5),
  CHECK (from_program_id <> to_program_id OR from_grade_level_id <> to_grade_level_id)
);
SELECT kernel.enable_tenant_rls('councils.series_transfers');
-- Un transfert vivant par inscription.
CREATE UNIQUE INDEX series_transfers_one_live ON councils.series_transfers (tenant_id, enrollment_id) WHERE status IN ('PLANNED', 'APPLIED');
CREATE INDEX series_transfers_by_student ON councils.series_transfers (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE ON councils.series_transfers TO app_user;
