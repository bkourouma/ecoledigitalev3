-- Migration 0021: Consolidate attendance records into student_attendance and remove legacy table
-- Purpose:
--  1) Migrate legacy data from attendance_records -> student_attendance
--  2) Remove attendance_records to avoid future confusion
--  3) Keep schema consistent with 0008_attendance.sql

BEGIN;

-- Ensure required extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Migrate legacy data if the legacy table exists
DO $$
DECLARE
  legacy_exists boolean;
BEGIN
  SELECT to_regclass('public.attendance_records') IS NOT NULL INTO legacy_exists;
  IF legacy_exists THEN
    -- Insert only missing rows to avoid duplicates
    INSERT INTO student_attendance (
      tenant_id,
      session_id,
      student_id,
      attendance_status,
      arrival_time,
      departure_time,
      excuse_reason,
      excuse_document_url,
      marked_by,
      marked_at,
      is_makeup,
      notes
    )
    SELECT
      ar.tenant_id,
      ar.session_id,
      ar.student_id,
      ar.status::attendance_status,
      NULL::time,
      NULL::time,
      NULL::text,
      NULL::text,
      COALESCE(u.id, '3a7a5a68-94ad-40e6-8fe2-15d4160858fe'::uuid) AS marked_by,
      COALESCE(ar.updated_at, ar.created_at, NOW()) AS marked_at,
      FALSE AS is_makeup,
      ar.notes
    FROM attendance_records ar
    JOIN attendance_sessions s ON s.id = ar.session_id
    LEFT JOIN teachers t ON t.id = s.teacher_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN student_attendance sa
      ON sa.tenant_id = ar.tenant_id AND sa.session_id = ar.session_id AND sa.student_id = ar.student_id
    WHERE sa.id IS NULL;
  END IF;
END $$;

-- 2) Drop the legacy table if it exists (policies and indexes are removed automatically)
DROP TABLE IF EXISTS attendance_records CASCADE;

COMMIT;

