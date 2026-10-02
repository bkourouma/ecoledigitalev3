-- =============================================================================
-- 2301 — Module stateassign : invariants imposés par la base
-- =============================================================================
--
--   1. la VÉRIFICATION d'une affectation, son activation, son rejet, sa suspension, sa fin sont des actes
--      HUMAINS (un job ne peut que RAPPROCHER et enregistrer des affectations importées) ;
--   2. séparation des tâches : celui qui enregistre n'est pas celui qui vérifie (réglage) ;
--   3. contenu figé dès la vérification : un avenant crée une NOUVELLE VERSION (l'ancienne est d'abord
--      remplacée), jamais une modification en place ;
--   4. rapprochement : le statut est CALCULÉ par la base depuis les écarts et la tolérance d'établissement ;
--   5. contrôles réalisés par un humain, anomalies résolues avec motif ; journal en ajout seul.
-- =============================================================================

CREATE FUNCTION stateassign.assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_set  stateassign.settings%ROWTYPE;
  v_prev stateassign.assignments%ROWTYPE;
  v_only_links boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: un dossier d''affectation ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_set FROM stateassign.settings WHERE tenant_id = NEW.tenant_id AND institution_id = NEW.institution_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RECEIVED' THEN
      RAISE EXCEPTION 'stateassign.initial_status: un dossier se crée RECEIVED' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source = 'MANUAL' THEN
      v_user := stateassign.require_human_actor();
      IF NEW.received_by IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'stateassign.receiver_mismatch: l''enregistrant est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    NEW.assignment_reference := btrim(NEW.assignment_reference);
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT * INTO v_prev FROM stateassign.assignments WHERE tenant_id = NEW.tenant_id AND id = NEW.supersedes_id;
      IF v_prev.status <> 'SUPERSEDED' OR v_prev.enrollment_id <> NEW.enrollment_id OR NEW.version <> v_prev.version + 1
         OR v_prev.academic_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'stateassign.amendment_invalid: un avenant suit une version REMPLACÉE de la même inscription (version + 1)' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.student_id <> OLD.student_id OR NEW.version <> OLD.version OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.source <> OLD.source OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
     OR NEW.external_payload_hash IS DISTINCT FROM OLD.external_payload_hash
     OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'stateassign.identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'RECEIVED' AND (NEW.assignment_reference <> OLD.assignment_reference OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
       OR NEW.issuing_authority IS DISTINCT FROM OLD.issuing_authority
       OR NEW.declared_state_amount IS DISTINCT FROM OLD.declared_state_amount
       OR NEW.declared_parent_amount IS DISTINCT FROM OLD.declared_parent_amount OR NEW.currency <> OLD.currency) THEN
    RAISE EXCEPTION 'stateassign.content_frozen: référence, autorité et montants déclarés ne changent plus après vérification (créer un avenant)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.assignment_reference := btrim(NEW.assignment_reference);
  IF OLD.status IN ('REJECTED', 'SUPERSEDED') AND to_jsonb(NEW) - 'updated_at' - 'row_version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'row_version' THEN
    RAISE EXCEPTION 'stateassign.final: dossier %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('RECEIVED', 'VERIFIED'), ('RECEIVED', 'REJECTED'), ('RECEIVED', 'SUPERSEDED'),
          ('VERIFIED', 'ACTIVE'), ('VERIFIED', 'REJECTED'), ('VERIFIED', 'SUPERSEDED'),
          ('ACTIVE', 'SUSPENDED'), ('ACTIVE', 'ENDED'), ('ACTIVE', 'TRANSFERRED'), ('ACTIVE', 'SUPERSEDED'),
          ('SUSPENDED', 'ACTIVE'), ('SUSPENDED', 'ENDED'), ('SUSPENDED', 'SUPERSEDED'))) THEN
      RAISE EXCEPTION 'stateassign.transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    v_user := stateassign.require_human_actor();
    IF NEW.status = 'VERIFIED' THEN
      IF coalesce(v_set.require_separate_verifier, true) AND OLD.received_by IS NOT DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'stateassign.four_eyes_required: la vérification doit venir d''une autre personne que l''enregistrant' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.verified_by := v_user;
      NEW.verified_at := now();
    ELSIF NEW.status = 'ACTIVE' THEN
      NEW.activated_at := coalesce(OLD.activated_at, now());
      NEW.suspended_at := NULL;
    ELSIF NEW.status = 'SUSPENDED' THEN
      NEW.suspended_at := now();
    END IF;
  END IF;

  -- Rapprochement : le statut est CALCULÉ (écarts et tolérance d'établissement), jamais saisi.
  IF NEW.last_reconciled_at IS DISTINCT FROM OLD.last_reconciled_at OR NEW.reconciled_state_delta IS DISTINCT FROM OLD.reconciled_state_delta
     OR NEW.reconciled_parent_delta IS DISTINCT FROM OLD.reconciled_parent_delta THEN
    IF NEW.last_reconciled_at IS NULL OR NEW.reconciled_state_delta IS NULL OR NEW.reconciled_parent_delta IS NULL THEN
      RAISE EXCEPTION 'stateassign.reconciliation_incomplete: date et écarts État / parent sont requis ensemble' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reconciliation_status := CASE
      WHEN abs(NEW.reconciled_state_delta) <= coalesce(v_set.reconciliation_tolerance, 0)
       AND abs(NEW.reconciled_parent_delta) <= coalesce(v_set.reconciliation_tolerance, 0) THEN 'BALANCED' ELSE 'DISCREPANCY' END;
  ELSE
    NEW.reconciliation_status := OLD.reconciliation_status;
  END IF;

  -- Toute autre modification de fond exige un humain ; le rapprochement et les liens finance peuvent venir d'un job.
  v_only_links := (to_jsonb(NEW) - 'updated_at' - 'row_version' - 'last_reconciled_at' - 'reconciled_state_delta' - 'reconciled_parent_delta'
                   - 'reconciliation_status' - 'finance_scholarship_id' - 'finance_state_invoice_id' - 'finance_parent_invoice_id')
                  IS NOT DISTINCT FROM
                  (to_jsonb(OLD) - 'updated_at' - 'row_version' - 'last_reconciled_at' - 'reconciled_state_delta' - 'reconciled_parent_delta'
                   - 'reconciliation_status' - 'finance_scholarship_id' - 'finance_state_invoice_id' - 'finance_parent_invoice_id');
  IF NOT v_only_links AND NEW.status = OLD.status THEN
    PERFORM stateassign.require_human_actor();
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.assignments
  FOR EACH ROW EXECUTE FUNCTION stateassign.assignments_guard();

-- Historique automatique
CREATE FUNCTION stateassign.log_assignment_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, to_status, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED', NEW.status, kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('version', NEW.version, 'source', NEW.source));
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status THEN
    v_reason := coalesce(NEW.rejection_reason, NEW.suspension_reason, NEW.end_reason, NEW.verification_note);
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, from_status, to_status, actor_id, actor_kind, reason)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'STATUS_CHANGED', OLD.status, NEW.status, kernel.current_user_id(), kernel.current_actor(), v_reason);
  END IF;
  IF NEW.last_reconciled_at IS DISTINCT FROM OLD.last_reconciled_at THEN
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'RECONCILED', kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('stateDelta', NEW.reconciled_state_delta::text, 'parentDelta', NEW.reconciled_parent_delta::text, 'status', NEW.reconciliation_status));
  END IF;
  IF NEW.finance_scholarship_id IS DISTINCT FROM OLD.finance_scholarship_id OR NEW.finance_state_invoice_id IS DISTINCT FROM OLD.finance_state_invoice_id
     OR NEW.finance_parent_invoice_id IS DISTINCT FROM OLD.finance_parent_invoice_id THEN
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, actor_id, actor_kind)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'LINKED', kernel.current_user_id(), kernel.current_actor());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assignments_log AFTER INSERT OR UPDATE ON stateassign.assignments
  FOR EACH ROW EXECUTE FUNCTION stateassign.log_assignment_event();
