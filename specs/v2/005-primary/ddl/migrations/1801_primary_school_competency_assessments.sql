-- =============================================================================
-- 1801 — Module primary_school : évaluation par compétences (maternelle et primaire)
-- =============================================================================
--
-- `assess` ne porte que des notes chiffrées (score ≤ barème). L'évaluation par compétences — niveau
-- de maîtrise d'une compétence, observation de l'instituteur — est un autre objet : elle est portée
-- ici. Elle ne produit AUCUNE moyenne : `competency_summary` se contente de COMPTER des niveaux par
-- domaine ; toute interprétation chiffrée serait une règle (RuleSet), donc hors de ce module.
--
-- Cycle d'une appréciation : DRAFT -> VALIDATED (par l'instituteur ou la direction). Une appréciation
-- VALIDÉE ne se corrige que par une RÉVISION tracée (`competency_revisions`, motif ≥ 10 caractères) ;
-- aucune écriture n'est possible dans une classe × période verrouillée (`period_locks`, alimentée par
-- les événements `academic.classroom_period.*`).
-- =============================================================================

-- Verrou de saisie par classe × période : miroir local de l'état effectif de la période (academic).
CREATE TABLE primary_school.period_locks (
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  status             text NOT NULL CHECK (status IN ('LOCKED', 'OPEN')),
  changed_at         timestamptz NOT NULL DEFAULT now(),
  source_event_id    uuid,
  PRIMARY KEY (tenant_id, classroom_id, academic_period_id)
);
SELECT kernel.enable_tenant_rls('primary_school.period_locks');
GRANT SELECT, INSERT, UPDATE ON primary_school.period_locks TO app_user;

