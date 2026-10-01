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
