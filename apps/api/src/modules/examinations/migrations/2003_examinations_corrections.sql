-- =============================================================================
-- 2003 — Module examinations : demandes de révision (quatre yeux) et correction après publication
-- =============================================================================
--
-- Deux ajouts au DDL de référence (2000–2002), motivés par l'implémentation :
--
--   1. `revision_requests` : une correction après résultats est DEMANDÉE par une personne puis APPROUVÉE par une autre.
--      Le DDL de référence ne portait que la révision appliquée (`score_revisions`, `result_revisions`,
--      approbateur <> demandeur) ; sans file d'attente, une seule personne pouvait jouer les deux rôles en
--      passant deux identifiants dans la requête. La demande est un enregistrement distinct, l'approbation
--      l'applique dans UNE transaction (révision + correction) ; l'approbateur est l'utilisateur authentifié.
--
--   2. `candidate_results_guard` : le DDL de référence refusait toute écriture de résultat dès que la session était
--      PUBLISHED, ce qui rendait impossible la correction d'un résultat déjà publié (R-EXA-08 : « seule la
--      révision le corrige », cas limite « correction d'un résultat déjà transmis »). Un résultat PUBLISHED peut
--      désormais être corrigé par révision tant que la session n'est pas ARCHIVED ; les créations et les
--      résultats non publiés restent limités aux sessions IN_PROGRESS / RESULTS_ENTERED.
--
--   3. `valid_export_columns` : la liste blanche gagne les champs `stat.*` (compteurs d'une statistique). Le DDL de référence
--      prévoyait des exports de nature STATISTICS sans champ exploitable.
-- =============================================================================

CREATE TABLE examinations.revision_requests (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  target_kind   text NOT NULL CHECK (target_kind IN ('SCORE', 'RESULT')),
  score_id      uuid,
  result_id     uuid,
  proposed      jsonb NOT NULL CHECK (jsonb_typeof(proposed) = 'object'),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  revision_id   uuid,                                   -- score_revisions.id / result_revisions.id appliquée à l'approbation
  UNIQUE (tenant_id, id),
  CHECK ((target_kind = 'SCORE') = (score_id IS NOT NULL)),
  CHECK ((target_kind = 'RESULT') = (result_id IS NOT NULL)),
  CHECK (status = 'PENDING' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (status <> 'APPROVED' OR revision_id IS NOT NULL),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(decision_note, ''))) >= 5),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, score_id) REFERENCES examinations.paper_scores (tenant_id, id),
  FOREIGN KEY (tenant_id, result_id) REFERENCES examinations.candidate_results (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.revision_requests');
CREATE INDEX revision_requests_by_session ON examinations.revision_requests (tenant_id, session_id, status, requested_at DESC);
-- Une seule demande en attente par cible : pas de demandes concurrentes sur la même note ou le même résultat.
CREATE UNIQUE INDEX revision_requests_one_pending_score ON examinations.revision_requests (tenant_id, score_id) WHERE status = 'PENDING' AND score_id IS NOT NULL;
CREATE UNIQUE INDEX revision_requests_one_pending_result ON examinations.revision_requests (tenant_id, result_id) WHERE status = 'PENDING' AND result_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON examinations.revision_requests TO app_user;

CREATE FUNCTION examinations.revision_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_res_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'examinations.revision_request_initial_state: une demande naît PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_kind = 'SCORE' AND v_status <> 'RESULTS_ENTERED' THEN
      RAISE EXCEPTION 'examinations.revision_not_needed: une note ne se corrige par révision que session à résultats saisis (session %)', v_status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_kind = 'RESULT' THEN
      SELECT r.status INTO v_res_status FROM examinations.candidate_results r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.result_id;
      IF v_res_status IS DISTINCT FROM 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.revision_not_needed: un résultat non publié se saisit directement' USING ERRCODE = 'check_violation';
      END IF;
      IF v_status NOT IN ('RESULTS_ENTERED', 'PUBLISHED') THEN
        RAISE EXCEPTION 'examinations.revision_not_needed: session % ', v_status USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'examinations.revision_request_closed: une demande % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.session_id <> OLD.session_id OR NEW.target_kind <> OLD.target_kind OR NEW.score_id IS DISTINCT FROM OLD.score_id
     OR NEW.result_id IS DISTINCT FROM OLD.result_id OR NEW.proposed IS DISTINCT FROM OLD.proposed OR NEW.reason <> OLD.reason
     OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'examinations.revision_request_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER revision_requests_guard BEFORE INSERT OR UPDATE ON examinations.revision_requests
  FOR EACH ROW EXECUTE FUNCTION examinations.revision_requests_guard();

-- Liste blanche des champs d'export : ajout des COMPTEURS de statistiques (`stat.*`). Le DDL de référence déclarait des exports de
-- nature STATISTICS sans aucun champ utilisable ; ces champs sont des agrégats (jamais d'identité).
CREATE OR REPLACE FUNCTION examinations.valid_export_columns(p_columns jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_columns) = 'array'
     AND jsonb_array_length(p_columns) BETWEEN 1 AND 60
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_columns) c
        WHERE jsonb_typeof(c) <> 'object'
           OR coalesce(c ->> 'header', '') = ''
           OR length(c ->> 'header') > 80
           OR coalesce(c ->> 'source', '') NOT IN (
                'candidate.number', 'candidate.official_number', 'candidate.last_name', 'candidate.first_name', 'candidate.birth_date',
                'candidate.birth_place', 'candidate.sex', 'candidate.track', 'candidate.grade_level', 'candidate.institution',
                'candidate.status', 'candidate.identifier.cepe_code', 'candidate.identifier.national_id',
                'assignment.center_code', 'assignment.center_name', 'assignment.room_code', 'assignment.seat_number', 'assignment.table_number',
                'result.code', 'result.average', 'result.rank', 'result.mention', 'result.total_points',
                'paper.score',
                'stat.group', 'stat.registered', 'stat.present', 'stat.admitted', 'stat.failed', 'stat.absent', 'stat.excluded', 'stat.deferred', 'stat.rate',
                'constant')
           OR (c ->> 'source' LIKE 'paper.%' AND coalesce(c ->> 'paper', '') = '')
           OR coalesce(c ->> 'transform', 'none') NOT IN ('none', 'upper', 'lower', 'date_iso', 'date_dmy', 'sex_fm', 'decimal_comma', 'pad_left_8'))
