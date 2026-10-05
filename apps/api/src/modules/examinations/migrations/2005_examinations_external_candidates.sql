-- =============================================================================
-- 2005 — Module examinations : CANDIDAT LIBRE (décision métier Q-E15)
-- =============================================================================
--
-- Un candidat libre est inscrit à une session SANS dossier élève de l'établissement (`people`) : identité saisie ou importée.
-- Additif : aucune migration existante n'est modifiée ; les candidats-élèves gardent exactement leur comportement.
--
--   * `candidates.student_id` devient NULLABLE ; `candidate_kind` ('STUDENT' | 'EXTERNAL') dit de quel régime relève la ligne
--     (CHECK : élève <=> `student_id` renseigné). L'identité (nom, prénoms, naissance, sexe) est posée dès la création d'un libre
--     et figée à l'inscription comme pour un élève ; le numéro interne (`CEPE2027-00001`) vient du MÊME compteur sans trou
--     par session ; le numéro officiel importé reste un `candidate_identifiers`.
--   * MINIMISATION : les coordonnées, la pièce d'identité et le tuteur vivent dans `external_candidate_profiles`, table à part,
--     lue par une permission dédiée ; l'ANONYMISATION (`anonymize_external_candidate`) efface ces données et dégrade l'identité
--     (nom neutre, année de naissance seule) en conservant numéro, résultat et historique.
--   * ÉLIGIBILITÉ : les faits d'un libre (classe d'examen déclarée, tentatives déclarées) sont SAISIS ; la règle ne change pas.
--   * PIÈCES : un libre n'a pas de GED d'élève ; une pièce peut être « vue sur place » (`presentation_kind = 'SIGHTED'`).
--   * Un libre n'existe que dans une session OFFICIELLE (un examen blanc s'appuie sur des notes d'élèves d'`assess`).
-- =============================================================================

ALTER TABLE examinations.candidates ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE examinations.candidates ADD COLUMN candidate_kind text NOT NULL DEFAULT 'STUDENT' CHECK (candidate_kind IN ('STUDENT', 'EXTERNAL'));
ALTER TABLE examinations.candidates ADD COLUMN anonymized_at timestamptz;
ALTER TABLE examinations.candidates ADD CONSTRAINT candidates_kind_student CHECK ((candidate_kind = 'STUDENT') = (student_id IS NOT NULL));
ALTER TABLE examinations.candidates ADD CONSTRAINT candidates_external_identity CHECK (
  candidate_kind <> 'EXTERNAL' OR (last_name IS NOT NULL AND first_name IS NOT NULL AND birth_date IS NOT NULL AND sex IS NOT NULL AND enrollment_id IS NULL));
ALTER TABLE examinations.candidates ADD CONSTRAINT candidates_anonymized_external CHECK (anonymized_at IS NULL OR candidate_kind = 'EXTERNAL');

-- Un libre vivant ne peut pas être saisi deux fois (même nom, mêmes prénoms, même naissance) dans une session.
CREATE UNIQUE INDEX candidates_one_live_external
  ON examinations.candidates (tenant_id, session_id, lower(btrim(last_name)), lower(btrim(first_name)), birth_date)
  WHERE candidate_kind = 'EXTERNAL' AND registration_status <> 'WITHDRAWN' AND anonymized_at IS NULL;

