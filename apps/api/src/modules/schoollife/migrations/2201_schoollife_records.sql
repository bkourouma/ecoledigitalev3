-- =============================================================================
-- 2201 — Module schoollife : incidents, mesures, observations, convocations, points de conduite,
--        recours, historique, journal des lectures confidentielles
-- =============================================================================
--
-- Principes :
--   - tout est HISTORISÉ : aucune suppression, correction = nouvelle ligne ou transition motivée ;
--   - les mesures (sanction, avertissement, exclusion temporaire) suivent un circuit de validation
--     défini par leur TYPE (données) ; la base impose la séparation des tâches quand le type l'exige ;
--   - confidentialité : STANDARD / RESTRICTED / CONFIDENTIAL ; un élément CONFIDENTIAL n'est jamais
--     visible d'un élève ni d'un tuteur ; chaque lecture d'un élément CONFIDENTIAL est journalisée
--     (`confidential_reads`) ;
--   - les retards et absences restent dans `attendance` (010) : une vue, pas une copie.
-- =============================================================================

-- Incidents : un fait signalé (avant toute mesure).
CREATE TABLE schoollife.incidents (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  campus_id        uuid,
  academic_year_id uuid NOT NULL,
  type_id          uuid NOT NULL,
  severity_code    text,
  occurred_at      timestamptz NOT NULL,
  location         text,
  description      text NOT NULL CHECK (length(btrim(description)) >= 5),
  context_note     text,
  status           text NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED', 'UNDER_REVIEW', 'CONFIRMED', 'DISMISSED', 'CLOSED')),
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  reported_by      uuid NOT NULL,
  reported_by_name text NOT NULL CHECK (length(btrim(reported_by_name)) > 0),
  assigned_to      uuid,
  resolution_note  text,
  attendance_session_id uuid,                              -- attendance.sessions.id (contexte), sans FK
  closed_at        timestamptz,
  row_version      integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES schoollife.event_types (tenant_id, id),
  FOREIGN KEY (tenant_id, severity_code) REFERENCES schoollife.severity_levels (tenant_id, code),
  CHECK (status NOT IN ('DISMISSED', 'CLOSED') OR length(btrim(coalesce(resolution_note, ''))) >= 5),
  CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('schoollife.incidents');
CREATE INDEX incidents_by_year ON schoollife.incidents (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX incidents_by_date ON schoollife.incidents (tenant_id, occurred_at DESC);
GRANT SELECT, INSERT, UPDATE ON schoollife.incidents TO app_user;

-- Élèves impliqués (auteur, victime, témoin) ; la déclaration d'un élève reste CONFIDENTIELLE par nature
-- (la visibilité d'un élève sur un incident passe par les mesures, pas par ses involvements).
CREATE TABLE schoollife.incident_involvements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  incident_id    uuid NOT NULL,
  enrollment_id  uuid NOT NULL,                            -- academic.enrollments.id
  student_id     uuid NOT NULL,                            -- people.students.id
  role           text NOT NULL CHECK (role IN ('AUTHOR', 'VICTIM', 'WITNESS', 'OTHER')),
  statement      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, incident_id, student_id, role),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES schoollife.incidents (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.incident_involvements');
CREATE INDEX incident_involvements_by_student ON schoollife.incident_involvements (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE ON schoollife.incident_involvements TO app_user;

-- Mesures disciplinaires : sanction, avertissement, exclusion temporaire.
--   kind : recopié du type par la base ; PROPOSED -> VALIDATED -> NOTIFIED -> EXECUTED ;
--   REJECTED / CANCELLED avant validation ; REVOKED / APPEALED après ; aucune suppression.
--   Une exclusion temporaire ne chevauche jamais une autre exclusion vivante du même élève.
CREATE TABLE schoollife.measures (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  classroom_id     uuid,                                   -- classe au moment des faits
  type_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('SANCTION', 'WARNING', 'TEMP_EXCLUSION')),
  incident_id      uuid,
  severity_code    text,
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 5),
  starts_on        date,
  ends_on          date,
  status           text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'VALIDATED', 'NOTIFIED', 'EXECUTED', 'APPEALED', 'REVOKED', 'REJECTED', 'CANCELLED')),
  proposed_by      uuid NOT NULL,
  proposed_by_name text NOT NULL CHECK (length(btrim(proposed_by_name)) > 0),
  proposed_at      timestamptz NOT NULL DEFAULT now(),
  validated_by     uuid,
  validated_by_name text,
  validated_at     timestamptz,
  validation_note  text,
  notified_at      timestamptz,
  notified_by      uuid,
  notification_ref uuid,                                   -- messaging : notification envoyée aux tuteurs
  executed_at      timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoked_reason   text,
  cancel_reason    text,
  visible_to_guardians boolean NOT NULL DEFAULT true,
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  row_version      integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES schoollife.event_types (tenant_id, id),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES schoollife.incidents (tenant_id, id),
  FOREIGN KEY (tenant_id, severity_code) REFERENCES schoollife.severity_levels (tenant_id, code),
  CHECK (ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on)),
  CHECK (kind <> 'TEMP_EXCLUSION' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(validation_note, ''))) >= 5),
  CHECK (status <> 'REVOKED' OR length(btrim(coalesce(revoked_reason, ''))) >= 10),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5),
  CHECK (confidentiality <> 'CONFIDENTIAL' OR NOT visible_to_guardians),
  EXCLUDE USING gist (
    tenant_id WITH =,
    enrollment_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (kind = 'TEMP_EXCLUSION' AND status IN ('VALIDATED', 'NOTIFIED', 'EXECUTED', 'APPEALED'))
);
SELECT kernel.enable_tenant_rls('schoollife.measures');
CREATE INDEX measures_by_student ON schoollife.measures (tenant_id, student_id, academic_year_id, status);
CREATE INDEX measures_by_year ON schoollife.measures (tenant_id, academic_year_id, institution_id, kind, status);
CREATE INDEX measures_pending ON schoollife.measures (tenant_id, institution_id, proposed_at) WHERE status = 'PROPOSED';
GRANT SELECT, INSERT, UPDATE ON schoollife.measures TO app_user;

