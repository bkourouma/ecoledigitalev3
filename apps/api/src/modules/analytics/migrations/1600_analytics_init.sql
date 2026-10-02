-- =============================================================================
-- 1600 — Module analytics : read-models de direction / propriétaire (spec v2/025)
-- =============================================================================
-- Plage de numéros réservée au module : 1600-1699 (docs/architecture/module-conventions.md).
-- Un fichier appliqué ne se modifie JAMAIS : corrigez par une nouvelle migration (1601_...).
--
-- Principe : ce schéma ne contient AUCUNE donnée source. Chaque table est un instantané DÉRIVÉ, reconstructible
-- à l'identique depuis les modules sources (par leurs API publiques, via les ports de platform/adapters) ; une ligne
-- n'a de sens qu'avec l'horodatage `refreshed_at`/`computed_at` de sa passe de rafraîchissement.
--   - références vers les autres modules : UUID sans clé étrangère (seul kernel.tenants est référencé) ;
--   - montants : bigint en unités mineures + devise ; décimaux exacts des résultats : numeric (jamais float) ;
--   - toute table : tenant_id + RLS forcée + GRANT app_user.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO app_user;

-- -----------------------------------------------------------------------------
-- 1. File de rafraîchissement et état de fraîcheur
-- -----------------------------------------------------------------------------

-- Une demande COALESCÉE par (genre, périmètre) tant qu'elle est PENDING : les événements ne calculent jamais,
-- ils demandent. Le job `analytics.process-refreshes` exécute les demandes échues.
CREATE TABLE analytics.refresh_requests (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants(id),
  kind         text NOT NULL CHECK (kind IN
                 ('REBUILD','CALENDAR','ENROLLMENT','RESULTS','ATTENDANCE','STAFF_PRESENCE','FINANCE','COLLECTIONS','CASH','PAYROLL','TEACHING_LOAD')),
  scope_key    text NOT NULL DEFAULT '*' CHECK (length(scope_key) BETWEEN 1 AND 200),
  causes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_at timestamptz NOT NULL,
  not_before   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED','UNAVAILABLE')),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text,
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE UNIQUE INDEX refresh_requests_pending_uq ON analytics.refresh_requests (tenant_id, kind, scope_key) WHERE status = 'PENDING';
CREATE INDEX refresh_requests_due_ix ON analytics.refresh_requests (tenant_id, status, not_before);

-- Fraîcheur : dernier succès par (genre, périmètre). `analytics_asof` d'une réponse = minimum de ces horodatages.
CREATE TABLE analytics.refresh_state (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants(id),
  kind            text NOT NULL,
  scope_key       text NOT NULL DEFAULT '*',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_status     text NOT NULL CHECK (last_status IN ('OK','FAILED','UNAVAILABLE')),
  rows_written    integer NOT NULL DEFAULT 0,
  duration_ms     integer NOT NULL DEFAULT 0,
  last_error      text,
  -- Empreinte du contenu des faits écrits : une passe qui retrouve la même empreinte n'écrit rien (idempotence).
  content_hash    text,
  PRIMARY KEY (tenant_id, kind, scope_key)
);

-- Seuils de LECTURE des tableaux de bord (feux tricolores) : paramètres d'affichage propres à l'établissement,
-- jamais des règles de calcul. Absence de ligne = valeurs par défaut du domaine (domain/display-thresholds.ts).
CREATE TABLE analytics.settings (
  tenant_id               uuid PRIMARY KEY REFERENCES kernel.tenants(id),
  collection_good_bps     integer CHECK (collection_good_bps BETWEEN 0 AND 10000),
  collection_warning_bps  integer CHECK (collection_warning_bps BETWEEN 0 AND 10000),
  attendance_good_bps     integer CHECK (attendance_good_bps BETWEEN 0 AND 10000),
  attendance_warning_bps  integer CHECK (attendance_warning_bps BETWEEN 0 AND 10000),
  stale_after_seconds     integer CHECK (stale_after_seconds BETWEEN 60 AND 604800),
  updated_by              uuid,
  updated_at              timestamptz NOT NULL,
  CHECK (collection_warning_bps IS NULL OR collection_good_bps IS NULL OR collection_warning_bps <= collection_good_bps),
  CHECK (attendance_warning_bps IS NULL OR attendance_good_bps IS NULL OR attendance_warning_bps <= attendance_good_bps)
);

-- -----------------------------------------------------------------------------
-- 2. Dimensions (libellés et périmètres des filtres)
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.dim_scope (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants(id),
  scope_kind   text NOT NULL CHECK (scope_kind IN ('INSTITUTION','CAMPUS')),
  scope_id     uuid NOT NULL,
  parent_id    uuid,
  label        text NOT NULL,
  status       text,
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, scope_kind, scope_id)
);

