-- =============================================================================
-- 0506 — Module finance : rapprochement des paiements en attente, remboursement réel
--        chez le fournisseur, résolutions manuelles à quatre yeux (spec 015)
-- =============================================================================
--
--   * `finance.refunds` : deux états de plus (REFUND_PENDING = envoyé au fournisseur, résultat pas encore connu ;
--     REFUND_FAILED = refus définitif du fournisseur, rien n'a été remboursé) et la trace de l'exécution (mode,
--     fournisseur, référence, statut, motif d'échec, preuve d'un remboursement manuel).
--     Les ÉCRITURES COMPTABLES (reprises d'imputation, cumul remboursé) ne sont passées qu'à COMPLETED : un remboursement
--     en vol ne touche ni factures ni cumuls, et un échec ne laisse rien à défaire (les écritures sont immuables).
--   * `finance.reconciliation_state` : un enregistrement par paiement en attente / remboursement en vol suivi par le job
--     (tentatives, prochaine échéance, indicateur « à rapprocher »). Sert aussi de bail entre instances du worker.
--   * `finance.manual_resolutions` : demande motivée (avec preuve) de régler À LA MAIN un paiement ou un remboursement
--     indéterminé ; QUATRE YEUX : une autre personne approuve (le CHECK n'impose pas la dualité, le cas d'usage la
--     contrôle selon la configuration, comme pour les remboursements).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Remboursements : nouveaux états et trace d'exécution
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'finance.refunds'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE finance.refunds DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

ALTER TABLE finance.refunds
  ADD COLUMN execution_mode        text,
  ADD COLUMN provider              text,
  ADD COLUMN provider_refund_ref   text,
  ADD COLUMN provider_status       text,
  ADD COLUMN provider_requested_at timestamptz,
  ADD COLUMN failed_at             timestamptz,
  ADD COLUMN failure_reason        text,
  ADD COLUMN manual_reference      text,
  ADD COLUMN manual_note           text;

ALTER TABLE finance.refunds
  ADD CONSTRAINT refunds_status_check
    CHECK (status IN ('REQUESTED', 'APPROVED', 'REFUND_PENDING', 'COMPLETED', 'REFUND_FAILED', 'REJECTED')),
  ADD CONSTRAINT refunds_execution_mode_check
    CHECK (execution_mode IS NULL OR execution_mode IN ('LEDGER', 'PROVIDER', 'MANUAL')),
  ADD CONSTRAINT refunds_approved_check
    CHECK (status NOT IN ('APPROVED', 'REFUND_PENDING', 'COMPLETED', 'REFUND_FAILED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  ADD CONSTRAINT refunds_completed_check
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  ADD CONSTRAINT refunds_rejected_check
    CHECK (status <> 'REJECTED' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL)),
  ADD CONSTRAINT refunds_pending_check
    CHECK (status <> 'REFUND_PENDING' OR (execution_mode = 'PROVIDER' AND provider IS NOT NULL AND provider_requested_at IS NOT NULL)),
  ADD CONSTRAINT refunds_failed_check
    CHECK (status <> 'REFUND_FAILED' OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL)),
  ADD CONSTRAINT refunds_manual_check
    CHECK (execution_mode IS DISTINCT FROM 'MANUAL' OR (manual_reference IS NOT NULL AND length(btrim(manual_reference)) >= 3));

-- Les remboursements en vol sont retrouvés par le job : index partiel.
CREATE INDEX refunds_in_flight_idx ON finance.refunds (tenant_id, provider_requested_at) WHERE status = 'REFUND_PENDING';

-- Machine d'états : REQUESTED -> APPROVED -> (REFUND_PENDING ->) COMPLETED | REFUND_FAILED ; REQUESTED | APPROVED -> REJECTED.
CREATE OR REPLACE FUNCTION finance.refunds_guard() RETURNS trigger
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
  IF OLD.status IN ('COMPLETED', 'REJECTED', 'REFUND_FAILED') THEN
    RAISE EXCEPTION 'finance.refund_terminal: un remboursement % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('REFUND_PENDING', 'COMPLETED', 'REJECTED'))
    OR (OLD.status = 'REFUND_PENDING' AND NEW.status IN ('COMPLETED', 'REFUND_FAILED'))) THEN
    RAISE EXCEPTION 'finance.invalid_transition: remboursement % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  -- Une fois envoyé au fournisseur, le mode, le fournisseur et la date d'envoi ne changent plus (jamais de second envoi ailleurs).
  IF OLD.provider IS NOT NULL AND (NEW.provider IS DISTINCT FROM OLD.provider OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode
     OR NEW.provider_requested_at IS DISTINCT FROM OLD.provider_requested_at) THEN
    RAISE EXCEPTION 'finance.refund_immutable: fournisseur et mode d''exécution figés une fois le remboursement envoyé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.provider_refund_ref IS NOT NULL AND NEW.provider_refund_ref IS DISTINCT FROM OLD.provider_refund_ref THEN
    RAISE EXCEPTION 'finance.refund_immutable: la référence fournisseur du remboursement ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id AND NEW.cash_session_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM finance.cash_sessions s WHERE s.id = NEW.cash_session_id AND s.status = 'OPEN') THEN
    RAISE EXCEPTION 'finance.cash_session_closed: la session de caisse n''est pas ouverte' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

-- -----------------------------------------------------------------------------
-- Paiements en attente : index du job de rapprochement
-- -----------------------------------------------------------------------------
CREATE INDEX payments_pending_online_idx ON finance.payments (tenant_id, received_at)
  WHERE status = 'PENDING' AND method = 'ONLINE';

-- -----------------------------------------------------------------------------
-- Suivi du rapprochement (un enregistrement par paiement en attente / remboursement en vol)
-- -----------------------------------------------------------------------------
CREATE TABLE finance.reconciliation_state (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  payment_id       uuid,
  refund_id        uuid,
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_attempt_at timestamptz,
  last_attempt_at  timestamptz,
  -- Prochaine échéance ; sert aussi de BAIL (poussée dans le futur par l'instance qui prend la tâche).
  next_attempt_at  timestamptz NOT NULL,
  last_outcome     text,
  last_error_code  text,
  -- Renseigné quand le job ne peut plus conclure : `finance.*.reconciliation_needed` a été publié, action humaine requise.
  flagged_at       timestamptz,
  flag_reason      text,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_id IS NULL) <> (refund_id IS NULL)),
  CHECK (flagged_at IS NULL OR flag_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id),
  FOREIGN KEY (tenant_id, refund_id) REFERENCES finance.refunds (tenant_id, id)
);
CREATE UNIQUE INDEX reconciliation_state_payment_uidx ON finance.reconciliation_state (tenant_id, payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX reconciliation_state_refund_uidx ON finance.reconciliation_state (tenant_id, refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX reconciliation_state_due_idx ON finance.reconciliation_state (tenant_id, next_attempt_at)
  WHERE resolved_at IS NULL AND flagged_at IS NULL;
CREATE INDEX reconciliation_state_flagged_idx ON finance.reconciliation_state (tenant_id, flagged_at)
  WHERE flagged_at IS NOT NULL AND resolved_at IS NULL;
SELECT kernel.enable_tenant_rls('finance.reconciliation_state');
-- Jamais de DELETE : l'historique du suivi reste lisible.
GRANT SELECT, INSERT, UPDATE ON finance.reconciliation_state TO app_user;

-- -----------------------------------------------------------------------------
-- Résolutions manuelles à quatre yeux
-- -----------------------------------------------------------------------------
CREATE TABLE finance.manual_resolutions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  payment_id    uuid,
  refund_id     uuid,
  -- Ce qui s'est RÉELLEMENT passé chez le fournisseur : l'argent est arrivé / parti (SUCCEEDED) ou non (FAILED).
  outcome       text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED')),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  -- Preuve : référence de transaction du relevé opérateur, numéro de pièce… (jamais une capture : texte court).
  evidence_ref  text NOT NULL CHECK (length(btrim(evidence_ref)) >= 3),
  status        text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL,
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_id IS NULL) <> (refund_id IS NULL)),
  CHECK (status = 'REQUESTED' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id),
  FOREIGN KEY (tenant_id, refund_id) REFERENCES finance.refunds (tenant_id, id)
);
-- Une seule demande ouverte par sujet.
CREATE UNIQUE INDEX manual_resolutions_open_payment_uidx ON finance.manual_resolutions (tenant_id, payment_id)
  WHERE status = 'REQUESTED' AND payment_id IS NOT NULL;
