-- =============================================================================
-- 1501 — Module payroll : configurations de paie et tarifs horaires
-- =============================================================================

-- Configuration de paie d'un enseignant, DATÉE. Deux configurations d'un même enseignant ne se chevauchent
-- jamais (EXCLUDE). `0` est une valeur (taux nul) distincte de NULL (absent) : défaut du legacy corrigé.
CREATE TABLE payroll.pay_configs (
  id                           uuid PRIMARY KEY,
  tenant_id                    uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id                     uuid NOT NULL,
  config_type                  text NOT NULL CHECK (config_type IN ('SALARY', 'HOURLY', 'MIXED')),
  monthly_salary               bigint CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  annual_salary                bigint CHECK (annual_salary IS NULL OR annual_salary >= 0),
  default_hourly_rate          bigint CHECK (default_hourly_rate IS NULL OR default_hourly_rate >= 0),
  overtime_threshold_minutes   integer NOT NULL CHECK (overtime_threshold_minutes > 0),
  overtime_multiplier_permille integer NOT NULL CHECK (overtime_multiplier_permille BETWEEN 1000 AND 5000),
  effective_from               date NOT NULL,
  effective_to                 date,
  created_by                   uuid NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (config_type = 'HOURLY' OR monthly_salary IS NOT NULL OR annual_salary IS NOT NULL),
  CHECK (config_type <> 'HOURLY' OR (monthly_salary IS NULL AND annual_salary IS NULL)),
  CONSTRAINT pay_configs_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, staff_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&
  )
);
CREATE INDEX pay_configs_staff_idx ON payroll.pay_configs (tenant_id, staff_id, effective_from DESC);
SELECT kernel.enable_tenant_rls('payroll.pay_configs');
GRANT SELECT, INSERT, UPDATE ON payroll.pay_configs TO app_user;      -- jamais DELETE : on met fin à la validité

-- Tarifs horaires par nœud de curriculum (matière ou ECUE : un seul référentiel), nominatifs ou génériques.
CREATE TABLE payroll.hourly_rates (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  curriculum_node_id uuid NOT NULL,
  staff_id           uuid,                                             -- NULL = tarif générique du nœud
  rate               bigint NOT NULL CHECK (rate >= 0),                -- XOF par heure
  valid_from         date NOT NULL,
  valid_to           date,
  notes              text,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- pas deux tarifs chevauchants pour un même couple (nœud, enseignant) ; le générique est son propre couple
  CONSTRAINT hourly_rates_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    curriculum_node_id WITH =,
    (coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);
CREATE INDEX hourly_rates_lookup_idx ON payroll.hourly_rates (tenant_id, curriculum_node_id, valid_from);
SELECT kernel.enable_tenant_rls('payroll.hourly_rates');
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.hourly_rates TO app_user;   -- un tarif utilisé reste lisible : les lignes de bulletin le figent