CREATE TABLE analytics.dim_year (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants(id),
  year_id        uuid NOT NULL,
  institution_id uuid NOT NULL,
  code           text NOT NULL,
  label          text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  status         text NOT NULL,
  is_current     boolean NOT NULL DEFAULT false,
  refreshed_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, year_id)
);

CREATE TABLE analytics.dim_period (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants(id),
  period_id    uuid NOT NULL,
  year_id      uuid NOT NULL,
  code         text NOT NULL,
  label        text NOT NULL,
  ordinal      integer NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  status       text NOT NULL,
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, period_id)
);

CREATE TABLE analytics.dim_classroom (
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants(id),
  classroom_id         uuid NOT NULL,
  institution_id       uuid NOT NULL,
  campus_id            uuid,
  year_id              uuid NOT NULL,
  name                 text NOT NULL,
  grade_level_code     text NOT NULL DEFAULT '',
  grade_level_label    text NOT NULL DEFAULT '',
  education_level_code text NOT NULL DEFAULT '',
  program_label        text NOT NULL DEFAULT '',
  kind                 text NOT NULL DEFAULT 'CLASS',
  status               text NOT NULL,
  headcount            integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  refreshed_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, classroom_id)
);
CREATE INDEX dim_classroom_year_ix ON analytics.dim_classroom (tenant_id, year_id);

-- -----------------------------------------------------------------------------
-- 3. Effectifs et inscriptions
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.enrollment_facts (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants(id),
  enrollment_id  uuid NOT NULL,
  student_id     uuid NOT NULL,
  institution_id uuid NOT NULL,
  campus_id      uuid,
  year_id        uuid NOT NULL,
  classroom_id   uuid NOT NULL,
  status         text NOT NULL,
  funding_type   text NOT NULL DEFAULT 'UNKNOWN',
  sex            text CHECK (sex IS NULL OR sex IN ('M','F')),
  is_repeating   boolean NOT NULL DEFAULT false,
  in_schooling   boolean NOT NULL DEFAULT false,
  source_kind    text,
  enrolled_on    date,
  ended_on       date,
  created_at     timestamptz,
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  refreshed_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, enrollment_id)
);
CREATE INDEX enrollment_facts_year_ix ON analytics.enrollment_facts (tenant_id, year_id, status);
CREATE INDEX enrollment_facts_class_ix ON analytics.enrollment_facts (tenant_id, classroom_id);

-- -----------------------------------------------------------------------------
-- 4. Résultats (UNIQUEMENT les résultats FINAL de `results`)
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.result_facts (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants(id),
  enrollment_id    uuid NOT NULL,
  period_id        uuid NOT NULL,
  student_id       uuid NOT NULL,
  classroom_id     uuid NOT NULL,
  year_id          uuid NOT NULL,
  results_version  integer NOT NULL DEFAULT 1,
  average          numeric,
  rank             integer,
  cohort_size      integer,
  mention_code     text,
  decision_code    text,
  decision_outcome text,
  year_decision_code    text,
  year_decision_outcome text,
  validated        boolean,
  credits_acquired numeric,
  credits_required numeric,
  finalized_at     timestamptz,
  refreshed_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, enrollment_id, period_id)
);
CREATE INDEX result_facts_class_period_ix ON analytics.result_facts (tenant_id, classroom_id, period_id);
CREATE INDEX result_facts_year_ix ON analytics.result_facts (tenant_id, year_id, period_id);

CREATE TABLE analytics.result_line_facts (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants(id),
  enrollment_id   uuid NOT NULL,
  period_id       uuid NOT NULL,
  node_id         uuid NOT NULL,
  classroom_id    uuid NOT NULL,
  year_id         uuid NOT NULL,
  level           text NOT NULL,
  node_code       text NOT NULL DEFAULT '',
  node_label      text NOT NULL DEFAULT '',
  value           numeric,
  validated       boolean,
  session_obtained smallint CHECK (session_obtained IS NULL OR session_obtained IN (1, 2)),
  resit_eligible  boolean,
  refreshed_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, enrollment_id, period_id, node_id)
);
CREATE INDEX result_line_facts_class_ix ON analytics.result_line_facts (tenant_id, classroom_id, period_id, node_id);

-- Clôtures connues : (classe, période) -> dernier état lu (une période rouverte retire ses faits).
CREATE TABLE analytics.result_scopes (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants(id),
  classroom_id  uuid NOT NULL,
  period_id     uuid NOT NULL,
  year_id       uuid,
  state         text NOT NULL CHECK (state IN ('FINAL','NOT_FINAL')),
  results_count integer NOT NULL DEFAULT 0,
  refreshed_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, classroom_id, period_id)
);

-- -----------------------------------------------------------------------------
-- 5. Présences
-- -----------------------------------------------------------------------------