-- Recours contre une mesure (tuteur ou élève selon l'établissement) ; l'issue remet la mesure en vigueur
-- (UPHELD -> EXECUTED) ou la révoque (OVERTURNED).
CREATE TABLE schoollife.measure_appeals (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  measure_id    uuid NOT NULL,
  filed_by      uuid NOT NULL,                             -- utilisateur (tuteur, élève, direction)
  filed_by_name text NOT NULL CHECK (length(btrim(filed_by_name)) > 0),
  filed_at      timestamptz NOT NULL DEFAULT now(),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  status        text NOT NULL DEFAULT 'FILED' CHECK (status IN ('FILED', 'UPHELD', 'OVERTURNED', 'WITHDRAWN')),
  decided_by    uuid,
  decided_by_name text,
  decided_at    timestamptz,
  decision_note text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, measure_id) REFERENCES schoollife.measures (tenant_id, id),
  CHECK (status = 'FILED' OR status = 'WITHDRAWN' OR (decided_by IS NOT NULL AND length(btrim(coalesce(decision_note, ''))) >= 10))
);
SELECT kernel.enable_tenant_rls('schoollife.measure_appeals');
CREATE UNIQUE INDEX measure_appeals_one_open ON schoollife.measure_appeals (tenant_id, measure_id) WHERE status = 'FILED';
GRANT SELECT, INSERT, UPDATE ON schoollife.measure_appeals TO app_user;

-- Encouragements et observations (notes de vie scolaire) : simples, immuables, retirables avec motif.
CREATE TABLE schoollife.notes (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  type_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('ENCOURAGEMENT', 'OBSERVATION')),
  body             text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  occurred_on      date NOT NULL,
  visibility       text NOT NULL DEFAULT 'STAFF_ONLY' CHECK (visibility IN ('STAFF_ONLY', 'GUARDIANS', 'STUDENT_AND_GUARDIANS')),
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  author_id        uuid NOT NULL,
  author_name      text NOT NULL CHECK (length(btrim(author_name)) > 0),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  withdrawn_by     uuid,
  withdrawn_at     timestamptz,
  withdrawn_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES schoollife.event_types (tenant_id, id),
  CHECK (confidentiality <> 'CONFIDENTIAL' OR visibility = 'STAFF_ONLY'),
  CHECK (status <> 'WITHDRAWN' OR (withdrawn_by IS NOT NULL AND length(btrim(coalesce(withdrawn_reason, ''))) >= 5))
);
SELECT kernel.enable_tenant_rls('schoollife.notes');
CREATE INDEX notes_by_student ON schoollife.notes (tenant_id, student_id, academic_year_id, occurred_on DESC);
GRANT SELECT, INSERT, UPDATE ON schoollife.notes TO app_user;

