-- =============================================================================
-- 0502 — Module finance : caisses, paiements, imputations, reçus, remboursements,
--        avoirs, webhooks
-- =============================================================================
--
-- Principe : un paiement confirmé, un reçu, une imputation, un avoir sont des écritures
-- IMMUABLES. Une correction est une écriture inverse (remboursement, reprise
-- d'imputation), jamais un UPDATE/DELETE. Les gardes sont dans 0503 ; les droits
-- ci-dessous sont déjà restreints (SELECT, INSERT seulement) pour les tables
-- strictement append-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Caisses physiques et sessions (ouverture / clôture par caissier)
-- -----------------------------------------------------------------------------
CREATE TABLE finance.cash_registers (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  campus_id  uuid,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('finance.cash_registers');
GRANT SELECT, INSERT, UPDATE ON finance.cash_registers TO app_user;

CREATE TABLE finance.cash_sessions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  register_id     uuid NOT NULL,
  cashier_id      uuid NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  currency        text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  opening_float   bigint NOT NULL CHECK (opening_float >= 0),
  opened_at       timestamptz NOT NULL,
  closed_at       timestamptz,
  -- attendu et écart sont SIGNÉS (un manquant est un écart négatif).
  expected_amount bigint,
  counted_amount  bigint CHECK (counted_amount >= 0),
  variance_amount bigint,
  close_note      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'OPEN' AND closed_at IS NULL AND expected_amount IS NULL
                AND counted_amount IS NULL AND variance_amount IS NULL)
      OR (status = 'CLOSED' AND closed_at IS NOT NULL AND expected_amount IS NOT NULL
                AND counted_amount IS NOT NULL AND variance_amount IS NOT NULL)),
  CHECK (variance_amount IS NULL OR variance_amount = counted_amount - expected_amount),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES finance.cash_registers (tenant_id, id)
);
-- Une seule session ouverte par caisse ET par caissier.
CREATE UNIQUE INDEX cash_sessions_one_open_per_register ON finance.cash_sessions (tenant_id, register_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX cash_sessions_one_open_per_cashier ON finance.cash_sessions (tenant_id, cashier_id) WHERE status = 'OPEN';
SELECT kernel.enable_tenant_rls('finance.cash_sessions');
GRANT SELECT, INSERT, UPDATE ON finance.cash_sessions TO app_user;

-- -----------------------------------------------------------------------------
-- Paiements
-- -----------------------------------------------------------------------------
CREATE TABLE finance.payments (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  learner_id          uuid NOT NULL,
  enrollment_id       uuid,
  payer_kind          text NOT NULL DEFAULT 'LEARNER' CHECK (payer_kind IN ('LEARNER', 'FUNDER')),
  payer_ref           text,
  payer_name          text,
  method              text NOT NULL CHECK (method IN ('CASH', 'CHEQUE', 'TRANSFER', 'CARD', 'MOBILE_MONEY', 'ONLINE')),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED')),
  amount              bigint NOT NULL CHECK (amount > 0),
  currency            text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  -- Imputé NET des reprises ; remboursé cumulé (COMPLETED). Vérifiés à chaque COMMIT (0503).
  allocated_amount    bigint NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  refunded_amount     bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  -- Clé fournie par l'appelant : un rejeu avec la même clé renvoie le même paiement.
  idempotency_key     text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  request_fingerprint text NOT NULL,
  provider            text,
  provider_ref        text,
  provider_status     text,
  -- Vrai pour un paiement traité par un fournisseur SIMULÉ (sandbox) — jamais en production.
  simulated           boolean NOT NULL DEFAULT false,
  reference           text,
  intended_invoice_id uuid,
  cash_session_id     uuid,
  received_at         timestamptz NOT NULL,
  confirmed_at        timestamptz,
  failed_at           timestamptz,
  failure_reason      text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (allocated_amount + refunded_amount <= amount),
  CHECK (status NOT IN ('CONFIRMED', 'REFUNDED') OR confirmed_at IS NOT NULL),
  CHECK (status <> 'FAILED' OR failed_at IS NOT NULL),
  CHECK (status <> 'REFUNDED' OR refunded_amount = amount),
  CHECK (status <> 'CONFIRMED' OR refunded_amount < amount),
  CHECK (status IN ('CONFIRMED', 'REFUNDED') OR (allocated_amount = 0 AND refunded_amount = 0)),
  -- Un paiement espèces est TOUJOURS rattaché à une session de caisse.
  CHECK (method <> 'CASH' OR cash_session_id IS NOT NULL),
  CHECK (method <> 'ONLINE' OR provider IS NOT NULL),
  CHECK (payer_kind = 'LEARNER' OR payer_ref IS NOT NULL),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, provider, provider_ref),
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES finance.cash_sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, intended_invoice_id) REFERENCES finance.invoices (tenant_id, id)
);
CREATE INDEX payments_learner_idx ON finance.payments (tenant_id, learner_id);
CREATE INDEX payments_confirmed_idx ON finance.payments (tenant_id, confirmed_at) WHERE status IN ('CONFIRMED', 'REFUNDED');
CREATE INDEX payments_session_idx ON finance.payments (tenant_id, cash_session_id) WHERE cash_session_id IS NOT NULL;
SELECT kernel.enable_tenant_rls('finance.payments');
-- Jamais de DELETE ; UPDATE restreint aux colonnes d'état (le reste est figé, cf. 0503).
GRANT SELECT, INSERT ON finance.payments TO app_user;
GRANT UPDATE (status, allocated_amount, refunded_amount, provider_ref, provider_status, confirmed_at,
              failed_at, failure_reason, updated_at)
  ON finance.payments TO app_user;

