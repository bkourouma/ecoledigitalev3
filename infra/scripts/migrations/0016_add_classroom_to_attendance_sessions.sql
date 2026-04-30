-- Migration: Add classroom_id to attendance_sessions
-- Purpose: Link attendance sessions to a specific classroom (room)

ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_classroom_id
  ON attendance_sessions(classroom_id);

COMMENT ON COLUMN attendance_sessions.classroom_id IS 'Optional link to classrooms table (room where the session is held)';

