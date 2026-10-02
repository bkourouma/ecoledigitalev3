-- =============================================================================
-- 2002 — Module examinations : notes d'épreuves, résultats, imports, exports, documents, statistiques
-- =============================================================================
--
-- Deux régimes de résultats, un seul modèle :
--   - session OFFICIELLE : les résultats viennent de l'autorité (import d'un fichier ou saisie) ; l'admission
--     est celle que l'autorité prononce (`source` IMPORTED / ENTERED). Le module ne recalcule rien.
--   - session BLANCHE (examen blanc) : les notes viennent d'`assess` (`source = ASSESS`) ou de la saisie ; la
--     moyenne et l'issue sont calculées par `rules` (contrat `exam-national@1`), avec version de règle et
--     empreinte d'entrées (`source = COMPUTED`).
-- Une note ou un résultat PUBLIÉ ne se corrige que par une RÉVISION tracée insérée dans la même transaction.
-- =============================================================================

CREATE TABLE examinations.paper_scores (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  paper_id      uuid NOT NULL,
  status        text NOT NULL DEFAULT 'ENTERED' CHECK (status IN ('ENTERED', 'ABSENT', 'EXCUSED', 'MALPRACTICE')),
  score         numeric(6, 2) CHECK (score IS NULL OR score >= 0),
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'ASSESS')),
  source_ref    uuid,                                           -- lot d'import, ou évaluation assess (examen blanc)
  entered_by    uuid,
  verified_by   uuid,                                           -- seconde saisie / contrôle
  row_version   integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, paper_id),
  CHECK ((status = 'ENTERED') = (score IS NOT NULL)),
  CHECK (source = 'MANUAL' OR source_ref IS NOT NULL),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id, paper_id) REFERENCES examinations.session_papers (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.paper_scores');
CREATE INDEX paper_scores_by_session ON examinations.paper_scores (tenant_id, session_id, paper_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON examinations.paper_scores TO app_user;   -- DELETE : avant la saisie des résultats (garde)

CREATE TABLE examinations.score_revisions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  score_id      uuid NOT NULL,
  from_status   text NOT NULL,
  from_score    numeric(6, 2),
  to_status     text NOT NULL,
  to_score      numeric(6, 2),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by  uuid NOT NULL,
  approved_by   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  xid           bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (approved_by <> requested_by),
  CHECK (from_status <> to_status OR from_score IS DISTINCT FROM to_score),
  FOREIGN KEY (tenant_id, score_id) REFERENCES examinations.paper_scores (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.score_revisions');
GRANT SELECT, INSERT ON examinations.score_revisions TO app_user;
CREATE TRIGGER score_revisions_append_only BEFORE UPDATE OR DELETE ON examinations.score_revisions
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

CREATE FUNCTION examinations.paper_scores_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_cand   examinations.candidates%ROWTYPE;
  v_max    numeric;
  v_sess   uuid;
  v_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_sess := OLD.session_id; v_tenant := OLD.tenant_id;
  ELSE v_sess := NEW.session_id; v_tenant := NEW.tenant_id; END IF;
  SELECT status INTO v_status FROM examinations.sessions s WHERE s.tenant_id = v_tenant AND s.id = v_sess;

  IF TG_OP = 'DELETE' THEN
    IF v_status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'examinations.scores_frozen: les notes ne se suppriment plus (session %)', v_status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_cand FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
  IF v_cand.registration_status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'examinations.candidate_not_registered: seul un candidat inscrit reçoit des notes (statut %)', v_cand.registration_status USING ERRCODE = 'check_violation';
  END IF;
  IF v_status NOT IN ('IN_PROGRESS', 'RESULTS_ENTERED') THEN
    RAISE EXCEPTION 'examinations.scores_closed: la saisie des notes n''est ouverte que session en cours ou résultats saisis (session %)', v_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT scale_max INTO v_max FROM examinations.session_papers p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.paper_id;
  IF NEW.score IS NOT NULL AND NEW.score > v_max THEN
    RAISE EXCEPTION 'examinations.score_above_scale: la note % dépasse le barème % de l''épreuve', NEW.score, v_max USING ERRCODE = 'check_violation';
  END IF;
  -- les candidats d'un examen blanc / officiel : la série du candidat doit couvrir l'épreuve
  IF EXISTS (SELECT 1 FROM examinations.session_papers p WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.paper_id
               AND p.track_code IS NOT NULL AND p.track_code IS DISTINCT FROM v_cand.track_code) THEN
    RAISE EXCEPTION 'examinations.paper_not_for_track: cette épreuve ne concerne pas la série du candidat' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id <> OLD.candidate_id OR NEW.paper_id <> OLD.paper_id OR NEW.session_id <> OLD.session_id THEN
      RAISE EXCEPTION 'examinations.score_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    -- une fois les résultats saisis, toute correction passe par une révision de la même transaction
    IF v_status = 'RESULTS_ENTERED' AND (NEW.score IS DISTINCT FROM OLD.score OR NEW.status <> OLD.status) THEN
      IF NOT EXISTS (SELECT 1 FROM examinations.score_revisions r
                      WHERE r.tenant_id = OLD.tenant_id AND r.score_id = OLD.id AND r.xid = txid_current()
                        AND r.from_status = OLD.status AND r.from_score IS NOT DISTINCT FROM OLD.score
                        AND r.to_status = NEW.status AND r.to_score IS NOT DISTINCT FROM NEW.score) THEN
        RAISE EXCEPTION 'examinations.score_revision_required: une note saisie après clôture ne se corrige que par une révision approuvée' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER paper_scores_guard BEFORE INSERT OR UPDATE OR DELETE ON examinations.paper_scores
  FOR EACH ROW EXECUTE FUNCTION examinations.paper_scores_guard();

-- -----------------------------------------------------------------------------
-- Lots d'import (fichiers de numéros, de notes, de résultats) et leurs lignes
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.import_batches (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id     uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('OFFICIAL_NUMBERS', 'SCORES', 'RESULTS')),
  file_name      text NOT NULL CHECK (length(btrim(file_name)) > 0),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  format_code    text,
  row_count      integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  ok_count       integer NOT NULL DEFAULT 0 CHECK (ok_count >= 0),
  error_count    integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  status         text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'VALIDATED', 'APPLIED', 'REJECTED')),
  uploaded_by    uuid NOT NULL,
  applied_by     uuid,
  applied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, kind, sha256),                -- le même fichier n'est importé qu'une fois
  CHECK (ok_count + error_count <= row_count),
  CHECK (status <> 'APPLIED' OR (error_count = 0 AND applied_by IS NOT NULL AND applied_at IS NOT NULL AND row_count > 0)),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.import_batches');
