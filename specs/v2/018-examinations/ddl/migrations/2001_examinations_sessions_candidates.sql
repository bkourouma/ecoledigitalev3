-- =============================================================================
-- 2001 — Module examinations : sessions, définition figée, candidats, éligibilité, pièces, centres, affectations
-- =============================================================================
--
-- Une SESSION est la participation d'un établissement à une édition d'un examen (officiel) ou la
-- tenue d'un examen blanc. À sa préparation, la définition de l'examen (séries, épreuves, coefficients)
-- est COPIÉE dans la session puis figée (`instantiate_session_definition`) : une session passée ne change
-- jamais, même si le modèle du type évolue.
--
-- Statuts de session : PLANNED > REGISTRATION_OPEN > REGISTRATION_CLOSED > IN_PROGRESS > RESULTS_ENTERED
-- > PUBLISHED > ARCHIVED (retour permis : REGISTRATION_CLOSED -> REGISTRATION_OPEN).
-- =============================================================================

CREATE TABLE examinations.sessions (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id            uuid NOT NULL,
  institution_id          uuid NOT NULL,                          -- tenancy.institutions.id (sans FK)
  academic_year_id        uuid,                                    -- academic.academic_years.id (sans FK)
  code                    text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label                   text NOT NULL CHECK (length(btrim(label)) > 0),
  session_kind            text NOT NULL DEFAULT 'OFFICIAL' CHECK (session_kind IN ('OFFICIAL', 'MOCK')),
  attempt_kind            text NOT NULL DEFAULT 'NORMAL' CHECK (attempt_kind IN ('NORMAL', 'MAKEUP')),
  session_year            integer NOT NULL CHECK (session_year BETWEEN 2000 AND 2200),
  mock_of_session_id      uuid,
  registration_opens_on   date,
  registration_closes_on  date,
  starts_on               date,
  ends_on                 date,
  status                  text NOT NULL DEFAULT 'PLANNED' CHECK (status IN
                            ('PLANNED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED')),
  definition_locked_at    timestamptz,
  rule_version_ref        uuid,                                    -- version de règle `exam-national@1` épinglée (rules.rule_versions.id)
  source_kind             text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (registration_closes_on IS NULL OR registration_opens_on IS NULL OR registration_closes_on >= registration_opens_on),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CHECK (mock_of_session_id IS NULL OR session_kind = 'MOCK'),
  CHECK (mock_of_session_id IS NULL OR mock_of_session_id <> id),
  CHECK (status IN ('PLANNED') OR definition_locked_at IS NOT NULL),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id),
  FOREIGN KEY (tenant_id, mock_of_session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.sessions');
CREATE INDEX sessions_by_type_year ON examinations.sessions (tenant_id, exam_type_id, session_year, status);
GRANT SELECT, INSERT, UPDATE ON examinations.sessions TO app_user;

-- Définition figée de la session : séries et épreuves copiées du type
CREATE TABLE examinations.session_tracks (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id   uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,19}$'),
  label        text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, code),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.session_tracks');
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.session_tracks TO app_user;   -- garde : session non figée

CREATE TABLE examinations.session_papers (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  track_code    text,
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,29}$'),
  label         text NOT NULL,
  coefficient   numeric(6, 3) NOT NULL CHECK (coefficient > 0),
  scale_max     numeric(6, 2) NOT NULL CHECK (scale_max > 0),
  is_optional   boolean NOT NULL DEFAULT false,
  ordinal       integer NOT NULL CHECK (ordinal >= 1),
  source_kind   text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id, track_code) REFERENCES examinations.session_tracks (tenant_id, session_id, code)
);
SELECT kernel.enable_tenant_rls('examinations.session_papers');
CREATE UNIQUE INDEX session_papers_unique ON examinations.session_papers (tenant_id, session_id, coalesce(track_code, ''), code);
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.session_papers TO app_user;   -- garde : session non figée

