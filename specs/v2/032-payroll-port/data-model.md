# Modèle de données — module `payroll` (032-payroll-port)

**Statut** : DDL de **référence**. Schéma `payroll`, migrations **`1500-1599`** (plage proposée, à inscrire dans `module-conventions.md`). Conventions : `tenant_id` + `kernel.enable_tenant_rls()` ; `UNIQUE (tenant_id, id)` + FK composites **intra-schéma** ; références au cœur et aux autres modules par **UUID sans FK** (`people.staff.id`, `scheduling` sessions, `attendance` présences, `academic.curriculum_nodes.id`, `academic.classrooms.id`, `academic.academic_years.id`) ; **montants en `bigint` (XOF, unité entière)**, **durées en minutes entières**, **aucun flottant** (ADR-007) ; horodatages UTC ; dates calendaires en `date`.

Reprise de la portabilité (`docs/module-remuneration-portage-nouvelle-stack.md` §3) avec les changements : entiers/minutes, contraintes de base pour l'unicité d'une heure payée, transitions imposées par trigger, `academic_year_id` obligatoire, comptes rendus conservés, plus de table propre aux séances (elles vivent dans 017).

## Errata — le DDL implémenté (`apps/api/src/modules/payroll/migrations/1500-1504`) fait foi

Fichiers : `1500_payroll_settings_periods.sql`, `1501_payroll_config_rates.sql`, `1502_payroll_payslips.sql`, `1503_payroll_events_runs.sql`, `1504_payroll_guards.sql`. Différences avec le DDL de référence ci-dessous :

| DDL de référence | Implémenté | Pourquoi |
|---|---|---|
| `session_validations` (+ garde) | **supprimée** | la validation et la dérogation de durée sont des actes de `scheduling` (017) |
| `settings.hour_source_by_pack` | supprimée | features `payroll.session-source` / `payroll.attendance-source` |
| `settings.currency` sans défaut | `DEFAULT 'XOF'`, ligne créée à la première utilisation ou au provisioning | |
| — | **`salary_day_claims`** `(tenant, enseignant, jour)` + garde + intégrité | un jour de salaire ne se paie qu'une fois |
| `payslips` sans `salary_amount` | `salary_amount`, `calculated_by_name`, CHECKs de piste de statut (`payslips_*_trail`) | totaux vérifiables ; identité figée |
| `payslip_lines` `CHECK ((is_overtime AND mult > 1000) OR (NOT is_overtime AND mult = 1000))` | `is_overtime OR multiplier_permille = 1000` ; `UNIQUE (tenant, payslip, source, ref, is_overtime)` | ×1,0 permis ; séance à cheval = deux lignes |
| `pay_period_targets` PK `(period_id, staff_id)` | PK `(tenant_id, period_id, staff_id)` | l'isolation exige un index qui commence par `tenant_id` |
| `pay_periods` : règle « une seule en attente » par déclencheur | colonne `awaiting_calculation` + index unique partiel, maintenue par `payslips_guard` / `pay_periods_guard` / le cas d'usage | |
| `calculation_run_items.skip_reason` | + `NOTHING_TO_PAY`, `ALREADY_CALCULATED` | |
| `payslip_events.action` | `VIEWED_PDF` → `VIEWED` | pas de PDF ici |
| Triggers du §5.1 | `payslips_guard` (colonnes modifiables **par transition**, séparation des tâches, seuil propriétaire via `payroll.actor_owner`), `payslips_cancel_releases`, `children_guard`, `payslip_integrity` (différé, une fois par bulletin et par transaction), `pay_periods_guard`, `pay_period_targets_guard`, `forbid_mutation` | |
| Vue `v_payslip_breakdown WITH (security_invoker)` | sans l'option (PG 14) : la RLS FORCÉE des tables s'applique au propriétaire de la vue | |

## 1. Réglages (migration `1501_payroll_settings.sql`)