GRANT SELECT, INSERT, UPDATE ON examinations.import_batches TO app_user;

CREATE FUNCTION examinations.import_batches_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPLIED', 'REJECTED') THEN
    RAISE EXCEPTION 'examinations.batch_closed: un lot % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.session_id <> OLD.session_id OR NEW.kind <> OLD.kind OR NEW.sha256 <> OLD.sha256 THEN
    RAISE EXCEPTION 'examinations.batch_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'UPLOADED' AND NEW.status IN ('VALIDATED', 'REJECTED')) OR
       (OLD.status = 'VALIDATED' AND NEW.status IN ('APPLIED', 'REJECTED'))) THEN
    RAISE EXCEPTION 'examinations.batch_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER import_batches_guard BEFORE UPDATE ON examinations.import_batches
  FOR EACH ROW EXECUTE FUNCTION examinations.import_batches_guard();

-- Lignes d'un lot : identifiants et valeurs utiles seulement (jamais le nom ni l'adresse du candidat)
CREATE TABLE examinations.import_rows (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  batch_id      uuid NOT NULL,
  line_no       integer NOT NULL CHECK (line_no >= 1),
  status        text NOT NULL CHECK (status IN ('OK', 'ERROR', 'SKIPPED')),
  error_code    text,
  candidate_id  uuid,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_id, line_no),
  CHECK ((status = 'ERROR') = (error_code IS NOT NULL)),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES examinations.import_batches (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.import_rows');
GRANT SELECT, INSERT ON examinations.import_rows TO app_user;
CREATE TRIGGER import_rows_append_only BEFORE UPDATE OR DELETE ON examinations.import_rows
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Résultats des candidats
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.candidate_results (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id        uuid NOT NULL,
  candidate_id      uuid NOT NULL,
  result_code       text NOT NULL CHECK (result_code IN ('ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),
  average           numeric(7, 3) CHECK (average IS NULL OR average >= 0),
  total_points      numeric(9, 3) CHECK (total_points IS NULL OR total_points >= 0),
  rank              integer CHECK (rank IS NULL OR rank >= 1),
  mention_code      text CHECK (mention_code IS NULL OR mention_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  source            text NOT NULL CHECK (source IN ('IMPORTED', 'ENTERED', 'COMPUTED')),
  rule_version_ref  uuid,
  inputs_hash       text CHECK (inputs_hash IS NULL OR inputs_hash ~ '^[0-9a-f]{64}$'),
  import_batch_id   uuid,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  published_at      timestamptz,
  published_by      uuid,
  entered_by        uuid,
  row_version       integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id),
  CHECK (source <> 'COMPUTED' OR (rule_version_ref IS NOT NULL AND inputs_hash IS NOT NULL)),
  CHECK (source <> 'IMPORTED' OR import_batch_id IS NOT NULL),
  CHECK (source <> 'ENTERED' OR entered_by IS NOT NULL),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (result_code NOT IN ('ABSENT', 'EXCLUDED', 'DEFERRED') OR (average IS NULL AND rank IS NULL AND mention_code IS NULL)),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, import_batch_id) REFERENCES examinations.import_batches (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_results');
CREATE INDEX candidate_results_by_session ON examinations.candidate_results (tenant_id, session_id, result_code);
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_results TO app_user;

CREATE TABLE examinations.result_revisions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  result_id      uuid NOT NULL,
  from_code      text NOT NULL,
  to_code        text NOT NULL,
  from_average   numeric(7, 3),
  to_average     numeric(7, 3),
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by   uuid NOT NULL,
  approved_by    uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  xid            bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (approved_by <> requested_by),
  FOREIGN KEY (tenant_id, result_id) REFERENCES examinations.candidate_results (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.result_revisions');
GRANT SELECT, INSERT ON examinations.result_revisions TO app_user;
CREATE TRIGGER result_revisions_append_only BEFORE UPDATE OR DELETE ON examinations.result_revisions
  FOR EACH ROW EXECUTE FUNCTION examinations.forbid_mutation();

CREATE FUNCTION examinations.candidate_results_guard() RETURNS trigger
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
  IF v_s.status NOT IN ('IN_PROGRESS', 'RESULTS_ENTERED') THEN
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
CREATE TRIGGER candidate_results_guard BEFORE INSERT OR UPDATE ON examinations.candidate_results
  FOR EACH ROW EXECUTE FUNCTION examinations.candidate_results_guard();

-- L'issue du candidat suit son résultat (mise à jour imbriquée, autorisée par pg_trigger_depth()).
CREATE FUNCTION examinations.candidate_results_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE examinations.candidates SET outcome = NEW.result_code WHERE tenant_id = NEW.tenant_id AND id = NEW.candidate_id AND outcome <> NEW.result_code;
  RETURN NULL;
END
$$;
CREATE TRIGGER candidate_results_apply AFTER INSERT OR UPDATE ON examinations.candidate_results
  FOR EACH ROW EXECUTE FUNCTION examinations.candidate_results_apply();

-- Déclencheur de session (fonction définie en 2001, après `candidate_results`)
CREATE TRIGGER sessions_guard BEFORE INSERT OR UPDATE ON examinations.sessions
  FOR EACH ROW EXECUTE FUNCTION examinations.sessions_guard();

-- Examen blanc : liens entre épreuves d'un examen blanc et évaluations `assess` d'une classe
CREATE TABLE examinations.paper_assessment_links (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id      uuid NOT NULL,
  paper_id        uuid NOT NULL,
  classroom_id    uuid NOT NULL,                              -- academic.classrooms.id (sans FK)
  assessment_id   uuid NOT NULL,                              -- assess.assessments.id (sans FK)
  linked_by       uuid,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, paper_id, classroom_id),
  UNIQUE (tenant_id, assessment_id),
  FOREIGN KEY (tenant_id, session_id, paper_id) REFERENCES examinations.session_papers (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.paper_assessment_links');
GRANT SELECT, INSERT, DELETE ON examinations.paper_assessment_links TO app_user;

CREATE FUNCTION examinations.paper_assessment_links_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_kind text; v_status text;
BEGIN
  SELECT session_kind, status INTO v_kind, v_status FROM examinations.sessions s WHERE s.tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND s.id = coalesce(NEW.session_id, OLD.session_id);
  IF v_kind <> 'MOCK' THEN
    RAISE EXCEPTION 'examinations.links_mock_only: seules les épreuves d''un examen blanc se lient à des évaluations' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('RESULTS_ENTERED', 'PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'examinations.links_frozen: les liens sont figés (session %)', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER paper_assessment_links_guard BEFORE INSERT OR DELETE ON examinations.paper_assessment_links
  FOR EACH ROW EXECUTE FUNCTION examinations.paper_assessment_links_guard();

-- -----------------------------------------------------------------------------
-- Exports et documents émis
-- -----------------------------------------------------------------------------
CREATE TABLE examinations.export_runs (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id      uuid NOT NULL,
  format_id       uuid NOT NULL,
  format_version  integer NOT NULL,
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  status          text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
  row_count       integer CHECK (row_count IS NULL OR row_count >= 0),
  file_sha256     text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key     text,
  error_code      text,
  requested_by    uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'DONE' OR (row_count IS NOT NULL AND file_sha256 IS NOT NULL AND storage_key IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
  FOREIGN KEY (tenant_id, session_id) REFERENCES examinations.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, format_id) REFERENCES examinations.export_formats (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.export_runs');
GRANT SELECT, INSERT, UPDATE ON examinations.export_runs TO app_user;

-- Un export s'exécute avec un format PUBLIÉ ; son résultat terminé est immuable.
CREATE FUNCTION examinations.export_runs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text; v_version integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status, version INTO v_status, v_version FROM examinations.export_formats f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.format_id;
    IF v_status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'examinations.format_not_published: un export exige un format publié (état : %)', coalesce(v_status, 'inconnu') USING ERRCODE = 'check_violation';
    END IF;
    NEW.format_version := v_version;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'examinations.export_closed: un export terminé ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER export_runs_guard BEFORE INSERT OR UPDATE ON examinations.export_runs
  FOR EACH ROW EXECUTE FUNCTION examinations.export_runs_guard();

CREATE TABLE examinations.issued_documents (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id           uuid NOT NULL,
  candidate_id         uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('CONVOCATION', 'ATTESTATION_REUSSITE', 'RELEVE_NOTES')),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  official_document_id uuid,                                  -- reportcards.official_documents.id une fois scellé
  status               text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'ISSUED', 'REVOKED')),
  requested_by         uuid NOT NULL,
  issued_at            timestamptz,
  revoked_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, kind, version),
  CHECK ((status = 'ISSUED') = (issued_at IS NOT NULL AND official_document_id IS NOT NULL) OR status = 'REVOKED'),
  CHECK (status <> 'REVOKED' OR length(btrim(coalesce(revoked_reason, ''))) >= 10),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.issued_documents');
CREATE UNIQUE INDEX issued_documents_one_live ON examinations.issued_documents (tenant_id, candidate_id, kind) WHERE status <> 'REVOKED';
GRANT SELECT, INSERT, UPDATE ON examinations.issued_documents TO app_user;

CREATE FUNCTION examinations.issued_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_res examinations.candidate_results%ROWTYPE; v_c examinations.candidates%ROWTYPE; v_s text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_c FROM examinations.candidates c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.candidate_id;
    SELECT status INTO v_s FROM examinations.sessions s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.session_id;
    IF v_c.registration_status <> 'REGISTERED' THEN
      RAISE EXCEPTION 'examinations.candidate_not_registered: aucun document pour un candidat non inscrit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'ATTESTATION_REUSSITE' THEN
      SELECT * INTO v_res FROM examinations.candidate_results r WHERE r.tenant_id = NEW.tenant_id AND r.candidate_id = NEW.candidate_id;
      IF v_res.id IS NULL OR v_res.result_code <> 'ADMITTED' OR v_res.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'examinations.attestation_requires_admission: l''attestation de réussite exige un résultat ADMIS publié' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.kind = 'CONVOCATION' AND NOT EXISTS (SELECT 1 FROM examinations.seat_assignments a WHERE a.tenant_id = NEW.tenant_id AND a.candidate_id = NEW.candidate_id) THEN
      RAISE EXCEPTION 'examinations.convocation_requires_assignment: la convocation exige une place attribuée' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'REVOKED' THEN
    RAISE EXCEPTION 'examinations.document_revoked: un document révoqué est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ISSUED' AND (NEW.status <> 'REVOKED' OR NEW.official_document_id IS DISTINCT FROM OLD.official_document_id OR NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'examinations.document_issued: un document émis ne change plus (le révoquer, puis en émettre un nouveau)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER issued_documents_guard BEFORE INSERT OR UPDATE ON examinations.issued_documents
  FOR EACH ROW EXECUTE FUNCTION examinations.issued_documents_guard();

-- -----------------------------------------------------------------------------
-- Statistiques : COMPTEURS par groupe (établissement, série, sexe, niveau). Les TAUX (taux de réussite)
-- sont calculés par la règle `taux_reussite` du contrat exam-national@1 (dénominateur : question métier) ;
-- ici seuls des effectifs sont fournis. Lecture sous la RLS de l'appelant.
-- -----------------------------------------------------------------------------
CREATE FUNCTION examinations.result_counts(p_session uuid, p_group_by text)
RETURNS TABLE (group_key text, registered integer, present integer, admitted integer, failed integer, absent integer, excluded integer, deferred integer)
LANGUAGE sql STABLE AS $$
  SELECT CASE p_group_by
           WHEN 'INSTITUTION' THEN c.institution_id::text
           WHEN 'TRACK' THEN coalesce(c.track_code, '-')
           WHEN 'SEX' THEN coalesce(c.sex, '-')
           WHEN 'GRADE' THEN coalesce(c.grade_level_code, '-')
           ELSE 'ALL' END AS group_key,
         count(*)::integer AS registered,
         count(*) FILTER (WHERE c.outcome IN ('ADMITTED', 'FAILED', 'EXCLUDED', 'DEFERRED'))::integer AS present,
         count(*) FILTER (WHERE c.outcome = 'ADMITTED')::integer,
         count(*) FILTER (WHERE c.outcome = 'FAILED')::integer,
         count(*) FILTER (WHERE c.outcome = 'ABSENT')::integer,
         count(*) FILTER (WHERE c.outcome = 'EXCLUDED')::integer,
         count(*) FILTER (WHERE c.outcome = 'DEFERRED')::integer
    FROM examinations.candidates c
   WHERE c.tenant_id = kernel.current_tenant_id() AND c.session_id = p_session AND c.registration_status = 'REGISTERED'
     AND p_group_by IN ('INSTITUTION', 'TRACK', 'SEX', 'GRADE', 'ALL')
   GROUP BY 1
   ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION examinations.result_counts(uuid, text) TO app_user;