CREATE FUNCTION examinations.session_definition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_locked timestamptz;
  v_tenant uuid;
  v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_session := OLD.session_id;
  ELSE v_tenant := NEW.tenant_id; v_session := NEW.session_id; END IF;
  SELECT definition_locked_at INTO v_locked FROM examinations.sessions s WHERE s.tenant_id = v_tenant AND s.id = v_session;
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.definition_locked: la définition de la session est figée depuis le %', v_locked USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER session_tracks_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.session_tracks
  FOR EACH ROW EXECUTE FUNCTION examinations.session_definition_guard();
CREATE TRIGGER session_papers_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.session_papers
  FOR EACH ROW EXECUTE FUNCTION examinations.session_definition_guard();

-- Copie la définition du type (séries et épreuves ACTIVES) dans la session puis la fige. Renvoie le nombre d'épreuves.
CREATE FUNCTION examinations.instantiate_session_definition(p_session uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_s examinations.sessions%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = kernel.current_tenant_id() AND s.id = p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'examinations.session_not_found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_s.definition_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.definition_locked: la définition de la session est déjà figée' USING ERRCODE = 'restrict_violation';
  END IF;
  INSERT INTO examinations.session_tracks (id, tenant_id, session_id, code, label)
    SELECT gen_random_uuid(), t.tenant_id, v_s.id, t.code, t.label
      FROM examinations.exam_tracks t WHERE t.tenant_id = v_s.tenant_id AND t.exam_type_id = v_s.exam_type_id AND t.active;
  INSERT INTO examinations.session_papers (id, tenant_id, session_id, track_code, code, label, coefficient, scale_max, is_optional, ordinal, source_kind)
    SELECT gen_random_uuid(), p.tenant_id, v_s.id, p.track_code, p.code, p.label, p.coefficient, p.scale_max, p.is_optional, p.ordinal, p.source_kind
      FROM examinations.exam_papers p WHERE p.tenant_id = v_s.tenant_id AND p.exam_type_id = v_s.exam_type_id AND p.active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'examinations.no_papers: le type d''examen ne compte aucune épreuve active' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE examinations.sessions SET definition_locked_at = now() WHERE tenant_id = v_s.tenant_id AND id = v_s.id;
  RETURN v_n;
END
$$;
GRANT EXECUTE ON FUNCTION examinations.instantiate_session_definition(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Candidats
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.candidates (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id          uuid NOT NULL,
  institution_id      uuid NOT NULL,
  student_id          uuid NOT NULL,                         -- people.students.id (sans FK)
  enrollment_id       uuid,                                   -- academic.enrollments.id (sans FK)
  grade_level_code    text,
  track_code          text,
  -- identité figée à l'inscription (les listes officielles doivent rester reproductibles)
  last_name           text,
  first_name          text,
  birth_date          date,
  birth_place         text,
  sex                 text CHECK (sex IN ('F', 'M')),
  snapshot_taken_at   timestamptz,
  registration_status text NOT NULL DEFAULT 'DRAFT' CHECK (registration_status IN ('DRAFT', 'PRE_REGISTERED', 'REGISTERED', 'WITHDRAWN')),
  eligibility_status  text NOT NULL DEFAULT 'NOT_EVALUATED' CHECK (eligibility_status IN ('NOT_EVALUATED', 'ELIGIBLE', 'INELIGIBLE', 'NEEDS_REVIEW')),
  outcome             text NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING', 'ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),
  candidate_seq       bigint,
  candidate_number    text,
  registered_at       timestamptz,
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  created_by          uuid,
  row_version         integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, id),
  UNIQUE (tenant_id, session_id, candidate_number),
  CHECK ((candidate_seq IS NULL) = (candidate_number IS NULL)),
  CHECK (registration_status <> 'REGISTERED' OR (candidate_number IS NOT NULL AND registered_at IS NOT NULL
         AND last_name IS NOT NULL AND first_name IS NOT NULL AND birth_date IS NOT NULL AND sex IS NOT NULL AND snapshot_taken_at IS NOT NULL)),
  CHECK (registration_status <> 'WITHDRAWN' OR (withdrawn_at IS NOT NULL AND length(btrim(coalesce(withdrawn_reason, ''))) >= 5)),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id, track_code) REFERENCES examinations.session_tracks (tenant_id, session_id, code)
);
SELECT kernel.enable_tenant_rls('examinations.candidates');
-- Un élève n'a qu'un candidat vivant par session.
CREATE UNIQUE INDEX candidates_one_live_per_student
  ON examinations.candidates (tenant_id, session_id, student_id) WHERE registration_status <> 'WITHDRAWN';
