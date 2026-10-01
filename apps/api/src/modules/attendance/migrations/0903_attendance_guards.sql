-- =============================================================================
-- 0903 — Module attendance : invariants imposés par la base
-- =============================================================================

CREATE FUNCTION attendance.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER record_history_immutable BEFORE UPDATE OR DELETE ON attendance.record_history
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON attendance.sessions
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();
CREATE TRIGGER justifications_no_delete BEFORE DELETE ON attendance.justifications
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();
CREATE TRIGGER staff_records_no_delete BEFORE DELETE ON attendance.staff_records
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Séance d'appel : transitions légales, identité figée. La réouverture d'une séance VALIDÉE
-- exige le réglage de transaction `attendance.reopen = on` (posé par `reopenAttendanceSession`
-- après contrôle de la permission sensible `attendance.session.reopen`).
--   OPEN -> SUBMITTED | CANCELLED ; SUBMITTED -> VALIDATED | OPEN (correction) | CANCELLED ;
--   VALIDATED -> SUBMITTED (réouverture) | CANCELLED (occurrence annulée après validation,
--   toujours sous le réglage de réouverture) ; CANCELLED terminal.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.classroom_id <> OLD.classroom_id OR NEW.session_date <> OLD.session_date OR NEW.scope <> OLD.scope
     OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id THEN
    RAISE EXCEPTION 'attendance.session_identity_immutable: classe, date, portée et occurrence d''un appel sont figées'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'OPEN'      AND NEW.status IN ('SUBMITTED', 'CANCELLED')) OR
         (OLD.status = 'SUBMITTED' AND NEW.status IN ('VALIDATED', 'OPEN', 'CANCELLED')) OR
         (OLD.status = 'VALIDATED' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))) THEN
      RAISE EXCEPTION 'attendance.session_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED' AND coalesce(current_setting('attendance.reopen', true), '') <> 'on' THEN
      RAISE EXCEPTION 'attendance.session_validated: réouverture réservée à reopenAttendanceSession' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sessions_guard BEFORE UPDATE ON attendance.sessions
  FOR EACH ROW EXECUTE FUNCTION attendance.sessions_guard();

-- -----------------------------------------------------------------------------
-- Pointages : écriture refusée sur une séance VALIDÉE ou ANNULÉE (sauf réouverture) ; le
-- statut doit être actif et de la bonne famille ; historique automatique.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.student_records_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_def    attendance.status_definitions%ROWTYPE;
  v_row    attendance.student_records%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  SELECT status INTO v_status FROM attendance.sessions WHERE tenant_id = v_row.tenant_id AND id = v_row.session_id;
  IF v_status IN ('VALIDATED', 'CANCELLED') THEN
    -- Seule exception sur un appel VALIDÉ : l'application ou la révocation d'une EXCUSE (décision
    -- d'un justificatif prise après coup). Le statut ne bascule qu'entre ABSENT et EXCUSED, rien
    -- d'autre ne change. Réglage de transaction `attendance.excuse_apply = on` posé par les seuls
    -- cas d'usage acceptJustification / revokeJustification.
    IF TG_OP = 'UPDATE' AND v_status = 'VALIDATED'
       AND coalesce(current_setting('attendance.excuse_apply', true), '') = 'on'
       AND NEW.counted_minutes IS NOT DISTINCT FROM OLD.counted_minutes
       AND NEW.minutes_late IS NOT DISTINCT FROM OLD.minutes_late
       AND NEW.arrived_at IS NOT DISTINCT FROM OLD.arrived_at
       AND NEW.left_at IS NOT DISTINCT FROM OLD.left_at
       AND NEW.note IS NOT DISTINCT FROM OLD.note
       AND NEW.session_id = OLD.session_id AND NEW.enrollment_id = OLD.enrollment_id
       AND (NEW.status_code = OLD.status_code
            OR (OLD.status_code = 'ABSENT' AND NEW.status_code = 'EXCUSED')
            OR (OLD.status_code = 'EXCUSED' AND NEW.status_code = 'ABSENT')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'attendance.session_locked: l''appel est % ; aucun pointage modifiable', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.session_id <> OLD.session_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id) THEN
    RAISE EXCEPTION 'attendance.record_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_def FROM attendance.status_definitions
   WHERE tenant_id = NEW.tenant_id AND subject_kind = 'STUDENT' AND code = NEW.status_code;
  IF NOT v_def.active AND (TG_OP = 'INSERT' OR NEW.status_code <> OLD.status_code) THEN
    RAISE EXCEPTION 'attendance.status_inactive: le statut % est désactivé', NEW.status_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_records_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance.student_records
  FOR EACH ROW EXECUTE FUNCTION attendance.student_records_guard();

CREATE FUNCTION attendance.student_records_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO attendance.record_history (id, tenant_id, record_id, session_id, from_status, to_status, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.session_id, NULL, NEW.status_code, kernel.current_user_id());
  ELSIF NEW.status_code <> OLD.status_code THEN
    INSERT INTO attendance.record_history (id, tenant_id, record_id, session_id, from_status, to_status, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.session_id, OLD.status_code, NEW.status_code, kernel.current_user_id());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_records_history AFTER INSERT OR UPDATE ON attendance.student_records
  FOR EACH ROW EXECUTE FUNCTION attendance.student_records_history();

-- -----------------------------------------------------------------------------
-- Justificatif : transitions légales (PENDING -> ACCEPTED | REJECTED | WITHDRAWN ;
-- ACCEPTED -> REVOKED), fenêtre et élève figés.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.justifications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.submitted_by_user <> OLD.submitted_by_user THEN
    RAISE EXCEPTION 'attendance.justification_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND (NEW.from_date <> OLD.from_date OR NEW.to_date <> OLD.to_date OR NEW.reason_code <> OLD.reason_code) THEN
    RAISE EXCEPTION 'attendance.justification_frozen: la fenêtre et le motif d''un justificatif décidé sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING'  AND NEW.status IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN')) OR
       (OLD.status = 'ACCEPTED' AND NEW.status = 'REVOKED')) THEN
    RAISE EXCEPTION 'attendance.justification_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER justifications_guard BEFORE UPDATE ON attendance.justifications
  FOR EACH ROW EXECUTE FUNCTION attendance.justifications_guard();