```sql
CREATE SCHEMA payroll;

CREATE TABLE payroll.settings (
  tenant_id                          uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  currency                           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),            -- depuis CountryProfile, immuable après le 1er bulletin
  default_overtime_threshold_minutes integer NOT NULL DEFAULT 2400 CHECK (default_overtime_threshold_minutes > 0),
  default_overtime_multiplier_permille integer NOT NULL DEFAULT 1500 CHECK (default_overtime_multiplier_permille BETWEEN 1000 AND 5000),
  hour_source_by_pack                jsonb NOT NULL DEFAULT '{"HIGHER":"SESSION","SECONDARY":"ATTENDANCE","PRIMARY":"ATTENDANCE","VIRTUAL":"SESSION"}'::jsonb,  -- Q-36
  require_separate_approver          boolean NOT NULL DEFAULT false,                           -- Q-30
  owner_approval_threshold           bigint CHECK (owner_approval_threshold IS NULL OR owner_approval_threshold > 0),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('payroll.settings');
GRANT SELECT, INSERT, UPDATE ON payroll.settings TO app_user;
```

Les défauts 40 h (2 400 min) et 1,5 (1 500 ‰) sont des **données de réglage seedées au provisioning**, reprises du legacy (`migrations/0011`), pas des constantes du code.

## 2. Périodes (migration `1502_payroll_periods.sql`)

```sql
CREATE TABLE payroll.pay_periods (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description      text,
  start_date       date NOT NULL,
  end_date         date NOT NULL,                              -- bornes incluses
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','CLOSED','ARCHIVED')),
  academic_year_id uuid NOT NULL,                              -- obligatoire (le legacy le laissait nul sur toutes les périodes)
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date >= start_date)
);
-- Pas de contrainte d'exclusion de dates : le chevauchement est AUTORISÉ (décision 0112) ; l'unicité du paiement d'une heure
-- est portée par payroll.hour_claims.
CREATE INDEX pay_periods_year_idx ON payroll.pay_periods (tenant_id, academic_year_id, start_date);
SELECT kernel.enable_tenant_rls('payroll.pay_periods');
GRANT SELECT, INSERT, UPDATE ON payroll.pay_periods TO app_user;        -- DELETE refusé s'il existe un bulletin (déclencheur)

CREATE TABLE payroll.pay_period_targets (                    -- aucune ligne = période collective ; N lignes = ciblée
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  period_id  uuid NOT NULL,
  staff_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, staff_id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES payroll.pay_periods (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('payroll.pay_period_targets');
GRANT SELECT, INSERT, DELETE ON payroll.pay_period_targets TO app_user;  -- DELETE refusé par déclencheur si un bulletin existe pour (période, enseignant)
```

Règle « une seule période en attente de calcul » : appliquée par l'application (lecture de `GET /periods/pending`) **et** par un index d'unicité partiel sur une colonne dérivée maintenue par déclencheur (`awaiting_calculation boolean`) — un seul `true` par tenant.

## 3. Configurations et tarifs (migration `1503_payroll_config_rates.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE payroll.pay_configs (
  id                          uuid PRIMARY KEY,
  tenant_id                   uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id                    uuid NOT NULL,
  config_type                 text NOT NULL CHECK (config_type IN ('SALARY','HOURLY','MIXED')),
  monthly_salary              bigint CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  annual_salary               bigint CHECK (annual_salary IS NULL OR annual_salary >= 0),
  default_hourly_rate         bigint CHECK (default_hourly_rate IS NULL OR default_hourly_rate >= 0),     -- 0 est une valeur (≠ NULL, défaut du legacy corrigé)
  overtime_threshold_minutes  integer NOT NULL CHECK (overtime_threshold_minutes > 0),
  overtime_multiplier_permille integer NOT NULL CHECK (overtime_multiplier_permille BETWEEN 1000 AND 5000),
  effective_from              date NOT NULL,
  effective_to                date,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (config_type = 'HOURLY' OR monthly_salary IS NOT NULL OR annual_salary IS NOT NULL),
  CHECK (config_type <> 'HOURLY' OR (monthly_salary IS NULL AND annual_salary IS NULL)),
  EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
);
CREATE INDEX pay_configs_staff_idx ON payroll.pay_configs (tenant_id, staff_id, effective_from DESC);
SELECT kernel.enable_tenant_rls('payroll.pay_configs');
GRANT SELECT, INSERT, UPDATE ON payroll.pay_configs TO app_user;      -- DELETE refusé par déclencheur s'il existe un bulletin qui la cite

