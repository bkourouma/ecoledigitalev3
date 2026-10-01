-- =============================================================================
-- 0951 — Module scheduling (spec 017) : emplois du temps (patrons récurrents)
-- =============================================================================

-- Un emploi du temps = un jeu de patrons hebdomadaires pour un établissement et une année (ou
-- une période). Brouillon -> publié (visible des portails, source de la génération) -> archivé.
-- Plusieurs brouillons peuvent coexister ; un seul publié par (établissement, année, période, campus).
CREATE TABLE scheduling.timetables (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  campus_id        uuid,
  academic_year_id uuid NOT NULL,
  period_id        uuid,                                -- academic.academic_periods.id
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  valid_from       date NOT NULL,
  valid_to         date NOT NULL,
  week_a_anchor    date,                                -- lundi d'une « semaine A » (alternance A/B)
  cloned_from_id   uuid,
  published_at     timestamptz,
  published_by     uuid,
  archived_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to >= valid_from),
  CHECK (week_a_anchor IS NULL OR extract(isodow FROM week_a_anchor) = 1),
  CHECK (status <> 'DRAFT' OR published_at IS NULL),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, cloned_from_id) REFERENCES scheduling.timetables (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.timetables');
CREATE UNIQUE INDEX timetables_one_published
  ON scheduling.timetables (tenant_id, institution_id, academic_year_id, (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'PUBLISHED';
CREATE INDEX timetables_by_year ON scheduling.timetables (tenant_id, institution_id, academic_year_id, status);
GRANT SELECT, INSERT, UPDATE ON scheduling.timetables TO app_user;

-- Patron récurrent : « chaque lundi de 08:00 à 10:00, classe X, matière Y, salle Z ».
--   weekday      jour ISO 1 (lundi) à 7 (dimanche) — le dimanche est permis (UI limitée à lundi-samedi
--                dans le legacy, jamais le schéma)
--   week_pattern EVERY | WEEK_A | WEEK_B (alternance relative à timetables.week_a_anchor)
--   valid_from/valid_to : bornes propres au patron (sinon celles de l'emploi du temps)
CREATE TABLE scheduling.timetable_entries (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  timetable_id        uuid NOT NULL,
  kind                text NOT NULL DEFAULT 'LESSON' CHECK (kind IN ('LESSON', 'EXAM', 'MEETING', 'EVENT', 'OTHER')),
  classroom_id        uuid,                              -- academic.classrooms.id
  curriculum_node_id  uuid,                              -- academic.curriculum_nodes.id
  offering_id         uuid,                              -- academic.classroom_offerings.id
  claims_classroom    boolean NOT NULL DEFAULT true,
  weekday             smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_time         time NOT NULL,
  ends_time           time NOT NULL,
  time_slot_id        uuid,
  room_id             uuid,
  week_pattern        text NOT NULL DEFAULT 'EVERY' CHECK (week_pattern IN ('EVERY', 'WEEK_A', 'WEEK_B')),
  valid_from          date,
  valid_to            date,
  delivery_mode       text NOT NULL DEFAULT 'IN_PERSON' CHECK (delivery_mode IN ('IN_PERSON', 'ONLINE', 'HYBRID')),
  title               text,
  notes               text,
  ended_at            timestamptz,                       -- patron terminé (valid_to = veille), conservé pour l'historique
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_time > starts_time),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (kind <> 'LESSON' OR (classroom_id IS NOT NULL AND curriculum_node_id IS NOT NULL)),
  CHECK (claims_classroom OR offering_id IS NOT NULL),
  FOREIGN KEY (tenant_id, timetable_id) REFERENCES scheduling.timetables (tenant_id, id),
  FOREIGN KEY (tenant_id, time_slot_id) REFERENCES scheduling.time_slots (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES scheduling.rooms (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.timetable_entries');
CREATE INDEX timetable_entries_by_timetable ON scheduling.timetable_entries (tenant_id, timetable_id, weekday, starts_time);
CREATE INDEX timetable_entries_by_class ON scheduling.timetable_entries (tenant_id, classroom_id) WHERE classroom_id IS NOT NULL;
CREATE INDEX timetable_entries_by_room ON scheduling.timetable_entries (tenant_id, room_id) WHERE room_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.timetable_entries TO app_user;

CREATE TABLE scheduling.timetable_entry_staff (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  entry_id   uuid NOT NULL,
  staff_id   uuid NOT NULL,                              -- people.staff.id
  role       text NOT NULL DEFAULT 'LEAD' CHECK (role IN ('LEAD', 'CO_TEACHER', 'SUPERVISOR')),
  PRIMARY KEY (tenant_id, entry_id, staff_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES scheduling.timetable_entries (tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('scheduling.timetable_entry_staff');
CREATE INDEX timetable_entry_staff_by_staff ON scheduling.timetable_entry_staff (tenant_id, staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.timetable_entry_staff TO app_user;

CREATE TABLE scheduling.timetable_entry_equipment (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  entry_id     uuid NOT NULL,
  equipment_id uuid NOT NULL,
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (tenant_id, entry_id, equipment_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES scheduling.timetable_entries (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES scheduling.equipment_items (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.timetable_entry_equipment');
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.timetable_entry_equipment TO app_user;

-- Journal des générations d'occurrences (traçabilité, rejeu idempotent).
CREATE TABLE scheduling.generation_runs (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  timetable_id     uuid NOT NULL,
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  created_count    integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  skipped_existing integer NOT NULL DEFAULT 0 CHECK (skipped_existing >= 0),
  skipped_blocked  integer NOT NULL DEFAULT 0 CHECK (skipped_blocked >= 0),
  skipped_conflict integer NOT NULL DEFAULT 0 CHECK (skipped_conflict >= 0),
  skipped_capped   integer NOT NULL DEFAULT 0 CHECK (skipped_capped >= 0),
  warnings         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  requested_by     uuid,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (to_date >= from_date),
  FOREIGN KEY (tenant_id, timetable_id) REFERENCES scheduling.timetables (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.generation_runs');
CREATE INDEX generation_runs_by_timetable ON scheduling.generation_runs (tenant_id, timetable_id, requested_at);
GRANT SELECT, INSERT ON scheduling.generation_runs TO app_user;
