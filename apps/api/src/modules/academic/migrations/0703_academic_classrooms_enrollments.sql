-- =============================================================================
-- 0703 — Module academic : classes / promotions, offres, inscriptions
-- =============================================================================
--
-- Vocabulaire (glossaire ADR-007) :
--   Classroom = la CLASSE ou PROMOTION (« 6e A », « Licence 2 Informatique — promotion 2026 »),
--               jamais la salle physique (qui est `scheduling.rooms`).
--   Offering  = la dispensation d'un nœud du curriculum à une classe pendant une fenêtre
--               (l'ancienne « cohorte / session d'UE ») : dates, fenêtre d'inscription,
--               capacité, statut. Obligatoire pour l'inscription à la carte, facultative sinon.
--   Enrollment = l'inscription annuelle d'un apprenant dans une classe ; elle HISTORISE (le
--               dossier permanent de l'élève ne change jamais).
-- =============================================================================

CREATE TABLE academic.classrooms (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id         uuid NOT NULL,                 -- tenancy.institutions.id (sans FK)
  campus_id              uuid,                          -- tenancy.campuses.id (sans FK)
  academic_year_id       uuid NOT NULL,
  program_id             uuid NOT NULL,
  grade_level_id         uuid NOT NULL,
  curriculum_version_id  uuid,                          -- NULL tant que le curriculum n'est pas choisi
  kind                   text NOT NULL DEFAULT 'CLASS' CHECK (kind IN ('CLASS', 'COHORT')),
  code                   text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  name                   text NOT NULL CHECK (length(btrim(name)) > 0),
  capacity               integer CHECK (capacity IS NULL OR capacity > 0),
  capacity_is_hard       boolean NOT NULL DEFAULT true,       -- parité : le legacy refusait au-delà de la capacité (NULL = illimité)
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED')),
  starts_on              date,
  ends_on                date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, program_id, grade_level_id, code),
  UNIQUE (tenant_id, academic_year_id, program_id, grade_level_id, name),
  -- Une classe n'est active qu'avec un curriculum choisi (publié : contrôlé par le déclencheur).
  CHECK (status IN ('DRAFT', 'CANCELLED') OR curriculum_version_id IS NOT NULL),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id),
  FOREIGN KEY (tenant_id, curriculum_version_id) REFERENCES academic.curriculum_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.classrooms');
CREATE INDEX classrooms_by_year ON academic.classrooms (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX classrooms_by_program ON academic.classrooms (tenant_id, program_id, grade_level_id);
GRANT SELECT, INSERT, UPDATE ON academic.classrooms TO app_user;

-- Cohérence : la version de curriculum est celle du programme ET de l'année de la classe ; le
-- niveau est couvert par le programme ; l'établissement ne change pas.
CREATE FUNCTION academic.classrooms_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ver  academic.curriculum_versions%ROWTYPE;
  v_year academic.academic_years%ROWTYPE;
BEGIN
  SELECT * INTO v_year FROM academic.academic_years WHERE tenant_id = NEW.tenant_id AND id = NEW.academic_year_id;
  IF v_year.institution_id <> NEW.institution_id THEN
    RAISE EXCEPTION 'academic.classroom_year_institution: l''année appartient à un autre établissement' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM academic.program_grade_levels g
                  WHERE g.tenant_id = NEW.tenant_id AND g.program_id = NEW.program_id AND g.grade_level_id = NEW.grade_level_id) THEN
    RAISE EXCEPTION 'academic.classroom_level_not_in_program: le niveau n''est pas couvert par le programme' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.curriculum_version_id IS NOT NULL THEN
    SELECT * INTO v_ver FROM academic.curriculum_versions WHERE tenant_id = NEW.tenant_id AND id = NEW.curriculum_version_id;
    IF v_ver.program_id <> NEW.program_id OR v_ver.academic_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'academic.classroom_curriculum_mismatch: la version de curriculum ne correspond pas au programme et à l''année' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ver.status = 'DRAFT' AND NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'academic.classroom_curriculum_draft: le curriculum doit être publié avant d''activer la classe' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.program_id <> OLD.program_id OR NEW.grade_level_id <> OLD.grade_level_id THEN
      RAISE EXCEPTION 'academic.classroom_identity_immutable: établissement, année, programme et niveau d''une classe sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT'     AND NEW.status IN ('ACTIVE', 'CANCELLED')) OR
         (OLD.status = 'ACTIVE'    AND NEW.status IN ('COMPLETED', 'CANCELLED', 'DRAFT')) OR
         (OLD.status = 'COMPLETED' AND NEW.status IN ('ARCHIVED', 'ACTIVE')) OR
         (OLD.status = 'CANCELLED' AND NEW.status IN ('DRAFT')) OR
         (OLD.status = 'ARCHIVED'  AND NEW.status = 'COMPLETED')) THEN
      RAISE EXCEPTION 'academic.classroom_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER classrooms_guard BEFORE INSERT OR UPDATE ON academic.classrooms
  FOR EACH ROW EXECUTE FUNCTION academic.classrooms_guard();