CREATE TABLE payroll.hourly_rates (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  curriculum_node_id uuid NOT NULL,                       -- matière (classique) ou ECUE (supérieur) : un seul référentiel
  staff_id           uuid,                                -- NULL = tarif générique du nœud
  rate               bigint NOT NULL CHECK (rate >= 0),    -- XOF par heure
  valid_from         date NOT NULL,
  valid_to           date,
  notes              text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- pas deux tarifs chevauchants pour un même couple ; le générique est son propre couple
  EXCLUDE USING gist (
    tenant_id WITH =, curriculum_node_id WITH =,
    coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);
CREATE INDEX hourly_rates_lookup_idx ON payroll.hourly_rates (tenant_id, curriculum_node_id, valid_from);
SELECT kernel.enable_tenant_rls('payroll.hourly_rates');
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.hourly_rates TO app_user;    -- un tarif utilisé reste lisible via les lignes historisées
```

## 4. Validation des séances — couche paie (migration `1504_payroll_validations.sql`)

Les séances elles-mêmes (planning, statut de réalisation, horaires, enseignant réel) appartiennent à 017 ; la paie ne stocke que **ses actes**.

```sql
CREATE TABLE payroll.session_validations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id         uuid NOT NULL,                       -- scheduling.sessions.id (UUID stable)
  staff_id           uuid NOT NULL,                       -- enseignant de la séance au moment de la validation
  validated_at       timestamptz,
  validated_by       uuid,
  validated_by_name  text,
  paid_minutes_override integer CHECK (paid_minutes_override IS NULL OR paid_minutes_override BETWEEN 1 AND 1440),
  override_by uuid, override_by_name text, override_at timestamptz, override_reason text,
  accounting_added   boolean NOT NULL DEFAULT false,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id),
  CHECK (validated_at IS NULL OR (validated_by IS NOT NULL AND validated_by_name IS NOT NULL)),
  CHECK (paid_minutes_override IS NULL OR (override_by IS NOT NULL AND override_at IS NOT NULL))
);
CREATE INDEX session_validations_staff_idx ON payroll.session_validations (tenant_id, staff_id) WHERE validated_at IS NOT NULL;
SELECT kernel.enable_tenant_rls('payroll.session_validations');
GRANT SELECT, INSERT, UPDATE ON payroll.session_validations TO app_user;
```

Déclencheur `session_validations_guard()` : refuse de dévalider ou de modifier la dérogation si une réclamation d'heures **active** existe pour `session_id` sur un bulletin `APPROVED`/`PAID` (`payroll.session_locked`, miroir de la règle du legacy « verrou des quatre » n°2).

## 5. Bulletins, lignes, réclamations (migration `1505_payroll_payslips.sql`)

```sql
CREATE TABLE payroll.payslips (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  period_id         uuid NOT NULL,
  staff_id          uuid NOT NULL,
  config_id         uuid NOT NULL,                        -- configuration ayant servi au calcul
  payslip_kind      text NOT NULL CHECK (payslip_kind IN ('SALARY','HOURLY','MIXED')),
  base_amount       bigint NOT NULL DEFAULT 0 CHECK (base_amount >= 0),       -- salaire prorata + heures normales
  overtime_amount   bigint NOT NULL DEFAULT 0 CHECK (overtime_amount >= 0),
  bonus_amount      bigint NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),      -- Σ ajustements BONUS
  deduction_amount  bigint NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),  -- Σ ajustements DEDUCTION
  total_amount      bigint NOT NULL CHECK (total_amount >= 0),
  currency          text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  regular_minutes   integer NOT NULL DEFAULT 0 CHECK (regular_minutes >= 0),
  overtime_minutes  integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  calc_details      jsonb NOT NULL,                       -- ventilation lisible (spec US4 AC4.3)
  config_snapshot   jsonb NOT NULL,                       -- configuration en vigueur FIGÉE au calcul (type, salaires, tarif défaut, seuil, majoration)
  status            text NOT NULL DEFAULT 'CALCULATED' CHECK (status IN ('CALCULATED','APPROVED','PAID','DISPUTED','CANCELLED')),
  calculated_at     timestamptz NOT NULL DEFAULT now(),
  calculated_by     uuid NOT NULL,
  approved_at       timestamptz, approved_by uuid, approved_by_name text,       -- acte 2 : arrêt du montant
  paid_at           timestamptz, paid_by uuid, paid_by_name text,               -- acte 3 : versement réel
  payment_method    text CHECK (payment_method IS NULL OR payment_method IN ('CASH','MOBILE_MONEY','BANK_TRANSFER','CHEQUE','OTHER')),
  payment_reference text,
  disputed_at       timestamptz, dispute_reason text,
  cancelled_at      timestamptz, cancelled_by uuid, cancelled_by_name text, cancel_reason text,
  snapshot          jsonb,                                -- document figé à l'arrêt du montant (PDF), NULL tant que CALCULATED
  snapshot_hash     text CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  replaces_payslip_id uuid,                               -- nouveau bulletin après annulation
  row_version       integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES payroll.pay_periods (tenant_id, id),
  FOREIGN KEY (tenant_id, config_id) REFERENCES payroll.pay_configs (tenant_id, id),
  CHECK (total_amount = base_amount + overtime_amount + bonus_amount - deduction_amount),
  CHECK (status NOT IN ('APPROVED','PAID') OR (approved_at IS NOT NULL AND approved_by IS NOT NULL AND snapshot IS NOT NULL)),
  CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND paid_by IS NOT NULL AND payment_method IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  CHECK (status <> 'DISPUTED' OR dispute_reason IS NOT NULL),
  CHECK (paid_at IS NULL OR approved_at IS NOT NULL)      -- l'archivage ne vaut jamais versement
);
-- UN bulletin non annulé par (enseignant, période)
CREATE UNIQUE INDEX payslips_live_uq ON payroll.payslips (tenant_id, staff_id, period_id) WHERE status <> 'CANCELLED';
CREATE INDEX payslips_period_idx ON payroll.payslips (tenant_id, period_id, status);
CREATE INDEX payslips_staff_idx  ON payroll.payslips (tenant_id, staff_id, period_id);
SELECT kernel.enable_tenant_rls('payroll.payslips');
GRANT SELECT, INSERT, UPDATE ON payroll.payslips TO app_user;          -- jamais DELETE

