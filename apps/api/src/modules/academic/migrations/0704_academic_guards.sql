-- =============================================================================
-- 0704 — Module academic : invariants imposés par la base
-- =============================================================================
--
-- Défense en profondeur (même esprit que finance/0503) : le domaine TypeScript applique ces
-- règles, la base les IMPOSE — un bug applicatif ou une requête manuelle ne peut pas dépasser
-- une capacité, réécrire l'historique d'une inscription ni faire sauter une transition d'état.
-- Codes d'erreur : `restrict_violation` (23001) pour une écriture interdite, `check_violation`
-- (23514) pour une incohérence. Le message commence par un code stable `academic.*`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Journaux append-only
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'academic.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER enrollment_history_immutable BEFORE UPDATE OR DELETE ON academic.enrollment_history
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER curriculum_amendments_immutable BEFORE UPDATE OR DELETE ON academic.curriculum_amendments
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER template_applications_immutable BEFORE UPDATE OR DELETE ON academic.template_applications
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Inscriptions : identité figée, transitions légales, exigences de financement, cohérence
-- établissement / année / classe.
-- Machine d'états (miroir de ENROLLMENT_TRANSITIONS du domaine) :
--   PENDING   -> ACTIVE | CANCELLED | WITHDRAWN
--   ACTIVE    -> SUSPENDED | COMPLETED | WITHDRAWN | TRANSFERRED_OUT | CANCELLED
--   SUSPENDED -> ACTIVE | WITHDRAWN | TRANSFERRED_OUT
--   COMPLETED -> ACTIVE            (réouverture exceptionnelle, auditée)
--   WITHDRAWN / TRANSFERRED_OUT / CANCELLED -> terminaux
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.enrollments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class academic.classrooms%ROWTYPE;
  v_fund  academic.funding_types%ROWTYPE;
BEGIN
  SELECT * INTO v_class FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id;
  IF v_class.institution_id <> NEW.institution_id OR v_class.academic_year_id <> NEW.academic_year_id THEN
    RAISE EXCEPTION 'academic.enrollment_class_mismatch: la classe n''appartient pas à l''établissement et à l''année de l''inscription'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_fund FROM academic.funding_types WHERE tenant_id = NEW.tenant_id AND code = NEW.funding_type;
  IF v_fund.requires_reference AND NEW.assignment_reference IS NULL THEN
    RAISE EXCEPTION 'academic.funding_reference_required: le financement % exige une référence d''affectation', NEW.funding_type
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_fund.requires_funder AND NEW.funder_label IS NULL THEN
    RAISE EXCEPTION 'academic.funding_funder_required: le financement % exige l''identification du financeur', NEW.funding_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.student_id <> OLD.student_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.institution_id <> OLD.institution_id OR NEW.enrolled_on <> OLD.enrolled_on THEN
      RAISE EXCEPTION 'academic.enrollment_identity_immutable: apprenant, année, établissement et date d''inscription sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'PENDING'   AND NEW.status IN ('ACTIVE', 'CANCELLED', 'WITHDRAWN')) OR
         (OLD.status = 'ACTIVE'    AND NEW.status IN ('SUSPENDED', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'CANCELLED')) OR
         (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE', 'WITHDRAWN', 'TRANSFERRED_OUT')) OR
         (OLD.status = 'COMPLETED' AND NEW.status = 'ACTIVE')) THEN
      RAISE EXCEPTION 'academic.enrollment_transition: % -> % interdit', OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollments_guard BEFORE INSERT OR UPDATE ON academic.enrollments
  FOR EACH ROW EXECUTE FUNCTION academic.enrollments_guard();

-- Une inscription ne se supprime jamais (annuler = statut CANCELLED) : les autres modules la
-- citent par UUID, sans clé étrangère, et l'historique est une exigence du produit.
CREATE TRIGGER enrollments_no_delete BEFORE DELETE ON academic.enrollments
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER enrollment_courses_no_delete BEFORE DELETE ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();
CREATE TRIGGER classrooms_no_delete BEFORE DELETE ON academic.classrooms
  FOR EACH ROW EXECUTE FUNCTION academic.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Capacité. Le verrou de ligne sur la classe / l'offre SÉRIALISE les inscriptions concurrentes
