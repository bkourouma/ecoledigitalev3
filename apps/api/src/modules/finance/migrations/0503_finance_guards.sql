-- =============================================================================
-- 0503 — Module finance : immuabilité, machines d'états en base, cohérence des sommes
-- =============================================================================
--
-- Défense en profondeur : le domaine (TypeScript) applique ces règles, la base les
-- IMPOSE — un bug applicatif ou une requête manuelle ne peut ni réécrire un reçu,
-- ni modifier un paiement confirmé, ni laisser des cumuls incohérents après COMMIT.
--
--   * déclencheurs BEFORE : immuabilité et transitions d'état légales ;
--   * déclencheurs CONSTRAINT différés (vérifiés au COMMIT) : les cumuls mis en cache
--     (`paid_amount`, `credited_amount`, `allocated_amount`, `refunded_amount`) égalent
--     la somme des écritures qui les justifient ; total facture = Σ lignes ; Σ échéances
--     = total ; tout paiement confirmé a un reçu.
--
-- Codes d'erreur : `restrict_violation` (23001) pour une écriture interdite,
-- `check_violation` (23514) pour une incohérence de sommes. Le message commence par
-- un code stable `finance.*`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Écritures strictement append-only
-- -----------------------------------------------------------------------------
CREATE FUNCTION finance.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finance.immutable: % est immuable (% interdit) — corrigez par une écriture inverse', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON finance.receipts
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER credit_notes_immutable BEFORE UPDATE OR DELETE ON finance.credit_notes
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER payment_allocations_immutable BEFORE UPDATE OR DELETE ON finance.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER allocation_reversals_immutable BEFORE UPDATE OR DELETE ON finance.allocation_reversals
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER invoice_discounts_immutable BEFORE UPDATE OR DELETE ON finance.invoice_discounts
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON finance.payments
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON finance.invoices
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON finance.refunds
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();
CREATE TRIGGER cash_sessions_no_delete BEFORE DELETE ON finance.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Factures : identité figée, transitions légales (miroir de INVOICE_TRANSITIONS)
-- -----------------------------------------------------------------------------
CREATE FUNCTION finance.invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.learner_id <> OLD.learner_id
     OR NEW.payer_kind <> OLD.payer_kind OR NEW.currency <> OLD.currency OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'finance.invoice_immutable: identité de la facture figée' USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'ISSUED', 'CANCELLED') THEN
      RAISE EXCEPTION 'finance.invalid_transition: facture DRAFT -> %', NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('CANCELLED', 'CREDITED') THEN
    RAISE EXCEPTION 'finance.invoice_terminal: une facture % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  -- Facture émise : numéro, montants, rattachements figés.
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.number_year IS DISTINCT FROM OLD.number_year
     OR NEW.number_seq IS DISTINCT FROM OLD.number_seq OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id OR NEW.academic_year <> OLD.academic_year
     OR NEW.group_key IS DISTINCT FROM OLD.group_key OR NEW.group_label IS DISTINCT FROM OLD.group_label
     OR NEW.institution_id IS DISTINCT FROM OLD.institution_id OR NEW.campus_id IS DISTINCT FROM OLD.campus_id
     OR NEW.funding_type IS DISTINCT FROM OLD.funding_type OR NEW.payer_ref IS DISTINCT FROM OLD.payer_ref
     OR NEW.related_group_id IS DISTINCT FROM OLD.related_group_id
     OR NEW.subtotal_amount <> OLD.subtotal_amount OR NEW.discount_amount <> OLD.discount_amount
     OR NEW.scholarship_amount <> OLD.scholarship_amount OR NEW.total_amount <> OLD.total_amount
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'finance.invoice_immutable: une facture émise ne se modifie pas (montants, numéro, rattachements)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  v_ok := CASE OLD.status
    WHEN 'ISSUED'         THEN NEW.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'CREDITED')
    WHEN 'PARTIALLY_PAID' THEN NEW.status IN ('PARTIALLY_PAID', 'ISSUED', 'PAID', 'OVERDUE')
    WHEN 'OVERDUE'        THEN NEW.status IN ('OVERDUE', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CREDITED', 'CANCELLED')
    WHEN 'PAID'           THEN NEW.status IN ('PAID', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    ELSE false
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'finance.invalid_transition: facture % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoices_guard BEFORE UPDATE ON finance.invoices
  FOR EACH ROW EXECUTE FUNCTION finance.invoices_guard();

-- Lignes : modifiables uniquement tant que la facture est un brouillon.
CREATE FUNCTION finance.invoice_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM finance.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'finance.invoice_lines_locked: les lignes d''une facture émise sont figées (statut %)', COALESCE(v_status, 'inconnu')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION finance.invoice_lines_guard();

-- Échéances : la structure (montant, date, rang) ne change que sur un brouillon ou une
-- facture émise SANS encaissement ni avoir ; les cumuls (paid/credited) évoluent librement.
CREATE FUNCTION finance.installments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_inv      finance.invoices%ROWTYPE;
  v_struct   boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_struct := NEW.invoice_id <> OLD.invoice_id OR NEW.seq <> OLD.seq OR NEW.label <> OLD.label
             OR NEW.due_date <> OLD.due_date OR NEW.amount <> OLD.amount;
    IF NOT v_struct THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT * INTO v_inv FROM finance.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance.installments_locked: facture introuvable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (v_inv.status = 'DRAFT'
          OR (v_inv.status IN ('ISSUED', 'OVERDUE') AND v_inv.paid_amount = 0 AND v_inv.credited_amount = 0)) THEN
    RAISE EXCEPTION 'finance.installments_locked: échéancier figé (facture %, encaissé %, crédité %)',
      v_inv.status, v_inv.paid_amount, v_inv.credited_amount USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND (OLD.paid_amount <> 0 OR OLD.credited_amount <> 0) THEN
    RAISE EXCEPTION 'finance.installments_locked: échéance déjà encaissée ou créditée' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER installments_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.installments
  FOR EACH ROW EXECUTE FUNCTION finance.installments_guard();

-- -----------------------------------------------------------------------------
-- Paiements : un paiement confirmé est IMMUABLE (hors cumuls imputé/remboursé)
-- -----------------------------------------------------------------------------
CREATE FUNCTION finance.payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_session_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM finance.cash_sessions s WHERE s.id = NEW.cash_session_id AND s.status = 'OPEN') THEN
      RAISE EXCEPTION 'finance.cash_session_closed: la session de caisse n''est pas ouverte' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.learner_id <> OLD.learner_id
     OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id OR NEW.payer_kind <> OLD.payer_kind
     OR NEW.payer_ref IS DISTINCT FROM OLD.payer_ref OR NEW.payer_name IS DISTINCT FROM OLD.payer_name
     OR NEW.method <> OLD.method OR NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.request_fingerprint <> OLD.request_fingerprint
     OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.intended_invoice_id IS DISTINCT FROM OLD.intended_invoice_id
     OR NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id OR NEW.simulated <> OLD.simulated
     OR NEW.received_at <> OLD.received_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'finance.payment_immutable: montant, mode, payeur et références d''un paiement sont figés'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status IN ('FAILED', 'REFUNDED') THEN
    RAISE EXCEPTION 'finance.payment_terminal: un paiement % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED', 'FAILED'))
    OR (OLD.status = 'CONFIRMED' AND NEW.status = 'REFUNDED')) THEN
    RAISE EXCEPTION 'finance.invalid_transition: paiement % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'CONFIRMED' THEN
    IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
       OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason
       OR NEW.provider_ref IS DISTINCT FROM OLD.provider_ref OR NEW.provider_status IS DISTINCT FROM OLD.provider_status THEN
      RAISE EXCEPTION 'finance.payment_immutable: un paiement confirmé ne se modifie pas' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.refunded_amount < OLD.refunded_amount THEN
      RAISE EXCEPTION 'finance.payment_immutable: le cumul remboursé ne diminue pas' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD.status = 'PENDING' THEN
    IF OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref THEN
      RAISE EXCEPTION 'finance.payment_immutable: la référence fournisseur ne change pas' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON finance.payments
  FOR EACH ROW EXECUTE FUNCTION finance.payments_guard();

