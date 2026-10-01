-- =============================================================================
-- 1200 — Module results : schéma, réglages, états de période, clôtures
-- =============================================================================
--
-- Plage de numéros réservée au module results : 1200–1299 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md, tableau des plages).
--
-- Référence : specs/v2/011-assessments-grades/data-model.md §2. Les références vers les modules academic, people,
-- assess et rules (inscription, classe, période, nœud, version de règle…) sont des UUID SANS clé étrangère. Les
-- moyennes sont CALCULÉES par le module `rules` : ce module ne contient AUCUNE formule et AUCUN seuil. Valeurs
-- exactes en `numeric` (jamais de flottant) ; la valeur d'affichage arrondie est distincte et jamais réinjectée.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS results;
REVOKE ALL ON SCHEMA results FROM PUBLIC;
GRANT USAGE ON SCHEMA results TO app_user;

CREATE TABLE results.settings (
  tenant_id                 uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  -- désactivée : la délibération est sautée et le bulletin porte « sans délibération » (jamais une date fausse)
  require_deliberation      boolean NOT NULL DEFAULT true,
  require_separate_approver boolean NOT NULL DEFAULT true,
  -- temporisation de la coalescence des recalculs (AC8.1)
  recompute_delay_seconds   integer NOT NULL DEFAULT 10 CHECK (recompute_delay_seconds BETWEEN 0 AND 3600),
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('results.settings');
GRANT SELECT, INSERT, UPDATE ON results.settings TO app_user;

CREATE TABLE results.period_states (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,                         -- NULL = état d'ANNÉE (scope = 'YEAR')
  academic_year_id    uuid NOT NULL,
  scope               text NOT NULL DEFAULT 'PERIOD' CHECK (scope IN ('PERIOD', 'YEAR')),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'GRADING_LOCKED', 'DELIBERATED', 'CLOSED')),
  contract_id         text NOT NULL,                -- ex. credit-semester@1
  -- PIN de la version de règle (reproductibilité) : ids externes au module, aucune FK
  rule_version_kind   text NOT NULL CHECK (rule_version_kind IN ('TENANT', 'NATIONAL')),
  rule_version_id     uuid NOT NULL,
  rule_set_code       text NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  pinned_at           timestamptz NOT NULL DEFAULT now(),
  pinned_by           uuid,
  locked_at           timestamptz,
  locked_by           uuid,
  deliberated_at      timestamptz,
  deliberated_by      uuid,
  closed_at           timestamptz,
  closed_by           uuid,
  reopen_count        integer NOT NULL DEFAULT 0,
  last_reopen_kind    text CHECK (last_reopen_kind IS NULL OR last_reopen_kind IN ('CORRECTION', 'RESIT_SESSION')),
  last_reopen_reason  text,
  results_version     integer NOT NULL DEFAULT 0,   -- version courante des résultats FINAL de la classe
  row_version         integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((scope = 'PERIOD') = (academic_period_id IS NOT NULL))
);
CREATE UNIQUE INDEX period_states_scope_uq ON results.period_states
  (tenant_id, classroom_id, coalesce(academic_period_id, '00000000-0000-0000-0000-000000000000'::uuid), academic_year_id, scope);
SELECT kernel.enable_tenant_rls('results.period_states');
GRANT SELECT, INSERT, UPDATE ON results.period_states TO app_user;           -- jamais DELETE

-- Une ligne par clôture ; tamper-evidence (hash agrégé des `outputs_hash`).
CREATE TABLE results.closures (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id         uuid NOT NULL,
  results_version  integer NOT NULL,
  results_count    integer NOT NULL CHECK (results_count >= 0),
  closure_hash     text NOT NULL CHECK (closure_hash ~ '^[0-9a-f]{64}$'),
  excluded         jsonb NOT NULL DEFAULT '[]'::jsonb,         -- inscriptions exclues d'un forçage (en ERREUR), avec motif
  forced_reason    text,
  closed_at        timestamptz NOT NULL DEFAULT now(),
  closed_by        uuid NOT NULL,
  closed_by_name   text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (state_id, results_version),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('results.closures');
GRANT SELECT, INSERT ON results.closures TO app_user;                        -- append-only
