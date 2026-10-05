-- =============================================================================
-- 2006 — Module examinations : FRAIS D'EXAMEN intégrés à l'inscription du candidat (décision métier Q-E13)
-- =============================================================================
--
-- Les frais d'examen sont perçus par l'établissement et INTÉGRÉS à l'inscription du candidat (élève ou libre) : à l'inscription, une
-- facture est demandée à `finance` par le PORT d'examinations (adaptateur de plateforme, jamais de SQL croisé).
--
--   * `exam_fee_items` : le BARÈME de frais d'examen défini par l'établissement = pour un type d'examen, la liste des frais du catalogue
--     de `finance` (catégorie EXAMS) qui s'appliquent (élèves, libres ou tous). VIDE PAR DÉFAUT : aucun montant n'est inventé, les
--     montants restent ceux du catalogue et des barèmes de `finance` ; ce module ne stocke aucun tarif.
--   * `candidate_fees` : l'obligation d'UN candidat (une ligne par candidat, créée dans la transaction d'inscription) : état de la
--     facturation, identifiant de la facture, instantané des lignes et du total à la facturation (affichage et audit), remboursement.
--     Le statut de PAIEMENT n'est pas stocké : il est relu en direct auprès de `finance` (jamais de copie qui se désynchronise).
--
--   Cycle d'une obligation :
--     NOT_APPLICABLE            aucun frais au barème pour ce type (état final)
--     PENDING_INVOICE           frais dus, facture pas encore établie (port indisponible, erreur : rejouable, idempotent)
--     INVOICED                  facture établie dans `finance`
--     AWAITING_MANUAL_INVOICE   payeur sans compte famille (candidat libre) : la facture à son nom / à celui du tuteur est à établir
--                               par la comptabilité (finance ne facture que des apprenants)
--     CANCELLED                 désinscription avant tout paiement : facture annulée (ou jamais établie)
--     REFUND_DUE                désinscription d'un candidat qui a PAYÉ : remboursement MANUEL à effectuer dans `finance` (Q-PAY-32)
--     REFUND_DONE               remboursement confirmé par une personne habilitée
-- =============================================================================

CREATE TABLE examinations.exam_fee_items (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  exam_type_id  uuid NOT NULL,
  fee_id        uuid NOT NULL,                                   -- finance.fees.id (sans FK : module distinct)
  applies_to    text NOT NULL DEFAULT 'ALL' CHECK (applies_to IN ('ALL', 'STUDENT', 'EXTERNAL')),
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, exam_type_id, fee_id),
  FOREIGN KEY (tenant_id, exam_type_id) REFERENCES examinations.exam_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.exam_fee_items');
GRANT SELECT, INSERT, UPDATE ON examinations.exam_fee_items TO app_user;     -- jamais de suppression : un frais se désactive

CREATE TABLE examinations.candidate_fees (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id           uuid NOT NULL,
  candidate_id         uuid NOT NULL,
  status               text NOT NULL DEFAULT 'PENDING_INVOICE' CHECK (status IN
                         ('NOT_APPLICABLE', 'PENDING_INVOICE', 'INVOICED', 'AWAITING_MANUAL_INVOICE', 'CANCELLED', 'REFUND_DUE', 'REFUND_DONE')),
  payer_kind           text NOT NULL CHECK (payer_kind IN ('STUDENT', 'EXTERNAL')),
  currency             text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  total_minor          bigint CHECK (total_minor IS NULL OR total_minor >= 0),
  -- frais retenus au barème à l'inscription ; libellés et montants complétés à la facturation (instantané)
  lines                jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  invoice_id           uuid,                                     -- finance.invoices.id (sans FK)
  idempotency_key      text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  last_error_code      text,
  note                 text,
  refund_confirmed_by  uuid,
  refund_confirmed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, candidate_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (status NOT IN ('INVOICED', 'REFUND_DUE', 'REFUND_DONE') OR invoice_id IS NOT NULL),
  CHECK ((status = 'REFUND_DONE') = (refund_confirmed_by IS NOT NULL AND refund_confirmed_at IS NOT NULL)),
  CHECK (status <> 'NOT_APPLICABLE' OR (invoice_id IS NULL AND jsonb_array_length(lines) = 0)),
  FOREIGN KEY (tenant_id, session_id, candidate_id) REFERENCES examinations.candidates (tenant_id, session_id, id)
);
SELECT kernel.enable_tenant_rls('examinations.candidate_fees');
CREATE INDEX candidate_fees_by_session ON examinations.candidate_fees (tenant_id, session_id, status);
GRANT SELECT, INSERT, UPDATE ON examinations.candidate_fees TO app_user;      -- jamais de suppression : l'historique d'une obligation reste

-- Identité de l'obligation figée ; transitions du cycle ; une obligation soldée ne se réouvre pas.
CREATE FUNCTION examinations.candidate_fees_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('NOT_APPLICABLE', 'PENDING_INVOICE') THEN
      RAISE EXCEPTION 'examinations.fee_initial_state: une obligation naît sans facture (NOT_APPLICABLE ou PENDING_INVOICE)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.candidate_id <> OLD.candidate_id OR NEW.session_id <> OLD.session_id OR NEW.payer_kind <> OLD.payer_kind OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'examinations.fee_identity_immutable: candidat, session, payeur et clé d''idempotence sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'examinations.fee_invoice_immutable: la facture d''une obligation ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING_INVOICE'          AND NEW.status IN ('INVOICED', 'AWAITING_MANUAL_INVOICE', 'CANCELLED')) OR
       (OLD.status = 'AWAITING_MANUAL_INVOICE'  AND NEW.status = 'CANCELLED') OR
       (OLD.status = 'INVOICED'                 AND NEW.status IN ('CANCELLED', 'REFUND_DUE')) OR
       (OLD.status = 'REFUND_DUE'               AND NEW.status = 'REFUND_DONE')) THEN
    RAISE EXCEPTION 'examinations.fee_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('NOT_APPLICABLE', 'CANCELLED', 'REFUND_DONE') AND (NEW.lines IS DISTINCT FROM OLD.lines OR NEW.total_minor IS DISTINCT FROM OLD.total_minor) THEN
    RAISE EXCEPTION 'examinations.fee_closed: une obligation close ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER candidate_fees_guard BEFORE INSERT OR UPDATE ON examinations.candidate_fees
  FOR EACH ROW EXECUTE FUNCTION examinations.candidate_fees_guard();