-- Imputation : paiement confirmé, même apprenant et même payeur, échéance de la bonne
-- facture, facture encaissable, même devise.
CREATE FUNCTION finance.payment_allocations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pay finance.payments%ROWTYPE;
  v_inv finance.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_pay FROM finance.payments WHERE id = NEW.payment_id;
  SELECT * INTO v_inv FROM finance.invoices WHERE id = NEW.invoice_id;
  IF v_pay.id IS NULL OR v_inv.id IS NULL THEN
    RAISE EXCEPTION 'finance.allocation_invalid: paiement ou facture introuvable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_pay.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'finance.allocation_invalid: seul un paiement confirmé s''impute (statut %)', v_pay.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_pay.learner_id <> v_inv.learner_id OR v_pay.payer_kind <> v_inv.payer_kind
     OR v_pay.payer_ref IS DISTINCT FROM v_inv.payer_ref OR v_pay.currency <> v_inv.currency THEN
    RAISE EXCEPTION 'finance.allocation_invalid: apprenant, payeur ou devise différents entre paiement et facture'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_inv.status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') THEN
    RAISE EXCEPTION 'finance.invoice_not_payable: facture % non encaissable', v_inv.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.installments i WHERE i.id = NEW.installment_id AND i.invoice_id = NEW.invoice_id) THEN
    RAISE EXCEPTION 'finance.allocation_invalid: l''échéance n''appartient pas à la facture' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.line_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM finance.invoice_lines l WHERE l.id = NEW.line_id AND l.invoice_id = NEW.invoice_id) THEN
    RAISE EXCEPTION 'finance.allocation_invalid: la ligne n''appartient pas à la facture' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payment_allocations_guard BEFORE INSERT ON finance.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION finance.payment_allocations_guard();

