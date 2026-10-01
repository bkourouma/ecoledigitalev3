-- =============================================================================
-- 1502 — Module payroll : bulletins, lignes, réclamations d'heures et de jours de salaire, ajustements
-- =============================================================================
--
-- Invariants portés PAR LA BASE (les déclencheurs de 1504 complètent les CHECK) :
--   * UNE HEURE N'EST PAYÉE QU'UNE FOIS : `hour_claims` a pour clé primaire (tenant, origine, source, enseignant) —
--     deux bulletins, y compris de périodes qui se chevauchent et sous concurrence, ne peuvent pas porter la même heure ;
--   * UN JOUR DE SALAIRE N'EST PAYÉ QU'UNE FOIS : `salary_day_claims` (tenant, enseignant, jour) — corrige le défaut
--     du legacy qui versait deux salaires pour deux périodes qui se chevauchent ;
--   * chaque ligne respecte la formule exacte, arrondi demi-supérieur : amount = floor((minutes × taux × ‰ + 30 000) / 60 000) ;
--   * total = base + heures supplémentaires + primes − retenues ; l'archivage ne vaut jamais versement
--     (`paid_at` ⇒ statut PAID ⇒ `approved_at`) ;
--   * les transitions de statut sont celles de la machine d'états (déclencheur `payslips_guard`).
--
-- Écarts avec le DDL de référence : + `salary_amount` (le salaire prorata est une colonne, donc vérifiable),
-- + `calculated_by_name` (identité FIGÉE), + `salary_day_claims`, multiplicateur des lignes ≥ 1000 (×1,0 permis).
-- =============================================================================