CREATE TABLE payroll.payslip_lines (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  payslip_id          uuid NOT NULL,
  source_kind         text NOT NULL CHECK (source_kind IN ('SESSION','ATTENDANCE')),
  source_ref_id       uuid NOT NULL,                       -- id de la séance (SESSION) ou de la présence (ATTENDANCE)
  staff_id            uuid NOT NULL,
  session_date        date NOT NULL,
  start_time          time,
  minutes             integer NOT NULL CHECK (minutes > 0),
  rate                bigint NOT NULL CHECK (rate >= 0),                 -- tarif de base (XOF/h) FIGÉ
  multiplier_permille integer NOT NULL CHECK (multiplier_permille >= 1000),   -- 1000 = normal ; majoration = valeur de la configuration
  amount              bigint NOT NULL CHECK (amount >= 0),
  is_overtime         boolean NOT NULL,
  rate_origin         text NOT NULL CHECK (rate_origin IN ('NODE_STAFF','NODE_GENERIC','CONFIG_DEFAULT','SALARY_ZERO')),
  curriculum_node_id  uuid,
  classroom_id        uuid,
  label               text,                                -- intitulé figé (cours / ECUE)
  code                text,
  classroom_label     text,
  position            integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  UNIQUE (payslip_id, source_kind, source_ref_id, is_overtime),        -- une séance : au plus une ligne normale + une ligne majorée
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payroll.payslips (tenant_id, id),
  CHECK ((is_overtime AND multiplier_permille > 1000) OR (NOT is_overtime AND multiplier_permille = 1000)),
  -- formule exacte, arrondi demi-supérieur : amount = round_half_up(minutes * rate * multiplier / 60 000)
  CHECK (amount = floor((minutes::numeric * rate * multiplier_permille + 30000) / 60000))
);
CREATE INDEX payslip_lines_payslip_idx ON payroll.payslip_lines (tenant_id, payslip_id, position);
CREATE INDEX payslip_lines_source_idx  ON payroll.payslip_lines (tenant_id, source_kind, source_ref_id);
SELECT kernel.enable_tenant_rls('payroll.payslip_lines');
GRANT SELECT, INSERT, DELETE ON payroll.payslip_lines TO app_user;      -- DELETE : uniquement tant que le bulletin est CALCULATED (recalcul) ; UPDATE refusé