CREATE UNIQUE INDEX manual_resolutions_open_refund_uidx ON finance.manual_resolutions (tenant_id, refund_id)
  WHERE status = 'REQUESTED' AND refund_id IS NOT NULL;
CREATE INDEX manual_resolutions_status_idx ON finance.manual_resolutions (tenant_id, status, requested_at DESC);
SELECT kernel.enable_tenant_rls('finance.manual_resolutions');
GRANT SELECT, INSERT, UPDATE ON finance.manual_resolutions TO app_user;

CREATE FUNCTION finance.manual_resolutions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance.immutable: manual_resolutions est immuable (DELETE interdit)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'finance.invalid_transition: une résolution manuelle naît REQUESTED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.refund_id IS DISTINCT FROM OLD.refund_id OR NEW.outcome <> OLD.outcome OR NEW.reason <> OLD.reason
     OR NEW.evidence_ref <> OLD.evidence_ref OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'finance.manual_resolution_immutable: sujet, issue, motif, preuve et demandeur sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'finance.manual_resolution_terminal: une résolution % ne change plus', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status NOT IN ('REQUESTED', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'finance.invalid_transition: résolution manuelle -> %', NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER manual_resolutions_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.manual_resolutions
  FOR EACH ROW EXECUTE FUNCTION finance.manual_resolutions_guard();
