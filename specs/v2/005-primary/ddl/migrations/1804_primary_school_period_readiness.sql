-- =============================================================================
-- 1804 — Module primary_school : état « prêt » d'une classe × période (décision Q-P18, 2026-10-05)
-- =============================================================================
--
-- Les familles (parents, élève) ne voient les rangs et les compétences d'une classe × période qu'APRÈS validation ou
-- après que l'enseignant a marqué la classe × période « prêtes » ; jamais une saisie brouillon. Ce marquage est :
--   - une action de l'enseignant, auditée (événement + audit applicatif) ;
--   - RÉVERSIBLE tant que le bulletin de la période n'est pas publié (garde applicative : `DocumentsPort`) ;
--   - une GELURE : tant que la classe × période est « prête », les brouillons ne peuvent ni être créés, ni modifiés, ni
--     supprimés (déclencheur ci-dessous) — ce que la famille voit est exactement ce que l'enseignant a déclaré prêt.
--     Valider (DRAFT -> VALIDATED sans changer le contenu) et réviser une appréciation validée (trace motivée) restent possibles.
--
-- Une seule ligne par classe × période ; l'historique des marquages / retraits est dans le journal d'audit.
-- =============================================================================

CREATE TABLE primary_school.period_readiness (
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,                  -- academic.classrooms.id (sans FK)
  academic_period_id uuid NOT NULL,                  -- academic.academic_periods.id (sans FK)
  status             text NOT NULL CHECK (status IN ('READY', 'NOT_READY')),
  marked_by          uuid NOT NULL,                  -- iam : utilisateur qui a marqué « prêts »
  marked_at          timestamptz NOT NULL DEFAULT now(),
  withdrawn_by       uuid,
  withdrawn_at       timestamptz,
  withdrawn_reason   text CHECK (withdrawn_reason IS NULL OR length(btrim(withdrawn_reason)) >= 10),
  row_version        integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  PRIMARY KEY (tenant_id, classroom_id, academic_period_id),
  CHECK ((status = 'NOT_READY') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('primary_school.period_readiness');
CREATE INDEX period_readiness_by_period ON primary_school.period_readiness (tenant_id, academic_period_id) WHERE status = 'READY';
GRANT SELECT, INSERT, UPDATE ON primary_school.period_readiness TO app_user;

-- Garde des brouillons d'une classe × période « prête » (défense en profondeur de la garde applicative).
CREATE FUNCTION primary_school.period_ready_assessment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row   primary_school.competency_assessments%ROWTYPE;
  v_ready boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  -- Une correction d'une appréciation VALIDÉE passe par une révision tracée : hors de cette garde.
  IF TG_OP = 'UPDATE' AND OLD.status = 'VALIDATED' THEN
    RETURN NEW;
  END IF;
  -- Valider un brouillon sans en changer le contenu : permis.
  IF TG_OP = 'UPDATE' AND NEW.status = 'VALIDATED'
     AND NEW.rating_level_id = OLD.rating_level_id AND NEW.note IS NOT DISTINCT FROM OLD.note AND NEW.observed_on = OLD.observed_on THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM primary_school.period_readiness r
                  WHERE r.tenant_id = v_row.tenant_id AND r.classroom_id = v_row.classroom_id
                    AND r.academic_period_id = v_row.academic_period_id AND r.status = 'READY')
    INTO v_ready;
  IF v_ready THEN
    RAISE EXCEPTION 'primary_school.period_ready: la classe et la période sont marquées prêtes ; retirer le marquage avant de modifier la saisie'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER competency_assessments_period_ready BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competency_assessments
  FOR EACH ROW EXECUTE FUNCTION primary_school.period_ready_assessment_guard();
