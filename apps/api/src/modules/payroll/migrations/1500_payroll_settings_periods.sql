-- =============================================================================
-- 1500 — Module payroll : schéma, réglages, périodes de paie
-- =============================================================================
--
-- Plage de numéros réservée au module payroll : 1500–1599 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md). Spec : specs/v2/032-payroll-port.
--
-- Références inter-modules par UUID SANS clé étrangère : `people` (enseignant), `scheduling` (séance),
-- `attendance` (présence), `academic` (nœud de curriculum, classe, année). Seule FK externe : kernel.tenants.
-- MONTANTS : bigint, XOF (unité entière). DURÉES : minutes entières. Aucun flottant (ADR-007).
--
-- Écarts assumés avec le DDL de référence de specs/v2/032-payroll-port/data-model.md (voir README) :
--   * settings : sans `hour_source_by_pack` — les sources d'heures actives viennent des features
--     `payroll.session-source` / `payroll.attendance-source` (entitlements, par pack : Q-36) ;
--   * pay_period_targets : clé primaire (tenant_id, period_id, staff_id) ;
--   * pay_periods : `awaiting_calculation` + index d'unicité partiel (une seule période en attente par tenant),
--     maintenu par l'application et les déclencheurs de 1504.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS payroll;
REVOKE ALL ON SCHEMA payroll FROM PUBLIC;
GRANT USAGE ON SCHEMA payroll TO app_user;

-- Opérateurs d'égalité (uuid) dans les index GiST des contraintes d'exclusion (configurations, tarifs).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Réglages du tenant (une ligne, créée à la première utilisation ou au provisioning).
-- Les défauts 40 h (2 400 min) et ×1,5 (1 500 ‰) sont des DONNÉES de réglage reprises du legacy, pas des
-- constantes du code : chaque configuration d'enseignant les recopie à sa création.
CREATE TABLE payroll.settings (
  tenant_id                            uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  currency                             text NOT NULL DEFAULT 'XOF' CHECK (currency ~ '^[A-Z]{3}$'),     -- immuable après le 1er bulletin (application)
  default_overtime_threshold_minutes   integer NOT NULL DEFAULT 2400 CHECK (default_overtime_threshold_minutes > 0),
  default_overtime_multiplier_permille integer NOT NULL DEFAULT 1500 CHECK (default_overtime_multiplier_permille BETWEEN 1000 AND 5000),
  require_separate_approver            boolean NOT NULL DEFAULT false,                                  -- Q-30 : celui qui calcule n'arrête pas
  owner_approval_threshold             bigint CHECK (owner_approval_threshold IS NULL OR owner_approval_threshold > 0),  -- au-delà : arrêt réservé au propriétaire
  updated_by                           uuid,
  updated_at                           timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('payroll.settings');
GRANT SELECT, INSERT, UPDATE ON payroll.settings TO app_user;

-- Périodes de paie. Pas de contrainte d'exclusion de dates : le chevauchement est AUTORISÉ (décision 0112) ;
-- l'unicité du paiement d'une heure (hour_claims) et d'un jour de salaire (salary_day_claims) est portée par
-- les réclamations, pas par le calendrier.
CREATE TABLE payroll.pay_periods (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description          text,
  start_date           date NOT NULL,
  end_date             date NOT NULL,                                  -- bornes incluses
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
  academic_year_id     uuid NOT NULL,                                  -- obligatoire (le legacy le laissait nul)
  awaiting_calculation boolean NOT NULL DEFAULT true,                  -- vrai tant qu'aucun calcul n'a été lancé : une seule par tenant
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date >= start_date)
);
CREATE INDEX pay_periods_year_idx ON payroll.pay_periods (tenant_id, academic_year_id, start_date);
CREATE UNIQUE INDEX pay_periods_one_awaiting_uq ON payroll.pay_periods (tenant_id) WHERE awaiting_calculation;
SELECT kernel.enable_tenant_rls('payroll.pay_periods');
GRANT SELECT, INSERT, UPDATE ON payroll.pay_periods TO app_user;      -- jamais DELETE : une période est archivée

-- Aucune ligne = période collective ; N lignes = période ciblée.
CREATE TABLE payroll.pay_period_targets (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  period_id  uuid NOT NULL,
  staff_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_id, staff_id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES payroll.pay_periods (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('payroll.pay_period_targets');
GRANT SELECT, INSERT, DELETE ON payroll.pay_period_targets TO app_user;   -- DELETE refusé s'il existe un bulletin (déclencheur, 1504)