-- Congé : transitions légales.
CREATE FUNCTION attendance.staff_leaves_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.staff_id <> OLD.staff_id THEN
    RAISE EXCEPTION 'attendance.leave_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED')) OR
       (OLD.status = 'APPROVED'  AND NEW.status = 'CANCELLED')) THEN
    RAISE EXCEPTION 'attendance.leave_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_leaves_guard BEFORE UPDATE ON attendance.staff_leaves
  FOR EACH ROW EXECUTE FUNCTION attendance.staff_leaves_guard();

-- -----------------------------------------------------------------------------
-- Comptage brut d'un pointage par famille de statut (aucun seuil) : utilisé par le recalcul des
-- récapitulatifs et par les tests de conformité SQL <-> domaine.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.summarize_enrollment(p_enrollment uuid, p_from date, p_to date)
RETURNS TABLE (
  sessions_total integer, present_count integer, absent_count integer, excused_count integer,
  late_count integer, excused_late_count integer, early_leave_count integer,
  absent_minutes integer, excused_minutes integer, late_minutes integer)
LANGUAGE sql STABLE AS $$
  -- absent_* = TOTAL des absences (justifiées comprises) ; excused_* = sous-ensemble justifié.
  SELECT count(*)::integer,
         count(*) FILTER (WHERE d.counts_as_present)::integer,
         count(*) FILTER (WHERE d.counts_as_absence)::integer,
         count(*) FILTER (WHERE d.counts_as_absence AND r.excused)::integer,
         count(*) FILTER (WHERE d.counts_as_late)::integer,
         count(*) FILTER (WHERE d.counts_as_late AND r.excused)::integer,
         count(*) FILTER (WHERE r.status_code = 'EARLY_LEAVE')::integer,
         coalesce(sum(r.counted_minutes) FILTER (WHERE d.counts_as_absence), 0)::integer,
         coalesce(sum(r.counted_minutes) FILTER (WHERE d.counts_as_absence AND r.excused), 0)::integer,
         coalesce(sum(coalesce(r.minutes_late, r.counted_minutes)) FILTER (WHERE d.counts_as_late), 0)::integer
    FROM attendance.student_records r
    JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
    JOIN attendance.status_definitions d ON d.tenant_id = r.tenant_id AND d.subject_kind = r.subject_kind AND d.code = r.status_code
   WHERE r.tenant_id = kernel.current_tenant_id()
     AND r.enrollment_id = p_enrollment
     AND s.status IN ('SUBMITTED', 'VALIDATED')
     AND s.session_date BETWEEN p_from AND p_to
$$;
GRANT EXECUTE ON FUNCTION attendance.summarize_enrollment(uuid, date, date) TO app_user;