-- Reprise : ne reprend jamais plus que l'imputation nette, sur le bon paiement.
CREATE FUNCTION finance.allocation_reversals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_alloc    finance.payment_allocations%ROWTYPE;
  v_reversed bigint;
BEGIN
  SELECT * INTO v_alloc FROM finance.payment_allocations WHERE id = NEW.allocation_id;
  IF v_alloc.id IS NULL OR v_alloc.payment_id <> NEW.payment_id THEN
    RAISE EXCEPTION 'finance.reversal_invalid: imputation introuvable ou d''un autre paiement' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_reversed FROM finance.allocation_reversals WHERE allocation_id = NEW.allocation_id;
  IF v_reversed + NEW.amount > v_alloc.amount THEN
    RAISE EXCEPTION 'finance.reversal_invalid: reprise (%) supérieure au net imputé (%)', v_reversed + NEW.amount, v_alloc.amount
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER allocation_reversals_guard BEFORE INSERT ON finance.allocation_reversals
  FOR EACH ROW EXECUTE FUNCTION finance.allocation_reversals_guard();

-- Remboursements : machine d'états REQUESTED -> APPROVED -> COMPLETED | REJECTED.
CREATE FUNCTION finance.refunds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pay finance.payments%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_pay FROM finance.payments WHERE id = NEW.payment_id;
    IF v_pay.id IS NULL OR v_pay.status <> 'CONFIRMED' OR v_pay.currency <> NEW.currency THEN
      RAISE EXCEPTION 'finance.refund_invalid: seul un paiement confirmé, dans la même devise, se rembourse'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'finance.invalid_transition: un remboursement naît REQUESTED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.payment_id <> OLD.payment_id OR NEW.amount <> OLD.amount
     OR NEW.currency <> OLD.currency OR NEW.reason <> OLD.reason OR NEW.requested_by <> OLD.requested_by
     OR NEW.requested_at <> OLD.requested_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint THEN
    RAISE EXCEPTION 'finance.refund_immutable: montant, motif et demandeur d''un remboursement sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('COMPLETED', 'REJECTED') THEN
    RAISE EXCEPTION 'finance.refund_terminal: un remboursement % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'REJECTED'))) THEN
    RAISE EXCEPTION 'finance.invalid_transition: remboursement % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id AND NEW.cash_session_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM finance.cash_sessions s WHERE s.id = NEW.cash_session_id AND s.status = 'OPEN') THEN
    RAISE EXCEPTION 'finance.cash_session_closed: la session de caisse n''est pas ouverte' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER refunds_guard BEFORE INSERT OR UPDATE ON finance.refunds
  FOR EACH ROW EXECUTE FUNCTION finance.refunds_guard();

