-- =============================================================================
-- 1902 — Module primary_school : conseil des maîtres, bilan annuel, archivage des années
-- =============================================================================
--
-- Le conseil des maîtres RÉUTILISE `results.deliberations` (kind = COUNCIL) et `results.decisions` :
-- la proposition vient d'une règle, la décision finale est confirmée en séance (spec 011). Ce module
-- n'ajoute que ce qui est propre au primaire : le DOSSIER de séance par élève (cas à examiner,
-- proposition de l'instituteur, notes de discussion) et la feuille de présence des maîtres.
--
-- Le bilan annuel est un instantané : il RASSEMBLE des résultats déjà calculés (results), la synthèse
-- des compétences (compteurs), l'assiduité et la décision du conseil ; il ne calcule rien. Scellé,
-- il est immuable ; une correction crée la version n+1 (même patron que `reportcards`).
-- =============================================================================

CREATE TABLE primary_school.council_cases (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  deliberation_id       uuid NOT NULL,                  -- results.deliberations.id (sans FK)
  classroom_id          uuid NOT NULL,
  enrollment_id         uuid NOT NULL,
  student_id            uuid NOT NULL,
  -- pourquoi le dossier est examiné (codes issus d'une règle `cas_a_examiner` ou posés à la main)
  reason_codes          text[] NOT NULL DEFAULT '{}',
  proposal_code         text CHECK (proposal_code IS NULL OR proposal_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),   -- code d'issue (academic.enrollment_outcomes)
  proposal_note         text CHECK (proposal_note IS NULL OR length(proposal_note) <= 1000),
  discussion_note       text CHECK (discussion_note IS NULL OR length(discussion_note) <= 2000),
  proposed_by_staff_id  uuid,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DECIDED', 'DEFERRED')),
  decision_ref          uuid,                           -- results.decisions.id (sans FK)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, deliberation_id, enrollment_id),
  CHECK (status <> 'DECIDED' OR decision_ref IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('primary_school.council_cases');
CREATE INDEX council_cases_by_enrollment ON primary_school.council_cases (tenant_id, enrollment_id);
GRANT SELECT, INSERT, UPDATE ON primary_school.council_cases TO app_user;

-- Feuille de présence du conseil. Le quorum est une RÈGLE (contrat coef-period@1, clé `quorum_conseil`),
-- jamais une constante : ce module ne fait que compter convoqués et présents.
CREATE TABLE primary_school.council_attendance (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  deliberation_id  uuid NOT NULL,
  staff_id         uuid NOT NULL,                       -- people.staff.id (sans FK)
  role_code        text NOT NULL CHECK (role_code IN ('CHAIR', 'HOMEROOM', 'TEACHER', 'SPECIALIST', 'DIRECTOR', 'SECRETARY', 'OTHER')),
  convened         boolean NOT NULL DEFAULT true,
  present          boolean,
  signed_at        timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, deliberation_id, staff_id),
  CHECK (signed_at IS NULL OR present IS TRUE)
);
SELECT kernel.enable_tenant_rls('primary_school.council_attendance');
CREATE UNIQUE INDEX council_attendance_one_chair
  ON primary_school.council_attendance (tenant_id, deliberation_id) WHERE role_code = 'CHAIR';
CREATE UNIQUE INDEX council_attendance_one_secretary
  ON primary_school.council_attendance (tenant_id, deliberation_id) WHERE role_code = 'SECRETARY';
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.council_attendance TO app_user;

-- Après signature du procès-verbal, la feuille de présence est figée (déclencheur).
CREATE FUNCTION primary_school.council_attendance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'primary_school.attendance_signed: une présence signée ne se supprime pas' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.signed_at IS NOT NULL
     AND (NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.present IS DISTINCT FROM OLD.present
          OR NEW.role_code <> OLD.role_code OR NEW.staff_id <> OLD.staff_id) THEN
    RAISE EXCEPTION 'primary_school.attendance_signed: une présence signée ne se modifie plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER council_attendance_guard BEFORE UPDATE OR DELETE ON primary_school.council_attendance
  FOR EACH ROW EXECUTE FUNCTION primary_school.council_attendance_guard();

-- -----------------------------------------------------------------------------
-- Bilan annuel (instantané par inscription et par année)
--   DRAFT -> READY -> SEALED -> SUPERSEDED (par la version n+1)
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.annual_reviews (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,
  academic_year_id    uuid NOT NULL,
  enrollment_id       uuid NOT NULL,
  student_id          uuid NOT NULL,
  classroom_id        uuid NOT NULL,
  grade_level_code    text NOT NULL CHECK (grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'SEALED', 'SUPERSEDED')),
  year_result_ref     uuid,                              -- results.period_results.id (résultat d'année FINAL)
  decision_ref        uuid,                              -- results.decisions.id (décision confirmée)
  outcome_code        text CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  competency_summary  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(competency_summary) = 'object'),
  attendance_summary  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attendance_summary) = 'object'),
  rule_version_ref    uuid,                              -- version de règle épinglée par results
  content_hash        text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  sealed_at           timestamptz,
  sealed_by           uuid,
  reportcard_id       uuid,                              -- reportcards.report_cards.id une fois le PDF émis
  supersedes_id       uuid,
  supersede_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id, academic_year_id, version),
  CHECK (status NOT IN ('SEALED', 'SUPERSEDED') OR (content_hash IS NOT NULL AND sealed_at IS NOT NULL AND sealed_by IS NOT NULL)),
  CHECK (supersedes_id IS NULL OR (version > 1 AND length(btrim(coalesce(supersede_reason, ''))) >= 10)),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES primary_school.annual_reviews (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.annual_reviews');
-- Une seule version vivante par inscription et par année.
CREATE UNIQUE INDEX annual_reviews_one_live
  ON primary_school.annual_reviews (tenant_id, enrollment_id, academic_year_id) WHERE status <> 'SUPERSEDED';
CREATE INDEX annual_reviews_by_class ON primary_school.annual_reviews (tenant_id, classroom_id, status);
CREATE INDEX annual_reviews_by_year ON primary_school.annual_reviews (tenant_id, academic_year_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.annual_reviews TO app_user;   -- DELETE : brouillon seulement (garde)

-- Archivage d'une année (par établissement) : PREPARING -> READY -> FROZEN. READY exige un manifeste
-- et un bilan scellé pour CHAQUE inscription comptée ; FROZEN est irréversible.
CREATE TABLE primary_school.year_archives (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id    uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  status            text NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING', 'READY', 'FROZEN')),
  reviews_total     integer NOT NULL DEFAULT 0 CHECK (reviews_total >= 0),
  reviews_sealed    integer NOT NULL DEFAULT 0 CHECK (reviews_sealed >= 0),
  manifest          jsonb CHECK (manifest IS NULL OR jsonb_typeof(manifest) = 'object'),
  manifest_hash     text CHECK (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$'),
  storage_key       text,
  prepared_by       uuid,
  prepared_at       timestamptz,
  frozen_at         timestamptz,
  frozen_by         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, academic_year_id),
  CHECK (reviews_sealed <= reviews_total),
  CHECK (status = 'PREPARING' OR (manifest IS NOT NULL AND manifest_hash IS NOT NULL AND reviews_sealed = reviews_total)),
  CHECK ((status = 'FROZEN') = (frozen_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('primary_school.year_archives');
GRANT SELECT, INSERT, UPDATE ON primary_school.year_archives TO app_user;

-- -----------------------------------------------------------------------------
-- Gardes : bilan annuel
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.annual_reviews_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council_required boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'primary_school.review_delete_forbidden: un bilan % ne se supprime pas', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Année figée par l'archivage : plus aucune écriture.
  IF EXISTS (SELECT 1 FROM primary_school.year_archives a
              WHERE a.tenant_id = NEW.tenant_id AND a.institution_id = NEW.institution_id
                AND a.academic_year_id = NEW.academic_year_id AND a.status = 'FROZEN') THEN
    RAISE EXCEPTION 'primary_school.year_frozen: l''année est archivée, plus aucun bilan ne peut être écrit' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.student_id <> OLD.student_id OR NEW.institution_id <> OLD.institution_id OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'primary_school.review_identity_immutable: inscription, année et version sont figées' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status IN ('SEALED', 'SUPERSEDED') THEN
      -- seuls permis : SEALED -> SUPERSEDED, et le renseignement UNIQUE de l'identifiant du PDF
      IF NEW.status = OLD.status
         AND NEW.reportcard_id IS DISTINCT FROM OLD.reportcard_id AND OLD.reportcard_id IS NULL
         AND ROW(NEW.competency_summary, NEW.attendance_summary, NEW.content_hash, NEW.outcome_code, NEW.decision_ref,
                 NEW.year_result_ref, NEW.sealed_at, NEW.classroom_id, NEW.grade_level_code)
             IS NOT DISTINCT FROM
             ROW(OLD.competency_summary, OLD.attendance_summary, OLD.content_hash, OLD.outcome_code, OLD.decision_ref,
                 OLD.year_result_ref, OLD.sealed_at, OLD.classroom_id, OLD.grade_level_code) THEN
        NEW.updated_at := now();
        RETURN NEW;
      END IF;
      IF OLD.status = 'SEALED' AND NEW.status = 'SUPERSEDED'
         AND ROW(NEW.competency_summary, NEW.attendance_summary, NEW.content_hash, NEW.outcome_code, NEW.decision_ref,
                 NEW.year_result_ref, NEW.sealed_at, NEW.reportcard_id)
             IS NOT DISTINCT FROM
             ROW(OLD.competency_summary, OLD.attendance_summary, OLD.content_hash, OLD.outcome_code, OLD.decision_ref,
                 OLD.year_result_ref, OLD.sealed_at, OLD.reportcard_id) THEN
        NEW.updated_at := now();
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'primary_school.review_sealed: un bilan scellé est immuable (créer la version suivante)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status IN ('READY', 'SEALED')) OR
         (OLD.status = 'READY' AND NEW.status IN ('DRAFT', 'SEALED'))) THEN
      RAISE EXCEPTION 'primary_school.review_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NEW.status = 'SEALED' AND (TG_OP = 'INSERT' OR OLD.status <> 'SEALED') THEN
    SELECT coalesce((SELECT s.council_required_for_bilan FROM primary_school.settings s
                      WHERE s.tenant_id = NEW.tenant_id AND s.institution_id = NEW.institution_id), true)
      INTO v_council_required;
    IF v_council_required AND (NEW.decision_ref IS NULL OR NEW.outcome_code IS NULL) THEN
      RAISE EXCEPTION 'primary_school.review_needs_decision: le bilan ne se scelle qu''avec la décision du conseil des maîtres' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.year_result_ref IS NULL THEN
      RAISE EXCEPTION 'primary_school.review_needs_results: le bilan ne se scelle qu''avec un résultat d''année FINAL' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM primary_school.annual_reviews p
                    WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.supersedes_id
                      AND p.enrollment_id = NEW.enrollment_id AND p.academic_year_id = NEW.academic_year_id
                      AND p.version = NEW.version - 1) THEN
      RAISE EXCEPTION 'primary_school.review_supersedes_mismatch: la version remplacée doit être n-1 de la même inscription et année' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER annual_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.annual_reviews
  FOR EACH ROW EXECUTE FUNCTION primary_school.annual_reviews_guard();

-- -----------------------------------------------------------------------------
-- Gardes : archives d'année
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.year_archives_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
      RAISE EXCEPTION 'primary_school.archive_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'FROZEN' THEN
      RAISE EXCEPTION 'primary_school.archive_frozen: une année archivée est figée' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'PREPARING' AND NEW.status = 'READY') OR
         (OLD.status = 'READY' AND NEW.status IN ('PREPARING', 'FROZEN'))) THEN
      RAISE EXCEPTION 'primary_school.archive_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER year_archives_guard BEFORE UPDATE ON primary_school.year_archives
  FOR EACH ROW EXECUTE FUNCTION primary_school.year_archives_guard();

-- Pas de suppression d'une archive.
CREATE TRIGGER year_archives_no_delete BEFORE DELETE ON primary_school.year_archives
  FOR EACH ROW EXECUTE FUNCTION primary_school.forbid_mutation();
