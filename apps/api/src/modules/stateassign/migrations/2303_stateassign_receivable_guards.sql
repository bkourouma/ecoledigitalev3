-- =============================================================================
-- 2303 — Module stateassign : invariants des créances et des formats d'export
-- =============================================================================
--
--   1. planifier, replanifier, annuler une échéance est un acte HUMAIN ; le rapprochement (montants reçus, marqueur
--      d'alerte de retard) peut venir d'un job, jamais le fond ;
--   2. la somme des échéances non annulées d'une inscription ne dépasse pas le montant État DÉCLARÉ du dossier
--      (un dossier sans montant déclaré n'accepte aucune échéance) ; un avenant ne peut pas descendre sous ce calendrier ;
--   3. le statut est CALCULÉ (jamais saisi) ; une échéance en partie reçue ne s'annule pas ; CANCELLED est final ;
--   4. historique des créances en ajout seul, alimenté par déclencheur ; formats d'export : acte humain.
-- =============================================================================

CREATE FUNCTION stateassign.receivables_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user      uuid;
  v_a         stateassign.assignments%ROWTYPE;
  v_scheduled bigint;
  v_next_seq  integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: une échéance ne se supprime pas (l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_user := stateassign.require_human_actor();
    -- Le dossier vivant est verrouillé : deux planifications concurrentes ne dépassent pas ensemble le montant déclaré.
    SELECT * INTO v_a FROM stateassign.assignments WHERE tenant_id = NEW.tenant_id AND id = NEW.assignment_id FOR UPDATE;
    IF NOT FOUND OR v_a.status NOT IN ('VERIFIED', 'ACTIVE', 'SUSPENDED') THEN
      RAISE EXCEPTION 'stateassign.receivable_state: une échéance se planifie sur un dossier vérifié, actif ou suspendu (dossier %)', coalesce(v_a.status, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.institution_id <> v_a.institution_id OR NEW.academic_year_id <> v_a.academic_year_id
       OR NEW.enrollment_id <> v_a.enrollment_id OR NEW.student_id <> v_a.student_id THEN
      RAISE EXCEPTION 'stateassign.receivable_mismatch: l''échéance doit porter l''établissement, l''année, l''inscription et l''élève de son dossier'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> v_a.currency THEN
      RAISE EXCEPTION 'stateassign.receivable_currency: la devise de l''échéance est celle du dossier (%)', v_a.currency USING ERRCODE = 'check_violation';
    END IF;
    IF v_a.declared_state_amount IS NULL THEN
      RAISE EXCEPTION 'stateassign.declared_amount_required: le dossier ne déclare aucun montant à la charge de l''État' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(expected_amount), 0) INTO v_scheduled
      FROM stateassign.receivables WHERE tenant_id = NEW.tenant_id AND enrollment_id = NEW.enrollment_id AND status <> 'CANCELLED';
    IF v_scheduled + NEW.expected_amount > v_a.declared_state_amount THEN
      RAISE EXCEPTION 'stateassign.receivable_exceeds_declared: les échéances (% + %) dépasseraient le montant déclaré à la charge de l''État (%)',
        v_scheduled, NEW.expected_amount, v_a.declared_state_amount USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(max(seq), 0) + 1 INTO v_next_seq FROM stateassign.receivables WHERE tenant_id = NEW.tenant_id AND enrollment_id = NEW.enrollment_id;
    NEW.seq := v_next_seq;
    NEW.status := 'OPEN';
    NEW.received_amount := 0;
    NEW.last_reconciled_at := NULL;
    NEW.overdue_flagged_at := NULL;
    NEW.cancel_reason := NULL; NEW.cancelled_by := NULL; NEW.cancelled_at := NULL;
    NEW.created_by := v_user;
    RETURN NEW;
  END IF;

  IF NEW.assignment_id <> OLD.assignment_id OR NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
     OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id OR NEW.seq <> OLD.seq
     OR NEW.currency <> OLD.currency OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'stateassign.receivable_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'stateassign.receivable_final: échéance annulée' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'CANCELLED' THEN
    v_user := stateassign.require_human_actor();
    IF OLD.received_amount > 0 OR NEW.received_amount > 0 THEN
      RAISE EXCEPTION 'stateassign.receivable_cancel_received: une échéance déjà (en partie) reçue ne s''annule pas' USING ERRCODE = 'check_violation';
    END IF;
    NEW.cancelled_by := v_user;
    NEW.cancelled_at := now();
  ELSE
    IF NEW.label IS DISTINCT FROM OLD.label OR NEW.due_on <> OLD.due_on OR NEW.expected_amount <> OLD.expected_amount THEN
      PERFORM stateassign.require_human_actor();
      IF NEW.due_on <> OLD.due_on THEN
        NEW.overdue_flagged_at := NULL;  -- une échéance reportée pourra être signalée de nouveau
      END IF;
      IF NEW.expected_amount <> OLD.expected_amount THEN
        SELECT * INTO v_a FROM stateassign.assignments
          WHERE tenant_id = NEW.tenant_id AND enrollment_id = NEW.enrollment_id AND status IN ('VERIFIED', 'ACTIVE', 'SUSPENDED', 'ENDED', 'TRANSFERRED')
          ORDER BY version DESC LIMIT 1 FOR UPDATE;
        SELECT coalesce(sum(expected_amount), 0) INTO v_scheduled FROM stateassign.receivables
          WHERE tenant_id = NEW.tenant_id AND enrollment_id = NEW.enrollment_id AND status <> 'CANCELLED' AND id <> NEW.id;
        IF v_a.declared_state_amount IS NULL OR v_scheduled + NEW.expected_amount > v_a.declared_state_amount THEN
          RAISE EXCEPTION 'stateassign.receivable_exceeds_declared: les échéances dépasseraient le montant déclaré à la charge de l''État'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
    -- Statut CALCULÉ depuis les montants : un statut saisi est ignoré.
    NEW.status := CASE
      WHEN NEW.received_amount = 0 THEN 'OPEN'
      WHEN NEW.received_amount < NEW.expected_amount THEN 'PARTIALLY_RECEIVED'
      ELSE 'RECEIVED' END;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER receivables_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.receivables
  FOR EACH ROW EXECUTE FUNCTION stateassign.receivables_guard();

-- Historique des créances
CREATE FUNCTION stateassign.log_receivable_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stateassign.receivable_events (id, tenant_id, receivable_id, action, to_status, to_amount, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED', NEW.status, NEW.expected_amount, kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('seq', NEW.seq, 'dueOn', NEW.due_on, 'label', NEW.label));
    RETURN NEW;
  END IF;
  IF NEW.due_on <> OLD.due_on THEN
    INSERT INTO stateassign.receivable_events (id, tenant_id, receivable_id, action, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'RESCHEDULED', kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('from', OLD.due_on, 'to', NEW.due_on));
  END IF;
  IF NEW.expected_amount <> OLD.expected_amount THEN
    INSERT INTO stateassign.receivable_events (id, tenant_id, receivable_id, action, from_amount, to_amount, actor_id, actor_kind)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'AMOUNT_CHANGED', OLD.expected_amount, NEW.expected_amount, kernel.current_user_id(), kernel.current_actor());
  END IF;
  IF NEW.received_amount <> OLD.received_amount THEN
    INSERT INTO stateassign.receivable_events (id, tenant_id, receivable_id, action, from_amount, to_amount, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'RECEIVED_UPDATED', OLD.received_amount, NEW.received_amount, kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('expected', NEW.expected_amount::text));
  END IF;
  IF NEW.status <> OLD.status THEN
    INSERT INTO stateassign.receivable_events (id, tenant_id, receivable_id, action, from_status, to_status, actor_id, actor_kind, reason)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, CASE WHEN NEW.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'STATUS_CHANGED' END,
            OLD.status, NEW.status, kernel.current_user_id(), kernel.current_actor(), NEW.cancel_reason);
  END IF;
  IF NEW.overdue_flagged_at IS NOT NULL AND OLD.overdue_flagged_at IS NULL THEN
    INSERT INTO stateassign.receivable_events (id, tenant_id, receivable_id, action, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'OVERDUE_FLAGGED', kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('dueOn', NEW.due_on));
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER receivables_log AFTER INSERT OR UPDATE ON stateassign.receivables
  FOR EACH ROW EXECUTE FUNCTION stateassign.log_receivable_event();
CREATE TRIGGER receivable_events_immutable BEFORE UPDATE OR DELETE ON stateassign.receivable_events
  FOR EACH ROW EXECUTE FUNCTION stateassign.forbid_mutation();

-- Un avenant ne peut pas descendre sous le calendrier déjà planifié pour l'inscription.
CREATE FUNCTION stateassign.assignments_schedule_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_scheduled bigint;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(expected_amount), 0) INTO v_scheduled FROM stateassign.receivables
    WHERE tenant_id = NEW.tenant_id AND enrollment_id = NEW.enrollment_id AND status <> 'CANCELLED';
  IF v_scheduled > coalesce(NEW.declared_state_amount, 0) THEN
    RAISE EXCEPTION 'stateassign.amendment_below_schedule: le montant déclaré à la charge de l''État (%) est inférieur aux échéances planifiées (%) : annuler ou revoir les échéances d''abord',
      coalesce(NEW.declared_state_amount, 0), v_scheduled USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assignments_schedule_guard BEFORE INSERT ON stateassign.assignments
  FOR EACH ROW EXECUTE FUNCTION stateassign.assignments_schedule_guard();

-- Formats d'export : acte humain, identité figée.
CREATE FUNCTION stateassign.export_formats_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := stateassign.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := v_user;
    NEW.updated_by := v_user;
    RETURN NEW;
  END IF;
  IF NEW.institution_id <> OLD.institution_id OR NEW.code <> OLD.code OR NEW.dataset <> OLD.dataset THEN
    RAISE EXCEPTION 'stateassign.identity_immutable: établissement, code et jeu d''un format ne changent pas' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_by := v_user;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER export_formats_guard BEFORE INSERT OR UPDATE ON stateassign.export_formats
  FOR EACH ROW EXECUTE FUNCTION stateassign.export_formats_guard();