-- -----------------------------------------------------------------------------
-- Profil du candidat libre : données personnelles RESTREINTES (lecture par permission dédiée, audit des lectures)
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.external_candidate_profiles (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id              uuid NOT NULL,
  candidate_id            uuid NOT NULL,
  contact_phone           text CHECK (contact_phone IS NULL OR length(btrim(contact_phone)) BETWEEN 4 AND 40),
  contact_email           text CHECK (contact_email IS NULL OR (length(btrim(contact_email)) BETWEEN 3 AND 200 AND contact_email LIKE '%@%')),
  address_line            text CHECK (address_line IS NULL OR length(btrim(address_line)) BETWEEN 1 AND 300),
  id_piece_kind           text CHECK (id_piece_kind IS NULL OR id_piece_kind ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  id_piece_number         text CHECK (id_piece_number IS NULL OR length(btrim(id_piece_number)) BETWEEN 1 AND 60),
  guardian_name           text CHECK (guardian_name IS NULL OR length(btrim(guardian_name)) BETWEEN 1 AND 200),
  guardian_relation       text CHECK (guardian_relation IS NULL OR length(btrim(guardian_relation)) BETWEEN 1 AND 60),
  guardian_phone          text CHECK (guardian_phone IS NULL OR length(btrim(guardian_phone)) BETWEEN 4 AND 40),
  guardian_email          text CHECK (guardian_email IS NULL OR (length(btrim(guardian_email)) BETWEEN 3 AND 200 AND guardian_email LIKE '%@%')),
  -- faits d'éligibilité FOURNIS PAR SAISIE (pas de dossier scolaire) : la règle les consomme telles quelles
  declared_in_exam_grade  boolean NOT NULL,
  declared_prior_attempts integer NOT NULL DEFAULT 0 CHECK (declared_prior_attempts BETWEEN 0 AND 50),
  data_source             text NOT NULL DEFAULT 'ENTERED' CHECK (data_source IN ('ENTERED', 'IMPORTED')),
  entered_by              uuid,
  anonymized_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id),
  CHECK ((id_piece_kind IS NULL) = (id_piece_number IS NULL)),
  -- joignable : au moins un moyen de contact (sauf après anonymisation)
  CHECK (anonymized_at IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL OR guardian_phone IS NOT NULL OR guardian_email IS NOT NULL),
  CHECK (anonymized_at IS NULL OR (contact_phone IS NULL AND contact_email IS NULL AND address_line IS NULL AND id_piece_kind IS NULL AND id_piece_number IS NULL
                                   AND guardian_name IS NULL AND guardian_relation IS NULL AND guardian_phone IS NULL AND guardian_email IS NULL)),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.external_candidate_profiles');
-- Une même pièce d'identité ne désigne qu'un seul candidat libre par session.
CREATE UNIQUE INDEX external_candidate_profiles_piece
  ON examinations.external_candidate_profiles (tenant_id, session_id, id_piece_kind, id_piece_number) WHERE id_piece_number IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON examinations.external_candidate_profiles TO app_user;

CREATE FUNCTION examinations.external_profiles_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT candidate_kind INTO v_kind FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
    IF v_kind IS DISTINCT FROM 'EXTERNAL' THEN
      RAISE EXCEPTION 'examinations.external_only: un profil de candidat libre ne se rattache qu''à un candidat libre' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id THEN
    RAISE EXCEPTION 'examinations.candidate_identity_immutable: le rattachement du profil est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.candidate_anonymized: un profil anonymisé ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER external_profiles_guard BEFORE INSERT OR UPDATE ON examinations.external_candidate_profiles
  FOR EACH ROW EXECUTE FUNCTION examinations.external_profiles_guard();

-- -----------------------------------------------------------------------------
-- Pièces : « vue sur place » pour un candidat libre (aucun document de la GED d'un élève)
-- -----------------------------------------------------------------------------
ALTER TABLE examinations.candidate_documents ADD COLUMN presentation_kind text NOT NULL DEFAULT 'DOCUMENT' CHECK (presentation_kind IN ('DOCUMENT', 'SIGHTED'));
ALTER TABLE examinations.candidate_documents ADD COLUMN sighted_note text CHECK (sighted_note IS NULL OR length(btrim(sighted_note)) BETWEEN 1 AND 300);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'examinations.candidate_documents'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%storage_key IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE examinations.candidate_documents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;
ALTER TABLE examinations.candidate_documents ADD CONSTRAINT candidate_documents_has_proof
  CHECK (status = 'MISSING' OR document_ref IS NOT NULL OR storage_key IS NOT NULL OR presentation_kind = 'SIGHTED');
ALTER TABLE examinations.candidate_documents ADD CONSTRAINT candidate_documents_sighted_shape
  CHECK (presentation_kind = 'DOCUMENT' OR (status <> 'MISSING' AND document_ref IS NULL AND storage_key IS NULL));

-- -----------------------------------------------------------------------------
-- Garde du candidat : version 2 (CREATE OR REPLACE ; le déclencheur existant la rappelle)
--   * `student_id` peut être NULL (comparaisons IS DISTINCT FROM) ; le régime d'un candidat ne change jamais ;
--   * un libre n'existe que dans une session OFFICIELLE ;
--   * l'ANONYMISATION (anonymized_at NULL -> renseigné, libre seulement) est la seule modification de l'identité figée permise,
--     y compris pour un candidat retiré ; ensuite l'identité ne change plus.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION examinations.candidates_guard() RETURNS trigger
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
    IF NEW.registration_status <> 'DRAFT' OR NEW.candidate_number IS NOT NULL OR NEW.outcome <> 'PENDING' OR NEW.anonymized_at IS NOT NULL THEN
      RAISE EXCEPTION 'examinations.candidate_initial_state: un candidat naît DRAFT, sans numéro ni résultat' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.candidate_kind = 'EXTERNAL' AND v_s.session_kind <> 'OFFICIAL' THEN
      RAISE EXCEPTION 'examinations.external_official_only: un candidat libre n''existe que dans une session officielle' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.session_id <> OLD.session_id OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.institution_id <> OLD.institution_id
     OR NEW.candidate_kind <> OLD.candidate_kind THEN
    RAISE EXCEPTION 'examinations.candidate_identity_immutable: session, élève et établissement sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.candidate_number IS NOT NULL AND (NEW.candidate_number IS DISTINCT FROM OLD.candidate_number OR NEW.candidate_seq IS DISTINCT FROM OLD.candidate_seq) THEN
    RAISE EXCEPTION 'examinations.candidate_number_immutable: le numéro de candidat ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;

  -- Anonymisation : seule opération autorisée sur l'identité d'un candidat libre déjà inscrit ou retiré.
  IF OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL THEN
    IF OLD.candidate_kind <> 'EXTERNAL' THEN
      RAISE EXCEPTION 'examinations.external_only: seul un candidat libre s''anonymise ici' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.registration_status <> OLD.registration_status OR NEW.outcome <> OLD.outcome OR NEW.eligibility_status <> OLD.eligibility_status THEN
      RAISE EXCEPTION 'examinations.candidate_anonymized: l''anonymisation ne change ni statut, ni issue, ni éligibilité' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.anonymized_at IS NOT NULL AND (NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at OR NEW.last_name IS DISTINCT FROM OLD.last_name
       OR NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.birth_date IS DISTINCT FROM OLD.birth_date OR NEW.birth_place IS DISTINCT FROM OLD.birth_place
       OR NEW.sex IS DISTINCT FROM OLD.sex) THEN
    RAISE EXCEPTION 'examinations.candidate_anonymized: un candidat anonymisé ne change plus d''identité' USING ERRCODE = 'restrict_violation';
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

-- -----------------------------------------------------------------------------
-- Anonymisation d'un candidat libre (droit à l'effacement) : irréversible, motif obligatoire.
-- Efface profil et identifiants personnels ; l'identité devient neutre (année de naissance seule) ; numéro, résultat, historique restent.
-- -----------------------------------------------------------------------------
CREATE FUNCTION examinations.anonymize_external_candidate(p_candidate uuid, p_reason text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_c examinations.candidates%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = kernel.current_tenant_id() AND c.id = p_candidate FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'examinations.candidate_not_found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_c.candidate_kind <> 'EXTERNAL' THEN
    RAISE EXCEPTION 'examinations.external_only: seul un candidat libre s''anonymise ici' USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'examinations.candidate_anonymized: ce candidat est déjà anonymisé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'examinations.invalid_input: le motif d''une anonymisation compte au moins 10 caractères' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE examinations.external_candidate_profiles
     SET contact_phone = NULL, contact_email = NULL, address_line = NULL, id_piece_kind = NULL, id_piece_number = NULL,
         guardian_name = NULL, guardian_relation = NULL, guardian_phone = NULL, guardian_email = NULL, anonymized_at = now()
   WHERE tenant_id = v_c.tenant_id AND candidate_id = v_c.id;
  -- le numéro officiel (attribué par l'autorité) reste ; tout autre identifiant (pièce nationale, code) est rendu neutre
  UPDATE examinations.candidate_identifiers
     SET value = 'ANONYME-' || left(id::text, 8)
   WHERE tenant_id = v_c.tenant_id AND candidate_id = v_c.id AND kind <> 'OFFICIAL_NUMBER';
  UPDATE examinations.candidates
     SET last_name = 'ANONYME', first_name = 'ANONYME', birth_place = NULL,
         birth_date = make_date(extract(year FROM birth_date)::int, 1, 1), anonymized_at = now()
   WHERE tenant_id = v_c.tenant_id AND id = v_c.id;
  INSERT INTO examinations.candidate_history (id, tenant_id, candidate_id, kind, reason, actor_id)
    VALUES (gen_random_uuid(), v_c.tenant_id, v_c.id, 'NOTE', 'Anonymisation : ' || btrim(p_reason), kernel.current_user_id());
END
$$;
GRANT EXECUTE ON FUNCTION examinations.anonymize_external_candidate(uuid, text) TO app_user;