CREATE TABLE payroll.payslips (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  period_id            uuid NOT NULL,
  staff_id             uuid NOT NULL,
  config_id            uuid NOT NULL,                       -- configuration ayant servi au calcul
  payslip_kind         text NOT NULL CHECK (payslip_kind IN ('SALARY', 'HOURLY', 'MIXED')),
  salary_amount        bigint NOT NULL DEFAULT 0 CHECK (salary_amount >= 0),     -- salaire prorata (mois par mois)
  base_amount          bigint NOT NULL DEFAULT 0 CHECK (base_amount >= 0),       -- salaire + heures normales
  overtime_amount      bigint NOT NULL DEFAULT 0 CHECK (overtime_amount >= 0),   -- Σ lignes majorées
  bonus_amount         bigint NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),      -- Σ ajustements BONUS
  deduction_amount     bigint NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),  -- Σ ajustements DEDUCTION
  total_amount         bigint NOT NULL CHECK (total_amount >= 0),
  currency             text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  regular_minutes      integer NOT NULL DEFAULT 0 CHECK (regular_minutes >= 0),
  overtime_minutes     integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  calc_details         jsonb NOT NULL,                      -- ventilation lisible (AC4.3)
  config_snapshot      jsonb NOT NULL,                      -- configuration en vigueur FIGÉE au calcul
  status               text NOT NULL DEFAULT 'CALCULATED' CHECK (status IN ('CALCULATED', 'APPROVED', 'PAID', 'DISPUTED', 'CANCELLED')),
  calculated_at        timestamptz NOT NULL DEFAULT now(),
  calculated_by        uuid NOT NULL,
  calculated_by_name   text NOT NULL,
  approved_at          timestamptz,                         -- acte 2 : arrêt du montant
  approved_by          uuid,
  approved_by_name     text,
  paid_at              timestamptz,                         -- acte 3 : versement réel
  paid_by              uuid,
  paid_by_name         text,
  payment_method       text CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')),
  payment_reference    text,
  disputed_at          timestamptz,
  dispute_reason       text,
  cancelled_at         timestamptz,
  cancelled_by         uuid,
  cancelled_by_name    text,
  cancel_reason        text,
  snapshot             jsonb,                               -- document figé à l'arrêt du montant ; NULL tant que CALCULATED
  snapshot_hash        text CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  replaces_payslip_id  uuid,                                -- nouveau bulletin après annulation
  row_version          integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES payroll.pay_periods (tenant_id, id),
  FOREIGN KEY (tenant_id, config_id) REFERENCES payroll.pay_configs (tenant_id, id),
  FOREIGN KEY (tenant_id, replaces_payslip_id) REFERENCES payroll.payslips (tenant_id, id),
  CONSTRAINT payslips_total_formula CHECK (total_amount = base_amount + overtime_amount + bonus_amount - deduction_amount),
  CONSTRAINT payslips_base_covers_salary CHECK (base_amount >= salary_amount),
  CONSTRAINT payslips_kind_salary CHECK (payslip_kind <> 'HOURLY' OR salary_amount = 0),
  CONSTRAINT payslips_kind_salary_only CHECK (payslip_kind <> 'SALARY' OR (overtime_amount = 0 AND regular_minutes = 0 AND overtime_minutes = 0 AND base_amount = salary_amount)),
  -- piste de statut : chaque statut porte exactement ses traces
  CONSTRAINT payslips_calculated_clean CHECK (status <> 'CALCULATED' OR (approved_at IS NULL AND paid_at IS NULL AND cancelled_at IS NULL AND snapshot IS NULL AND snapshot_hash IS NULL)),
  CONSTRAINT payslips_approved_trail CHECK (status NOT IN ('APPROVED', 'DISPUTED', 'PAID') OR (approved_at IS NOT NULL AND approved_by IS NOT NULL AND approved_by_name IS NOT NULL AND snapshot IS NOT NULL AND snapshot_hash IS NOT NULL)),
  CONSTRAINT payslips_paid_trail CHECK ((status = 'PAID') = (paid_at IS NOT NULL) AND (status <> 'PAID' OR (paid_by IS NOT NULL AND paid_by_name IS NOT NULL AND payment_method IS NOT NULL))),
  CONSTRAINT payslips_cancelled_trail CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL) AND (status <> 'CANCELLED' OR (cancelled_by_name IS NOT NULL AND cancel_reason IS NOT NULL))),
  CONSTRAINT payslips_disputed_trail CHECK (status <> 'DISPUTED' OR (disputed_at IS NOT NULL AND dispute_reason IS NOT NULL))
);
-- UN bulletin non annulé par (enseignant, période) : l'origine d'une heure vit sur la LIGNE, jamais sur le bulletin.
CREATE UNIQUE INDEX payslips_live_uq ON payroll.payslips (tenant_id, staff_id, period_id) WHERE status <> 'CANCELLED';
CREATE INDEX payslips_period_idx ON payroll.payslips (tenant_id, period_id, status);
CREATE INDEX payslips_staff_idx ON payroll.payslips (tenant_id, staff_id, period_id);
SELECT kernel.enable_tenant_rls('payroll.payslips');
GRANT SELECT, INSERT, UPDATE ON payroll.payslips TO app_user;       -- jamais DELETE