-- -----------------------------------------------------------------------------
-- Clôture par classe : l'état EFFECTIF d'une période pour une classe est l'état EXPLICITE de la
-- classe s'il existe, sinon celui de la période (règle R4 : la classe SURCHARGE). Permet de clore les notes d'une
-- classe sans clore celles d'une autre (bug historique : la clôture d'un semestre fermait
-- toutes les cohortes de l'UE, tous noms de classe confondus).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.classroom_period_states (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id  uuid NOT NULL,
  period_id     uuid NOT NULL,
  status        text NOT NULL CHECK (status IN ('OPEN', 'GRADING_CLOSED', 'CLOSED')),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  changed_by    uuid,
  reason        text,
  PRIMARY KEY (tenant_id, classroom_id, period_id),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES academic.academic_periods (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.classroom_period_states');
GRANT SELECT, INSERT, UPDATE ON academic.classroom_period_states TO app_user;

-- -----------------------------------------------------------------------------
-- Offres (ancienne « cohorte / session d'UE »)
--   status : DRAFT -> OPEN <-> FULL -> IN_PROGRESS -> COMPLETED ; CANCELLED terminal.
--   FULL n'est jamais posé à la main : il est dérivé de la capacité (déclencheur + cas d'usage).
--   Nombre d'inscrits actifs = enrollment_courses non annulés de l'offre (+ inscriptions de
--   classe pour une offre dont la classe inscrit en bloc).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.classroom_offerings (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id             uuid NOT NULL,
  curriculum_node_id       uuid NOT NULL,
  label                    text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_on                date NOT NULL,
  ends_on                  date NOT NULL,
  registration_opens_at    timestamptz,
  registration_closes_at   timestamptz,
  capacity                 integer CHECK (capacity IS NULL OR capacity > 0),
  status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, classroom_id, curriculum_node_id),
  CHECK (ends_on >= starts_on),
  CHECK ((registration_opens_at IS NULL) = (registration_closes_at IS NULL)),
  CHECK (registration_closes_at IS NULL OR registration_closes_at >= registration_opens_at),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  FOREIGN KEY (tenant_id, curriculum_node_id) REFERENCES academic.curriculum_nodes (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.classroom_offerings');
CREATE INDEX classroom_offerings_open ON academic.classroom_offerings (tenant_id, status, registration_opens_at, registration_closes_at);
CREATE INDEX classroom_offerings_by_node ON academic.classroom_offerings (tenant_id, curriculum_node_id);
GRANT SELECT, INSERT, UPDATE ON academic.classroom_offerings TO app_user;

-- Le nœud appartient au curriculum de la classe et est inscriptible ; transitions légales.
CREATE FUNCTION academic.classroom_offerings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class academic.classrooms%ROWTYPE;
  v_node  academic.curriculum_nodes%ROWTYPE;
  v_type  academic.curriculum_node_types%ROWTYPE;
  v_year  academic.academic_years%ROWTYPE;
  v_held  integer;
BEGIN
  SELECT * INTO v_class FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id;
  SELECT * INTO v_node  FROM academic.curriculum_nodes WHERE tenant_id = NEW.tenant_id AND id = NEW.curriculum_node_id;
  SELECT * INTO v_year  FROM academic.academic_years WHERE tenant_id = NEW.tenant_id AND id = v_class.academic_year_id;
  IF NEW.starts_on < v_year.starts_on OR NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'academic.offering_outside_year: les dates de l''offre dépassent l''année % (% -> %)', v_year.code, v_year.starts_on, v_year.ends_on
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_class.curriculum_version_id IS NULL OR v_node.version_id <> v_class.curriculum_version_id THEN
    RAISE EXCEPTION 'academic.offering_node_not_in_curriculum: le nœud n''appartient pas au curriculum de la classe' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_type FROM academic.curriculum_node_types WHERE tenant_id = NEW.tenant_id AND code = v_node.node_type_code;
  IF NOT v_type.is_enrollable THEN
    RAISE EXCEPTION 'academic.offering_node_not_enrollable: un nœud % ne s''offre pas à l''inscription', v_node.node_type_code USING ERRCODE = 'check_violation';
  END IF;
  IF v_node.is_transversal THEN
    RAISE EXCEPTION 'academic.offering_node_transversal: une matière transversale n''est jamais offerte à l''inscription' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.classroom_id <> OLD.classroom_id OR NEW.curriculum_node_id <> OLD.curriculum_node_id THEN
      RAISE EXCEPTION 'academic.offering_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT'       AND NEW.status IN ('OPEN', 'CANCELLED')) OR
         (OLD.status = 'OPEN'        AND NEW.status IN ('DRAFT', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) OR
         (OLD.status = 'FULL'        AND NEW.status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) OR
         (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED', 'CANCELLED')) OR
         -- Réouverture (legacy POST /sessions/reopen), sous contrôle du cas d'usage `transitionOffering`
         -- (permission, nouvelle fenêtre et nouvelle date de fin valides, motif).
         (OLD.status = 'COMPLETED'   AND NEW.status IN ('OPEN', 'IN_PROGRESS')) OR
         (OLD.status = 'CANCELLED'   AND NEW.status = 'DRAFT')) THEN
      RAISE EXCEPTION 'academic.offering_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    -- La capacité ne peut pas descendre sous les places déjà réservées.
    IF NEW.capacity IS NOT NULL AND NEW.capacity IS DISTINCT FROM OLD.capacity THEN
      SELECT count(*) INTO v_held FROM academic.enrollment_courses c
       WHERE c.tenant_id = NEW.tenant_id AND c.offering_id = NEW.id
         AND (c.status IN ('CONFIRMED', 'COMPLETED')
              OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())));
      IF NEW.capacity < v_held THEN
        RAISE EXCEPTION 'academic.capacity_below_reserved: % places réservées pour une capacité de %', v_held, NEW.capacity
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER classroom_offerings_guard BEFORE INSERT OR UPDATE ON academic.classroom_offerings
  FOR EACH ROW EXECUTE FUNCTION academic.classroom_offerings_guard();

