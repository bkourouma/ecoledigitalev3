-- =============================================================================
-- 1504 — Module payroll : déclencheurs d'intégrité (défense en profondeur)
-- =============================================================================
--
-- Le domaine (TypeScript) refuse proprement ; la BASE refuse quoi qu'il arrive, quel que soit l'écrivain
-- (cas d'usage, script, SQL manuel). Le message de chaque exception commence par un code stable
-- `payroll.<code>:` lu par infrastructure/db-errors.ts ; `restrict_violation` pour une écriture interdite.
--
--   payslips_guard            machine d'états, colonnes autorisées par transition, séparation des tâches,
--                             seuil propriétaire, gel des montants hors CALCULATED, snapshot posé une seule fois
--   payslips_cancel_releases  l'annulation relâche les heures ET les jours de salaire (même transaction)
--   *_guard (lignes, réclamations, ajustements)  écritures seulement tant que le bulletin est CALCULATED
--   payslip_integrity (différé, au COMMIT)  toute ligne a sa réclamation et inversement ; les totaux du
--                             bulletin = Σ des lignes + salaire + ajustements (cohérent PAR CONSTRUCTION)
--   payslip_events_immutable  journal append-only
-- =============================================================================

CREATE FUNCTION payroll.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payroll.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER payslip_events_immutable BEFORE UPDATE OR DELETE ON payroll.payslip_events
  FOR EACH ROW EXECUTE FUNCTION payroll.forbid_mutation();
CREATE TRIGGER calculation_run_items_immutable BEFORE UPDATE OR DELETE ON payroll.calculation_run_items
  FOR EACH ROW EXECUTE FUNCTION payroll.forbid_mutation();
CREATE TRIGGER payslip_lines_no_update BEFORE UPDATE ON payroll.payslip_lines
  FOR EACH ROW EXECUTE FUNCTION payroll.forbid_mutation();
CREATE TRIGGER hour_claims_no_update BEFORE UPDATE ON payroll.hour_claims
  FOR EACH ROW EXECUTE FUNCTION payroll.forbid_mutation();
CREATE TRIGGER salary_day_claims_no_update BEFORE UPDATE ON payroll.salary_day_claims
  FOR EACH ROW EXECUTE FUNCTION payroll.forbid_mutation();
CREATE TRIGGER payslip_adjustments_no_update BEFORE UPDATE ON payroll.payslip_adjustments
  FOR EACH ROW EXECUTE FUNCTION payroll.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Bulletins : naissance, transitions, colonnes modifiables par transition
-- -----------------------------------------------------------------------------
CREATE FUNCTION payroll.payslips_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_changed  text[];
  v_allowed  text[];
  v_sep      boolean;
  v_thresh   bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'CALCULATED' THEN
      RAISE EXCEPTION 'payroll.invalid_transition: un bulletin naît CALCULATED (reçu %)', NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    -- une période reçoit son premier bulletin : elle n'est plus « en attente de calcul »
    UPDATE payroll.pay_periods SET awaiting_calculation = false, updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id AND awaiting_calculation;
    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.period_id <> OLD.period_id OR NEW.staff_id <> OLD.staff_id THEN
    RAISE EXCEPTION 'payroll.immutable: l''identité d''un bulletin (id, tenant, période, enseignant) est immuable' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'CALCULATED' AND NEW.status IN ('APPROVED', 'CANCELLED'))
    OR (OLD.status = 'APPROVED'   AND NEW.status IN ('PAID', 'DISPUTED', 'CANCELLED'))
    OR (OLD.status = 'DISPUTED'   AND NEW.status IN ('APPROVED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'payroll.invalid_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;

  -- colonnes réellement modifiées (hors horodatage de mise à jour et version)
  SELECT coalesce(array_agg(n.key), '{}') INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at', 'row_version');

  v_allowed := CASE
    WHEN OLD.status = 'CALCULATED' AND NEW.status = 'CALCULATED' THEN  -- recalcul
      ARRAY['config_id', 'payslip_kind', 'salary_amount', 'base_amount', 'overtime_amount', 'bonus_amount', 'deduction_amount',
            'total_amount', 'currency', 'regular_minutes', 'overtime_minutes', 'calc_details', 'config_snapshot',
            'calculated_at', 'calculated_by', 'calculated_by_name', 'replaces_payslip_id']
    WHEN OLD.status = 'CALCULATED' AND NEW.status = 'APPROVED' THEN
      ARRAY['status', 'approved_at', 'approved_by', 'approved_by_name', 'snapshot', 'snapshot_hash']
    WHEN NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
      ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancelled_by_name', 'cancel_reason']
    WHEN OLD.status = 'APPROVED' AND NEW.status = 'PAID' THEN
      ARRAY['status', 'paid_at', 'paid_by', 'paid_by_name', 'payment_method', 'payment_reference']
    WHEN OLD.status = 'APPROVED' AND NEW.status = 'DISPUTED' THEN
      ARRAY['status', 'disputed_at', 'dispute_reason']
    WHEN OLD.status = 'DISPUTED' AND NEW.status = 'APPROVED' THEN
      ARRAY['status', 'approved_at', 'approved_by', 'approved_by_name']
    ELSE ARRAY[]::text[]                                              -- tout autre statut : plus rien ne bouge
  END;

  IF NOT (v_changed <@ v_allowed) THEN
    RAISE EXCEPTION 'payroll.payslip_locked: colonnes non modifiables pour un bulletin % (% -> %) : %',
      OLD.status, OLD.status, NEW.status, array_to_string(ARRAY(SELECT c FROM unnest(v_changed) c WHERE NOT (c = ANY (v_allowed))), ', ')
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Arrêt (ou ré-arrêt après contestation) : séparation des tâches et seuil propriétaire.
  IF NEW.status = 'APPROVED' AND OLD.status IN ('CALCULATED', 'DISPUTED') THEN
    SELECT s.require_separate_approver, s.owner_approval_threshold INTO v_sep, v_thresh
      FROM payroll.settings s WHERE s.tenant_id = NEW.tenant_id;
    IF coalesce(v_sep, false) AND NEW.approved_by IS NOT DISTINCT FROM NEW.calculated_by THEN
      RAISE EXCEPTION 'payroll.separation_of_duties: celui qui a calculé le bulletin ne peut pas l''arrêter' USING ERRCODE = 'restrict_violation';
    END IF;
    IF v_thresh IS NOT NULL AND NEW.total_amount >= v_thresh
       AND coalesce(current_setting('payroll.actor_owner', true), '') <> 'true' THEN
      RAISE EXCEPTION 'payroll.owner_approval_required: ce montant exige l''arrêt par le propriétaire' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;
CREATE TRIGGER payslips_guard BEFORE INSERT OR UPDATE ON payroll.payslips
  FOR EACH ROW EXECUTE FUNCTION payroll.payslips_guard();

-- L'annulation relâche les heures et les jours de salaire, dans la même transaction.
CREATE FUNCTION payroll.payslips_cancel_releases() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
    DELETE FROM payroll.hour_claims WHERE tenant_id = NEW.tenant_id AND payslip_id = NEW.id;
    DELETE FROM payroll.salary_day_claims WHERE tenant_id = NEW.tenant_id AND payslip_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER payslips_cancel_releases AFTER UPDATE ON payroll.payslips
  FOR EACH ROW EXECUTE FUNCTION payroll.payslips_cancel_releases();

-- -----------------------------------------------------------------------------
-- Lignes, réclamations, ajustements : seulement tant que le bulletin est CALCULATED
-- (la suppression des réclamations d'un bulletin ANNULÉ est permise : c'est le relâchement).
-- -----------------------------------------------------------------------------
CREATE FUNCTION payroll.children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_payslip uuid;
  v_tenant  uuid;
  v_status  text;
  v_staff   uuid;
BEGIN
  v_payslip := CASE WHEN TG_OP = 'DELETE' THEN OLD.payslip_id ELSE NEW.payslip_id END;
  v_tenant  := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id  ELSE NEW.tenant_id  END;
  SELECT status, staff_id INTO v_status, v_staff FROM payroll.payslips WHERE tenant_id = v_tenant AND id = v_payslip;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll.not_found: bulletin % introuvable', v_payslip USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_status = 'CALCULATED' OR (v_status = 'CANCELLED' AND TG_TABLE_NAME IN ('hour_claims', 'salary_day_claims')) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payroll.payslip_locked: suppression dans % interdite pour un bulletin %', TG_TABLE_NAME, v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_status <> 'CALCULATED' THEN
    RAISE EXCEPTION 'payroll.payslip_locked: écriture dans % interdite pour un bulletin %', TG_TABLE_NAME, v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME IN ('payslip_lines', 'hour_claims', 'salary_day_claims') AND NEW.staff_id <> v_staff THEN
    RAISE EXCEPTION 'payroll.integrity_violation: % d''un autre enseignant que le titulaire du bulletin', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payslip_lines_guard BEFORE INSERT OR DELETE ON payroll.payslip_lines
  FOR EACH ROW EXECUTE FUNCTION payroll.children_guard();
CREATE TRIGGER hour_claims_guard BEFORE INSERT OR DELETE ON payroll.hour_claims
  FOR EACH ROW EXECUTE FUNCTION payroll.children_guard();
CREATE TRIGGER salary_day_claims_guard BEFORE INSERT OR DELETE ON payroll.salary_day_claims
  FOR EACH ROW EXECUTE FUNCTION payroll.children_guard();
CREATE TRIGGER payslip_adjustments_guard BEFORE INSERT OR DELETE ON payroll.payslip_adjustments
  FOR EACH ROW EXECUTE FUNCTION payroll.children_guard();

-- -----------------------------------------------------------------------------
-- Intégrité différée (au COMMIT) : lignes ↔ réclamations, totaux. Une seule vérification par bulletin et par
-- transaction (marqueur local), quel que soit le nombre de lignes écrites.
-- -----------------------------------------------------------------------------
CREATE FUNCTION payroll.payslip_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id      uuid;
  v_tenant  uuid;
  v_mark    text;
  p         payroll.payslips%ROWTYPE;
  v_reg_amt bigint; v_ot_amt bigint; v_reg_min bigint; v_ot_min bigint;
  v_bonus   bigint; v_ded bigint;
  v_days    bigint; v_claimed_days bigint;
BEGIN
  IF TG_TABLE_NAME = 'payslips' THEN
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.payslip_id ELSE NEW.payslip_id END;
  END IF;
  v_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;

  v_mark := 'payroll.chk_' || replace(v_id::text, '-', '_');
  IF coalesce(current_setting(v_mark, true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config(v_mark, '1', true);

  SELECT * INTO p FROM payroll.payslips WHERE tenant_id = v_tenant AND id = v_id;
  IF NOT FOUND OR p.status = 'CANCELLED' THEN RETURN NULL; END IF;     -- un bulletin annulé ne porte plus de réclamations

  SELECT coalesce(sum(amount) FILTER (WHERE NOT is_overtime), 0), coalesce(sum(amount) FILTER (WHERE is_overtime), 0),
         coalesce(sum(minutes) FILTER (WHERE NOT is_overtime), 0), coalesce(sum(minutes) FILTER (WHERE is_overtime), 0)
    INTO v_reg_amt, v_ot_amt, v_reg_min, v_ot_min
    FROM payroll.payslip_lines WHERE tenant_id = v_tenant AND payslip_id = v_id;

  IF p.base_amount <> p.salary_amount + v_reg_amt THEN
    RAISE EXCEPTION 'payroll.integrity_violation: base_amount (%) <> salaire (%) + lignes normales (%)', p.base_amount, p.salary_amount, v_reg_amt USING ERRCODE = 'check_violation';
  END IF;
  IF p.overtime_amount <> v_ot_amt THEN
    RAISE EXCEPTION 'payroll.integrity_violation: overtime_amount (%) <> somme des lignes majorées (%)', p.overtime_amount, v_ot_amt USING ERRCODE = 'check_violation';
  END IF;
  IF p.regular_minutes <> v_reg_min OR p.overtime_minutes <> v_ot_min THEN
    RAISE EXCEPTION 'payroll.integrity_violation: minutes du bulletin (% / %) <> minutes des lignes (% / %)', p.regular_minutes, p.overtime_minutes, v_reg_min, v_ot_min USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE kind = 'BONUS'), 0), coalesce(sum(amount) FILTER (WHERE kind = 'DEDUCTION'), 0)
    INTO v_bonus, v_ded FROM payroll.payslip_adjustments WHERE tenant_id = v_tenant AND payslip_id = v_id;
  IF p.bonus_amount <> v_bonus OR p.deduction_amount <> v_ded THEN
    RAISE EXCEPTION 'payroll.integrity_violation: primes/retenues du bulletin (% / %) <> ajustements (% / %)', p.bonus_amount, p.deduction_amount, v_bonus, v_ded USING ERRCODE = 'check_violation';
  END IF;

  -- toute ligne a sa réclamation (mêmes minutes) et inversement
  IF EXISTS (
    SELECT 1
      FROM (SELECT source_kind, source_ref_id, sum(minutes)::int AS m
              FROM payroll.payslip_lines WHERE tenant_id = v_tenant AND payslip_id = v_id GROUP BY source_kind, source_ref_id) l
      FULL JOIN (SELECT source_kind, source_ref_id, minutes AS m
                   FROM payroll.hour_claims WHERE tenant_id = v_tenant AND payslip_id = v_id) c
        USING (source_kind, source_ref_id)
     WHERE l.m IS DISTINCT FROM c.m
  ) THEN
    RAISE EXCEPTION 'payroll.integrity_violation: les lignes et les réclamations d''heures du bulletin % ne correspondent pas', v_id USING ERRCODE = 'check_violation';
  END IF;

  -- jours de salaire réclamés = jours dus déclarés par le calcul
  SELECT count(*) INTO v_claimed_days FROM payroll.salary_day_claims WHERE tenant_id = v_tenant AND payslip_id = v_id;
  SELECT coalesce(sum((m ->> 'daysDue')::int), 0) INTO v_days FROM jsonb_array_elements(coalesce(p.calc_details -> 'salaryMonths', '[]'::jsonb)) m;
  IF v_claimed_days <> v_days THEN
    RAISE EXCEPTION 'payroll.integrity_violation: % jour(s) de salaire réclamé(s) pour % jour(s) dus', v_claimed_days, v_days USING ERRCODE = 'check_violation';
  END IF;
  IF p.payslip_kind = 'HOURLY' AND v_claimed_days > 0 THEN
    RAISE EXCEPTION 'payroll.integrity_violation: un bulletin horaire ne réclame aucun jour de salaire' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER payslips_integrity AFTER INSERT OR UPDATE ON payroll.payslips
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.payslip_integrity();
CREATE CONSTRAINT TRIGGER payslip_lines_integrity AFTER INSERT OR DELETE ON payroll.payslip_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.payslip_integrity();
CREATE CONSTRAINT TRIGGER hour_claims_integrity AFTER INSERT OR DELETE ON payroll.hour_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.payslip_integrity();
CREATE CONSTRAINT TRIGGER salary_day_claims_integrity AFTER INSERT OR DELETE ON payroll.salary_day_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.payslip_integrity();
CREATE CONSTRAINT TRIGGER payslip_adjustments_integrity AFTER INSERT OR DELETE ON payroll.payslip_adjustments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.payslip_integrity();

-- -----------------------------------------------------------------------------
-- Périodes : ARCHIVED terminal ; dates figées dès qu'un bulletin non annulé existe ; statuts légaux ;
-- une période CLOSED/ARCHIVED n'est plus « en attente de calcul ».
-- -----------------------------------------------------------------------------
CREATE FUNCTION payroll.pay_periods_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'payroll.immutable: l''identité d''une période est immuable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'payroll.period_closed: une période archivée ne se modifie plus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT'  AND NEW.status IN ('ACTIVE', 'ARCHIVED'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('CLOSED', 'ARCHIVED'))
    OR (OLD.status = 'CLOSED' AND NEW.status IN ('ACTIVE', 'ARCHIVED'))
  ) THEN
    RAISE EXCEPTION 'payroll.invalid_transition: période % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date OR NEW.academic_year_id <> OLD.academic_year_id)
     AND EXISTS (SELECT 1 FROM payroll.payslips WHERE tenant_id = OLD.tenant_id AND period_id = OLD.id AND status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'payroll.period_has_payslips: les dates d''une période portant des bulletins ne se modifient plus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('CLOSED', 'ARCHIVED') THEN NEW.awaiting_calculation := false; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pay_periods_guard BEFORE UPDATE ON payroll.pay_periods
  FOR EACH ROW EXECUTE FUNCTION payroll.pay_periods_guard();

-- Un enseignant ciblé par une période ne se retire plus dès qu'un bulletin existe pour lui (pas de cascade).
CREATE FUNCTION payroll.pay_period_targets_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payroll.payslips WHERE tenant_id = OLD.tenant_id AND period_id = OLD.period_id AND staff_id = OLD.staff_id) THEN
    RAISE EXCEPTION 'payroll.period_has_payslips: cet enseignant a un bulletin sur la période, il ne peut plus en être retiré' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER pay_period_targets_guard BEFORE DELETE ON payroll.pay_period_targets
  FOR EACH ROW EXECUTE FUNCTION payroll.pay_period_targets_guard();
