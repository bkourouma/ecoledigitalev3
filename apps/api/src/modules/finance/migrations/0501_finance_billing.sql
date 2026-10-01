-- =============================================================================
-- 0501 — Module finance : factures, lignes, remises appliquées, échéances
-- =============================================================================
--
-- Invariants portés par la structure (les gardes d'immutabilité et de cohérence
-- inter-lignes sont dans 0503) :
--   - total = sous-total − remises − bourses ; encaissé + crédité ≤ total ;
--   - une facture portant un numéro a été émise (et inversement) ;
--   - ligne : brut = quantité × prix unitaire ; total = brut − remise − bourse.
-- =============================================================================

CREATE TABLE finance.invoices (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  -- Numéro attribué à l'émission seulement (FAC-aaaa-nnnnnn, sans trou).
  number              text,
  number_year         integer,
  number_seq          bigint,
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                        'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'CREDITED')),
  -- Références au cœur académique : UUID seulement, aucune FK (module distinct).
  learner_id          uuid NOT NULL,
  enrollment_id       uuid,
  academic_year       text NOT NULL CHECK (length(btrim(academic_year)) > 0),
  -- Instantané du regroupement (« créances par classe ») fourni par EnrollmentRef.
  group_key           text,
  group_label         text,
  institution_id      uuid,
  campus_id           uuid,
  funding_type        text CHECK (funding_type IS NULL OR funding_type IN (
                        'PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  -- Qui doit payer : la famille ou un financeur (part de l'État, d'une entreprise…).
  payer_kind          text NOT NULL DEFAULT 'LEARNER' CHECK (payer_kind IN ('LEARNER', 'FUNDER')),
  payer_ref           text,
  -- Factures sœurs issues du même acte de facturation (parent + financeurs).
  related_group_id    uuid,
  currency            text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  subtotal_amount     bigint NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount     bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  scholarship_amount  bigint NOT NULL DEFAULT 0 CHECK (scholarship_amount >= 0),
  total_amount        bigint NOT NULL CHECK (total_amount >= 0),
  -- Cumuls entretenus par les cas d'usage, vérifiés à chaque COMMIT (0503).
  paid_amount         bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  credited_amount     bigint NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  due_date            date NOT NULL,
  issued_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  idempotency_key     text,
  request_fingerprint text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = subtotal_amount - discount_amount - scholarship_amount),
  CHECK (paid_amount + credited_amount <= total_amount),
  CHECK ((number IS NULL) = (issued_at IS NULL)),
  CHECK ((number IS NULL) = (number_year IS NULL) AND (number IS NULL) = (number_seq IS NULL)),
  CHECK (status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CREDITED') OR number IS NOT NULL),
  CHECK (status <> 'DRAFT' OR (number IS NULL AND paid_amount = 0 AND credited_amount = 0)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND paid_amount = 0 AND credited_amount = 0)),
  CHECK (payer_kind = 'LEARNER' OR payer_ref IS NOT NULL),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, number_year, number_seq),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX invoices_learner_idx ON finance.invoices (tenant_id, learner_id, academic_year);
CREATE INDEX invoices_report_idx ON finance.invoices (tenant_id, academic_year, status);
CREATE INDEX invoices_group_idx ON finance.invoices (tenant_id, group_key) WHERE group_key IS NOT NULL;
CREATE INDEX invoices_related_idx ON finance.invoices (tenant_id, related_group_id) WHERE related_group_id IS NOT NULL;
SELECT kernel.enable_tenant_rls('finance.invoices');
-- Pas de DELETE : une facture se CANCELLE (le numéro émis ne disparaît jamais).
GRANT SELECT, INSERT, UPDATE ON finance.invoices TO app_user;

CREATE TABLE finance.invoice_lines (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  invoice_id         uuid NOT NULL,
  position           integer NOT NULL CHECK (position >= 1),
  fee_id             uuid,
  category           text NOT NULL CHECK (category IN (
                       'REGISTRATION', 'TUITION', 'CANTEEN', 'TRANSPORT', 'UNIFORM', 'DOCUMENTS',
                       'EXAMS', 'ACTIVITIES', 'DEFENSE', 'LIBRARY', 'OTHER')),
  description        text NOT NULL CHECK (length(btrim(description)) > 0),
  quantity           integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  unit_amount        bigint NOT NULL CHECK (unit_amount >= 0),
  gross_amount       bigint NOT NULL CHECK (gross_amount >= 0),
  discount_amount    bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  scholarship_amount bigint NOT NULL DEFAULT 0 CHECK (scholarship_amount >= 0),
  total_amount       bigint NOT NULL CHECK (total_amount >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (gross_amount = unit_amount * quantity),
  CHECK (total_amount = gross_amount - discount_amount - scholarship_amount),
  UNIQUE (tenant_id, id),
  UNIQUE (invoice_id, position),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, fee_id) REFERENCES finance.fees (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('finance.invoice_lines');
-- DELETE/UPDATE gardés par un déclencheur : seules les lignes d'un brouillon changent.
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.invoice_lines TO app_user;

-- Remises appliquées (traçabilité : quelle remise a retiré combien).
CREATE TABLE finance.invoice_discounts (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  invoice_id  uuid NOT NULL,
  discount_id uuid NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, discount_id) REFERENCES finance.discounts (tenant_id, id)
);
CREATE INDEX invoice_discounts_invoice_idx ON finance.invoice_discounts (tenant_id, invoice_id);
SELECT kernel.enable_tenant_rls('finance.invoice_discounts');
GRANT SELECT, INSERT ON finance.invoice_discounts TO app_user;

-- Échéances. `paid_amount` = imputations NETTES des reprises ; `credited_amount` = avoirs.
CREATE TABLE finance.installments (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  invoice_id      uuid NOT NULL,
  seq             integer NOT NULL CHECK (seq >= 1),
  label           text NOT NULL CHECK (length(btrim(label)) > 0),
  due_date        date NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  paid_amount     bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  credited_amount bigint NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_amount + credited_amount <= amount),
  UNIQUE (tenant_id, id),
  UNIQUE (invoice_id, seq),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id)
);
CREATE INDEX installments_invoice_idx ON finance.installments (tenant_id, invoice_id);
-- Échéances ouvertes (reste dû > 0) : balance âgée, relances, imputation automatique.
CREATE INDEX installments_open_idx ON finance.installments (tenant_id, due_date)
  WHERE paid_amount + credited_amount < amount;
SELECT kernel.enable_tenant_rls('finance.installments');
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.installments TO app_user;
