# Modèle de données — 010-attendance (schéma Postgres `attendance`)

**Statut** : DDL de référence, exécuté et testé sur PostgreSQL 17 (21 tests de comportement : statuts, justificatifs, verrou de validation et exception d'excuse, historique automatique, récapitulatif, congés, RLS). Migrations cibles `apps/api/src/modules/attendance/migrations/0900…0903` (plage 0900-0999 à inscrire dans `module-conventions.md`).

**Sources** : `docs/architecture/module-conventions.md`, ADR-002/004/006/007, PRD §33-34 et §43, plan §3.7 et §4 (tranche 2.3), inventaire legacy (`parity.md`).

## 1. Conventions appliquées

Celles de `specs/v2/004-academic-core/data-model.md` §1. Particularités :

| Règle | Application |
|---|---|
| Références hors schéma sans FK | `enrollment_id`, `classroom_id`, `curriculum_node_id`, `offering_id`, `academic_year_id` → `academic` ; `student_id`, `staff_id` → `people` ; `occurrence_id` → `scheduling` ; `period_id` → `academic.academic_periods`. Vérifiées à l'écriture par les API publiques (`academic.getRoster`, `scheduling.getOccurrence`, `people.getStudentsByIds`). |
| Un seul modèle d'appel | `sessions` (appel) + `student_records` (pointages) remplacent `attendance_sessions`/`student_attendance`, `teacher_attendance_*` et `professional_ecue_attendance`. |
| Statuts = données | `status_definitions` (famille ÉLÈVE ou PERSONNEL) ; les drapeaux (`counts_as_present`, `counts_as_absence`, `counts_as_late`, `is_justified`) pilotent les comptages — **aucun seuil**, aucune équivalence « N retards = 1 absence » dans le module. |
| Récapitulatif dérivé | `period_summaries` est un cache recalculé ; toute correction manuelle passe par `summary_overrides` (motif, auteur) — plus de saisie libre. |
| Verrous et historique | Séance `VALIDATED` figée par la base ; `record_history` alimenté par déclencheur ; suppression physique interdite. |
| Aucun secret ni donnée sensible dans les journaux | Les pièces jointes sont référencées par clé d'objet ; le type réel est contrôlé par octets magiques (`detected_mime`) et l'empreinte `sha256` est conservée. |
| Seuils | Aucun. Les alertes d'absentéisme (PRD §43) sont des configurations de 016/025 qui lisent `period_summaries` et les événements. |

## 2. Vue d'ensemble

```
academic.classrooms / enrollments (UUID)       scheduling.session_occurrences (UUID)
          │                                              │
          └──────────────► sessions (appel) ◄────────────┘   scope DAILY (primaire) | SESSION (séance)
                              │  status : OPEN → SUBMITTED → VALIDATED (| CANCELLED)
                              ├──< student_records ──< record_history (automatique)
                              │        │ (statut, excused, justification_id, counted_minutes)
                              │        └── justifications ──< justification_attachments
                              │                    └──< justification_records
                              └── client_id (idempotence hors-ligne)

period_summaries (dérivé) ◄── student_records     summary_overrides (surcharge tracée)
staff_records (présence du personnel) ──> staff_leaves (congés)
status_definitions · justification_reasons · leave_types · call_policies · settings (données)
```

## 3. Catalogue des tables

| Table | Rôle | Cardinalité indicative (1 500 élèves, appel par séance) |
|---|---|---|
| `status_definitions`, `justification_reasons`, `leave_types` | Référentiels de pack | ~15 lignes |
| `call_policies`, `settings` | Politique d'appel par cycle ; pièces jointes acceptées | quelques lignes |
| `sessions` | Séance d'appel (une par occurrence, ou une par classe et par jour) | ~1 500 / jour |
| `student_records` | Pointage par inscription | ~25 000 / jour (≈ 5 M / an) → partitionnable par `session_date` si besoin |
| `record_history` | Journal des changements de statut | ≈ 1,1 × `student_records` |
| `justifications`, `justification_attachments`, `justification_records` | Demandes de justification d'une fenêtre, pièces, pointages couverts | ~2 % des absences |
| `period_summaries` | Cache dérivé par inscription et période | 1 par inscription et par période |
| `summary_overrides` | Surcharges tracées | rares |
| `staff_records`, `staff_leaves` | Présence quotidienne et congés du personnel | ~100 / jour ; ~200 / an |

## 4. Décisions de modélisation à connaître

1. **Un pointage, deux dimensions : statut et justification.** `status_code` dit ce qui s'est passé (PRESENT, ABSENT, LATE, EARLY_LEAVE) ; `excused` dit qu'un justificatif **accepté** le couvre. Une absence justifiée passe en `EXCUSED` (le statut d'origine `ABSENT` est conservé dans `original_status_code` et restauré si le justificatif est révoqué) ; un retard ou un départ anticipé justifié **garde** son statut avec `excused = true`. La base interdit `EXCUSED` sans justificatif accepté lié (le legacy levait une violation de CHECK à l'appel suivant et laissait un motif libre sans décision).
2. **Un justificatif couvre une fenêtre**, pas un pointage ; l'acceptation (`acceptJustification`) applique l'excuse à tous les pointages `ABSENT`/`LATE`/`EARLY_LEAVE` de l'élève dans la fenêtre (liste conservée dans `justification_records` pour la révocation). Le dépôt est possible par le tuteur ou l'élève ; la décision par un rôle habilité (`attendance.justification.decide`).
3. **Séance d'appel ≠ occurrence.** L'occurrence (scheduling) est le fait planifié ; la séance d'appel est le relevé des présences. Le constat « séance réalisée » (legacy `basculerSeanceRealisee`) devient l'événement `attendance.session.submitted` que scheduling consomme pour poser `HELD`. La validation pour la paie et la durée payée vivent dans scheduling, pas ici.
4. **Appel journalier du primaire** (`scope = DAILY`) : sans occurrence ni nœud ; `call_policies.daily_minutes` (donnée) convertit une absence d'un jour en minutes si l'établissement le souhaite ; sinon les récapitulatifs ne comptent que des jours.
5. **Récapitulatif = comptage brut dérivé.** `absent_*` = absences **totales** (justifiées comprises) ; `excused_*` = sous-ensemble justifié (« N heures d'absence dont M justifiées » du bulletin legacy s'obtient sans calcul). La surcharge manuelle (`summary_overrides`) remplace le dérivé pour (inscription, période) avec motif et auteur — pour les établissements qui ne font pas l'appel ou pour une reprise d'historique.
6. **Hors-ligne.** `client_id` (UUID généré par l'appareil) sur la séance et sur le pointage rend la synchronisation idempotente ; une séance déjà `VALIDATED` rejette les pointages tardifs (mis en file de conflits côté application).
7. **Personnel.** Présence quotidienne (`staff_records`) et congés (`staff_leaves`, approbation, non-chevauchement des congés approuvés) ; la présence d'un enseignant **à une séance** reste un fait de scheduling (`occurrence_staff`, remplaçant compris).

## 5. DDL de référence

### 5.1 Schéma et référentiels

<!-- migration: 0900_attendance_reference.sql -->
```sql
-- =============================================================================
-- 0900 — Module attendance : schéma et référentiels pilotés par les modèles de pack
-- =============================================================================
--
-- Plage de numéros réservée au module attendance : 0900–0999 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; plage à inscrire dans ce tableau).
--
-- UN SEUL modèle d'appel remplace les quatre systèmes du legacy (attendance_sessions +
-- student_attendance, teacher_attendance_*, professional_ecue_attendance, récaps saisis à la
-- main) : une SÉANCE D'APPEL (`sessions`) porte des POINTAGES (`student_records`) par
-- inscription. Les statuts sont des DONNÉES (`status_definitions`) dont les drapeaux
-- (compte comme présence / absence / retard) pilotent les comptages — aucune règle de seuil
-- ni d'équivalence (« 3 retards = 1 absence ») n'est dans ce module : elles relèvent des
-- RuleSets et des politiques des modules consommateurs.
-- Références inter-modules par UUID, sans FK : academic (année, classe, inscription, nœud),
-- people (élève, personnel), scheduling (occurrence).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS attendance;
REVOKE ALL ON SCHEMA attendance FROM PUBLIC;
GRANT USAGE ON SCHEMA attendance TO app_user;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Statuts de présence. Codes système verrouillés (is_system) : PRESENT, ABSENT, LATE, EXCUSED,
-- EARLY_LEAVE (élèves, PRD §33) ; PRESENT, ABSENT, LATE, ON_LEAVE (personnel). Un tenant peut
-- AJOUTER des statuts (ex. MEDICAL_LEAVE) mais pas modifier la sémantique des statuts système.
CREATE TABLE attendance.status_definitions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  subject_kind       text NOT NULL CHECK (subject_kind IN ('STUDENT', 'STAFF')),
  code               text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label              text NOT NULL CHECK (length(btrim(label)) > 0),
  counts_as_present  boolean NOT NULL DEFAULT false,
  counts_as_absence  boolean NOT NULL DEFAULT false,
  counts_as_late     boolean NOT NULL DEFAULT false,
  is_justified       boolean NOT NULL DEFAULT false,
  requires_justification boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  is_system          boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, subject_kind, code),
  CHECK (NOT (counts_as_present AND counts_as_absence)),
  CHECK (NOT is_justified OR counts_as_absence OR counts_as_late)
);
SELECT kernel.enable_tenant_rls('attendance.status_definitions');
GRANT SELECT, INSERT, UPDATE ON attendance.status_definitions TO app_user;

-- Motifs de justification d'absence (maladie, famille, transport…), donnée de pack.
CREATE TABLE attendance.justification_reasons (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  requires_attachment  boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 0,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('attendance.justification_reasons');
GRANT SELECT, INSERT, UPDATE ON attendance.justification_reasons TO app_user;

-- Types de congé du personnel. `is_paid` est une information pour la paie (spec 031/032).
CREATE TABLE attendance.leave_types (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  is_paid              boolean NOT NULL DEFAULT true,
  requires_approval    boolean NOT NULL DEFAULT true,
  requires_attachment  boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('attendance.leave_types');
GRANT SELECT, INSERT, UPDATE ON attendance.leave_types TO app_user;

-- Politique d'appel par cycle d'enseignement : appel journalier (primaire : l'instituteur fait
-- l'appel du matin) ou par séance (secondaire, supérieur), fenêtre de correction après
-- soumission. Ce sont des politiques d'établissement, pas des règles réglementaires.
CREATE TABLE attendance.call_policies (
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id       uuid NOT NULL,
  education_level_code text NOT NULL,                    -- academic.education_levels.code ('*' = défaut)
  call_scope           text NOT NULL DEFAULT 'SESSION' CHECK (call_scope IN ('DAILY', 'SESSION', 'BOTH')),
  edit_window_minutes  integer CHECK (edit_window_minutes IS NULL OR edit_window_minutes >= 0),
  late_requires_minutes boolean NOT NULL DEFAULT false,
  -- Durée (minutes) comptée pour une absence constatée à l'appel JOURNALIER (sans durée de
  -- séance) ; NULL = on ne compte que des jours (counted_minutes reste NULL).
  daily_minutes        integer CHECK (daily_minutes IS NULL OR daily_minutes > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id, education_level_code)
);
SELECT kernel.enable_tenant_rls('attendance.call_policies');
GRANT SELECT, INSERT, UPDATE ON attendance.call_policies TO app_user;

-- Paramètres du tenant (une ligne) : pièces jointes acceptées pour les justificatifs et congés.
-- NULL = dépôt de pièces désactivé tant que le modèle de pack ou le tenant n'a rien fixé.
CREATE TABLE attendance.settings (
  tenant_id                uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  attachment_max_bytes     integer CHECK (attachment_max_bytes IS NULL OR attachment_max_bytes > 0),
  allowed_attachment_types text[] CHECK (allowed_attachment_types IS NULL OR allowed_attachment_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('attendance.settings');
GRANT SELECT, INSERT, UPDATE ON attendance.settings TO app_user;
```

### 5.2 Appel, pointages, justificatifs, récapitulatifs

<!-- migration: 0901_attendance_records.sql -->
```sql
-- =============================================================================
-- 0901 — Module attendance (spec 010) : séances d'appel, pointages, justificatifs, récaps
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Séance d'appel
--   scope SESSION : rattachée à une occurrence du planning (scheduling.session_occurrences)
--   scope DAILY   : appel journalier d'une classe (primaire), sans occurrence
-- status : OPEN -> SUBMITTED -> VALIDATED ; CANCELLED. Corrections : SUBMITTED dans la fenêtre
--   de la politique d'appel, VALIDATED seulement par réouverture motivée et auditée.
-- `client_id` : identifiant généré par l'appareil, clé d'idempotence de la synchronisation
--   hors-ligne (PRD §59 : l'appel d'abord).
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.sessions (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id       uuid NOT NULL,
  academic_year_id     uuid NOT NULL,
  classroom_id         uuid NOT NULL,
  curriculum_node_id   uuid,
  offering_id          uuid,                             -- academic.classroom_offerings.id (appel d'une offre à la carte)
  occurrence_id        uuid,                             -- scheduling.session_occurrences.id
  scope                text NOT NULL CHECK (scope IN ('DAILY', 'SESSION')),
  session_date         date NOT NULL,
  starts_at            timestamptz,
  ends_at              timestamptz,
  duration_minutes     integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  taken_by_staff_id    uuid,                             -- people.staff.id
  taken_by_user_id     uuid,
  status               text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'VALIDATED', 'CANCELLED')),
  source               text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'OFFLINE_SYNC', 'LIVE_CLASS', 'IMPORT')),
  client_id            uuid,
  submitted_at         timestamptz,
  validated_at         timestamptz,
  validated_by         uuid,
  reopened_count       integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (scope <> 'SESSION' OR occurrence_id IS NOT NULL OR curriculum_node_id IS NOT NULL),
  CHECK (scope <> 'DAILY' OR (occurrence_id IS NULL AND curriculum_node_id IS NULL)),
  CHECK (status NOT IN ('SUBMITTED', 'VALIDATED') OR submitted_at IS NOT NULL),
  CHECK (status <> 'VALIDATED' OR (validated_at IS NOT NULL AND validated_by IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('attendance.sessions');
-- Un seul appel par occurrence ; un seul appel journalier par classe et par jour.
CREATE UNIQUE INDEX sessions_one_per_occurrence ON attendance.sessions (tenant_id, occurrence_id) WHERE occurrence_id IS NOT NULL AND status <> 'CANCELLED';
CREATE UNIQUE INDEX sessions_one_daily ON attendance.sessions (tenant_id, classroom_id, session_date) WHERE scope = 'DAILY' AND status <> 'CANCELLED';
CREATE UNIQUE INDEX sessions_client_id ON attendance.sessions (tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX sessions_by_class_date ON attendance.sessions (tenant_id, classroom_id, session_date DESC);
CREATE INDEX sessions_by_date ON attendance.sessions (tenant_id, institution_id, session_date);
CREATE INDEX sessions_by_taker ON attendance.sessions (tenant_id, taken_by_staff_id, session_date DESC) WHERE taken_by_staff_id IS NOT NULL;
CREATE INDEX sessions_open ON attendance.sessions (tenant_id, status, session_date) WHERE status IN ('OPEN', 'SUBMITTED');
GRANT SELECT, INSERT, UPDATE ON attendance.sessions TO app_user;

-- -----------------------------------------------------------------------------
-- Justificatifs d'absence : une demande couvre une FENÊTRE (maladie de trois jours), pas un
-- pointage isolé. Statut : PENDING -> ACCEPTED | REJECTED ; WITHDRAWN par le demandeur ;
-- ACCEPTED -> REVOKED (révocation motivée). La décision est tracée (qui, quand, pourquoi).
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.justifications (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id         uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  from_date          date NOT NULL,
  to_date            date NOT NULL,
  reason_code        text NOT NULL,
  comment            text,
  submitted_by_kind  text NOT NULL CHECK (submitted_by_kind IN ('GUARDIAN', 'STUDENT', 'STAFF')),
  submitted_by_user  uuid NOT NULL,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'REVOKED')),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (to_date >= from_date),
  CHECK (status = 'PENDING' OR status = 'WITHDRAWN' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, reason_code) REFERENCES attendance.justification_reasons (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('attendance.justifications');
CREATE INDEX justifications_by_student ON attendance.justifications (tenant_id, student_id, from_date DESC);
CREATE INDEX justifications_pending ON attendance.justifications (tenant_id, status, submitted_at) WHERE status = 'PENDING';
GRANT SELECT, INSERT, UPDATE ON attendance.justifications TO app_user;

-- Pièces jointes d'un justificatif (stockage objet via StoragePort ; le type réel est contrôlé
-- par octets magiques, jamais par le type MIME déclaré par le client).
CREATE TABLE attendance.justification_attachments (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  justification_id uuid NOT NULL,
  storage_key      text NOT NULL,
  file_name        text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  detected_mime    text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by      uuid NOT NULL,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, justification_id) REFERENCES attendance.justifications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('attendance.justification_attachments');
CREATE INDEX justification_attachments_by_justification ON attendance.justification_attachments (tenant_id, justification_id) WHERE removed_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON attendance.justification_attachments TO app_user;

-- -----------------------------------------------------------------------------
-- Pointages élèves
--   status_code      : statut courant (PRESENT, ABSENT, LATE, EXCUSED, EARLY_LEAVE…)
--   excused          : un justificatif ACCEPTÉ couvre ce pointage. Une absence justifiée passe en
--                      EXCUSED (statut d'origine ABSENT conservé) ; un retard ou un départ anticipé
--                      justifié GARDE son statut (LATE, EARLY_LEAVE) avec excused = true.
--   original_status_code : statut AVANT justification (restauré si le justificatif est révoqué)
--   counted_minutes  : minutes comptées (durée de la séance pour une absence, retard réel,
--                      minutes manquées pour un départ anticipé) — base des « heures d'absence »
-- Règle de base : EXCUSED / excused exigent un justificatif accepté (fin du CHECK qui provoquait
-- des 500 quand une pièce était jointe puis qu'on changeait le statut).
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.student_records (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  session_id            uuid NOT NULL,
  enrollment_id         uuid NOT NULL,
  student_id            uuid NOT NULL,
  subject_kind          text NOT NULL DEFAULT 'STUDENT' CHECK (subject_kind = 'STUDENT'),
  status_code           text NOT NULL,
  original_status_code  text,
  excused               boolean NOT NULL DEFAULT false,
  minutes_late          integer CHECK (minutes_late IS NULL OR minutes_late > 0),
  counted_minutes       integer CHECK (counted_minutes IS NULL OR counted_minutes >= 0),
  arrived_at            timestamptz,
  left_at               timestamptz,
  justification_id      uuid,
  note                  text,
  marked_by             uuid NOT NULL,
  marked_at             timestamptz NOT NULL DEFAULT now(),
  source_detail         text CHECK (source_detail IS NULL OR source_detail IN ('TEACHER', 'ADMIN', 'LIVE_CLASS', 'OFFLINE_SYNC', 'IMPORT', 'JUSTIFICATION')),
  client_id             uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, enrollment_id),
  CHECK (status_code <> 'EXCUSED' OR (excused AND justification_id IS NOT NULL AND original_status_code IS NOT NULL)),
  CHECK (NOT excused OR justification_id IS NOT NULL),
  CHECK (left_at IS NULL OR arrived_at IS NULL OR left_at >= arrived_at),
  FOREIGN KEY (tenant_id, session_id) REFERENCES attendance.sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, subject_kind, status_code) REFERENCES attendance.status_definitions (tenant_id, subject_kind, code),
  FOREIGN KEY (tenant_id, justification_id) REFERENCES attendance.justifications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('attendance.student_records');
CREATE INDEX student_records_by_student ON attendance.student_records (tenant_id, student_id, marked_at DESC);
CREATE INDEX student_records_by_enrollment ON attendance.student_records (tenant_id, enrollment_id, status_code);
CREATE INDEX student_records_by_justification ON attendance.student_records (tenant_id, justification_id) WHERE justification_id IS NOT NULL;
CREATE UNIQUE INDEX student_records_client_id ON attendance.student_records (tenant_id, client_id) WHERE client_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.student_records TO app_user;

-- Journal des changements de pointage (le legacy écrasait sans trace). Alimenté par déclencheur.
CREATE TABLE attendance.record_history (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  record_id    uuid NOT NULL,
  session_id   uuid NOT NULL,
  from_status  text,
  to_status    text,
  actor_id     uuid,
  reason       text,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('attendance.record_history');
CREATE INDEX record_history_by_record ON attendance.record_history (tenant_id, record_id, changed_at);
GRANT SELECT, INSERT ON attendance.record_history TO app_user;

-- Justificatif <-> pointages couverts (calculé à l'acceptation, conservé pour la révocation).
CREATE TABLE attendance.justification_records (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  justification_id uuid NOT NULL,
  record_id        uuid NOT NULL,
  PRIMARY KEY (tenant_id, justification_id, record_id),
  FOREIGN KEY (tenant_id, justification_id) REFERENCES attendance.justifications (tenant_id, id),
  FOREIGN KEY (tenant_id, record_id) REFERENCES attendance.student_records (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('attendance.justification_records');
GRANT SELECT, INSERT, DELETE ON attendance.justification_records TO app_user;

-- -----------------------------------------------------------------------------
-- Récapitulatif par inscription et période : DÉRIVÉ des pointages (cache recalculé de façon
-- idempotente par le consommateur d'événements), jamais saisi. Les écarts reconnus (reprise
-- d'historique, établissement qui ne fait pas l'appel) se déclarent en SURCHARGE tracée.
-- Les bornes viennent de la période academic (starts_on/ends_on) au moment du calcul.
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.period_summaries (
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id     uuid NOT NULL,
  period_id         uuid NOT NULL,                      -- academic.academic_periods.id
  student_id        uuid NOT NULL,
  window_from       date NOT NULL,
  window_to         date NOT NULL,
  sessions_total    integer NOT NULL DEFAULT 0 CHECK (sessions_total >= 0),
  present_count     integer NOT NULL DEFAULT 0 CHECK (present_count >= 0),      -- présents (retards et départs anticipés compris)
  absent_count      integer NOT NULL DEFAULT 0 CHECK (absent_count >= 0),       -- absences TOTALES (justifiées comprises)
  excused_count     integer NOT NULL DEFAULT 0 CHECK (excused_count >= 0),      -- dont justifiées
  late_count        integer NOT NULL DEFAULT 0 CHECK (late_count >= 0),
  excused_late_count integer NOT NULL DEFAULT 0 CHECK (excused_late_count >= 0),
  early_leave_count integer NOT NULL DEFAULT 0 CHECK (early_leave_count >= 0),
  unmarked_count    integer NOT NULL DEFAULT 0 CHECK (unmarked_count >= 0),
  absent_minutes    integer NOT NULL DEFAULT 0 CHECK (absent_minutes >= 0),     -- TOTAL (justifiées comprises) : « N heures d'absence »
  excused_minutes   integer NOT NULL DEFAULT 0 CHECK (excused_minutes >= 0),    -- « dont M justifiées »
  late_minutes      integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, enrollment_id, period_id),
  CHECK (excused_count <= absent_count),
  CHECK (excused_late_count <= late_count),
  CHECK (excused_minutes <= absent_minutes)
);
SELECT kernel.enable_tenant_rls('attendance.period_summaries');
CREATE INDEX period_summaries_by_period ON attendance.period_summaries (tenant_id, period_id);
CREATE INDEX period_summaries_by_student ON attendance.period_summaries (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.period_summaries TO app_user;

CREATE TABLE attendance.summary_overrides (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id     uuid NOT NULL,
  period_id         uuid NOT NULL,
  absent_minutes    integer NOT NULL CHECK (absent_minutes >= 0),
  excused_minutes   integer NOT NULL CHECK (excused_minutes >= 0),
  reason            text NOT NULL CHECK (length(btrim(reason)) >= 5),
  set_by            uuid NOT NULL,
  set_at            timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (excused_minutes <= absent_minutes)
);
SELECT kernel.enable_tenant_rls('attendance.summary_overrides');
CREATE UNIQUE INDEX summary_overrides_one_live ON attendance.summary_overrides (tenant_id, enrollment_id, period_id) WHERE removed_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON attendance.summary_overrides TO app_user;
```

### 5.3 Personnel : présence et congés

<!-- migration: 0902_attendance_staff.sql -->
```sql
-- =============================================================================
-- 0902 — Module attendance (spec 010) : présence et congés du personnel (PRD §33)
-- =============================================================================
--
-- Le legacy n'avait AUCUNE présence du personnel : seulement la déclaration de séances pour être
-- payé (teacher_attendance_sessions) et le constat de réalisation d'une séance Professional. Ces
-- deux usages passent désormais par scheduling (occurrence réalisée / validée, intervenant réel).
-- Ce module ajoute la présence quotidienne (retard, absence, congé) du personnel, avec des
-- extensions futures (QR code, badge, biométrie) portées par `source`.
-- =============================================================================

CREATE TABLE attendance.staff_leaves (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id         uuid NOT NULL,                         -- people.staff.id
  leave_type_code  text NOT NULL,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  half_day_start   boolean NOT NULL DEFAULT false,
  half_day_end     boolean NOT NULL DEFAULT false,
  reason           text,
  status           text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  document_ref     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on >= starts_on),
  CHECK (status IN ('REQUESTED', 'CANCELLED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, leave_type_code) REFERENCES attendance.leave_types (tenant_id, code),
  EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
    WHERE (status = 'APPROVED')
);
SELECT kernel.enable_tenant_rls('attendance.staff_leaves');
CREATE INDEX staff_leaves_by_staff ON attendance.staff_leaves (tenant_id, staff_id, starts_on DESC);
CREATE INDEX staff_leaves_pending ON attendance.staff_leaves (tenant_id, status, requested_at) WHERE status = 'REQUESTED';
GRANT SELECT, INSERT, UPDATE ON attendance.staff_leaves TO app_user;

CREATE TABLE attendance.staff_records (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id        uuid NOT NULL,
  subject_kind    text NOT NULL DEFAULT 'STAFF' CHECK (subject_kind = 'STAFF'),
  work_date       date NOT NULL,
  occurrence_id   uuid,                                   -- présence rattachée à une séance (optionnel)
  status_code     text NOT NULL,
  check_in_at     timestamptz,
  check_out_at    timestamptz,
  minutes_late    integer CHECK (minutes_late IS NULL OR minutes_late > 0),
  leave_id        uuid,
  note            text,
  source          text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'SELF', 'OFFLINE_SYNC', 'IMPORT', 'QR', 'BADGE', 'BIOMETRIC')),
  marked_by       uuid NOT NULL,
  marked_at       timestamptz NOT NULL DEFAULT now(),
  client_id       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at),
  CHECK (status_code <> 'ON_LEAVE' OR leave_id IS NOT NULL),
  FOREIGN KEY (tenant_id, subject_kind, status_code) REFERENCES attendance.status_definitions (tenant_id, subject_kind, code),
  FOREIGN KEY (tenant_id, leave_id) REFERENCES attendance.staff_leaves (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('attendance.staff_records');
CREATE UNIQUE INDEX staff_records_daily ON attendance.staff_records (tenant_id, staff_id, work_date) WHERE occurrence_id IS NULL;
CREATE UNIQUE INDEX staff_records_per_occurrence ON attendance.staff_records (tenant_id, staff_id, occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX staff_records_client_id ON attendance.staff_records (tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX staff_records_by_date ON attendance.staff_records (tenant_id, work_date, status_code);
GRANT SELECT, INSERT, UPDATE ON attendance.staff_records TO app_user;
```

### 5.4 Invariants imposés par la base

<!-- migration: 0903_attendance_guards.sql -->
```sql
-- =============================================================================
-- 0903 — Module attendance : invariants imposés par la base
-- =============================================================================

CREATE FUNCTION attendance.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER record_history_immutable BEFORE UPDATE OR DELETE ON attendance.record_history
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON attendance.sessions
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();
CREATE TRIGGER justifications_no_delete BEFORE DELETE ON attendance.justifications
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();
CREATE TRIGGER staff_records_no_delete BEFORE DELETE ON attendance.staff_records
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Séance d'appel : transitions légales, identité figée. La réouverture d'une séance VALIDÉE
-- exige le réglage de transaction `attendance.reopen = on` (posé par `reopenAttendanceSession`
-- après contrôle de la permission sensible `attendance.session.reopen`).
--   OPEN -> SUBMITTED | CANCELLED ; SUBMITTED -> VALIDATED | OPEN (correction) | CANCELLED ;
--   VALIDATED -> SUBMITTED (réouverture) | CANCELLED (occurrence annulée après validation,
--   toujours sous le réglage de réouverture) ; CANCELLED terminal.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.classroom_id <> OLD.classroom_id OR NEW.session_date <> OLD.session_date OR NEW.scope <> OLD.scope
     OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id THEN
    RAISE EXCEPTION 'attendance.session_identity_immutable: classe, date, portée et occurrence d''un appel sont figées'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'OPEN'      AND NEW.status IN ('SUBMITTED', 'CANCELLED')) OR
         (OLD.status = 'SUBMITTED' AND NEW.status IN ('VALIDATED', 'OPEN', 'CANCELLED')) OR
         (OLD.status = 'VALIDATED' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))) THEN
      RAISE EXCEPTION 'attendance.session_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED' AND coalesce(current_setting('attendance.reopen', true), '') <> 'on' THEN
      RAISE EXCEPTION 'attendance.session_validated: réouverture réservée à reopenAttendanceSession' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sessions_guard BEFORE UPDATE ON attendance.sessions
  FOR EACH ROW EXECUTE FUNCTION attendance.sessions_guard();

-- -----------------------------------------------------------------------------
-- Pointages : écriture refusée sur une séance VALIDÉE ou ANNULÉE (sauf réouverture) ; le
-- statut doit être actif et de la bonne famille ; historique automatique.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.student_records_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_def    attendance.status_definitions%ROWTYPE;
  v_row    attendance.student_records%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  SELECT status INTO v_status FROM attendance.sessions WHERE tenant_id = v_row.tenant_id AND id = v_row.session_id;
  IF v_status IN ('VALIDATED', 'CANCELLED') THEN
    -- Seule exception sur un appel VALIDÉ : l'application ou la révocation d'une EXCUSE (décision
    -- d'un justificatif prise après coup). Le statut ne bascule qu'entre ABSENT et EXCUSED, rien
    -- d'autre ne change. Réglage de transaction `attendance.excuse_apply = on` posé par les seuls
    -- cas d'usage acceptJustification / revokeJustification.
    IF TG_OP = 'UPDATE' AND v_status = 'VALIDATED'
       AND coalesce(current_setting('attendance.excuse_apply', true), '') = 'on'
       AND NEW.counted_minutes IS NOT DISTINCT FROM OLD.counted_minutes
       AND NEW.minutes_late IS NOT DISTINCT FROM OLD.minutes_late
       AND NEW.arrived_at IS NOT DISTINCT FROM OLD.arrived_at
       AND NEW.left_at IS NOT DISTINCT FROM OLD.left_at
       AND NEW.note IS NOT DISTINCT FROM OLD.note
       AND NEW.session_id = OLD.session_id AND NEW.enrollment_id = OLD.enrollment_id
       AND (NEW.status_code = OLD.status_code
            OR (OLD.status_code = 'ABSENT' AND NEW.status_code = 'EXCUSED')
            OR (OLD.status_code = 'EXCUSED' AND NEW.status_code = 'ABSENT')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'attendance.session_locked: l''appel est % ; aucun pointage modifiable', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.session_id <> OLD.session_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id) THEN
    RAISE EXCEPTION 'attendance.record_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_def FROM attendance.status_definitions
   WHERE tenant_id = NEW.tenant_id AND subject_kind = 'STUDENT' AND code = NEW.status_code;
  IF NOT v_def.active AND (TG_OP = 'INSERT' OR NEW.status_code <> OLD.status_code) THEN
    RAISE EXCEPTION 'attendance.status_inactive: le statut % est désactivé', NEW.status_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_records_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance.student_records
  FOR EACH ROW EXECUTE FUNCTION attendance.student_records_guard();

CREATE FUNCTION attendance.student_records_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO attendance.record_history (id, tenant_id, record_id, session_id, from_status, to_status, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.session_id, NULL, NEW.status_code, kernel.current_user_id());
  ELSIF NEW.status_code <> OLD.status_code THEN
    INSERT INTO attendance.record_history (id, tenant_id, record_id, session_id, from_status, to_status, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.session_id, OLD.status_code, NEW.status_code, kernel.current_user_id());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER student_records_history AFTER INSERT OR UPDATE ON attendance.student_records
  FOR EACH ROW EXECUTE FUNCTION attendance.student_records_history();

-- -----------------------------------------------------------------------------
-- Justificatif : transitions légales (PENDING -> ACCEPTED | REJECTED | WITHDRAWN ;
-- ACCEPTED -> REVOKED), fenêtre et élève figés.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.justifications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.submitted_by_user <> OLD.submitted_by_user THEN
    RAISE EXCEPTION 'attendance.justification_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND (NEW.from_date <> OLD.from_date OR NEW.to_date <> OLD.to_date OR NEW.reason_code <> OLD.reason_code) THEN
    RAISE EXCEPTION 'attendance.justification_frozen: la fenêtre et le motif d''un justificatif décidé sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING'  AND NEW.status IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN')) OR
       (OLD.status = 'ACCEPTED' AND NEW.status = 'REVOKED')) THEN
    RAISE EXCEPTION 'attendance.justification_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER justifications_guard BEFORE UPDATE ON attendance.justifications
  FOR EACH ROW EXECUTE FUNCTION attendance.justifications_guard();

-- Congé : transitions légales.
CREATE FUNCTION attendance.staff_leaves_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.staff_id <> OLD.staff_id THEN
    RAISE EXCEPTION 'attendance.leave_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED')) OR
       (OLD.status = 'APPROVED'  AND NEW.status = 'CANCELLED')) THEN
    RAISE EXCEPTION 'attendance.leave_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_leaves_guard BEFORE UPDATE ON attendance.staff_leaves
  FOR EACH ROW EXECUTE FUNCTION attendance.staff_leaves_guard();

-- -----------------------------------------------------------------------------
-- Comptage brut d'un pointage par famille de statut (aucun seuil) : utilisé par le recalcul des
-- récapitulatifs et par les tests de conformité SQL <-> domaine.
-- -----------------------------------------------------------------------------
CREATE FUNCTION attendance.summarize_enrollment(p_enrollment uuid, p_from date, p_to date)
RETURNS TABLE (
  sessions_total integer, present_count integer, absent_count integer, excused_count integer,
  late_count integer, excused_late_count integer, early_leave_count integer,
  absent_minutes integer, excused_minutes integer, late_minutes integer)
LANGUAGE sql STABLE AS $$
  -- absent_* = TOTAL des absences (justifiées comprises) ; excused_* = sous-ensemble justifié.
  SELECT count(*)::integer,
         count(*) FILTER (WHERE d.counts_as_present)::integer,
         count(*) FILTER (WHERE d.counts_as_absence)::integer,
         count(*) FILTER (WHERE d.counts_as_absence AND r.excused)::integer,
         count(*) FILTER (WHERE d.counts_as_late)::integer,
         count(*) FILTER (WHERE d.counts_as_late AND r.excused)::integer,
         count(*) FILTER (WHERE r.status_code = 'EARLY_LEAVE')::integer,
         coalesce(sum(r.counted_minutes) FILTER (WHERE d.counts_as_absence), 0)::integer,
         coalesce(sum(r.counted_minutes) FILTER (WHERE d.counts_as_absence AND r.excused), 0)::integer,
         coalesce(sum(coalesce(r.minutes_late, r.counted_minutes)) FILTER (WHERE d.counts_as_late), 0)::integer
    FROM attendance.student_records r
    JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
    JOIN attendance.status_definitions d ON d.tenant_id = r.tenant_id AND d.subject_kind = r.subject_kind AND d.code = r.status_code
   WHERE r.tenant_id = kernel.current_tenant_id()
     AND r.enrollment_id = p_enrollment
     AND s.status IN ('SUBMITTED', 'VALIDATED')
     AND s.session_date BETWEEN p_from AND p_to
$$;
GRANT EXECUTE ON FUNCTION attendance.summarize_enrollment(uuid, date, date) TO app_user;
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Un appel par occurrence ; un appel journalier par classe et par jour | index uniques partiels | `openAttendanceSession` renvoie la séance existante (idempotent) |
| Un pointage par (séance, inscription) | `UNIQUE (tenant_id, session_id, enrollment_id)` | `markStudentRecords` fait l'upsert ; l'élève doit figurer dans `getRoster` (le legacy ne le vérifiait pas) |
| Statut connu et actif | FK composite vers `status_definitions`, `student_records_guard` | validation du lot avant écriture |
| `EXCUSED` ⇒ justificatif accepté et statut d'origine | CHECK | `acceptJustification` applique, `revokeJustification` restaure |
| Séance `VALIDATED` ou `CANCELLED` : aucun pointage modifiable | `student_records_guard`, `sessions_guard` | `reopenAttendanceSession` pose `attendance.reopen = on` après contrôle de la permission sensible |
| Exception unique sur un appel validé : appliquer / révoquer une excuse (`ABSENT ⇄ EXCUSED`) | `student_records_guard` (réglage `attendance.excuse_apply = on`, aucun autre champ ne peut changer) | `acceptJustification`, `revokeJustification` |
| Transitions de séance et de justificatif | `sessions_guard`, `justifications_guard` | messages `attendance.*` stables |
| Historique de chaque changement de statut | `student_records_history` (déclencheur) | motif porté par le cas d'usage |
| Congés approuvés sans chevauchement | `EXCLUDE` | `approveStaffLeave` |
| Récapitulatif cohérent (`excused ≤ absent`) | CHECK | recalcul idempotent par (inscription, période) |
| Fenêtre d'édition d'un appel soumis | — (politique) | `call_policies.edit_window_minutes` appliqué par le domaine (le legacy n'avait ni fenêtre ni verrou) |
| Élève ∈ classe | — (hors schéma) | `academic.getRoster` |

## 7. Données de référence : modèle de pack

Section `attendance` (`tenancy/templates/attendance/<educationSystem>/<pack>.json`), appliquée de façon idempotente :

```json
{
  "section": "attendance",
  "schemaVersion": 1,
  "educationSystem": "CI",
  "statusDefinitions": [
    { "subject": "STUDENT", "code": "PRESENT",     "label": "Présent",           "present": true,  "system": true },
    { "subject": "STUDENT", "code": "ABSENT",      "label": "Absent",            "absence": true,  "system": true },
    { "subject": "STUDENT", "code": "LATE",        "label": "En retard",         "present": true, "late": true, "system": true },
    { "subject": "STUDENT", "code": "EXCUSED",     "label": "Absence justifiée", "absence": true,  "justified": true, "system": true },
    { "subject": "STUDENT", "code": "EARLY_LEAVE", "label": "Départ anticipé",   "present": true,  "system": true },
    { "subject": "STAFF",   "code": "PRESENT",     "label": "Présent",           "present": true,  "system": true },
    { "subject": "STAFF",   "code": "ABSENT",      "label": "Absent",            "absence": true,  "system": true },
    { "subject": "STAFF",   "code": "LATE",        "label": "En retard",         "present": true, "late": true, "system": true },
    { "subject": "STAFF",   "code": "ON_LEAVE",    "label": "En congé",          "system": true }
  ],
  "justificationReasons": [
    { "code": "ILLNESS", "label": "Maladie", "requiresAttachment": false },
    { "code": "FAMILY_EVENT", "label": "Événement familial" },
    { "code": "TRANSPORT", "label": "Difficulté de transport" },
    { "code": "OFFICIAL_ACTIVITY", "label": "Activité officielle" },
    { "code": "OTHER", "label": "Autre" }
  ],
  "leaveTypes": [
    { "code": "ANNUAL", "label": "Congé annuel", "paid": true },
    { "code": "SICK", "label": "Congé maladie", "paid": true, "requiresAttachment": true },
    { "code": "MATERNITY", "label": "Congé de maternité", "paid": true },
    { "code": "UNPAID", "label": "Congé sans solde", "paid": false },
    { "code": "AUTHORIZED_ABSENCE", "label": "Absence autorisée", "paid": false }
  ],
  "callPolicies": [
    { "educationLevel": "PRESCHOOL", "callScope": "DAILY" },
    { "educationLevel": "PRIMARY",   "callScope": "DAILY" },
    { "educationLevel": "*",         "callScope": "SESSION", "editWindowMinutes": 120 }
  ],
  "settings": { "attachmentMaxBytes": 5242880, "allowedAttachmentTypes": ["application/pdf", "image/jpeg", "image/png"] }
}
```

Ces valeurs sont des **politiques d'établissement modifiables**, pas des règles réglementaires. Les durées légales de congé et les seuils d'absentéisme ne sont pas des données de pack tant que le propriétaire n'a pas fourni les textes (voir `open-questions.md`).

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Appel d'une occurrence | `WHERE occurrence_id = $1` | `sessions_one_per_occurrence` |
| Appel du jour d'une classe | `WHERE classroom_id = $1 AND session_date = $2` | `sessions_by_class_date` / `sessions_one_daily` |
| Appels non soumis (suivi) | `WHERE status IN ('OPEN','SUBMITTED') AND session_date < current_date` | `sessions_open` |
| Pointages d'un élève | `WHERE student_id = $1 ORDER BY marked_at DESC` | `student_records_by_student` |
| Absences d'une inscription | `WHERE enrollment_id = $1 AND status_code …` | `student_records_by_enrollment` |
| Justificatifs à traiter | `WHERE status = 'PENDING'` | `justifications_pending` |
| Récapitulatif | `(enrollment_id, period_id)` | clé primaire de `period_summaries` |
| Présence du personnel d'un jour | `WHERE work_date = $1` | `staff_records_by_date` |

## 9. Volumétrie et exploitation

`student_records` croît de ~5 millions de lignes par an pour 1 500 élèves à 5 appels par jour ; au-delà de 50 millions, le partitionnement par plage de `session_date` (comme `audit_log`) est prévu sans changement de contrat. Le recalcul des récapitulatifs est incrémental et idempotent (un `period_summaries` par couple) et se déclenche par le consommateur de `attendance.session.submitted|validated|reopened` ; `recomputeSummaries` peut tout reconstruire à partir des pointages.
