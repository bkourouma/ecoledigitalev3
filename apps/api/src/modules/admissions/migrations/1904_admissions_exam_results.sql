-- =============================================================================
-- 1904 — Module admissions : résultat d'examen ET moyenne reçus de `examinations` (décision métier Q-E18, CEPE -> admission en 6e)
-- =============================================================================
--
-- `examinations` transmet (événement `examinations.result.transmitted`) le résultat « admis / non admis » ET la MOYENNE d'un élève ayant
-- passé un examen qui conditionne l'admission. Ce module les reçoit et les range ICI, par élève : jamais de SQL croisé, jamais de nom.
--
--   * Une ligne par résultat de l'examen (`source_result_id`) ; une correction approuvée après transmission remplace la ligne si sa
--     version (`revision`) est plus grande (jamais l'inverse : un événement tardif ou rejoué ne défait rien).
--   * Un dossier de candidature n'y est rattaché que par un lien SÛR : son propre élève (`applications.student_id`) ou un
--     rapprochement CONFIRMÉ par une personne (`duplicate_candidates.status = 'CONFIRMED_DUPLICATE'`). Un simple rapprochement
--     « ouvert » ne montre jamais la moyenne d'un autre enfant.
--   * La MOYENNE n'est lue que par le personnel d'admission habilité (permission `admission.exam_result.read`, lecture auditée) ;
--     sans cette permission, seul « admis / non admis » est montré.
--   * Aucune durée de conservation n'est inventée : elle suivra la politique de conservation de l'établissement.
-- =============================================================================

CREATE TABLE admissions.exam_results (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id    uuid NOT NULL,
  student_id        uuid NOT NULL,                              -- people.students.id (sans FK)
  source_candidate_id uuid NOT NULL,                            -- examinations.candidates.id (sans FK)
  source_result_id  uuid NOT NULL,                              -- examinations.candidate_results.id (sans FK)
  exam_type_code    text NOT NULL CHECK (exam_type_code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  session_year      integer NOT NULL CHECK (session_year BETWEEN 2000 AND 2200),
  outcome           text NOT NULL CHECK (outcome IN ('ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),
  admitted          boolean NOT NULL,
  average           numeric(7, 3) CHECK (average IS NULL OR average >= 0),
  revision          integer NOT NULL CHECK (revision >= 1),
  source_event_id   uuid NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_result_id),
  CHECK (admitted = (outcome = 'ADMITTED')),
  CHECK (outcome NOT IN ('ABSENT', 'EXCLUDED', 'DEFERRED') OR average IS NULL)
);
SELECT kernel.enable_tenant_rls('admissions.exam_results');
CREATE INDEX exam_results_by_student ON admissions.exam_results (tenant_id, student_id, session_year DESC);
GRANT SELECT, INSERT, UPDATE ON admissions.exam_results TO app_user;      -- jamais de suppression par l'application

-- L'identité d'un résultat reçu est figée ; une mise à jour ne vient que d'une version PLUS GRANDE du même résultat.
CREATE FUNCTION admissions.exam_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id <> OLD.student_id OR NEW.source_result_id <> OLD.source_result_id OR NEW.source_candidate_id <> OLD.source_candidate_id
     OR NEW.institution_id <> OLD.institution_id OR NEW.exam_type_code <> OLD.exam_type_code OR NEW.session_year <> OLD.session_year THEN
    RAISE EXCEPTION 'admissions.exam_result_identity_immutable: élève, résultat source, établissement, examen et année sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.revision <= OLD.revision THEN
    RAISE EXCEPTION 'admissions.exam_result_stale: une correction remplace un résultat reçu seulement si sa version est plus grande (% -> %)', OLD.revision, NEW.revision USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER exam_results_guard BEFORE UPDATE ON admissions.exam_results
  FOR EACH ROW EXECUTE FUNCTION admissions.exam_results_guard();