CREATE TABLE payroll.payslip_lines (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  payslip_id          uuid NOT NULL,
  source_kind         text NOT NULL CHECK (source_kind IN ('SESSION', 'ATTENDANCE')),
  source_ref_id       uuid NOT NULL,                        -- id de la séance (SESSION) ou de la présence (ATTENDANCE)
  staff_id            uuid NOT NULL,
  session_date        date NOT NULL,
  start_time          time,
  minutes             integer NOT NULL CHECK (minutes > 0),
  rate                bigint NOT NULL CHECK (rate >= 0),                  -- tarif de base (XOF/h) FIGÉ
  multiplier_permille integer NOT NULL CHECK (multiplier_permille >= 1000),
  amount              bigint NOT NULL CHECK (amount >= 0),
  is_overtime         boolean NOT NULL,
  rate_origin         text NOT NULL CHECK (rate_origin IN ('NODE_STAFF', 'NODE_GENERIC', 'CONFIG_DEFAULT', 'SALARY_ZERO')),
  curriculum_node_id  uuid,
  classroom_id        uuid,
  label               text,                                 -- intitulés figés (cours / ECUE, classe)
  code                text,
  classroom_label     text,
  position            integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  -- une séance : au plus une ligne normale + une ligne majorée (la séance à cheval sur le seuil est COUPÉE)
  UNIQUE (tenant_id, payslip_id, source_kind, source_ref_id, is_overtime),
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payroll.payslips (tenant_id, id),
  CONSTRAINT payslip_lines_multiplier CHECK (is_overtime OR multiplier_permille = 1000),
  -- formule exacte, arrondi demi-supérieur, en arithmétique entière (numeric) : celle du domaine (`lineAmount`)
  CONSTRAINT payslip_lines_amount_formula CHECK (amount = floor((minutes::numeric * rate * multiplier_permille + 30000) / 60000))
);
CREATE INDEX payslip_lines_payslip_idx ON payroll.payslip_lines (tenant_id, payslip_id, position);
CREATE INDEX payslip_lines_source_idx ON payroll.payslip_lines (tenant_id, source_kind, source_ref_id);
SELECT kernel.enable_tenant_rls('payroll.payslip_lines');
GRANT SELECT, INSERT, DELETE ON payroll.payslip_lines TO app_user;  -- DELETE seulement tant que CALCULATED (recalcul) ; UPDATE refusé

-- UNICITÉ D'UNE HEURE PAYÉE : une réclamation active par (origine, source, enseignant).
CREATE TABLE payroll.hour_claims (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  source_kind   text NOT NULL CHECK (source_kind IN ('SESSION', 'ATTENDANCE')),
  source_ref_id uuid NOT NULL,
  staff_id      uuid NOT NULL,
  payslip_id    uuid NOT NULL,
  minutes       integer NOT NULL CHECK (minutes > 0),
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_kind, source_ref_id, staff_id),
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payroll.payslips (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX hour_claims_payslip_idx ON payroll.hour_claims (tenant_id, payslip_id);
SELECT kernel.enable_tenant_rls('payroll.hour_claims');
GRANT SELECT, INSERT, DELETE ON payroll.hour_claims TO app_user;    -- DELETE : recalcul (CALCULATED) ou annulation seulement

-- UNICITÉ D'UN JOUR DE SALAIRE PAYÉ : un jour ouvré d'un enseignant n'est dû que par UN bulletin non annulé.
CREATE TABLE payroll.salary_day_claims (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id   uuid NOT NULL,
  work_date  date NOT NULL,
  payslip_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, staff_id, work_date),
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payroll.payslips (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX salary_day_claims_payslip_idx ON payroll.salary_day_claims (tenant_id, payslip_id);
SELECT kernel.enable_tenant_rls('payroll.salary_day_claims');
GRANT SELECT, INSERT, DELETE ON payroll.salary_day_claims TO app_user;

-- Primes et retenues : saisies manuellement, sur un bulletin CALCULATED seulement ; PRÉSERVÉES au recalcul
-- (elles vivent dans leur table, le recalcul ne touche que les lignes d'heures et les réclamations).
CREATE TABLE payroll.payslip_adjustments (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  payslip_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('BONUS', 'DEDUCTION')),
  amount          bigint NOT NULL CHECK (amount > 0),
  label           text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  reason          text,
  created_by      uuid NOT NULL,
  created_by_name text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payroll.payslips (tenant_id, id)
);
CREATE INDEX payslip_adjustments_payslip_idx ON payroll.payslip_adjustments (tenant_id, payslip_id);
SELECT kernel.enable_tenant_rls('payroll.payslip_adjustments');
GRANT SELECT, INSERT, DELETE ON payroll.payslip_adjustments TO app_user;   -- modifiable seulement tant que CALCULATED (déclencheur)
