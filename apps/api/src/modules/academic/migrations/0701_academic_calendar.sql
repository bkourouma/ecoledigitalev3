-- =============================================================================
-- 0701 — Module academic : années académiques et périodes typées
-- =============================================================================
--
-- L'année académique est LA source unique (fin des cinq dérivations « pivot au 1er septembre »
-- du code historique). Une année appartient à un établissement : un groupe qui exploite un
-- collège et une grande école peut avoir des calendriers différents.
-- Règle héritée de 0118 : deux années d'un même établissement ne se chevauchent jamais
-- (contrainte d'exclusion ci-dessous) et ne laissent aucun trou entre elles (règle appliquée
-- par `createAcademicYear`, vérifiable par `academic.find_year_gaps()`).
-- =============================================================================

CREATE TABLE academic.academic_years (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,                       -- tenancy.institutions.id (sans FK)
  code           text NOT NULL CHECK (code ~ '^[0-9A-Za-z][0-9A-Za-z_./-]{0,19}$'),   -- '2026-2027'
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED')),
  is_current     boolean NOT NULL DEFAULT false,
  opened_at      timestamptz,
  closed_at      timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (ends_on > starts_on),
  CHECK (NOT is_current OR status = 'OPEN'),
  EXCLUDE USING gist (
    tenant_id WITH =,
    institution_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('academic.academic_years');
-- Une seule année courante par établissement.
CREATE UNIQUE INDEX academic_years_one_current
  ON academic.academic_years (tenant_id, institution_id) WHERE is_current;
CREATE INDEX academic_years_by_institution
  ON academic.academic_years (tenant_id, institution_id, starts_on DESC);
GRANT SELECT, INSERT, UPDATE ON academic.academic_years TO app_user;

-- Contrôle d'exploitation : années consécutives sans trou (0118).
-- Renvoie les couples (année précédente, année suivante) séparés par plus d'un jour.
CREATE FUNCTION academic.find_year_gaps()
RETURNS TABLE (institution_id uuid, previous_year_id uuid, next_year_id uuid, gap_days integer)
LANGUAGE sql STABLE AS $$
  SELECT y.institution_id, y.id, y.next_id, (y.next_start - y.ends_on - 1)::integer
    FROM (
      SELECT a.institution_id, a.id, a.ends_on,
             lead(a.id)        OVER w AS next_id,
             lead(a.starts_on) OVER w AS next_start
        FROM academic.academic_years a
       WHERE a.tenant_id = kernel.current_tenant_id()
      WINDOW w AS (PARTITION BY a.institution_id ORDER BY a.starts_on)
    ) y
   WHERE y.next_id IS NOT NULL AND y.next_start - y.ends_on > 1
$$;
GRANT EXECUTE ON FUNCTION academic.find_year_gaps() TO app_user;

-- -----------------------------------------------------------------------------
-- Périodes typées d'une année. Arbre à deux niveaux d'imbrication maximum sous l'année :
-- année > semestre > session (normale / rattrapage). Les périodes sœurs de même type ne se
-- chevauchent pas ; un enfant tient dans son parent (déclencheur ci-dessous).
--
-- status : PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED
--   GRADING_CLOSED : la saisie et la correction des notes sont arrêtées (« clôture des notes »)
--   CLOSED         : résultats et bulletins arrêtés (« clôture des bulletins »)
-- La réouverture (pas en arrière) est une opération sensible, motivée et auditée.
-- -----------------------------------------------------------------------------
CREATE TABLE academic.academic_periods (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  academic_year_id  uuid NOT NULL,
  parent_period_id  uuid,
  period_type_code  text NOT NULL,
  ordinal           integer NOT NULL CHECK (ordinal >= 1),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  status            text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'OPEN', 'GRADING_CLOSED', 'CLOSED')),
  opened_at         timestamptz,
  grading_closed_at timestamptz,
  closed_at         timestamptz,
  closed_by         uuid,
  reopened_count    integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, code),
  CHECK (ends_on >= starts_on),
  CHECK (parent_period_id IS NULL OR parent_period_id <> id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic.academic_years (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_period_id) REFERENCES academic.academic_periods (tenant_id, id),
  FOREIGN KEY (tenant_id, period_type_code) REFERENCES academic.period_types (tenant_id, code),
  EXCLUDE USING gist (
    tenant_id WITH =,
    academic_year_id WITH =,
    (coalesce(parent_period_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    period_type_code WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('academic.academic_periods');
-- Numéro d'ordre unique parmi les périodes sœurs de même type.
CREATE UNIQUE INDEX academic_periods_ordinal_unique
  ON academic.academic_periods (
    tenant_id, academic_year_id,
    (coalesce(parent_period_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    period_type_code, ordinal);
CREATE INDEX academic_periods_by_year ON academic.academic_periods (tenant_id, academic_year_id, starts_on);
GRANT SELECT, INSERT, UPDATE ON academic.academic_periods TO app_user;

-- Garde : une période tient dans son année et dans son parent, parent de la même année,
-- profondeur <= 2 niveaux sous l'année, statut cohérent avec les horodatages.
CREATE FUNCTION academic.academic_periods_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_year   academic.academic_years%ROWTYPE;
  v_parent academic.academic_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_year FROM academic.academic_years
   WHERE tenant_id = NEW.tenant_id AND id = NEW.academic_year_id;
  IF NEW.starts_on < v_year.starts_on OR NEW.ends_on > v_year.ends_on THEN
    RAISE EXCEPTION 'academic.period_outside_year: la période % (% -> %) dépasse l''année % (% -> %)',
      NEW.code, NEW.starts_on, NEW.ends_on, v_year.code, v_year.starts_on, v_year.ends_on
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.parent_period_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM academic.academic_periods
     WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_period_id;
    IF v_parent.academic_year_id <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'academic.period_parent_other_year: le parent appartient à une autre année'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent.parent_period_id IS NOT NULL THEN
      -- année > période > sous-période : pas plus profond.
      IF EXISTS (SELECT 1 FROM academic.academic_periods g
                  WHERE g.tenant_id = NEW.tenant_id AND g.id = v_parent.parent_period_id AND g.parent_period_id IS NOT NULL) THEN
        RAISE EXCEPTION 'academic.period_too_deep: au plus trois niveaux de périodes'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.starts_on < v_parent.starts_on OR NEW.ends_on > v_parent.ends_on THEN
      RAISE EXCEPTION 'academic.period_outside_parent: la période % dépasse son parent %', NEW.code, v_parent.code
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.academic_year_id <> OLD.academic_year_id OR NEW.period_type_code <> OLD.period_type_code THEN
      RAISE EXCEPTION 'academic.period_identity_immutable: année et type d''une période sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- Pas de saut d'état : PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED, retour d'un seul pas (réouverture).
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'PLANNED'        AND NEW.status = 'OPEN') OR
        (OLD.status = 'OPEN'           AND NEW.status IN ('GRADING_CLOSED', 'PLANNED')) OR
        (OLD.status = 'GRADING_CLOSED' AND NEW.status IN ('CLOSED', 'OPEN')) OR
        (OLD.status = 'CLOSED'         AND NEW.status = 'GRADING_CLOSED')
      ) THEN
        RAISE EXCEPTION 'academic.period_transition: % -> % interdit', OLD.status, NEW.status
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    -- Les bornes d'une période close ne bougent plus.
    IF OLD.status IN ('GRADING_CLOSED', 'CLOSED') AND (NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on) THEN
      RAISE EXCEPTION 'academic.period_closed_dates: les dates d''une période close sont figées'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER academic_periods_guard BEFORE INSERT OR UPDATE ON academic.academic_periods
  FOR EACH ROW EXECUTE FUNCTION academic.academic_periods_guard();

-- Une période ne se supprime pas si quelque chose la référence (les autres modules la citent
-- par UUID sans FK) : on la désactive en la laissant ; la suppression n'est autorisée que
-- tant que la période est PLANNED.
CREATE FUNCTION academic.academic_periods_no_delete_started() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'academic.period_delete_forbidden: la période % est % ; elle ne peut plus être supprimée', OLD.code, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER academic_periods_no_delete BEFORE DELETE ON academic.academic_periods
  FOR EACH ROW EXECUTE FUNCTION academic.academic_periods_no_delete_started();
GRANT DELETE ON academic.academic_periods TO app_user;