-- Pointages des séances SOUMISES ou VALIDÉES d'un jour, agrégés par classe (famille de statut : donnée de présence).
CREATE TABLE analytics.attendance_daily (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants(id),
  day            date NOT NULL,
  classroom_id   uuid NOT NULL,
  year_id        uuid,
  institution_id uuid,
  campus_id      uuid,
  sessions_count integer NOT NULL DEFAULT 0 CHECK (sessions_count >= 0),
  records_count  integer NOT NULL DEFAULT 0 CHECK (records_count >= 0),
  present_count  integer NOT NULL DEFAULT 0 CHECK (present_count >= 0),
  absent_count   integer NOT NULL DEFAULT 0 CHECK (absent_count >= 0),
  excused_count  integer NOT NULL DEFAULT 0 CHECK (excused_count >= 0),
  late_count     integer NOT NULL DEFAULT 0 CHECK (late_count >= 0),
  absent_minutes integer NOT NULL DEFAULT 0 CHECK (absent_minutes >= 0),
  refreshed_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, day, classroom_id),
  CHECK (excused_count <= absent_count)
);
CREATE INDEX attendance_daily_class_ix ON analytics.attendance_daily (tenant_id, classroom_id, day);

CREATE TABLE analytics.staff_presence_facts (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants(id),
  day          date NOT NULL,
  staff_id     uuid NOT NULL,
  status_code  text NOT NULL,
  present      boolean NOT NULL DEFAULT false,
  absent       boolean NOT NULL DEFAULT false,
  on_leave     boolean NOT NULL DEFAULT false,
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, day, staff_id)
);

-- -----------------------------------------------------------------------------
-- 6. Finance : facturé / encaissé / restant / retard / recouvrement / créances / trésorerie
-- -----------------------------------------------------------------------------
-- `year_key` = code de l'année (celui des factures de finance) ou '*' ; `campus_key` = uuid de campus ou '*'.

CREATE TABLE analytics.finance_summary (
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants(id),
  year_key              text NOT NULL,
  campus_key            text NOT NULL,
  currency              text NOT NULL CHECK (length(currency) = 3),
  as_of_date            date NOT NULL,
  invoice_count         integer NOT NULL,
  billed                bigint NOT NULL,
  credited              bigint NOT NULL,
  net_billed            bigint NOT NULL,
  collected             bigint NOT NULL,
  outstanding           bigint NOT NULL,
  overdue               bigint NOT NULL,
  overdue_invoice_count integer NOT NULL,
  unallocated           bigint NOT NULL,
  collection_rate_bps   integer,
  computed_at           timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, year_key, campus_key, currency)
);

CREATE TABLE analytics.finance_by_group (
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants(id),
  year_key            text NOT NULL,
  campus_key          text NOT NULL,
  group_key           text NOT NULL,
  currency            text NOT NULL CHECK (length(currency) = 3),
  label               text,
  invoice_count       integer NOT NULL,
  learner_count       integer NOT NULL,
  billed              bigint NOT NULL,
  credited            bigint NOT NULL,
  collected           bigint NOT NULL,
  outstanding         bigint NOT NULL,
  overdue             bigint NOT NULL,
  collection_rate_bps integer,
  computed_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, year_key, campus_key, group_key, currency)
);

CREATE TABLE analytics.finance_by_learner (
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants(id),
  year_key            text NOT NULL,
  campus_key          text NOT NULL,
  learner_id          uuid NOT NULL,
  currency            text NOT NULL CHECK (length(currency) = 3),
  learner_name        text,
  group_key           text,
  label               text,
  invoice_count       integer NOT NULL,
  billed              bigint NOT NULL,
  credited            bigint NOT NULL,
  collected           bigint NOT NULL,
  outstanding         bigint NOT NULL,
  overdue             bigint NOT NULL,
  oldest_overdue_date date,
  collection_rate_bps integer,
  computed_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, year_key, campus_key, learner_id, currency)
);
CREATE INDEX finance_by_learner_out_ix ON analytics.finance_by_learner (tenant_id, year_key, campus_key, outstanding DESC);

CREATE TABLE analytics.finance_aged (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants(id),
  year_key      text NOT NULL,
  campus_key    text NOT NULL,
  bucket        text NOT NULL CHECK (bucket IN ('NOT_DUE','D1_30','D31_60','D61_90','D91_PLUS')),
  currency      text NOT NULL CHECK (length(currency) = 3),
  amount        bigint NOT NULL,
  invoice_count integer NOT NULL,
  as_of_date    date NOT NULL,
  computed_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, year_key, campus_key, bucket, currency)
);