$$;

-- Garde des résultats : correction par révision d'un résultat PUBLISHED, y compris session PUBLISHED.
CREATE OR REPLACE FUNCTION examinations.candidate_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_s examinations.sessions%ROWTYPE;
  v_c examinations.candidates%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
  SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_c.registration_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit un résultat' USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.status NOT IN ('IN_PROGRESS', 'RESULTS_ENTERED')
     AND NOT (TG_OP = 'UPDATE' AND v_s.status = 'PUBLISHED' AND OLD.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'examinations.results_closed: la saisie des résultats exige une session en cours ou à résultats saisis (session %)', v_s.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.session_kind = 'OFFICIAL' AND NEW.source = 'COMPUTED' THEN
    RAISE EXCEPTION 'examinations.official_not_computed: l''admission officielle est prononcée par l''autorité (import ou saisie), jamais calculée ici' USING ERRCODE = 'check_violation';
  END IF;
  IF v_s.session_kind = 'MOCK' AND NEW.source = 'IMPORTED' THEN
    RAISE EXCEPTION 'examinations.mock_not_imported: les résultats d''un examen blanc sont calculés, jamais importés' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id THEN
      RAISE EXCEPTION 'examinations.result_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
      -- un résultat publié ne bouge que par une révision de la même transaction
      IF NEW.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.result_published: un résultat publié ne se dépublie pas (réviser)' USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.result_code <> OLD.result_code OR NEW.average IS DISTINCT FROM OLD.average OR NEW.rank IS DISTINCT FROM OLD.rank
         OR NEW.mention_code IS DISTINCT FROM OLD.mention_code OR NEW.total_points IS DISTINCT FROM OLD.total_points THEN
        IF NOT EXISTS (SELECT 1 FROM examinations.result_revisions r
                        WHERE r.tenant_id = OLD.tenant_id AND r.result_id = OLD.id AND r.xid = txid_current()
                          AND r.from_code = OLD.result_code AND r.to_code = NEW.result_code
                          AND r.from_average IS NOT DISTINCT FROM OLD.average AND r.to_average IS NOT DISTINCT FROM NEW.average) THEN
          RAISE EXCEPTION 'examinations.result_revision_required: un résultat publié ne se corrige que par une révision approuvée' USING ERRCODE = 'restrict_violation';
        END IF;
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  ELSE
    IF NEW.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'examinations.result_initial_state: un résultat naît DRAFT (publication = étape distincte)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
