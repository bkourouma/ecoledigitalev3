# Modèle de données — modules `assess` et `results` (011-assessments-grades)

**Statut** : DDL de **référence**. Schémas `assess` (migrations `1100-1199`) et `results` (`1200-1299`) — plages proposées, à inscrire dans `docs/architecture/module-conventions.md`. Conventions : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` ; `kernel.enable_tenant_rls()` ; `UNIQUE (tenant_id, id)` + clés étrangères composites `(tenant_id, …)` **à l'intérieur** d'un schéma ; références au cœur par **UUID sans FK** (`academic.enrollments.id`, `academic.curriculum_nodes.id`, `academic.academic_periods.id`, `academic.academic_years.id`, `academic.classrooms.id`, `people.students.id`, `people.staff.id`) ; notes et moyennes = `numeric` exact, **aucun flottant** ; horodatages `timestamptz` UTC ; ids UUID v7 générés par `newId()`.

## 1. Schéma `assess`

### 1.1 Types d'évaluation (migration `1101_assess_types.sql`)

```sql
CREATE SCHEMA assess;

CREATE TABLE assess.assessment_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label               text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  -- groupe d'agrégation lu par les règles (ex. 'CONTINUOUS', 'EXAM', 'PROJECT') : donnée, pas constante de code
  aggregation_group   text NOT NULL CHECK (aggregation_group ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  default_scale_max   numeric(8,3) NOT NULL DEFAULT 20 CHECK (default_scale_max > 0),
  default_weight      numeric(8,3) NOT NULL DEFAULT 1  CHECK (default_weight >= 0),
  publication_mode    text NOT NULL DEFAULT 'MANUAL' CHECK (publication_mode IN ('MANUAL','AUTO_ON_APPROVAL')),
  visible_to_students boolean NOT NULL DEFAULT true,
  allows_session2     boolean NOT NULL DEFAULT false,
  is_system           boolean NOT NULL DEFAULT false,     -- instancié depuis un modèle de pack
  template_key        text,
  position            integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('assess.assessment_types');
GRANT SELECT, INSERT, UPDATE ON assess.assessment_types TO app_user;     -- jamais DELETE : désactivation (active = false)
```

Modèles de pack (données seedées au provisioning, `tenancy.tenant.provisioned`) : *classic/secondary* — Interrogation, Devoir, Composition, Examen blanc, Projet, Oral, TP, Autre (PRD §17), + « Moyenne saisie » (`aggregation_group = 'ENTERED_AVERAGE'`, Q-35) ; *higher* — Devoir (`CONTINUOUS`), Examen (`EXAM`, `allows_session2`), TP, Projet. Les `aggregation_group` valent **donnée** ; les règles les lisent (`filter(devoirs, d => d.groupe == "EXAM")`).

### 1.2 Réglages (migration `1101`)

```sql
CREATE TABLE assess.settings (
  tenant_id                uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  require_separate_reviewer boolean NOT NULL DEFAULT true,     -- Q-11
  require_separate_approver boolean NOT NULL DEFAULT true,
  max_score_decimals        smallint NOT NULL DEFAULT 2 CHECK (max_score_decimals BETWEEN 0 AND 3),
  late_grade_policy         text NOT NULL DEFAULT 'REVISION' CHECK (late_grade_policy IN ('REVISION')),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('assess.settings');
GRANT SELECT, INSERT, UPDATE ON assess.settings TO app_user;
```

### 1.3 Évaluations (migration `1102_assess_assessments.sql`)

```sql
CREATE TABLE assess.assessments (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  type_id            uuid NOT NULL,
  -- références du cœur : UUID sans FK
  classroom_id       uuid NOT NULL,
  curriculum_node_id uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  teacher_id         uuid NOT NULL,                      -- people.staff.id
  title              text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  assessed_on        date NOT NULL,
  scale_max          numeric(8,3) NOT NULL CHECK (scale_max > 0),
  weight             numeric(8,3) NOT NULL DEFAULT 1 CHECK (weight >= 0),
  session_no         smallint NOT NULL DEFAULT 1 CHECK (session_no IN (1, 2)),
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                       ('DRAFT','SUBMITTED','REVIEWED','APPROVED','PUBLISHED','CANCELLED')),
  submitted_at timestamptz, submitted_by uuid,
  reviewed_at  timestamptz, reviewed_by  uuid,
  approved_at  timestamptz, approved_by  uuid,
  published_at timestamptz, published_by uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  four_eyes_waived   boolean NOT NULL DEFAULT false,       -- dérogation tracée (Q-11)
  return_comment     text,                                 -- dernier motif de retour à DRAFT
  row_version        integer NOT NULL DEFAULT 1,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES assess.assessment_types (tenant_id, id),
  -- cohérence statut / horodatage
  CHECK (status NOT IN ('SUBMITTED','REVIEWED','APPROVED','PUBLISHED') OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
  CHECK (status NOT IN ('REVIEWED','APPROVED','PUBLISHED') OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  CHECK (status NOT IN ('APPROVED','PUBLISHED') OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK (status <> 'PUBLISHED' OR (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX assessments_class_period_idx ON assess.assessments (tenant_id, classroom_id, academic_period_id, status);
CREATE INDEX assessments_node_idx         ON assess.assessments (tenant_id, curriculum_node_id, academic_period_id);
CREATE INDEX assessments_teacher_idx      ON assess.assessments (tenant_id, teacher_id, status);
SELECT kernel.enable_tenant_rls('assess.assessments');
GRANT SELECT, INSERT, UPDATE ON assess.assessments TO app_user;           -- jamais DELETE
```

### 1.4 Notes (migration `1103_assess_grades.sql`)

```sql
CREATE TABLE assess.grades (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,                    -- academic.enrollments.id
  student_id    uuid NOT NULL,                    -- people.students.id (dénormalisé pour les lectures)
  score         numeric(8,3),
  entry_status  text NOT NULL DEFAULT 'ENTERED' CHECK (entry_status IN
                  ('ENTERED','ABSENT_EXCUSED','ABSENT_UNEXCUSED','EXEMPT','NOT_GRADED')),
  comment       text CHECK (comment IS NULL OR length(comment) <= 500),
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                  ('DRAFT','SUBMITTED','REVIEWED','APPROVED','PUBLISHED','CANCELLED')),   -- miroir de l'évaluation (trigger)
  row_version   integer NOT NULL DEFAULT 1,
  entered_by    uuid,
  entered_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (assessment_id, enrollment_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assess.assessments (tenant_id, id),
  CHECK ((entry_status = 'ENTERED') = (score IS NOT NULL)),
  CHECK (score IS NULL OR score >= 0)
);
CREATE INDEX grades_assessment_idx ON assess.grades (tenant_id, assessment_id);
CREATE INDEX grades_enrollment_idx ON assess.grades (tenant_id, enrollment_id, status);
CREATE INDEX grades_student_idx    ON assess.grades (tenant_id, student_id, status);
SELECT kernel.enable_tenant_rls('assess.grades');
GRANT SELECT, INSERT, UPDATE, DELETE ON assess.grades TO app_user;    -- DELETE/UPDATE gardés par déclencheur (brouillon, révision)
```

### 1.5 Révisions de notes (migration `1104_assess_revisions.sql`)

```sql
CREATE TABLE assess.grade_revisions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id      uuid NOT NULL,
  grade_id           uuid,                                  -- NULL pour kind = ADDITION avant application
  enrollment_id      uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('CORRECTION','ADDITION','REMOVAL')),
  old_score          numeric(8,3),
  old_entry_status   text,
  new_score          numeric(8,3),
  new_entry_status   text,
  reason             text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by       uuid NOT NULL,
  requested_by_name  text NOT NULL,                         -- identité figée
  requested_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','APPLIED')),
  decided_by         uuid,
  decided_by_name    text,
  decided_at         timestamptz,
  decision_comment   text,
  four_eyes_waived   boolean NOT NULL DEFAULT false,
  applied_at         timestamptz,
  batch_id           uuid,                                  -- annulation d'évaluation : lot de REMOVAL
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assess.assessments (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_id)      REFERENCES assess.grades (tenant_id, id),
  CHECK (kind <> 'CORRECTION' OR (grade_id IS NOT NULL AND new_entry_status IS NOT NULL)),
  CHECK (kind <> 'ADDITION'   OR (old_score IS NULL AND new_entry_status IS NOT NULL)),
  CHECK (status NOT IN ('APPROVED','REJECTED','APPLIED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'APPLIED' OR applied_at IS NOT NULL),
  CHECK (decided_by IS NULL OR four_eyes_waived OR decided_by <> requested_by)
);
CREATE INDEX grade_revisions_assessment_idx ON assess.grade_revisions (tenant_id, assessment_id, status);
CREATE INDEX grade_revisions_grade_idx      ON assess.grade_revisions (tenant_id, grade_id);
SELECT kernel.enable_tenant_rls('assess.grade_revisions');
GRANT SELECT, INSERT, UPDATE ON assess.grade_revisions TO app_user;      -- append-only sauf progression de statut (déclencheur)
```

### 1.6 Verrous de période (migration `1105_assess_locks.sql`)

```sql
CREATE TABLE assess.period_locks (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  locked_at          timestamptz NOT NULL DEFAULT now(),
  locked_by          uuid NOT NULL,
  lock_reason        text,
  -- sessions verrouillées : {1,2} = tout ; {1} = fenêtre de rattrapage ouverte (la session 2 redevient saisissable)
  locked_sessions    smallint[] NOT NULL DEFAULT '{1,2}' CHECK (locked_sessions <@ '{1,2}'::smallint[] AND cardinality(locked_sessions) >= 1),
  released_at        timestamptz,
  released_by        uuid,
  release_reason     text,
  UNIQUE (tenant_id, id),
  CHECK (released_at IS NULL OR release_reason IS NOT NULL)
);
-- un seul verrou actif par classe × période
CREATE UNIQUE INDEX period_locks_active_uq ON assess.period_locks (tenant_id, classroom_id, academic_period_id)
  WHERE released_at IS NULL;
SELECT kernel.enable_tenant_rls('assess.period_locks');
GRANT SELECT, INSERT, UPDATE ON assess.period_locks TO app_user;
```

### 1.7 Déclencheurs d'intégrité (migration `1106_assess_guards.sql`)

Codes d'erreur stables au format `assess.<code>` en préfixe du message ; `ERRCODE restrict_violation` (23001) ou `check_violation` (23514), comme `finance` (`0503`).

| Fonction / déclencheur | Table | Règle imposée |
|---|---|---|
| `assess.assessments_guard()` `BEFORE UPDATE` | `assessments` | (a) transitions légales (miroir de l'AC2.1) ; (b) hors `DRAFT`, `scale_max`, `weight`, `curriculum_node_id`, `classroom_id`, `academic_period_id`, `session_no`, `type_id`, `teacher_id` sont **immuables** ; (c) `SUBMITTED→REVIEWED` impose `reviewed_by <> submitted_by` sauf `four_eyes_waived` (idem approbation/publication selon `assess.settings`) ; (d) `PUBLISHED` est terminal (seul `CANCELLED` par lot de révisions approuvé via `app.grade_revision_batch`) ; (e) transition vers `SUBMITTED` impose au moins une ligne `grades` ; (f) refuse toute transition si `assess.period_locks` actif pour (classe, période) **dont `locked_sessions` contient le `session_no` de l'évaluation** |
| `assess.assessments_mirror()` `AFTER UPDATE OF status` | `assessments` | Reporte `status` sur toutes les lignes `grades` de l'évaluation (même transaction). Les lignes `NOT_GRADED` des inscriptions actives sans note sont **insérées par l'application juste avant** la transition `SUBMITTED` (l'évaluation est encore `DRAFT`, l'insertion est donc légale) : la liste des inscriptions est un UUID externe, jamais déduite en SQL |
| `assess.grades_guard()` `BEFORE INSERT OR UPDATE OR DELETE` | `grades` | **INSERT** : évaluation `DRAFT` **ou** révision `ADDITION` approuvée désignée par `current_setting('app.grade_revision_id')` pour la même (évaluation, inscription) ; **UPDATE de `score`/`entry_status`** : évaluation `DRAFT` **ou** révision `CORRECTION|REMOVAL` approuvée désignée par le même réglage pour cette note ; **UPDATE de `status`** : uniquement par `assessments_mirror` (`pg_trigger_depth() > 1`) ; **DELETE** : évaluation `DRAFT` seulement ; vérifie `score <= scale_max` et le nombre de décimales (`assess.settings.max_score_decimals`) ; refuse tout si la période est verrouillée **pour la session de l'évaluation** (`locked_sessions`) |
| `assess.grade_revisions_guard()` `BEFORE INSERT OR UPDATE OR DELETE` | `grade_revisions` | `DELETE` interdit ; colonnes de contenu (`old_*`, `new_*`, `reason`, `requested_*`, `kind`) immuables après insertion ; statut : `REQUESTED→APPROVED|REJECTED`, `APPROVED→APPLIED` seulement ; l'ancien `score` est **relu en base** à l'insertion (impossible de mentir sur l'ancienne valeur) |
| `assess.apply_revision(p_revision uuid)` `SECURITY INVOKER` | fonction | Seule voie de modification d'une note publiée : vérifie `status = 'APPROVED'`, période non verrouillée, positionne `set_config('app.grade_revision_id', p_revision::text, true)`, applique la modification, passe la révision à `APPLIED`, incrémente `row_version`. `EXECUTE` accordé à `app_user` ; le déclencheur `grades_guard` revérifie tout (défense en profondeur : l'application **et** le déclencheur) |
| `assess.period_locks_guard()` | `period_locks` | `released_*` posés une seule fois ; pas de `DELETE` ; `locked_sessions` ne peut que **diminuer** (de `{1,2}` à `{1}`) tant que le verrou est actif — jamais s'élargir sans nouveau verrou |

## 2. Schéma `results`

### 2.1 États de période et clôtures (migration `1201_results_states.sql`)

```sql
CREATE SCHEMA results;

CREATE TABLE results.period_states (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,                         -- NULL = état d'ANNÉE (scope = 'YEAR')
  academic_year_id    uuid NOT NULL,
  scope               text NOT NULL DEFAULT 'PERIOD' CHECK (scope IN ('PERIOD','YEAR')),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','GRADING_LOCKED','DELIBERATED','CLOSED')),
  contract_id         text NOT NULL,                -- ex. credit-semester@1
  -- PIN de la version de règle (reproductibilité) : ids externes au module, aucune FK
  rule_version_kind   text NOT NULL CHECK (rule_version_kind IN ('TENANT','NATIONAL')),
  rule_version_id     uuid NOT NULL,
  rule_set_code       text NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  pinned_at           timestamptz NOT NULL DEFAULT now(),
  pinned_by           uuid,
  locked_at timestamptz, locked_by uuid,
  deliberated_at timestamptz, deliberated_by uuid,
  closed_at timestamptz, closed_by uuid,
  reopen_count        integer NOT NULL DEFAULT 0,
  last_reopen_kind    text CHECK (last_reopen_kind IS NULL OR last_reopen_kind IN ('CORRECTION','RESIT_SESSION')),
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
GRANT SELECT, INSERT, UPDATE ON results.period_states TO app_user;

CREATE TABLE results.closures (                      -- une ligne par clôture ; tamper-evidence
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id         uuid NOT NULL,
  results_version  integer NOT NULL,
  results_count    integer NOT NULL CHECK (results_count >= 0),
  closure_hash     text NOT NULL CHECK (closure_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 des outputs_hash triés
  closed_at        timestamptz NOT NULL DEFAULT now(),
  closed_by        uuid NOT NULL,
  closed_by_name   text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (state_id, results_version),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('results.closures');
GRANT SELECT, INSERT ON results.closures TO app_user;          -- append-only (déclencheur forbid_mutation)
```

### 2.2 Résultats calculés (migration `1202_results_results.sql`)

```sql
CREATE TABLE results.period_results (                -- en-tête : une version de résultats d'une inscription pour une période (ou une année)
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id            uuid NOT NULL,
  enrollment_id       uuid NOT NULL,
  student_id          uuid NOT NULL,
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,
  academic_year_id    uuid NOT NULL,
  scope               text NOT NULL CHECK (scope IN ('PERIOD','YEAR')),
  version             integer NOT NULL CHECK (version >= 1),
  status              text NOT NULL CHECK (status IN ('DRAFT','FINAL','SUPERSEDED','ERROR')),
  -- reproductibilité
  contract_id         text NOT NULL,
  rule_version_kind   text NOT NULL,
  rule_version_id     uuid NOT NULL,
  rule_set_code       text NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL,
  engine_version      text NOT NULL,
  inputs_hash         text NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  outputs_hash        text CHECK (outputs_hash IS NULL OR outputs_hash ~ '^[0-9a-f]{64}$'),
  inputs              jsonb,                           -- contexte canonique (FINAL seulement ; sans identité)
  error               jsonb,                           -- diagnostic si status = ERROR
  -- synthèse typée (valeurs exactes + valeur d'affichage séparée)
  average             numeric,                         -- exact
  average_display     numeric(6,2),                    -- sortie de arrondi_affichage (jamais réinjectée)
  rank                integer CHECK (rank IS NULL OR rank >= 1),
  cohort_size         integer CHECK (cohort_size IS NULL OR cohort_size >= 0),
  mention_code        text,
  decision_code       text,
  decision_outcome    text CHECK (decision_outcome IS NULL OR decision_outcome IN
                        ('PROMOTED','REPEAT','PENDING','EXAM_REFERRAL','ADMITTED','RESIT','ADJOURNED','OTHER')),
  credits_acquired    numeric(8,2),
  credits_required    numeric(8,2),
  validated           boolean,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  finalized_at        timestamptz,
  superseded_at       timestamptz,
  supersedes_id       uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  CHECK ((scope = 'PERIOD') = (academic_period_id IS NOT NULL)),
  CHECK (status <> 'FINAL' OR (finalized_at IS NOT NULL AND outputs_hash IS NOT NULL AND inputs IS NOT NULL)),
  CHECK (status <> 'SUPERSEDED' OR superseded_at IS NOT NULL),
  CHECK (status <> 'ERROR' OR error IS NOT NULL)
);
CREATE UNIQUE INDEX period_results_version_uq ON results.period_results (tenant_id, state_id, enrollment_id, version);
CREATE UNIQUE INDEX period_results_final_uq   ON results.period_results (tenant_id, state_id, enrollment_id) WHERE status = 'FINAL';
CREATE UNIQUE INDEX period_results_draft_uq   ON results.period_results (tenant_id, state_id, enrollment_id) WHERE status IN ('DRAFT','ERROR');
CREATE INDEX period_results_student_idx       ON results.period_results (tenant_id, student_id, academic_year_id) WHERE status = 'FINAL';
CREATE INDEX period_results_rank_idx          ON results.period_results (tenant_id, state_id, rank) WHERE status IN ('DRAFT','FINAL');
SELECT kernel.enable_tenant_rls('results.period_results');
GRANT SELECT, INSERT, UPDATE ON results.period_results TO app_user;

CREATE TABLE results.line_results (                  -- détail par nœud
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  period_result_id   uuid NOT NULL,
  level              text NOT NULL CHECK (level IN ('ECUE','SUBJECT','UE','SECTION','PERIOD','YEAR')),
  curriculum_node_id uuid,
  parent_node_id     uuid,
  value              numeric,                        -- moyenne/note exacte ; NULL = non notée
  display_value      numeric(6,2),
  credits            numeric(8,2),
  coefficient        numeric(8,3),
  validated          boolean,
  status_code        text,                           -- ex. VALIDATED, COMPENSATED, ELIMINATORY, PENDING
  session_obtained   smallint CHECK (session_obtained IS NULL OR session_obtained IN (1, 2)),
  resit_eligible     boolean,
  rank               integer CHECK (rank IS NULL OR rank >= 1),
  cohort_size        integer,
  overridden         boolean NOT NULL DEFAULT false,
  override_id        uuid,
  outputs            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- autres sorties de règle (codes)
  trace              jsonb,                          -- trace du moteur (FINAL seulement)
  position           integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_result_id) REFERENCES results.period_results (tenant_id, id),
  CHECK ((level IN ('PERIOD','YEAR')) = (curriculum_node_id IS NULL)),
  CHECK (NOT overridden OR override_id IS NOT NULL)
);
CREATE UNIQUE INDEX line_results_node_uq ON results.line_results
  (tenant_id, period_result_id, level, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX line_results_node_idx ON results.line_results (tenant_id, curriculum_node_id, level);
SELECT kernel.enable_tenant_rls('results.line_results');
GRANT SELECT, INSERT, UPDATE, DELETE ON results.line_results TO app_user;     -- DELETE/UPDATE : brouillon seulement (déclencheur)
```

Déclencheurs `results.*_guard` : un en-tête `FINAL` n'accepte que `status → SUPERSEDED` (+ `superseded_at`) ; ses lignes sont immuables ; `DELETE` interdit sur `period_results`/`closures` ; `status → FINAL` n'est permis que si une `closures` correspondante est insérée dans la même transaction (déclencheur différé) ; une écriture est refusée si `period_states.status = 'CLOSED'` (sauf passage `FINAL`/`SUPERSEDED` de la clôture elle-même, flag `app.results_closing`).

### 2.3 Surcharges, décisions, délibérations, appréciations (migration `1203_results_decisions.sql`)

```sql
CREATE TABLE results.overrides (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id           uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  level              text NOT NULL CHECK (level IN ('ECUE','SUBJECT','UE','SECTION','PERIOD','YEAR')),
  curriculum_node_id uuid,
  rule_key           text NOT NULL,                   -- étape surchargée (ex. note_ecue, ecue_validee)
  kind               text NOT NULL CHECK (kind IN ('VALUE','VALIDATION')),
  original_value     text,                            -- décimal exact ou booléen, tel que calculé
  override_value     numeric,
  override_flag      boolean,
  justification      text NOT NULL CHECK (length(btrim(justification)) >= 20),
  requested_by uuid NOT NULL, requested_by_name text NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','REVOKED')),
  decided_by uuid, decided_by_name text, decided_at timestamptz, decision_comment text,
  revoked_reason     text,
  four_eyes_waived   boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  CHECK ((kind = 'VALUE') = (override_value IS NOT NULL)),
  CHECK ((kind = 'VALIDATION') = (override_flag IS NOT NULL)),
  CHECK (decided_by IS NULL OR four_eyes_waived OR decided_by <> requested_by),
  CHECK (status <> 'REVOKED' OR revoked_reason IS NOT NULL)
);
-- une seule surcharge ACTIVE par cible
CREATE UNIQUE INDEX overrides_active_uq ON results.overrides
  (tenant_id, state_id, enrollment_id, rule_key, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('REQUESTED','APPROVED');
SELECT kernel.enable_tenant_rls('results.overrides');
GRANT SELECT, INSERT, UPDATE ON results.overrides TO app_user;

CREATE TABLE results.deliberations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  state_id           uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('COUNCIL','JURY')),
  held_on            date,
  status             text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','HELD','SIGNED','CANCELLED')),
  participants       jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{ staffId, role }]
  minutes_object_key text,                                      -- procès-verbal (StoragePort)
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  CHECK (status NOT IN ('HELD','SIGNED') OR held_on IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('results.deliberations');
GRANT SELECT, INSERT, UPDATE ON results.deliberations TO app_user;

CREATE TABLE results.decisions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id           uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  scope              text NOT NULL CHECK (scope IN ('PERIOD','YEAR')),
  kind               text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),     -- ex. SEMESTER_STATUS, COUNCIL, YEAR_END
  source_result_id   uuid,                                      -- en-tête period_results dont la règle a proposé
  proposed_code      text,
  proposed_outcome   text,
  final_code         text,
  final_outcome      text,
  status             text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','CONFIRMED','PUBLISHED','WITHDRAWN')),
  deliberation_id    uuid,
  justification      text,
  decided_by uuid, decided_by_name text, decided_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  FOREIGN KEY (tenant_id, deliberation_id) REFERENCES results.deliberations (tenant_id, id),
  CHECK (status = 'PROPOSED' OR final_code IS NOT NULL),
  CHECK (final_code IS NULL OR final_code = proposed_code OR length(btrim(coalesce(justification, ''))) >= 20)
);
CREATE UNIQUE INDEX decisions_active_uq ON results.decisions (tenant_id, state_id, enrollment_id, kind) WHERE status <> 'WITHDRAWN';
SELECT kernel.enable_tenant_rls('results.decisions');
GRANT SELECT, INSERT, UPDATE ON results.decisions TO app_user;

CREATE TABLE results.appreciations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id           uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  curriculum_node_id uuid,                                       -- NULL = appréciation générale (conseil)
  author_staff_id    uuid NOT NULL,
  author_role        text NOT NULL CHECK (author_role IN ('TEACHER','COUNCIL','DIRECTOR')),
  body               text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id)
);
CREATE UNIQUE INDEX appreciations_uq ON results.appreciations
  (tenant_id, state_id, enrollment_id, author_role, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid));
SELECT kernel.enable_tenant_rls('results.appreciations');
GRANT SELECT, INSERT, UPDATE ON results.appreciations TO app_user;     -- figées après clôture (déclencheur)
```

### 2.4 File de recalcul (migration `1204_results_recompute.sql`)

```sql
CREATE TABLE results.recompute_requests (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  scope_enrollments  uuid[],                      -- NULL = toute la classe
  causes             jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{ event, id, at }] plafonné à 50
  not_before         timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','BLOCKED','FAILED')),
  blocked_reason     text,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, finished_at timestamptz,
  UNIQUE (tenant_id, id)
);
-- un seul PENDING par clé (coalescence) ; un seul RUNNING
CREATE UNIQUE INDEX recompute_pending_uq ON results.recompute_requests (tenant_id, classroom_id, academic_period_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX recompute_running_uq ON results.recompute_requests (tenant_id, classroom_id, academic_period_id) WHERE status = 'RUNNING';
CREATE INDEX recompute_due_idx ON results.recompute_requests (not_before) WHERE status = 'PENDING';
SELECT kernel.enable_tenant_rls('results.recompute_requests');
GRANT SELECT, INSERT, UPDATE, DELETE ON results.recompute_requests TO app_user;       -- purge des DONE > 30 j
```

## 3. Index et volumétrie

| Table | Ordre de grandeur (établissement de 1 000 élèves) | Remarque |
|---|---|---|
| `assessments` | ~3 000 / an | |
| `grades` | ~100 000 à 300 000 / an | partitionnement par `academic_year_id` envisageable après 5 ans |
| `grade_revisions` | < 1 % des notes | |
| `period_results` | 1 000 × 4 périodes × versions (≈ 1,3 en moyenne) | purge des `DRAFT`/`SUPERSEDED` non `FINAL` précédents après 90 j (job) |
| `line_results` | ~15 lignes par en-tête | `trace` uniquement pour `FINAL` (≈ 2-10 Ko par ligne) |
| `recompute_requests` | volatile | purge 30 j |

Conservation : `FINAL`, `closures`, révisions, surcharges, décisions : **durée de vie du tenant** (valeur probante) ; export contrôlé par rôle.

## 4. Événements et outbox

Les événements de la spec §11 sont écrits via `PgOutboxWriter(tx)` dans la même transaction que la donnée ; versions `{ v: 1 }`. `assess.grade.published` ne transporte **aucune note** (seulement ids et métadonnées) : pas de donnée personnelle dans l'outbox.

## 5. Écarts d'implémentation (modules `assess` et `results`, 2026-10-01)

Ajouts ou précisions par rapport aux DDL ci-dessus (tous justifiés par une exigence de la spec ; migrations `1100-1105` et `1200-1203`) :

- `assess.assessment_transitions` : historique append-only de chaque transition (acteur, date, commentaire) — AC2.4.
- `assess.batch_receipts` : clés `Idempotency-Key` des saisies en lot — AC1.3 (purge quotidienne).
- `assess.grade_revisions.student_id` : nécessaire à une révision de type ADDITION (élève absent de la feuille à la publication).
- `assess.apply_revision(uuid, timestamptz)` : voie unique de modification d'une note publiée ; la révision APPROUVÉE correspondante est relue en base.
- `results.period_results.closure_id`, `line_count` : une clôture scelle les lignes de ses en-têtes FINAL ; `summary` jsonb porte `classSize`
  (effectif de la classe), distinct de `cohort_size` (inscriptions classées, avec moyenne).
- `results.line_results.trace` des FINAL conserve, pour chaque appel de règle, le contexte exact (`variables`, hors `rang`) : base du rejeu
  de reproductibilité et des cas de simulation du module `rules`.
- Les résultats d'ANNÉE (`scope = 'YEAR'`) ne sont pas persistés : `getYearResult` les DÉRIVE des résultats FINAL de période (immuables) sous
  la version de règle épinglée du dernier semestre (contrat à crédits : règles de l'étape « année » ; contrat à coefficients : ligne `YEAR`
  du 2ᵉ semestre). Les colonnes `scope = 'YEAR'` restent disponibles pour une persistance ultérieure (diplôme, 019).
- Une UE sans aucun résultat n'a ni état LMD ni session de validation, et le semestre reste sans décision (en attente) : la décision
  `ADJOURNED` n'est jamais prononcée faute de note.
- Vue de travail d'une période : version la plus récente non remplacée (après réouverture, le brouillon de correction prime sur le FINAL) ;
  résultat officiel et lectures famille : FINAL seulement.