-- Convocations des tuteurs (envoi par `notifications` via un port ; le statut suit la réalité).
CREATE TABLE schoollife.convocations (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  guardian_ids     uuid[] NOT NULL CHECK (cardinality(guardian_ids) >= 1),   -- people.guardians.id
  reason_kind      text NOT NULL CHECK (reason_kind IN ('DISCIPLINE', 'ABSENCES', 'ACADEMIC', 'HEALTH', 'OTHER')),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 5),
  related_measure_id  uuid,
  related_incident_id uuid,
  scheduled_at     timestamptz NOT NULL,
  location         text,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'HELD', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED')),
  convened_by      uuid NOT NULL,
  convened_by_name text NOT NULL CHECK (length(btrim(convened_by_name)) > 0),
  sent_at          timestamptz,
  notification_ref uuid,
  acknowledged_at  timestamptz,
  acknowledged_by_guardian_id uuid,
  held_at          timestamptz,
  outcome_note     text,
  cancel_reason    text,
  rescheduled_from_id uuid,
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  row_version      integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, related_measure_id) REFERENCES schoollife.measures (tenant_id, id),
  FOREIGN KEY (tenant_id, related_incident_id) REFERENCES schoollife.incidents (tenant_id, id),
  FOREIGN KEY (tenant_id, rescheduled_from_id) REFERENCES schoollife.convocations (tenant_id, id),
  CHECK (status NOT IN ('SENT', 'ACKNOWLEDGED', 'HELD', 'NO_SHOW') OR sent_at IS NOT NULL),
  CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL),
  CHECK (status <> 'HELD' OR held_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5)
);
SELECT kernel.enable_tenant_rls('schoollife.convocations');
CREATE INDEX convocations_by_student ON schoollife.convocations (tenant_id, student_id, scheduled_at DESC);
CREATE INDEX convocations_due ON schoollife.convocations (tenant_id, scheduled_at) WHERE status IN ('SENT', 'ACKNOWLEDGED');
GRANT SELECT, INSERT, UPDATE ON schoollife.convocations TO app_user;

-- Mouvements de points de conduite (registre en ajout seul). Le solde se DÉRIVE du barème et des mouvements
-- (`schoollife.conduct_balance`) ; une correction est un mouvement inverse (`reverses_id`).
CREATE TABLE schoollife.conduct_movements (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  scale_id         uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  academic_period_id uuid,
  delta            integer NOT NULL CHECK (delta <> 0),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 3),
  source_kind      text NOT NULL CHECK (source_kind IN ('MEASURE', 'NOTE', 'MANUAL_ADJUSTMENT')),
  source_id        uuid,
  reverses_id      uuid,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES schoollife.conduct_scales (tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_id) REFERENCES schoollife.conduct_movements (tenant_id, id),
  CHECK (source_kind = 'MANUAL_ADJUSTMENT' OR source_id IS NOT NULL OR reverses_id IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('schoollife.conduct_movements');
CREATE UNIQUE INDEX conduct_movements_one_reversal ON schoollife.conduct_movements (tenant_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX conduct_movements_one_per_source ON schoollife.conduct_movements (tenant_id, scale_id, source_kind, source_id)
  WHERE source_id IS NOT NULL AND reverses_id IS NULL;
CREATE INDEX conduct_movements_by_student ON schoollife.conduct_movements (tenant_id, student_id, scale_id, academic_year_id);
GRANT SELECT, INSERT ON schoollife.conduct_movements TO app_user;      -- append-only

-- Historique (ajout seul) : alimenté par les déclencheurs (2202) à chaque création et changement de statut.
CREATE TABLE schoollife.life_events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('INCIDENT', 'MEASURE', 'NOTE', 'CONVOCATION', 'APPEAL', 'SCALE')),
  entity_id   uuid NOT NULL,
  student_id  uuid,
  action      text NOT NULL CHECK (action IN ('CREATED', 'STATUS_CHANGED')),
  from_status text,
  to_status   text,
  actor_id    uuid,
  actor_kind  text CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'system', 'superAdmin')),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.life_events');
CREATE INDEX life_events_by_entity ON schoollife.life_events (tenant_id, entity_kind, entity_id, occurred_at);
CREATE INDEX life_events_by_student ON schoollife.life_events (tenant_id, student_id, occurred_at DESC) WHERE student_id IS NOT NULL;
GRANT SELECT, INSERT ON schoollife.life_events TO app_user;

-- Journal des lectures d'éléments CONFIDENTIELS (qui, quand, pourquoi) : ajout seul.
CREATE TABLE schoollife.confidential_reads (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  entity_kind    text NOT NULL CHECK (entity_kind IN ('INCIDENT', 'MEASURE', 'NOTE', 'CONVOCATION')),
  entity_id      uuid NOT NULL,
  reader_user_id uuid NOT NULL,
  purpose        text NOT NULL CHECK (length(btrim(purpose)) >= 5),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.confidential_reads');
CREATE INDEX confidential_reads_by_entity ON schoollife.confidential_reads (tenant_id, entity_kind, entity_id, occurred_at);
GRANT SELECT, INSERT ON schoollife.confidential_reads TO app_user;      -- append-only