-- (l'ancien décompte `count(*)` sans verrou laissait dépasser la capacité).
--   - classe : seulement si capacity_is_hard (capacité indicative sinon) ;
--   - offre  : toujours, et seulement pour une sélection de cours qui réserve une place
--              (PENDING sous réserve de hold_expires_at, CONFIRMED, COMPLETED).
-- Les places réservées par une sélection PENDING expirée ne comptent plus.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.enforce_classroom_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cap   integer;
  v_hard  boolean;
  v_count integer;
BEGIN
  -- La capacité d'une classe ne compte que les inscriptions « de classe » ; les inscriptions à la
  -- carte sont limitées par la capacité de chaque offre.
  IF NEW.mode <> 'CLASS' OR NEW.status NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.classroom_id = OLD.classroom_id AND OLD.status IN ('PENDING', 'ACTIVE', 'SUSPENDED') THEN
    RETURN NEW;                                   -- déjà compté : ni place de plus, ni verrou
  END IF;
  SELECT capacity, capacity_is_hard INTO v_cap, v_hard
    FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id FOR UPDATE;
  IF v_cap IS NULL OR NOT v_hard THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM academic.enrollments e
   WHERE e.tenant_id = NEW.tenant_id AND e.classroom_id = NEW.classroom_id AND e.mode = 'CLASS'
     AND e.status IN ('PENDING', 'ACTIVE', 'SUSPENDED') AND e.id <> NEW.id;
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'academic.classroom_full: la classe est complète (% places)', v_cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollments_capacity BEFORE INSERT OR UPDATE OF status, classroom_id ON academic.enrollments
  FOR EACH ROW EXECUTE FUNCTION academic.enforce_classroom_capacity();

CREATE FUNCTION academic.enforce_offering_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cap    integer;
  v_status text;
  v_count  integer;
  v_node   uuid;
BEGIN
  IF NEW.offering_id IS NULL OR NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.offering_id IS NOT DISTINCT FROM OLD.offering_id AND OLD.status <> 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  SELECT capacity, status, curriculum_node_id INTO v_cap, v_status, v_node
    FROM academic.classroom_offerings WHERE tenant_id = NEW.tenant_id AND id = NEW.offering_id FOR UPDATE;
  IF v_node <> NEW.curriculum_node_id THEN
    RAISE EXCEPTION 'academic.offering_node_mismatch: le nœud de la sélection ne correspond pas à l''offre' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('CANCELLED', 'COMPLETED') THEN
    RAISE EXCEPTION 'academic.offering_closed: l''offre est %', v_status USING ERRCODE = 'check_violation';
  END IF;
  IF v_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM academic.enrollment_courses c
     WHERE c.tenant_id = NEW.tenant_id AND c.offering_id = NEW.offering_id AND c.id <> NEW.id
       AND (c.status IN ('CONFIRMED', 'COMPLETED')
            OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())));
    IF v_count >= v_cap THEN
      RAISE EXCEPTION 'academic.offering_full: l''offre est complète (% places)', v_cap USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollment_courses_capacity BEFORE INSERT OR UPDATE OF status, offering_id ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.enforce_offering_capacity();

-- -----------------------------------------------------------------------------
-- Sélection de cours : transitions légales et cohérence avec l'inscription.
--   PENDING -> CONFIRMED | CANCELLED ; CONFIRMED -> COMPLETED | CANCELLED ; COMPLETED terminal.
-- Une inscription à la carte ne porte que des sélections ; le nœud doit appartenir au
-- curriculum d'une classe de la même année.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.enrollment_courses_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_enr   academic.enrollments%ROWTYPE;
  v_node  academic.curriculum_nodes%ROWTYPE;
  v_year  uuid;
  v_trans boolean;