CREATE TABLE analytics.finance_aged_learner (
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants(id),
  year_key    text NOT NULL,
  campus_key  text NOT NULL,
  learner_id  uuid NOT NULL,
  currency    text NOT NULL CHECK (length(currency) = 3),
  not_due     bigint NOT NULL,
  d1_30       bigint NOT NULL,
  d31_60      bigint NOT NULL,
  d61_90      bigint NOT NULL,
  d91_plus    bigint NOT NULL,
  total       bigint NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, year_key, campus_key, learner_id, currency)
);

-- Courbe d'encaissements : un point par jour (les semaines et les mois s'agrègent à la lecture).
CREATE TABLE analytics.collections_daily (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants(id),
  day           date NOT NULL,
  currency      text NOT NULL CHECK (length(currency) = 3),
  collected     bigint NOT NULL,
  refunded      bigint NOT NULL,
  net           bigint NOT NULL,
  payment_count integer NOT NULL,
  computed_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, day, currency)
);

-- Sessions de caisse (écarts : attendu, compté, écart).
CREATE TABLE analytics.cash_session_facts (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants(id),
  session_id    uuid NOT NULL,
  register_id   uuid,
  cashier_id    uuid,
  currency      text NOT NULL CHECK (length(currency) = 3),
  status        text NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  opened_at     timestamptz,
  closed_at     timestamptz,
  opening_float bigint NOT NULL DEFAULT 0,
  expected      bigint,
  counted       bigint,
  variance      bigint,
  refreshed_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, session_id)
);
CREATE INDEX cash_session_facts_closed_ix ON analytics.cash_session_facts (tenant_id, closed_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Paie et charge d'enseignement
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.payroll_status_facts (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants(id),
  period_id     uuid NOT NULL,
  status        text NOT NULL,
  year_id       uuid,
  period_name   text NOT NULL,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  currency      text NOT NULL CHECK (length(currency) = 3),
  payslip_count integer NOT NULL,
  total         bigint NOT NULL,
  refreshed_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, period_id, status)
);

CREATE TABLE analytics.teaching_load_facts (
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants(id),
  staff_id                  uuid NOT NULL,
  year_id                   uuid NOT NULL,
  display_name              text NOT NULL,
  status                    text,
  planned_hours             numeric NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  classroom_count           integer NOT NULL DEFAULT 0 CHECK (classroom_count >= 0),
  contractual_hours_per_week numeric,
  refreshed_at              timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, year_id)
);

-- -----------------------------------------------------------------------------
-- RLS forcée et droits (l'application ne SUPPRIME que des instantanés : DELETE accordé partout)
-- -----------------------------------------------------------------------------

SELECT kernel.enable_tenant_rls('analytics.refresh_requests');
SELECT kernel.enable_tenant_rls('analytics.refresh_state');
SELECT kernel.enable_tenant_rls('analytics.settings');
SELECT kernel.enable_tenant_rls('analytics.dim_scope');
SELECT kernel.enable_tenant_rls('analytics.dim_year');
SELECT kernel.enable_tenant_rls('analytics.dim_period');
SELECT kernel.enable_tenant_rls('analytics.dim_classroom');
SELECT kernel.enable_tenant_rls('analytics.enrollment_facts');
SELECT kernel.enable_tenant_rls('analytics.result_facts');
SELECT kernel.enable_tenant_rls('analytics.result_line_facts');
SELECT kernel.enable_tenant_rls('analytics.result_scopes');
SELECT kernel.enable_tenant_rls('analytics.attendance_daily');
SELECT kernel.enable_tenant_rls('analytics.staff_presence_facts');
SELECT kernel.enable_tenant_rls('analytics.finance_summary');
SELECT kernel.enable_tenant_rls('analytics.finance_by_group');
SELECT kernel.enable_tenant_rls('analytics.finance_by_learner');
SELECT kernel.enable_tenant_rls('analytics.finance_aged');
SELECT kernel.enable_tenant_rls('analytics.finance_aged_learner');
SELECT kernel.enable_tenant_rls('analytics.collections_daily');
SELECT kernel.enable_tenant_rls('analytics.cash_session_facts');
SELECT kernel.enable_tenant_rls('analytics.payroll_status_facts');
SELECT kernel.enable_tenant_rls('analytics.teaching_load_facts');

GRANT SELECT, INSERT, UPDATE, DELETE ON
  analytics.refresh_requests, analytics.refresh_state, analytics.settings, analytics.dim_scope, analytics.dim_year, analytics.dim_period,
  analytics.dim_classroom, analytics.enrollment_facts, analytics.result_facts, analytics.result_line_facts,
  analytics.result_scopes, analytics.attendance_daily, analytics.staff_presence_facts, analytics.finance_summary,
  analytics.finance_by_group, analytics.finance_by_learner, analytics.finance_aged, analytics.finance_aged_learner,
  analytics.collections_daily, analytics.cash_session_facts, analytics.payroll_status_facts, analytics.teaching_load_facts
  TO app_user;