CREATE TRIGGER assignment_events_immutable BEFORE UPDATE OR DELETE ON stateassign.assignment_events
  FOR EACH ROW EXECUTE FUNCTION stateassign.forbid_mutation();

-- Contrôles : planifiés (humain ou job), réalisés par un humain, anomalie résolue avec motif
CREATE FUNCTION stateassign.controls_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_stat text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: un contrôle ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT status INTO v_stat FROM stateassign.assignments WHERE tenant_id = NEW.tenant_id AND id = NEW.assignment_id;
  IF TG_OP = 'INSERT' THEN
    IF v_stat NOT IN ('VERIFIED', 'ACTIVE', 'SUSPENDED') THEN
      RAISE EXCEPTION 'stateassign.control_state: un contrôle se planifie sur un dossier vérifié, actif ou suspendu (dossier %)', v_stat USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'stateassign.initial_status: un contrôle se planifie PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.kind <> OLD.kind OR NEW.academic_period_id IS DISTINCT FROM OLD.academic_period_id OR NEW.due_on <> OLD.due_on THEN
    RAISE EXCEPTION 'stateassign.control_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('PENDING', 'OK'), ('PENDING', 'ANOMALY'), ('PENDING', 'WAIVED'), ('ANOMALY', 'OK'))) THEN
      RAISE EXCEPTION 'stateassign.control_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    v_user := stateassign.require_human_actor();
    IF OLD.status = 'PENDING' THEN
      NEW.performed_by := v_user;
      NEW.performed_at := now();
    ELSE
      IF length(btrim(coalesce(NEW.anomaly_resolution, ''))) < 5 THEN
        RAISE EXCEPTION 'stateassign.resolution_required: une anomalie se résout avec un motif' USING ERRCODE = 'check_violation';
      END IF;
      NEW.anomaly_resolved_at := now();
    END IF;
  ELSIF OLD.status IN ('OK', 'WAIVED') THEN
    RAISE EXCEPTION 'stateassign.control_final: contrôle %', OLD.status USING ERRCODE = 'restrict_violation';
  ELSIF (to_jsonb(NEW) - 'updated_at' - 'due_notified_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'due_notified_at') THEN
    -- seul le marqueur d'alerte peut être posé par un job ; toute autre modification de fond est un acte humain
    PERFORM stateassign.require_human_actor();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER controls_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.controls
  FOR EACH ROW EXECUTE FUNCTION stateassign.controls_guard();

-- Documents : références seulement, retrait motivé
CREATE FUNCTION stateassign.documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: un document ne se supprime pas (le retirer avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := stateassign.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.added_by <> v_user THEN
      RAISE EXCEPTION 'stateassign.adder_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.kind <> OLD.kind OR NEW.document_ref <> OLD.document_ref OR NEW.added_by <> OLD.added_by THEN
    RAISE EXCEPTION 'stateassign.document_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'stateassign.document_withdrawn' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'WITHDRAWN' THEN
    NEW.withdrawn_by := v_user;
    NEW.withdrawn_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER documents_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.documents
  FOR EACH ROW EXECUTE FUNCTION stateassign.documents_guard();

-- Réglages : modifier la séparation des tâches, la tolérance ou les contrôles exigés est un acte humain.
CREATE FUNCTION stateassign.settings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := stateassign.require_human_actor();
  NEW.updated_by := v_user;
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'stateassign.identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER settings_guard BEFORE INSERT OR UPDATE ON stateassign.settings
  FOR EACH ROW EXECUTE FUNCTION stateassign.settings_guard();