-- UNICITÉ D'UNE HEURE PAYÉE : une réclamation active par (origine, source, enseignant)
CREATE TABLE payroll.hour_claims (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  source_kind   text NOT NULL CHECK (source_kind IN ('SESSION','ATTENDANCE')),
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
GRANT SELECT, INSERT, DELETE ON payroll.hour_claims TO app_user;        -- DELETE : par recalcul (CALCULATED) ou annulation seulement (déclencheur)

CREATE TABLE payroll.payslip_adjustments (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  payslip_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('BONUS','DEDUCTION')),
  amount      bigint NOT NULL CHECK (amount > 0),
  label       text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  reason      text,
  created_by uuid NOT NULL, created_by_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payslip_id) REFERENCES payroll.payslips (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('payroll.payslip_adjustments');
GRANT SELECT, INSERT, DELETE ON payroll.payslip_adjustments TO app_user;   -- modifiable seulement tant que CALCULATED (déclencheur)
```

### 5.1 Déclencheurs d'intégrité (migration `1506_payroll_guards.sql`)

Codes stables `payroll.<code>`, `ERRCODE restrict_violation`.

| Déclencheur | Règle |
|---|---|
| `payslips_guard()` `BEFORE UPDATE` | Transitions légales : `CALCULATED→APPROVED|CANCELLED`, `APPROVED→PAID|DISPUTED|CANCELLED`, `DISPUTED→APPROVED|CANCELLED` ; `PAID` et `CANCELLED` terminaux. Les montants, `config_snapshot`, `staff_id`, `period_id` ne varient que tant que `CALCULATED`. `snapshot` posé exactement à `CALCULATED→APPROVED` puis immuable. `paid_at` n'est jamais posé par `CALCULATED→APPROVED`. Si `settings.require_separate_approver` : `approved_by <> calculated_by` ; si `owner_approval_threshold` et `total_amount ≥ seuil` : l'acteur doit porter le marqueur `app.actor_owner = 'true'` (posé par la couche d'accès pour la permission d'approbation propriétaire). |
| `payslips_cancel_releases()` `AFTER UPDATE` | À `→ CANCELLED` : supprime les `hour_claims` du bulletin (heures relâchées) dans la même transaction. |
| `payslip_lines_guard()` / `hour_claims_guard()` | Écritures interdites si le bulletin n'est pas `CALCULATED` (sauf suppression par `payslips_cancel_releases`) ; à l'insertion d'une ligne, vérifie qu'une réclamation correspondante existe (ou l'insère par le cas d'usage dans la même transaction, vérification différée `DEFERRABLE INITIALLY DEFERRED`) : **toute ligne a sa réclamation et inversement**. |
| `payslip_totals_check()` (différé, au `COMMIT`) | `base_amount + overtime_amount` = Σ lignes + base de salaire de `calc_details` ; `bonus_amount`/`deduction_amount` = Σ `payslip_adjustments` ; `regular_minutes`/`overtime_minutes` = Σ minutes des lignes. |
| `pay_periods_guard()` | Pas de `DELETE` s'il existe un bulletin ; `ARCHIVED` terminal ; `CLOSED` refuse un nouveau calcul. |
| `pay_configs_guard()` | Pas de `DELETE` si un bulletin la cite (fin de validité à la place). |
| `session_validations_guard()` | Voir §4. |
| `payslip_events_immutable()` | Append-only (`UPDATE`/`DELETE` interdits). |

## 6. Journal et comptes rendus (migration `1507_payroll_events_runs.sql`)

```sql
CREATE TABLE payroll.payslip_events (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  payslip_id    uuid NOT NULL,                          -- sans FK : le journal survit à tout
  action        text NOT NULL CHECK (action IN ('CALCULATED','RECALCULATED','ADJUSTED','APPROVED','PAID','DISPUTED','CANCELLED','NOTIFIED','VIEWED_PDF')),
  old_values    jsonb,
  new_values    jsonb,
  reason        text,
  actor_id      uuid,
  actor_name    text NOT NULL,                          -- identité FIGÉE au moment de l'acte
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payslip_events_payslip_idx ON payroll.payslip_events (tenant_id, payslip_id, occurred_at);
SELECT kernel.enable_tenant_rls('payroll.payslip_events');
GRANT SELECT, INSERT ON payroll.payslip_events TO app_user;

CREATE TABLE payroll.calculation_runs (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  period_id     uuid NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('ALL','SESSION','ATTENDANCE')),
  recalculate   boolean NOT NULL,
  dry_run       boolean NOT NULL,
  staff_filter  uuid[],
  status        text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  calculated    integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0, locked integer NOT NULL DEFAULT 0,
  duration_ms   integer,
  error         text,
  requested_by  uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES payroll.pay_periods (tenant_id, id)
);
-- un seul calcul actif par période (verrou fonctionnel)
CREATE UNIQUE INDEX calculation_runs_running_uq ON payroll.calculation_runs (tenant_id, period_id) WHERE status = 'RUNNING' AND NOT dry_run;
SELECT kernel.enable_tenant_rls('payroll.calculation_runs');
GRANT SELECT, INSERT, UPDATE ON payroll.calculation_runs TO app_user;

CREATE TABLE payroll.calculation_run_items (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  run_id       uuid NOT NULL,
  staff_id     uuid NOT NULL,
  staff_name   text NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('CALCULATED','SKIPPED','LOCKED','FAILED')),
  skip_reason  text CHECK (skip_reason IN ('NO_CONFIG','NO_HOURS','NO_RATE_RESOLVED','PAYSLIP_LOCKED','OUT_OF_SCOPE','STALE_SOURCE')),
  message      text,
  payslip_id   uuid,
  minutes_by_source jsonb,                              -- { "SESSION": 390, "ATTENDANCE": 240 }
  total_amount bigint,
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll.calculation_runs (tenant_id, id),
  UNIQUE (run_id, staff_id)
);
SELECT kernel.enable_tenant_rls('payroll.calculation_run_items');
GRANT SELECT, INSERT ON payroll.calculation_run_items TO app_user;
```

## 7. Rapports et ventilation à trois postes

Vue de lecture (créée par migration, appartenant au schéma `payroll`, RLS héritée des tables) :

```sql
CREATE VIEW payroll.v_payslip_breakdown WITH (security_invoker = true) AS
SELECT p.tenant_id, p.id AS payslip_id, p.period_id, p.staff_id, p.status, p.total_amount,
       coalesce(sum(l.amount) FILTER (WHERE l.source_kind = 'ATTENDANCE'), 0) AS attendance_amount,
       coalesce(sum(l.amount) FILTER (WHERE l.source_kind = 'SESSION'), 0)    AS session_amount,
       p.total_amount - coalesce(sum(l.amount), 0)                            AS out_of_hours_amount     -- salaires, primes, retenues