-- Sessions de caisse : OPEN -> CLOSED, définitif.
CREATE FUNCTION finance.cash_sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.register_id <> OLD.register_id
     OR NEW.cashier_id <> OLD.cashier_id OR NEW.currency <> OLD.currency
     OR NEW.opening_float <> OLD.opening_float OR NEW.opened_at <> OLD.opened_at THEN
    RAISE EXCEPTION 'finance.cash_session_immutable: caisse, caissier, fonds et ouverture sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'finance.cash_session_closed: une session clôturée ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cash_sessions_guard BEFORE UPDATE ON finance.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION finance.cash_sessions_guard();

-- -----------------------------------------------------------------------------
-- Cohérence des sommes, vérifiée AU COMMIT (déclencheurs de contrainte différés)
-- -----------------------------------------------------------------------------
CREATE FUNCTION finance.check_invoice_consistent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id      uuid;
  v_inv     finance.invoices%ROWTYPE;
  v_lines   bigint;
  v_n       integer;
  v_amount  bigint;
  v_paid    bigint;
  v_cred    bigint;
  v_alloc   bigint;
  v_rev     bigint;
  v_notes   bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    v_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'allocation_reversals' THEN
    SELECT invoice_id INTO v_id FROM finance.payment_allocations WHERE id = COALESCE(NEW.allocation_id, OLD.allocation_id);
  ELSE
    v_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;

  SELECT * INTO v_inv FROM finance.invoices WHERE id = v_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO v_lines FROM finance.invoice_lines WHERE invoice_id = v_id;
  IF v_lines <> v_inv.total_amount THEN
    RAISE EXCEPTION 'finance.invoice_total_mismatch: total % <> somme des lignes %', v_inv.total_amount, v_lines
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(paid_amount), 0), COALESCE(sum(credited_amount), 0)
    INTO v_n, v_amount, v_paid, v_cred
    FROM finance.installments WHERE invoice_id = v_id;
  IF v_n = 0 THEN
    IF v_inv.status NOT IN ('DRAFT', 'CANCELLED') THEN
      RAISE EXCEPTION 'finance.installments_missing: une facture émise a au moins une échéance' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF v_amount <> v_inv.total_amount THEN
      RAISE EXCEPTION 'finance.installments_sum_mismatch: échéances % <> total %', v_amount, v_inv.total_amount
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_paid <> v_inv.paid_amount OR v_cred <> v_inv.credited_amount THEN
      RAISE EXCEPTION 'finance.invoice_cumul_mismatch: cumuls facture (payé %, crédité %) <> échéances (%, %)',
        v_inv.paid_amount, v_inv.credited_amount, v_paid, v_cred USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM finance.installments i
       WHERE i.invoice_id = v_id
         AND i.paid_amount <>
             COALESCE((SELECT sum(a.amount) FROM finance.payment_allocations a WHERE a.installment_id = i.id), 0)
           - COALESCE((SELECT sum(r.amount) FROM finance.allocation_reversals r
                         JOIN finance.payment_allocations a2 ON a2.id = r.allocation_id
                        WHERE a2.installment_id = i.id), 0)
    ) THEN
      RAISE EXCEPTION 'finance.installment_paid_mismatch: encaissé d''une échéance <> imputations nettes' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_alloc FROM finance.payment_allocations WHERE invoice_id = v_id;
  SELECT COALESCE(sum(r.amount), 0) INTO v_rev
    FROM finance.allocation_reversals r JOIN finance.payment_allocations a ON a.id = r.allocation_id
   WHERE a.invoice_id = v_id;
  IF v_alloc - v_rev <> v_inv.paid_amount THEN
    RAISE EXCEPTION 'finance.invoice_paid_mismatch: encaissé % <> imputations nettes %', v_inv.paid_amount, v_alloc - v_rev
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_notes FROM finance.credit_notes WHERE invoice_id = v_id;
  IF v_notes <> v_inv.credited_amount THEN
    RAISE EXCEPTION 'finance.invoice_credit_mismatch: crédité % <> somme des avoirs %', v_inv.credited_amount, v_notes
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER invoices_consistent AFTER INSERT OR UPDATE ON finance.invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_invoice_consistent();
CREATE CONSTRAINT TRIGGER invoice_lines_consistent AFTER INSERT OR UPDATE OR DELETE ON finance.invoice_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_invoice_consistent();
CREATE CONSTRAINT TRIGGER installments_consistent AFTER INSERT OR UPDATE OR DELETE ON finance.installments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_invoice_consistent();
CREATE CONSTRAINT TRIGGER allocations_invoice_consistent AFTER INSERT ON finance.payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_invoice_consistent();
CREATE CONSTRAINT TRIGGER reversals_invoice_consistent AFTER INSERT ON finance.allocation_reversals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_invoice_consistent();
CREATE CONSTRAINT TRIGGER credit_notes_invoice_consistent AFTER INSERT ON finance.credit_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_invoice_consistent();

