-- =============================================================================
-- 0956 — Module scheduling (spec 017, question O-05) : générateur d'emploi du temps
-- =============================================================================
--
-- Un « run » est une demande de génération automatique et sa PROPOSITION. Il ne touche JAMAIS un emploi du
-- temps existant : le résultat reste dans `result` (jsonb) jusqu'à ce qu'un humain l'applique, ce qui crée un
-- NOUVEAU brouillon (ou remplace le contenu d'un brouillon, avec confirmation) — jamais un emploi du temps
-- publié. La publication reste l'acte distinct de `publishTimetable`.
--
-- Garanties tenues par la base :
--   * machine d'états : QUEUED → RUNNING → COMPLETED → APPLIED | DISCARDED ; FAILED ; DISCARDED depuis
--     QUEUED / COMPLETED / FAILED ; APPLIED et DISCARDED sont terminaux ;
--   * les paramètres (`params`, `seed`) ne changent jamais ; le résultat (`result`) est posé UNE fois, à la
--     fin du calcul (RUNNING → COMPLETED), puis figé (la proposition examinée est celle qui sera appliquée) ;
--   * un run APPLIED désigne l'emploi du temps créé.
-- =============================================================================

CREATE TABLE scheduling.autogen_runs (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id       uuid NOT NULL,
  campus_id            uuid,
  academic_year_id     uuid NOT NULL,
  period_id            uuid,
  name                 text NOT NULL CHECK (length(btrim(name)) > 0),
  status               text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'APPLIED', 'DISCARDED')),
  seed                 text NOT NULL CHECK (length(seed) BETWEEN 1 AND 100),
  params               jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  result               jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  summary              jsonb CHECK (summary IS NULL OR jsonb_typeof(summary) = 'object'),
  error_code           text,
  error_message        text,
  fixed_timetable_id   uuid,
  applied_timetable_id uuid,
  requested_by         uuid,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  applied_at           timestamptz,
  applied_by           uuid,
  discarded_at         timestamptz,
  discarded_by         uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, fixed_timetable_id) REFERENCES scheduling.timetables (tenant_id, id),
  FOREIGN KEY (tenant_id, applied_timetable_id) REFERENCES scheduling.timetables (tenant_id, id),
  CHECK ((status IN ('COMPLETED', 'APPLIED')) = (result IS NOT NULL) OR status IN ('DISCARDED')),
  CHECK ((status = 'APPLIED') = (applied_timetable_id IS NOT NULL)),
  CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL)),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('scheduling.autogen_runs');
CREATE INDEX autogen_runs_by_status ON scheduling.autogen_runs (tenant_id, institution_id, status, requested_at DESC);
GRANT SELECT, INSERT, UPDATE ON scheduling.autogen_runs TO app_user;

CREATE FUNCTION scheduling.autogen_runs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
     OR NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id OR NEW.params IS DISTINCT FROM OLD.params OR NEW.seed IS DISTINCT FROM OLD.seed
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.fixed_timetable_id IS DISTINCT FROM OLD.fixed_timetable_id THEN
    RAISE EXCEPTION 'scheduling.autogen_immutable: les paramètres d''une génération ne changent pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'QUEUED'    AND NEW.status IN ('RUNNING', 'DISCARDED', 'FAILED'))
    OR (OLD.status = 'RUNNING'   AND NEW.status IN ('COMPLETED', 'FAILED'))
    OR (OLD.status = 'COMPLETED' AND NEW.status IN ('APPLIED', 'DISCARDED'))
    OR (OLD.status = 'FAILED'    AND NEW.status = 'DISCARDED')
  ) THEN
    RAISE EXCEPTION 'scheduling.autogen_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  -- La proposition est posée une seule fois (RUNNING -> COMPLETED), puis figée.
  IF NEW.result IS DISTINCT FROM OLD.result AND NOT (OLD.status = 'RUNNING' AND NEW.status = 'COMPLETED' AND OLD.result IS NULL) THEN
    RAISE EXCEPTION 'scheduling.autogen_immutable: la proposition est figée une fois calculée' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER autogen_runs_guard BEFORE UPDATE ON scheduling.autogen_runs
  FOR EACH ROW EXECUTE FUNCTION scheduling.autogen_runs_guard();
CREATE TRIGGER autogen_runs_no_delete BEFORE DELETE ON scheduling.autogen_runs
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();