FROM payroll.payslips p
LEFT JOIN payroll.payslip_lines l ON l.payslip_id = p.id AND l.tenant_id = p.tenant_id
GROUP BY p.tenant_id, p.id;
```

Invariant testé (T18) : `attendance_amount + session_amount + out_of_hours_amount = total_amount` pour chaque ligne de la vue, et pour tout filtre appliqué à l'affichage, aux totaux et aux exports.

## 8. Correspondance avec les tables legacy (`parity.md` pour le détail)

| Legacy | v2 |
|---|---|
| `payment_periods`, `payment_period_teachers` | `pay_periods`, `pay_period_targets` |
| `teacher_payment_configs` | `pay_configs` |
| `course_hourly_rates`, `professional_ecue_hourly_rates` | `hourly_rates` (un seul référentiel, nœud de curriculum) |
| `professional_ecue_seances` (champs paie : `statut`, `valide_*`, `duree_payee*`, `saisie_comptable`) | 017 (séance, statut) + `session_validations` (validation, dérogation) |
| `teacher_payments` | `payslips` (+ `payslip_adjustments`) |
| `payment_hour_details` (+ `teaching_hours_id` vestige) | `payslip_lines` + `hour_claims` (le vestige disparaît) |
| `payment_audit_log` (+ triggers) | `payslip_events` (+ `audit.audit_log`) |
| `teaching_hours`, `course_assignments`, `teacher_attendance_sessions` | non repris / ports vers 010, 009, 004 |

## 9. Volumétrie et conservation

| Table | Ordre de grandeur (100 enseignants) | Conservation |
|---|---|---|
| `payslips` | 12-24 / enseignant / an | **10 ans** (valeur probante, à confirmer avec le conseil juridique) |
| `payslip_lines` | ~200 par bulletin horaire | idem |
| `hour_claims` | = nombre de sources payées | idem (suppression uniquement à l'annulation) |
| `payslip_events` | ~5 par bulletin | idem |
| `calculation_runs/items` | 1-3 par période | 24 mois |
