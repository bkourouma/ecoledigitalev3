-- =============================================================================
-- 0805 — Module people (spec 009) : invariants du personnel et des affectations
-- =============================================================================
-- Prérequis : 0804 (fonction people.forbid_mutation, spec 008).

CREATE TRIGGER staff_status_history_immutable BEFORE UPDATE OR DELETE ON people.staff_status_history
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER teaching_assignment_history_immutable BEFORE UPDATE OR DELETE ON people.teaching_assignment_history
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- Jamais de suppression physique (le legacy `DELETE /teachers/:id` effaçait en cascade
-- évaluations, affectations, bulletins, configurations et tarifs).
CREATE TRIGGER staff_no_delete BEFORE DELETE ON people.staff
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER staff_contracts_no_delete BEFORE DELETE ON people.staff_contracts
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER teaching_assignments_no_delete BEFORE DELETE ON people.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- Personnel : numéro immuable ; ACTIVE <-> ON_LEAVE <-> SUSPENDED ; * -> LEFT (réembauche : LEFT -> ACTIVE).
CREATE FUNCTION people.staff_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cat people.staff_categories%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.staff_number <> OLD.staff_number OR NEW.person_id <> OLD.person_id THEN
      RAISE EXCEPTION 'people.staff_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED') AND NEW.status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'LEFT')) OR
         (OLD.status = 'LEFT' AND NEW.status = 'ACTIVE')) THEN
      RAISE EXCEPTION 'people.staff_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  SELECT * INTO v_cat FROM people.staff_categories WHERE tenant_id = NEW.tenant_id AND code = NEW.category_code;
  IF NOT v_cat.active AND (TG_OP = 'INSERT' OR NEW.category_code <> OLD.category_code) THEN
    RAISE EXCEPTION 'people.staff_category_inactive: la catégorie % est désactivée', NEW.category_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_guard BEFORE INSERT OR UPDATE ON people.staff
  FOR EACH ROW EXECUTE FUNCTION people.staff_guard();

-- Affectation : seul un membre du personnel ACTIF (ou en congé) dont la catégorie peut enseigner
-- (ou superviser, pour SUPERVISOR) reçoit une affectation ; les clés d'objet sont figées.
CREATE FUNCTION people.teaching_assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_staff people.staff%ROWTYPE;
  v_cat   people.staff_categories%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.staff_id <> OLD.staff_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.classroom_id <> OLD.classroom_id
       OR NEW.curriculum_node_id IS DISTINCT FROM OLD.curriculum_node_id OR NEW.role_code <> OLD.role_code THEN
      RAISE EXCEPTION 'people.assignment_identity_immutable: pour changer d''enseignant, terminer et recréer (REPLACED)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'ACTIVE' AND NEW.status = 'ACTIVE' THEN
      RAISE EXCEPTION 'people.assignment_transition: une affectation terminée ne se réactive pas' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_staff FROM people.staff WHERE tenant_id = NEW.tenant_id AND id = NEW.staff_id;
  SELECT * INTO v_cat FROM people.staff_categories WHERE tenant_id = NEW.tenant_id AND code = v_staff.category_code;
  IF v_staff.status NOT IN ('ACTIVE', 'ON_LEAVE') THEN
    RAISE EXCEPTION 'people.assignment_staff_not_active: le personnel est %', v_staff.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role_code = 'SUPERVISOR' THEN
    IF NOT (v_cat.can_supervise OR v_cat.can_teach) THEN
      RAISE EXCEPTION 'people.assignment_category_forbidden: la catégorie % ne peut pas superviser', v_cat.code USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT v_cat.can_teach THEN
    RAISE EXCEPTION 'people.assignment_category_forbidden: la catégorie % ne peut pas enseigner', v_cat.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER teaching_assignments_guard BEFORE INSERT OR UPDATE ON people.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION people.teaching_assignments_guard();

-- -----------------------------------------------------------------------------
-- Qualifications qui expirent bientôt (fournie aux alertes de la spec 025 et au job
-- d'événements `people.staff_qualification.expiring`).
-- -----------------------------------------------------------------------------
CREATE FUNCTION people.expiring_qualifications(p_as_of date, p_within_days integer)
RETURNS TABLE (qualification_id uuid, staff_id uuid, label text, expires_on date, days_left integer)
LANGUAGE sql STABLE AS $$
  SELECT q.id, q.staff_id, q.label, q.expires_on, (q.expires_on - p_as_of)::integer
    FROM people.staff_qualifications q
    JOIN people.staff s ON s.tenant_id = q.tenant_id AND s.id = q.staff_id
   WHERE q.tenant_id = kernel.current_tenant_id()
     AND s.status IN ('ACTIVE', 'ON_LEAVE')
     AND q.expires_on IS NOT NULL
     AND q.expires_on BETWEEN p_as_of AND p_as_of + p_within_days
$$;
GRANT EXECUTE ON FUNCTION people.expiring_qualifications(date, integer) TO app_user;
