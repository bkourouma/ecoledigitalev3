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