BEGIN
  SELECT * INTO v_enr FROM academic.enrollments WHERE tenant_id = NEW.tenant_id AND id = NEW.enrollment_id;
  SELECT * INTO v_node FROM academic.curriculum_nodes WHERE tenant_id = NEW.tenant_id AND id = NEW.curriculum_node_id;
  SELECT academic_year_id INTO v_year FROM academic.curriculum_versions WHERE tenant_id = NEW.tenant_id AND id = v_node.version_id;
  IF v_year <> v_enr.academic_year_id AND NEW.source <> 'CARRY_OVER' THEN
    RAISE EXCEPTION 'academic.course_other_year: le nœud appartient à un curriculum d''une autre année' USING ERRCODE = 'check_violation';
  END IF;
  IF v_node.is_transversal AND NEW.source = 'A_LA_CARTE' THEN
    RAISE EXCEPTION 'academic.course_transversal: une matière transversale ne s''achète pas à la carte' USING ERRCODE = 'check_violation';
  END IF;
  -- À la carte : l'offre est celle de la classe de l'inscription (le « lot » apprenant × classe).
  -- Reprise de dette (CARRY_OVER) et options : l'offre peut venir d'une autre classe.
  IF NEW.source = 'A_LA_CARTE' AND NOT EXISTS (
       SELECT 1 FROM academic.classroom_offerings o
        WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.offering_id AND o.classroom_id = v_enr.classroom_id) THEN
    RAISE EXCEPTION 'academic.course_offering_other_class: l''offre n''appartient pas à la classe de l''inscription' USING ERRCODE = 'check_violation';
  END IF;
  -- Une sélection n'est CONFIRMÉE que si l'inscription est ACTIVE (la confirmation de l'inscription
  -- précède celle des cours : porte d'entrée des frais d'inscription).
  IF NEW.status IN ('CONFIRMED', 'COMPLETED') AND v_enr.status NOT IN ('ACTIVE', 'COMPLETED') THEN
    RAISE EXCEPTION 'academic.course_enrollment_not_active: l''inscription est % ; confirmez-la d''abord', v_enr.status
      USING ERRCODE = 'check_violation';
  END IF;
  -- Un apprenant ne suit pas deux fois le même nœud la même année (ex. même UE dans deux classes du
  -- même programme) ; reprendre un nœud échoué se fait l'année suivante ou après annulation.
  IF NEW.status <> 'CANCELLED' AND EXISTS (
       SELECT 1 FROM academic.enrollment_courses c
         JOIN academic.enrollments e ON e.tenant_id = c.tenant_id AND e.id = c.enrollment_id
        WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id AND c.status <> 'CANCELLED'
          AND c.curriculum_node_id = NEW.curriculum_node_id
          AND e.student_id = v_enr.student_id AND e.academic_year_id = v_enr.academic_year_id) THEN
    RAISE EXCEPTION 'academic.duplicate_enrollment: l''apprenant suit déjà ce nœud cette année' USING ERRCODE = 'unique_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.curriculum_node_id <> OLD.curriculum_node_id OR NEW.source <> OLD.source THEN
      RAISE EXCEPTION 'academic.course_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'PENDING'   AND NEW.status IN ('CONFIRMED', 'CANCELLED')) OR
         (OLD.status = 'CONFIRMED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))) THEN
      RAISE EXCEPTION 'academic.course_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollment_courses_guard BEFORE INSERT OR UPDATE ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.enrollment_courses_guard();

-- -----------------------------------------------------------------------------
-- Un seul placement ouvert (sans date de fin) par inscription.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX enrollment_placements_one_open
  ON academic.enrollment_placements (tenant_id, enrollment_id) WHERE ends_on IS NULL;

-- -----------------------------------------------------------------------------
-- FULL / OPEN dérivés de la capacité (parité : computeSessionCapacityStatus du legacy) :
--   OPEN -> FULL  quand les places réservées atteignent la capacité ;
--   FULL -> OPEN  quand une place se libère ET que la fenêtre d'inscription est encore valide
--                 (ou n'existe pas). Jamais posé à la main, jamais depuis un autre état.
-- Déclenché après toute écriture de sélection ; l'offre est verrouillée par le garde de capacité.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.sync_offering_fullness() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_offering uuid := coalesce(NEW.offering_id, OLD.offering_id);
  o          academic.classroom_offerings%ROWTYPE;
  v_held     integer;
BEGIN
  IF v_offering IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO o FROM academic.classroom_offerings WHERE tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND id = v_offering;
  IF NOT FOUND OR o.capacity IS NULL OR o.status NOT IN ('OPEN', 'FULL') THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_held FROM academic.enrollment_courses c
   WHERE c.tenant_id = o.tenant_id AND c.offering_id = o.id
     AND (c.status IN ('CONFIRMED', 'COMPLETED')
          OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())));
  IF o.status = 'OPEN' AND v_held >= o.capacity THEN
    UPDATE academic.classroom_offerings SET status = 'FULL', updated_at = now() WHERE tenant_id = o.tenant_id AND id = o.id;
  ELSIF o.status = 'FULL' AND v_held < o.capacity
        AND (o.registration_closes_at IS NULL OR now() <= o.registration_closes_at) THEN
    UPDATE academic.classroom_offerings SET status = 'OPEN', updated_at = now() WHERE tenant_id = o.tenant_id AND id = o.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER enrollment_courses_fullness AFTER INSERT OR UPDATE OF status, offering_id, hold_expires_at OR DELETE ON academic.enrollment_courses
  FOR EACH ROW EXECUTE FUNCTION academic.sync_offering_fullness();

