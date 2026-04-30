-- Migration: assignment instances to decouple scheduling from templates
-- Creates assignment_instances table, links submissions to instances, and relaxes dates on assignments

-- 1) Make assignment template dates optional
ALTER TABLE IF EXISTS assignments
  ALTER COLUMN ends_at DROP NOT NULL;

-- 2) Instances per class and academic year
CREATE TABLE IF NOT EXISTS assignment_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

  -- Scheduling
  starts_at timestamptz,
  ends_at timestamptz NOT NULL,
  status evaluation_status DEFAULT 'draft', -- reuse existing enum

  -- Optional overrides (apply at runtime if provided)
  duration_minutes integer,
  max_attempts integer,
  shuffle_questions boolean,
  show_results_mode text, -- 'immediate' | 'after_end' | 'after_correction'
  late_submission_allowed boolean,
  late_penalty_percent numeric(5,2),

  overrides jsonb DEFAULT '{}',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_instances_tenant ON assignment_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assignment_instances_assignment ON assignment_instances(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_instances_class ON assignment_instances(class_id);
CREATE INDEX IF NOT EXISTS idx_assignment_instances_year ON assignment_instances(academic_year_id);

-- 3) Submissions reference instance when available
ALTER TABLE IF EXISTS assignment_submissions
  ADD COLUMN IF NOT EXISTS assignment_instance_id uuid REFERENCES assignment_instances(id) ON DELETE CASCADE;

-- Unique per instance when instance_id is present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_submission_instance_student_attempt'
  ) THEN
    CREATE UNIQUE INDEX uq_submission_instance_student_attempt
      ON assignment_submissions(assignment_instance_id, student_id, attempt_number)
      WHERE assignment_instance_id IS NOT NULL;
  END IF;
END$$;

-- Helpful view for reporting (optional, safe to create if not exists)
CREATE OR REPLACE VIEW v_assignment_instances AS
SELECT ai.*, a.course_id, a.teacher_id, a.type, a.title
FROM assignment_instances ai
JOIN assignments a ON a.id = ai.assignment_id;