CREATE FUNCTION finance.check_payment_consistent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id      uuid;
  v_pay     finance.payments%ROWTYPE;
  v_alloc   bigint;
  v_rev     bigint;
  v_refund  bigint;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    v_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_id := COALESCE(NEW.payment_id, OLD.payment_id);
  END IF;

  SELECT * INTO v_pay FROM finance.payments WHERE id = v_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_alloc FROM finance.payment_allocations WHERE payment_id = v_id;
  SELECT COALESCE(sum(amount), 0) INTO v_rev FROM finance.allocation_reversals WHERE payment_id = v_id;
  IF v_alloc - v_rev <> v_pay.allocated_amount THEN
    RAISE EXCEPTION 'finance.payment_allocated_mismatch: imputé % <> imputations nettes %', v_pay.allocated_amount, v_alloc - v_rev
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_refund FROM finance.refunds WHERE payment_id = v_id AND status = 'COMPLETED';
  IF v_refund <> v_pay.refunded_amount THEN
    RAISE EXCEPTION 'finance.payment_refunded_mismatch: remboursé % <> remboursements terminés %', v_pay.refunded_amount, v_refund
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_pay.status IN ('CONFIRMED', 'REFUNDED') THEN
    IF NOT EXISTS (SELECT 1 FROM finance.receipts WHERE payment_id = v_id) THEN
      RAISE EXCEPTION 'finance.receipt_missing: un paiement confirmé a toujours un reçu' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM finance.receipts WHERE payment_id = v_id) THEN
    RAISE EXCEPTION 'finance.receipt_unexpected: pas de reçu pour un paiement %', v_pay.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER payments_consistent AFTER INSERT OR UPDATE ON finance.payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_payment_consistent();
CREATE CONSTRAINT TRIGGER allocations_payment_consistent AFTER INSERT ON finance.payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_payment_consistent();
CREATE CONSTRAINT TRIGGER reversals_payment_consistent AFTER INSERT ON finance.allocation_reversals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_payment_consistent();
CREATE CONSTRAINT TRIGGER refunds_payment_consistent AFTER INSERT OR UPDATE ON finance.refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_payment_consistent();
CREATE CONSTRAINT TRIGGER receipts_payment_consistent AFTER INSERT ON finance.receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.check_payment_consistent();