-- -----------------------------------------------------------------------------
-- Clôture par classe : la période appartient à l'année de la classe ; transitions
-- OPEN -> GRADING_CLOSED -> CLOSED, retour d'un pas ; l'état d'une classe SURCHARGE celui de la
-- période (permet de rouvrir une seule classe après une clôture globale, ou d'en clore une seule).
-- Clore la période entière (closePeriod*) aligne en une opération les états explicites existants.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.classroom_period_states_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_class_year  uuid;
  v_period_year uuid;
BEGIN
  SELECT academic_year_id INTO v_class_year FROM academic.classrooms WHERE tenant_id = NEW.tenant_id AND id = NEW.classroom_id;
  SELECT academic_year_id INTO v_period_year FROM academic.academic_periods WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id;
  IF v_class_year <> v_period_year THEN
    RAISE EXCEPTION 'academic.classroom_period_other_year: la période n''appartient pas à l''année de la classe' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NOT (
       (OLD.status = 'OPEN'           AND NEW.status = 'GRADING_CLOSED') OR
       (OLD.status = 'GRADING_CLOSED' AND NEW.status IN ('CLOSED', 'OPEN')) OR
       (OLD.status = 'CLOSED'         AND NEW.status IN ('GRADING_CLOSED', 'OPEN'))) THEN
    RAISE EXCEPTION 'academic.classroom_period_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER classroom_period_states_guard BEFORE INSERT OR UPDATE ON academic.classroom_period_states
  FOR EACH ROW EXECUTE FUNCTION academic.classroom_period_states_guard();

-- -----------------------------------------------------------------------------
-- Aide à la lecture : état effectif d'une période pour une classe = l'état explicite de la
-- classe s'il existe, sinon celui de la période.
-- -----------------------------------------------------------------------------
CREATE FUNCTION academic.effective_period_status(p_classroom uuid, p_period uuid)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(s.status, p.status)
    FROM academic.academic_periods p
    LEFT JOIN academic.classroom_period_states s
           ON s.tenant_id = p.tenant_id AND s.classroom_id = p_classroom AND s.period_id = p.id
   WHERE p.tenant_id = kernel.current_tenant_id() AND p.id = p_period
$$;
GRANT EXECUTE ON FUNCTION academic.effective_period_status(uuid, uuid) TO app_user;