CREATE TABLE primary_school.competency_assessments (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id           uuid NOT NULL,                 -- academic.classrooms.id (sans FK)
  academic_period_id     uuid NOT NULL,                 -- academic.academic_periods.id (sans FK)
  enrollment_id          uuid NOT NULL,                 -- academic.enrollments.id (sans FK)
  student_id             uuid NOT NULL,                 -- people.students.id (sans FK)
  framework_id           uuid NOT NULL,
  competency_id          uuid NOT NULL,
  scale_id               uuid NOT NULL,                 -- redondant : impose « le niveau appartient à l'échelle du référentiel »
  rating_level_id        uuid NOT NULL,
  observed_on            date NOT NULL,
  recorded_by_staff_id   uuid NOT NULL,                 -- people.staff.id (sans FK)
  note                   text CHECK (note IS NULL OR length(note) <= 500),
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VALIDATED')),
  validated_by           uuid,
  validated_at           timestamptz,
  row_version            integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id, academic_period_id, competency_id),
  CHECK ((status = 'VALIDATED') = (validated_at IS NOT NULL AND validated_by IS NOT NULL)),
  FOREIGN KEY (tenant_id, framework_id, competency_id)
    REFERENCES primary_school.competencies (tenant_id, framework_id, id),
  FOREIGN KEY (tenant_id, scale_id, rating_level_id)
    REFERENCES primary_school.rating_levels (tenant_id, scale_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_assessments');
CREATE INDEX competency_assessments_by_class_period
  ON primary_school.competency_assessments (tenant_id, classroom_id, academic_period_id, status);
CREATE INDEX competency_assessments_by_enrollment
  ON primary_school.competency_assessments (tenant_id, enrollment_id, academic_period_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competency_assessments TO app_user;   -- DELETE : brouillon seulement (garde)

-- Révisions d'une appréciation validée : append-only. `xid` lie la révision à la transaction qui
-- applique la correction : un UPDATE d'une appréciation validée n'est accepté que si la révision
-- correspondante a été insérée dans la MÊME transaction (la trace précède toujours la correction).
CREATE TABLE primary_school.competency_revisions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id  uuid NOT NULL,
  from_level_id  uuid NOT NULL,
  to_level_id    uuid NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by   uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  xid            bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (from_level_id <> to_level_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES primary_school.competency_assessments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_revisions');
CREATE INDEX competency_revisions_by_assessment ON primary_school.competency_revisions (tenant_id, assessment_id, created_at);
GRANT SELECT, INSERT ON primary_school.competency_revisions TO app_user;
CREATE TRIGGER competency_revisions_append_only BEFORE UPDATE OR DELETE ON primary_school.competency_revisions
  FOR EACH ROW EXECUTE FUNCTION primary_school.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Garde des appréciations
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.competency_assessments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fw     primary_school.competency_frameworks%ROWTYPE;
  v_locked boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'primary_school.assessment_delete_forbidden: une appréciation validée ne se supprime pas (réviser)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_fw FROM primary_school.competency_frameworks f
   WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.framework_id;
  IF v_fw.status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'primary_school.framework_not_published: seul un référentiel publié s''évalue (état : %)', coalesce(v_fw.status, 'inconnu')
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.scale_id <> v_fw.scale_id THEN
    RAISE EXCEPTION 'primary_school.scale_mismatch: le niveau n''appartient pas à l''échelle du référentiel'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (SELECT 1 FROM primary_school.period_locks l
                  WHERE l.tenant_id = NEW.tenant_id AND l.classroom_id = NEW.classroom_id
                    AND l.academic_period_id = NEW.academic_period_id AND l.status = 'LOCKED')
    INTO v_locked;
  IF v_locked THEN
    RAISE EXCEPTION 'primary_school.period_locked: la saisie est arrêtée pour cette classe et cette période'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.classroom_id <> OLD.classroom_id OR NEW.academic_period_id <> OLD.academic_period_id
       OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id
       OR NEW.framework_id <> OLD.framework_id OR NEW.competency_id <> OLD.competency_id THEN
      RAISE EXCEPTION 'primary_school.assessment_identity_immutable: élève, classe, période et compétence sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED' AND NEW.status <> 'VALIDATED' THEN
      RAISE EXCEPTION 'primary_school.assessment_transition: VALIDATED -> % interdit (réviser)', NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED'
       AND (NEW.rating_level_id <> OLD.rating_level_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.observed_on <> OLD.observed_on) THEN
      -- la correction exige une révision insérée dans cette même transaction, pour ce changement précis
      IF NOT EXISTS (SELECT 1 FROM primary_school.competency_revisions r
                      WHERE r.tenant_id = OLD.tenant_id AND r.assessment_id = OLD.id
                        AND r.from_level_id = OLD.rating_level_id AND r.to_level_id = NEW.rating_level_id
                        AND r.xid = txid_current()) THEN
        RAISE EXCEPTION 'primary_school.validated_frozen: une appréciation validée ne se corrige que par une révision motivée'
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER competency_assessments_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competency_assessments
  FOR EACH ROW EXECUTE FUNCTION primary_school.competency_assessments_guard();

-- -----------------------------------------------------------------------------
-- Synthèse : COMPTE les niveaux VALIDÉS par domaine pour une inscription (et, au choix, un jeu de
-- périodes). Aucune moyenne, aucun seuil : { "<domaine>": { "<niveau>": n } }. Lue sous la RLS de l'appelant.
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.summarize_competencies(p_enrollment uuid, p_periods uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH counts AS (
    SELECT d.code AS domain_code, l.code AS level_code, count(*)::int AS n
      FROM primary_school.competency_assessments a
      JOIN primary_school.competencies c ON c.tenant_id = a.tenant_id AND c.id = a.competency_id
      JOIN primary_school.competency_domains d ON d.tenant_id = c.tenant_id AND d.id = c.domain_id
      JOIN primary_school.rating_levels l ON l.tenant_id = a.tenant_id AND l.id = a.rating_level_id
     WHERE a.tenant_id = kernel.current_tenant_id()
       AND a.enrollment_id = p_enrollment
       AND a.status = 'VALIDATED'
       AND (p_periods IS NULL OR a.academic_period_id = ANY (p_periods))
     GROUP BY d.code, l.code
  )
  SELECT coalesce(jsonb_object_agg(domain_code, per_level), '{}'::jsonb)
    FROM (SELECT domain_code, jsonb_object_agg(level_code, n) AS per_level FROM counts GROUP BY domain_code) x
$$;
GRANT EXECUTE ON FUNCTION primary_school.summarize_competencies(uuid, uuid[]) TO app_user;