-- -----------------------------------------------------------------------------
-- Inscriptions
--   mode   CLASS        l'apprenant suit tout le curriculum obligatoire de la classe
--          A_LA_CARTE   il ne suit que les offres listées dans enrollment_courses
--   status PENDING (en attente de confirmation) -> ACTIVE -> COMPLETED ; SUSPENDED ; WITHDRAWN ;
--          TRANSFERRED_OUT ; CANCELLED. PENDING et ACTIVE réservent une place.
--   funding_type, assignment_reference… : type de financement (PRD §20) porté par l'inscription.
--          Les montants (part État / part parent) appartiennent au module finance.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.enrollments (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id          uuid NOT NULL,
  campus_id               uuid,
  academic_year_id        uuid NOT NULL,
  student_id              uuid NOT NULL,                 -- people.students.id (sans FK)
  classroom_id            uuid NOT NULL,                 -- placement courant (historique : enrollment_placements)
  mode                    text NOT NULL DEFAULT 'CLASS' CHECK (mode IN ('CLASS', 'A_LA_CARTE')),
  status                  text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'CANCELLED')),
  registration_number     text,
  enrolled_on             date NOT NULL,
  ended_on                date,
  end_reason              text,
  is_repeating            boolean NOT NULL DEFAULT false,
  is_transfer_in          boolean NOT NULL DEFAULT false,   -- arrive d'un autre établissement cette année
  origin_school           text,
  previous_enrollment_id  uuid,
  funding_type            text NOT NULL DEFAULT 'PRIVATE',
  assignment_reference    text CHECK (assignment_reference IS NULL OR length(btrim(assignment_reference)) > 0),
  assignment_issued_on    date,
  funder_label            text,
  funding_notes           text,
  outcome_code            text,
  outcome_decided_at      timestamptz,
  outcome_source_ref      uuid,                           -- identifiant de la décision (module bulletins)
  source_kind             text CHECK (source_kind IS NULL OR source_kind IN ('ADMISSION', 'IMPORT', 'MANUAL', 'ROLLOVER', 'ONLINE')),
  source_ref              uuid,
  confirmed_at            timestamptz,
  cancelled_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ended_on IS NULL OR ended_on >= enrolled_on),
  CHECK (status NOT IN ('WITHDRAWN', 'TRANSFERRED_OUT', 'CANCELLED') OR ended_on IS NOT NULL),
  CHECK (status NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED') OR ended_on IS NULL),
  CHECK (previous_enrollment_id IS NULL OR previous_enrollment_id <> id),
  CHECK (funding_type <> 'PRIVATE' OR assignment_reference IS NULL),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  FOREIGN KEY (tenant_id, previous_enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, funding_type) REFERENCES academic.funding_types (tenant_id, code),
  FOREIGN KEY (tenant_id, outcome_code) REFERENCES academic.enrollment_outcomes (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.enrollments');
-- Un apprenant n'a qu'une inscription vivante par classe.
CREATE UNIQUE INDEX enrollments_one_live_per_class
  ON academic.enrollments (tenant_id, student_id, classroom_id)
  WHERE status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED');
-- Inscription « de classe » : une seule par apprenant, année et établissement.
CREATE UNIQUE INDEX enrollments_one_class_mode_per_year
  ON academic.enrollments (tenant_id, student_id, academic_year_id, institution_id)
  WHERE mode = 'CLASS' AND status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED');
CREATE INDEX enrollments_registration_number
  ON academic.enrollments (tenant_id, institution_id, registration_number) WHERE registration_number IS NOT NULL;
CREATE INDEX enrollments_by_classroom ON academic.enrollments (tenant_id, classroom_id, status);
CREATE INDEX enrollments_by_student ON academic.enrollments (tenant_id, student_id, academic_year_id);
CREATE INDEX enrollments_by_year ON academic.enrollments (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX enrollments_by_funding ON academic.enrollments (tenant_id, funding_type) WHERE funding_type <> 'PRIVATE';
GRANT SELECT, INSERT, UPDATE ON academic.enrollments TO app_user;

-- Sélections de cours : options (langue vivante 2…), inscription à la carte, reprise de dette,
-- chacune rattachée à un nœud du curriculum et, à la carte, à une offre.
CREATE TABLE academic.enrollment_courses (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id       uuid NOT NULL,
  curriculum_node_id  uuid NOT NULL,
  offering_id         uuid,
  source              text NOT NULL CHECK (source IN ('OPTION', 'A_LA_CARTE', 'CARRY_OVER')),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  hold_expires_at     timestamptz,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (source <> 'A_LA_CARTE' OR offering_id IS NOT NULL),
  CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, curriculum_node_id) REFERENCES academic.curriculum_nodes (tenant_id, id),
  FOREIGN KEY (tenant_id, offering_id) REFERENCES academic.classroom_offerings (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_courses');
-- Une sélection vivante par (inscription, nœud).
CREATE UNIQUE INDEX enrollment_courses_one_live
  ON academic.enrollment_courses (tenant_id, enrollment_id, curriculum_node_id) WHERE status <> 'CANCELLED';
CREATE INDEX enrollment_courses_by_offering ON academic.enrollment_courses (tenant_id, offering_id, status) WHERE offering_id IS NOT NULL;
CREATE INDEX enrollment_courses_hold ON academic.enrollment_courses (tenant_id, hold_expires_at) WHERE status = 'PENDING' AND hold_expires_at IS NOT NULL;
CREATE INDEX enrollment_courses_by_node ON academic.enrollment_courses (tenant_id, curriculum_node_id, status);
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_courses TO app_user;

-- Historique des affectations de classe (changement de classe en cours d'année, changement de
-- groupe d'un semestre à l'autre). Les périodes d'une même inscription ne se chevauchent pas.
CREATE TABLE academic.enrollment_placements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id  uuid NOT NULL,
  classroom_id   uuid NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date,
  reason         text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, classroom_id) REFERENCES academic.classrooms (tenant_id, id),
  EXCLUDE USING gist (
    tenant_id WITH =,
    enrollment_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('academic.enrollment_placements');
CREATE INDEX enrollment_placements_by_class ON academic.enrollment_placements (tenant_id, classroom_id, starts_on);
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_placements TO app_user;

-- Journal d'historique des inscriptions (statut, financement, placement, sélection de cours).
-- Append-only : « l'Enrollment historise ».
CREATE TABLE academic.enrollment_history (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('CREATED', 'STATUS', 'FUNDING', 'PLACEMENT', 'COURSE', 'OUTCOME', 'NOTE')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  actor_id       uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_history');
CREATE INDEX enrollment_history_by_enrollment ON academic.enrollment_history (tenant_id, enrollment_id, occurred_at);
GRANT SELECT, INSERT ON academic.enrollment_history TO app_user;

-- -----------------------------------------------------------------------------
-- Registre des numéros d'inscription (ex-« matricule professionnel » IPAM-<CODE>-<NNNN>) : un
-- numéro est attribué UNE fois par (apprenant, programme, niveau) et reste identique à chaque
-- réinscription (redoublement compris) ; deux apprenants ne partagent jamais un numéro dans un
-- établissement. Le motif est la donnée `institution_settings.registration_number_pattern`
-- (jetons {PREFIX} {PROGRAM} {LEVEL} {YEAR} {STUDENT_SEQ:n}) : le préfixe n'est plus codé en dur.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.registration_numbers (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,
  student_id          uuid NOT NULL,                     -- people.students.id (sans FK)
  program_id          uuid NOT NULL,
  grade_level_id      uuid NOT NULL,
  registration_number text NOT NULL CHECK (length(btrim(registration_number)) > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, registration_number),
  UNIQUE (tenant_id, institution_id, student_id, program_id, grade_level_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES academic.programs (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_level_id) REFERENCES academic.grade_levels (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('academic.registration_numbers');
GRANT SELECT, INSERT ON academic.registration_numbers TO app_user;