-- -----------------------------------------------------------------------------
-- Imputations (paiement → échéance) et reprises (remboursements). Append-only.
-- -----------------------------------------------------------------------------
CREATE TABLE finance.payment_allocations (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  payment_id     uuid NOT NULL,
  invoice_id     uuid NOT NULL,
  installment_id uuid NOT NULL,
  line_id        uuid,
  amount         bigint NOT NULL CHECK (amount > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES finance.installments (tenant_id, id),
  FOREIGN KEY (tenant_id, line_id) REFERENCES finance.invoice_lines (tenant_id, id)
);
CREATE INDEX payment_allocations_payment_idx ON finance.payment_allocations (tenant_id, payment_id);
CREATE INDEX payment_allocations_invoice_idx ON finance.payment_allocations (tenant_id, invoice_id);
CREATE INDEX payment_allocations_installment_idx ON finance.payment_allocations (tenant_id, installment_id);
SELECT kernel.enable_tenant_rls('finance.payment_allocations');
GRANT SELECT, INSERT ON finance.payment_allocations TO app_user;

-- -----------------------------------------------------------------------------
-- Reçus (REC-aaaa-nnnnnn) — immuables
-- -----------------------------------------------------------------------------
CREATE TABLE finance.receipts (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  number      text NOT NULL,
  number_year integer NOT NULL,
  number_seq  bigint NOT NULL CHECK (number_seq >= 1),
  payment_id  uuid NOT NULL,
  learner_id  uuid NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  currency    text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  issued_at   timestamptz NOT NULL,
  issued_by   uuid,
  -- Instantané du contenu du reçu (payeur, mode, imputations, solde après paiement).
  snapshot    jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, number_year, number_seq),
  UNIQUE (tenant_id, payment_id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id)
);
CREATE INDEX receipts_learner_idx ON finance.receipts (tenant_id, learner_id);
SELECT kernel.enable_tenant_rls('finance.receipts');
GRANT SELECT, INSERT ON finance.receipts TO app_user;

