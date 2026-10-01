-- =============================================================================
-- 1503 — Module payroll : journal des bulletins, comptes rendus de calcul, vue de ventilation
-- =============================================================================

-- Journal append-only : l'identité de l'acteur est FIGÉE (`actor_name`), il survit à toute modification du
-- compte utilisateur ; sans clé étrangère sur le bulletin (R-PAY-15).
CREATE TABLE payroll.payslip_events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  payslip_id  uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('CALCULATED', 'RECALCULATED', 'ADJUSTED', 'APPROVED', 'PAID', 'DISPUTED', 'CANCELLED', 'NOTIFIED', 'VIEWED')),
  old_values  jsonb,
  new_values  jsonb,
  reason      text,
  actor_id    uuid,
  actor_name  text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payslip_events_payslip_idx ON payroll.payslip_events (tenant_id, payslip_id, occurred_at);
SELECT kernel.enable_tenant_rls('payroll.payslip_events');
GRANT SELECT, INSERT ON payroll.payslip_events TO app_user;

-- Comptes rendus de calcul, CONSERVÉS (le détail des écartés disparaissait après « Générer » dans le legacy).
CREATE TABLE payroll.calculation_runs (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  period_id    uuid NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('ALL', 'SESSION', 'ATTENDANCE')),
  recalculate  boolean NOT NULL,
  dry_run      boolean NOT NULL,
  staff_filter uuid[],
  status       text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  calculated   integer NOT NULL DEFAULT 0,
  skipped      integer NOT NULL DEFAULT 0,
  locked       integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  duration_ms  integer,
  error        text,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES payroll.pay_periods (tenant_id, id)
);
-- un seul calcul actif par période (verrou fonctionnel) ; un calcul « mort » est repris par l'application
CREATE UNIQUE INDEX calculation_runs_running_uq ON payroll.calculation_runs (tenant_id, period_id) WHERE status = 'RUNNING' AND NOT dry_run;
CREATE INDEX calculation_runs_period_idx ON payroll.calculation_runs (tenant_id, period_id, requested_at DESC);
SELECT kernel.enable_tenant_rls('payroll.calculation_runs');
GRANT SELECT, INSERT, UPDATE ON payroll.calculation_runs TO app_user;

CREATE TABLE payroll.calculation_run_items (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  run_id            uuid NOT NULL,
  staff_id          uuid NOT NULL,
  staff_name        text NOT NULL,
  outcome           text NOT NULL CHECK (outcome IN ('CALCULATED', 'SKIPPED', 'LOCKED', 'FAILED')),
  skip_reason       text CHECK (skip_reason IN ('NO_CONFIG', 'NO_HOURS', 'NO_RATE_RESOLVED', 'PAYSLIP_LOCKED', 'OUT_OF_SCOPE', 'STALE_SOURCE', 'NOTHING_TO_PAY', 'ALREADY_CALCULATED')),
  message           text,
  payslip_id        uuid,
  minutes_by_source jsonb,                                   -- { "SESSION": 390, "ATTENDANCE": 240 }
  total_amount      bigint,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, staff_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll.calculation_runs (tenant_id, id),
  CHECK (outcome <> 'SKIPPED' OR skip_reason IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('payroll.calculation_run_items');
GRANT SELECT, INSERT ON payroll.calculation_run_items TO app_user;

-- Ventilation à trois postes (T18) : Σ présences + Σ séances + hors-heures = total, pour chaque bulletin.
-- La vue s'exécute avec les droits de son propriétaire (migrator) ; la RLS étant FORCÉE sur les tables, elle
-- s'applique quand même au tenant de la transaction (jamais de lecture inter-tenants).
CREATE VIEW payroll.v_payslip_breakdown AS
SELECT p.tenant_id,
       p.id AS payslip_id,
       p.period_id,
       p.staff_id,
       p.status,
       p.total_amount,
       coalesce(sum(l.amount) FILTER (WHERE l.source_kind = 'ATTENDANCE'), 0)::bigint AS attendance_amount,
       coalesce(sum(l.amount) FILTER (WHERE l.source_kind = 'SESSION'), 0)::bigint AS session_amount,
       (p.total_amount - coalesce(sum(l.amount), 0))::bigint AS out_of_hours_amount   -- salaire, primes, retenues
  FROM payroll.payslips p
  LEFT JOIN payroll.payslip_lines l ON l.payslip_id = p.id AND l.tenant_id = p.tenant_id
 GROUP BY p.tenant_id, p.id;
GRANT SELECT ON payroll.v_payslip_breakdown TO app_user;