CREATE INDEX candidates_by_session ON examinations.candidates (tenant_id, session_id, registration_status, outcome);
CREATE INDEX candidates_by_student ON examinations.candidates (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE ON examinations.candidates TO app_user;

-- Identifiants du candidat (numéro officiel attribué par l'autorité, code CEPE du legacy, identifiant national…)
CREATE TABLE examinations.candidate_identifiers (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  kind          text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,39}$'),   -- OFFICIAL_NUMBER, CEPE_CODE, NATIONAL_ID…
  value         text NOT NULL CHECK (length(btrim(value)) > 0),
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'MIGRATION')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, kind),
  UNIQUE (tenant_id, session_id, kind, value),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_identifiers');
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_identifiers TO app_user;

-- Éligibilité : journal des évaluations (règle `eligibilite` du contrat exam-national@1). Ajout seul.
CREATE TABLE examinations.eligibility_checks (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  candidate_id     uuid NOT NULL,
  rule_version_ref uuid,                                   -- NULL tant qu'aucune règle n'est liée (résultat manuel)
  result           text NOT NULL CHECK (result IN ('ELIGIBLE', 'INELIGIBLE', 'NEEDS_REVIEW')),
  reasons          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
  inputs_hash      text CHECK (inputs_hash IS NULL OR inputs_hash ~ '^[0-9a-f]{64}$'),
  evaluated_by     uuid,
  evaluated_at     timestamptz NOT NULL DEFAULT now(),
  overridden_by    uuid,
  override_reason  text,
  UNIQUE (tenant_id, id),
  CHECK ((overridden_by IS NULL) = (override_reason IS NULL)),
  CHECK (override_reason IS NULL OR length(btrim(override_reason)) >= 10),
  CHECK (rule_version_ref IS NOT NULL OR evaluated_by IS NOT NULL),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES examinations.candidates (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.eligibility_checks');
CREATE INDEX eligibility_checks_by_candidate ON examinations.eligibility_checks (tenant_id, candidate_id, evaluated_at DESC);
GRANT SELECT, INSERT ON examinations.eligibility_checks TO app_user;
CREATE TRIGGER eligibility_checks_append_only BEFORE UPDATE OR DELETE ON examinations.eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

-- Pièces des candidats
CREATE TABLE examinations.candidate_documents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  candidate_id    uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  status          text NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  document_ref    uuid,
  storage_key     text,
  rejection_reason text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, requirement_id),
  CHECK (status = 'MISSING' OR document_ref IS NOT NULL OR storage_key IS NOT NULL),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) > 0),
  CHECK (status NOT IN ('ACCEPTED', 'REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES examinations.candidates (tenant_id, id),
  FOREIGN KEY (tenant_id, requirement_id) REFERENCES examinations.document_requirements (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_documents');
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_documents TO app_user;

CREATE FUNCTION examinations.missing_required_documents(p_candidate uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(r.code ORDER BY r.sort_order, r.code), ARRAY[]::text[])
    FROM examinations.candidates c
    JOIN examinations.sessions s ON s.tenant_id = c.tenant_id AND s.id = c.session_id
    JOIN examinations.document_requirements r
      ON r.tenant_id = c.tenant_id AND r.exam_type_id = s.exam_type_id AND r.required AND r.active
    LEFT JOIN examinations.candidate_documents d
      ON d.tenant_id = c.tenant_id AND d.candidate_id = c.id AND d.requirement_id = r.id
   WHERE c.tenant_id = kernel.current_tenant_id() AND c.id = p_candidate
     AND (d.id IS NULL OR d.status <> 'ACCEPTED')
$$;
GRANT EXECUTE ON FUNCTION examinations.missing_required_documents(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Centres de la session et affectations (centre, salle, place)
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.session_centers (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id   uuid NOT NULL,
  center_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id, center_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, center_id) REFERENCES examinations.centers (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.session_centers');
GRANT SELECT, INSERT, DELETE ON examinations.session_centers TO app_user;

CREATE TABLE examinations.seat_assignments (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  center_id     uuid NOT NULL,
  room_id       uuid NOT NULL,
  seat_number   integer NOT NULL CHECK (seat_number >= 1),
  table_number  text,
  assigned_by   uuid,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, candidate_id),                 -- un candidat, une place par session
  UNIQUE (tenant_id, session_id, room_id, seat_number),         -- une place, un candidat
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id, center_id) REFERENCES examinations.session_centers (tenant_id, session_id, center_id),
  FOREIGN KEY (tenant_id, center_id, room_id) REFERENCES examinations.rooms (tenant_id, center_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.seat_assignments');
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.seat_assignments TO app_user;

CREATE FUNCTION examinations.seat_assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cap integer;
  v_status text;
  v_cand_status text;
  v_session_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_session_status FROM examinations.sessions s WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.session_id;
    IF v_session_status IN ('IN_PROGRESS', 'RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'examinations.assignment_frozen: la répartition est figée (session %)', v_session_status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO v_session_status FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  IF v_session_status IN ('IN_PROGRESS', 'RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'examinations.assignment_frozen: la répartition est figée (session %)', v_session_status USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT registration_status INTO v_cand_status FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_cand_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit une place (statut %)', v_cand_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT capacity, CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END INTO v_cap, v_status
    FROM examinations.rooms r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.room_id;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'examinations.room_inactive: la salle est désactivée' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.seat_number > v_cap THEN
    RAISE EXCEPTION 'examinations.seat_beyond_capacity: la place % dépasse la capacité de la salle (%)', NEW.seat_number, v_cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER seat_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.seat_assignments
  FOR EACH ROW EXECUTE FUNCTION examinations.seat_assignments_guard();

-- -----------------------------------------------------------------------------
-- Historique du candidat : ajout seul, alimenté automatiquement
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.candidate_history (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  candidate_id  uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('CREATED', 'STATUS', 'ELIGIBILITY', 'OUTCOME', 'ASSIGNMENT', 'NOTE')),
  from_value    text,
  to_value      text,
  reason        text,
  actor_id      uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES examinations.candidates (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_history');
CREATE INDEX candidate_history_by_candidate ON examinations.candidate_history (tenant_id, candidate_id, occurred_at);
GRANT SELECT, INSERT ON examinations.candidate_history TO app_user;
CREATE TRIGGER candidate_history_append_only BEFORE UPDATE OR DELETE ON examinations.candidate_history
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

-- =============================================================================
-- Gardes : session
-- =============================================================================
CREATE FUNCTION examinations.sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_missing integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.definition_locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'examinations.session_initial_state: une session naît PLANNED, définition non figée' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mock_of_session_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM examinations.sessions o WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.mock_of_session_id
            AND o.exam_type_id = NEW.exam_type_id AND o.session_kind = 'OFFICIAL') THEN
      RAISE EXCEPTION 'examinations.mock_target_invalid: un examen blanc prépare une session OFFICIELLE du même type' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.exam_type_id <> OLD.exam_type_id OR NEW.institution_id <> OLD.institution_id OR NEW.session_kind <> OLD.session_kind
     OR NEW.session_year <> OLD.session_year OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'examinations.session_identity_immutable: type, établissement, nature, année et code sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.definition_locked_at IS NOT NULL AND NEW.definition_locked_at IS DISTINCT FROM OLD.definition_locked_at THEN
    RAISE EXCEPTION 'examinations.definition_locked: la date de gel est inaltérable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'examinations.session_archived: une session archivée est figée' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'PLANNED'             AND NEW.status = 'REGISTRATION_OPEN') OR
      (OLD.status = 'REGISTRATION_OPEN'   AND NEW.status = 'REGISTRATION_CLOSED') OR
      (OLD.status = 'REGISTRATION_CLOSED' AND NEW.status IN ('REGISTRATION_OPEN', 'IN_PROGRESS')) OR
      (OLD.status = 'IN_PROGRESS'         AND NEW.status = 'RESULTS_ENTERED') OR
      (OLD.status = 'RESULTS_ENTERED'     AND NEW.status IN ('IN_PROGRESS', 'PUBLISHED')) OR
      (OLD.status = 'PUBLISHED'           AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'examinations.session_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'REGISTRATION_OPEN' AND NEW.definition_locked_at IS NULL THEN
      RAISE EXCEPTION 'examinations.definition_not_locked: figer la définition (épreuves, séries) avant d''ouvrir les inscriptions' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' THEN
      SELECT count(*) INTO v_missing
        FROM examinations.candidates c
       WHERE c.tenant_id = NEW.tenant_id AND c.session_id = NEW.id AND c.registration_status = 'REGISTERED'
         AND NOT EXISTS (SELECT 1 FROM examinations.candidate_results r WHERE r.tenant_id = c.tenant_id AND r.candidate_id = c.id);
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'examinations.results_incomplete: % candidat(s) inscrit(s) sans résultat', v_missing USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
-- (le déclencheur est créé en 2002, une fois `candidate_results` définie)

-- =============================================================================
-- Gardes : candidat
-- =============================================================================
CREATE FUNCTION examinations.candidates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_s     examinations.sessions%ROWTYPE;
  v_type  examinations.exam_types%ROWTYPE;
  v_miss  text[];
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  IF NEW.institution_id <> v_s.institution_id THEN
    RAISE EXCEPTION 'examinations.candidate_institution: le candidat doit appartenir à l''établissement de la session' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_s.status NOT IN ('PLANNED', 'REGISTRATION_OPEN') THEN
      RAISE EXCEPTION 'examinations.session_registration_closed: la session est % ; plus de nouveau candidat', v_s.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.registration_status <> 'DRAFT' OR NEW.candidate_number IS NOT NULL OR NEW.outcome <> 'PENDING' THEN
      RAISE EXCEPTION 'examinations.candidate_initial_state: un candidat naît DRAFT, sans numéro ni résultat' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.session_id <> OLD.session_id OR NEW.student_id <> OLD.student_id OR NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'examinations.candidate_identity_immutable: session, élève et établissement sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.candidate_number IS NOT NULL AND (NEW.candidate_number IS DISTINCT FROM OLD.candidate_number OR NEW.candidate_seq IS DISTINCT FROM OLD.candidate_seq) THEN
    RAISE EXCEPTION 'examinations.candidate_number_immutable: le numéro de candidat ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.outcome <> OLD.outcome AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'examinations.outcome_derived: l''issue d''un candidat est dérivée de son résultat (saisir le résultat)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.eligibility_status <> OLD.eligibility_status AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'examinations.eligibility_derived: le statut d''éligibilité est dérivé du journal des évaluations' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.registration_status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'examinations.candidate_withdrawn: un candidat retiré ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  -- après inscription, l'identité figée ne change plus
  IF OLD.registration_status = 'REGISTERED' AND (NEW.last_name IS DISTINCT FROM OLD.last_name OR NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.birth_date IS DISTINCT FROM OLD.birth_date OR NEW.sex IS DISTINCT FROM OLD.sex OR NEW.birth_place IS DISTINCT FROM OLD.birth_place
       OR NEW.track_code IS DISTINCT FROM OLD.track_code) THEN
    RAISE EXCEPTION 'examinations.candidate_snapshot_frozen: l''identité et la série d''un candidat inscrit sont figées' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.registration_status <> OLD.registration_status THEN
    IF NOT (
      (OLD.registration_status = 'DRAFT'          AND NEW.registration_status IN ('PRE_REGISTERED', 'REGISTERED', 'WITHDRAWN')) OR
      (OLD.registration_status = 'PRE_REGISTERED' AND NEW.registration_status IN ('REGISTERED', 'WITHDRAWN')) OR
      (OLD.registration_status = 'REGISTERED'     AND NEW.registration_status = 'WITHDRAWN')) THEN
      RAISE EXCEPTION 'examinations.candidate_transition: % -> % interdit', OLD.registration_status, NEW.registration_status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.registration_status = 'REGISTERED' THEN
      IF v_s.status <> 'REGISTRATION_OPEN' THEN
        RAISE EXCEPTION 'examinations.session_registration_closed: les inscriptions ne sont pas ouvertes (session %)', v_s.status USING ERRCODE = 'check_violation';
      END IF;
      SELECT * INTO v_type FROM examinations.exam_types t WHERE t.tenant_id = v_s.tenant_id AND t.id = v_s.exam_type_id;
      IF v_s.session_kind = 'OFFICIAL' THEN
        IF NEW.eligibility_status <> 'ELIGIBLE' THEN
          RAISE EXCEPTION 'examinations.not_eligible: l''éligibilité doit être établie avant l''inscription (statut %)', NEW.eligibility_status USING ERRCODE = 'check_violation';
        END IF;
        v_miss := examinations.missing_required_documents(NEW.id);
        IF cardinality(v_miss) > 0 THEN
          RAISE EXCEPTION 'examinations.documents_incomplete: pièces non acceptées : %', array_to_string(v_miss, ', ') USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.candidate_seq IS NULL THEN
        NEW.candidate_seq := examinations.next_number('cand:' || NEW.session_id::text);
        NEW.candidate_number := examinations.format_number(v_type.candidate_number_pattern, v_type.code, v_s.session_year, NEW.candidate_seq);
      END IF;
      NEW.registered_at := coalesce(NEW.registered_at, now());
      NEW.snapshot_taken_at := coalesce(NEW.snapshot_taken_at, now());
    END IF;
    IF NEW.registration_status = 'WITHDRAWN' THEN
      IF v_s.status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
        RAISE EXCEPTION 'examinations.withdraw_after_results: retrait impossible une fois les résultats saisis' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.withdrawn_at := coalesce(NEW.withdrawn_at, now());
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER candidates_guard BEFORE INSERT OR UPDATE ON examinations.candidates
  FOR EACH ROW EXECUTE FUNCTION examinations.candidates_guard();

-- Historique automatique (création, statut, éligibilité, issue)
CREATE FUNCTION examinations.candidates_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, to_value, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED', NEW.registration_status, kernel.current_user_id());
    RETURN NULL;
  END IF;
  IF NEW.registration_status <> OLD.registration_status THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, reason, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'STATUS', OLD.registration_status, NEW.registration_status, NEW.withdrawn_reason, kernel.current_user_id());
  END IF;
  IF NEW.eligibility_status <> OLD.eligibility_status THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'ELIGIBILITY', OLD.eligibility_status, NEW.eligibility_status, kernel.current_user_id());
  END IF;
  IF NEW.outcome <> OLD.outcome THEN
    INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, from_value, to_value, actor_id)
      VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'OUTCOME', OLD.outcome, NEW.outcome, kernel.current_user_id());
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER candidates_log AFTER INSERT OR UPDATE ON examinations.candidates
  FOR EACH ROW EXECUTE FUNCTION examinations.candidates_log();

-- L'éligibilité d'un candidat reflète sa DERNIÈRE évaluation (une dérogation motivée vaut ELIGIBLE).
CREATE FUNCTION examinations.eligibility_checks_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE examinations.candidates
     SET eligibility_status = CASE WHEN NEW.overridden_by IS NOT NULL THEN 'ELIGIBLE' ELSE NEW.result END
   WHERE tenant_id = NEW.tenant_id AND id = NEW.candidate_id;
  RETURN NULL;
END
$$;
CREATE TRIGGER eligibility_checks_apply AFTER INSERT ON examinations.eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION examinations.eligibility_checks_apply();