-- -----------------------------------------------------------------------------
-- Remboursements
-- -----------------------------------------------------------------------------
CREATE TABLE finance.refunds (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  payment_id          uuid NOT NULL,
  amount              bigint NOT NULL CHECK (amount > 0),
  currency            text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  reason              text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status              text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'COMPLETED', 'REJECTED')),
  requested_by        uuid NOT NULL,
  requested_at        timestamptz NOT NULL,
  approved_by         uuid,
  approved_at         timestamptz,
  completed_at        timestamptz,
  rejected_by         uuid,
  rejected_at         timestamptz,
  rejection_reason    text,
  -- Session de caisse qui a SORTI les espèces (remboursement d'un paiement espèces).
  cash_session_id     uuid,
  idempotency_key     text,
  request_fingerprint text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('APPROVED', 'COMPLETED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  CHECK (status <> 'REJECTED' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id),
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES finance.cash_sessions (tenant_id, id)
);
CREATE INDEX refunds_payment_idx ON finance.refunds (tenant_id, payment_id);
CREATE INDEX refunds_session_idx ON finance.refunds (tenant_id, cash_session_id) WHERE cash_session_id IS NOT NULL;
SELECT kernel.enable_tenant_rls('finance.refunds');
GRANT SELECT, INSERT, UPDATE ON finance.refunds TO app_user;

CREATE TABLE finance.allocation_reversals (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  allocation_id uuid NOT NULL,
  payment_id    uuid NOT NULL,
  refund_id     uuid NOT NULL,
  amount        bigint NOT NULL CHECK (amount > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES finance.payment_allocations (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id),
  FOREIGN KEY (tenant_id, refund_id) REFERENCES finance.refunds (tenant_id, id)
);
CREATE INDEX allocation_reversals_allocation_idx ON finance.allocation_reversals (tenant_id, allocation_id);
CREATE INDEX allocation_reversals_payment_idx ON finance.allocation_reversals (tenant_id, payment_id);
SELECT kernel.enable_tenant_rls('finance.allocation_reversals');
GRANT SELECT, INSERT ON finance.allocation_reversals TO app_user;

-- -----------------------------------------------------------------------------
-- Avoirs (AV-aaaa-nnnnnn) — immuables
-- -----------------------------------------------------------------------------
CREATE TABLE finance.credit_notes (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  number       text NOT NULL,
  number_year  integer NOT NULL,
  number_seq   bigint NOT NULL CHECK (number_seq >= 1),
  invoice_id   uuid NOT NULL,
  learner_id   uuid NOT NULL,
  amount       bigint NOT NULL CHECK (amount > 0),
  currency     text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  reason       text NOT NULL CHECK (length(btrim(reason)) >= 5),
  -- Échéances allégées : [{installmentId, amount}].
  applications jsonb NOT NULL,
  issued_at    timestamptz NOT NULL,
  issued_by    uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, number_year, number_seq),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id)
);
CREATE INDEX credit_notes_invoice_idx ON finance.credit_notes (tenant_id, invoice_id);
SELECT kernel.enable_tenant_rls('finance.credit_notes');
GRANT SELECT, INSERT ON finance.credit_notes TO app_user;

-- -----------------------------------------------------------------------------
-- Webhooks fournisseurs : clé unique (tenant, fournisseur, event_id) → traitement idempotent
-- -----------------------------------------------------------------------------
CREATE TABLE finance.webhook_events (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  provider     text NOT NULL CHECK (length(btrim(provider)) > 0),
  event_id     text NOT NULL CHECK (length(btrim(event_id)) > 0),
  event_type   text,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  payment_id   uuid,
  error        text,
  attempts     integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  received_at  timestamptz NOT NULL,
  processed_at timestamptz,
  UNIQUE (tenant_id, provider, event_id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id)
);
CREATE INDEX webhook_events_payment_idx ON finance.webhook_events (tenant_id, payment_id) WHERE payment_id IS NOT NULL;
SELECT kernel.enable_tenant_rls('finance.webhook_events');
GRANT SELECT, INSERT, UPDATE ON finance.webhook_events TO app_user;
