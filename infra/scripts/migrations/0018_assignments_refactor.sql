-- Migration: 0018_assignments_refactor.sql
-- Description: Refactor assignments system to use assignment instances instead of status
-- Date: 2025-09-24
-- Author: EcoleDigitale Platform Team

-- ========================================
-- STEP 1: CREATE ASSIGNMENT_INSTANCES TABLE
-- ========================================

-- Create the new assignment_instances table
CREATE TABLE assignment_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  
  -- Scheduling information
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ NOT NULL,
  
  -- Optional parameter overrides
  duration_minutes INTEGER,
  max_attempts INTEGER,
  shuffle_questions BOOLEAN,
  show_results_mode TEXT CHECK (show_results_mode IN ('immediate', 'after_end', 'after_correction')),
  late_submission_allowed BOOLEAN,
  late_penalty_percent NUMERIC(5,2) CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_assignment_class_period UNIQUE (assignment_id, class_id, starts_at, ends_at),
  CONSTRAINT valid_date_range CHECK (starts_at IS NULL OR starts_at < ends_at)
);

-- Create indexes for performance
CREATE INDEX idx_assignment_instances_tenant_id ON assignment_instances(tenant_id);
CREATE INDEX idx_assignment_instances_assignment_id ON assignment_instances(assignment_id);
CREATE INDEX idx_assignment_instances_class_id ON assignment_instances(class_id);
CREATE INDEX idx_assignment_instances_teacher_id ON assignment_instances(teacher_id);
CREATE INDEX idx_assignment_instances_dates ON assignment_instances(starts_at, ends_at);

-- Enable Row Level Security
ALTER TABLE assignment_instances ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for tenant isolation
CREATE POLICY assignment_instances_isolation ON assignment_instances 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ========================================
-- STEP 2: MIGRATE EXISTING DATA
-- ========================================

-- Create a function to migrate published assignments to instances
CREATE OR REPLACE FUNCTION migrate_published_assignments()
RETURNS INTEGER AS $$
DECLARE
  migrated_count INTEGER := 0;
  assignment_record RECORD;
  class_record RECORD;
BEGIN
  -- Loop through all published assignments
  FOR assignment_record IN 
    SELECT a.id, a.tenant_id, a.teacher_id, a.course_id, a.starts_at, a.ends_at
    FROM assignments a
    WHERE a.status = 'published'
  LOOP
    -- For each published assignment, create instances for all classes that have this course
    FOR class_record IN
      SELECT DISTINCT c.id as class_id
      FROM classes c
      JOIN class_courses cc ON cc.class_id = c.id
      WHERE cc.course_id = assignment_record.course_id
        AND c.tenant_id = assignment_record.tenant_id
    LOOP
      -- Insert assignment instance
      INSERT INTO assignment_instances (
        tenant_id,
        assignment_id,
        class_id,
        teacher_id,
        starts_at,
        ends_at
      ) VALUES (
        assignment_record.tenant_id,
        assignment_record.id,
        class_record.class_id,
        assignment_record.teacher_id,
        assignment_record.starts_at,
        assignment_record.ends_at
      )
      ON CONFLICT (assignment_id, class_id, starts_at, ends_at) DO NOTHING;
      
      migrated_count := migrated_count + 1;
    END LOOP;
  END LOOP;
  
  RETURN migrated_count;
END;
$$ LANGUAGE plpgsql;

-- Execute the migration
SELECT migrate_published_assignments() as migrated_instances_count;

-- ========================================
-- STEP 3: UPDATE ASSIGNMENT_SUBMISSIONS TABLE
-- ========================================

-- Add class_id to assignment_submissions for better querying
-- This will help identify which class instance a submission belongs to
ALTER TABLE assignment_submissions 
ADD COLUMN assignment_instance_id UUID REFERENCES assignment_instances(id) ON DELETE SET NULL;

-- Create index for the new foreign key
CREATE INDEX idx_assignment_submissions_instance_id ON assignment_submissions(assignment_instance_id);

-- Update existing submissions to link them to the appropriate assignment instance
-- This is a complex operation that requires matching submissions to the right class
UPDATE assignment_submissions 
SET assignment_instance_id = (
  SELECT ai.id 
  FROM assignment_instances ai
  JOIN assignments a ON a.id = ai.assignment_id
  JOIN students s ON s.id = assignment_submissions.student_id
  JOIN student_enrollments se ON se.student_id = s.id
  WHERE ai.assignment_id = assignment_submissions.assignment_id
    AND se.class_id = ai.class_id
    AND ai.tenant_id = assignment_submissions.tenant_id
  LIMIT 1
)
WHERE assignment_instance_id IS NULL;

-- ========================================
-- STEP 4: CREATE HELPER VIEWS
-- ========================================

-- Create a view to easily get assignments available to students by class
CREATE OR REPLACE VIEW student_available_assignments AS
SELECT 
  a.id as assignment_id,
  a.title,
  a.description,
  a.type,
  a.course_id,
  ai.id as instance_id,
  ai.class_id,
  ai.starts_at,
  ai.ends_at,
  ai.duration_minutes,
  ai.max_attempts,
  c.name as course_name,
  cl.name as class_name,
  t.first_name as teacher_first_name,
  t.last_name as teacher_last_name
FROM assignments a
JOIN assignment_instances ai ON ai.assignment_id = a.id
JOIN courses c ON c.id = a.course_id
JOIN classes cl ON cl.id = ai.class_id
JOIN teachers t ON t.id = ai.teacher_id
WHERE (ai.starts_at IS NULL OR ai.starts_at <= NOW())
  AND ai.ends_at >= NOW();

-- Create a view for teacher assignment management
CREATE OR REPLACE VIEW teacher_assignment_instances AS
SELECT 
  a.id as assignment_id,
  a.title,
  a.description,
  a.type,
  a.course_id,
  ai.id as instance_id,
  ai.class_id,
  ai.starts_at,
  ai.ends_at,
  ai.teacher_id,
  c.name as course_name,
  cl.name as class_name,
  COUNT(s.id) as enrolled_students,
  COUNT(sub.id) as submissions_count,
  COUNT(CASE WHEN sub.status = 'graded' THEN 1 END) as graded_count
FROM assignments a
JOIN assignment_instances ai ON ai.assignment_id = a.id
JOIN courses c ON c.id = a.course_id
JOIN classes cl ON cl.id = ai.class_id
LEFT JOIN student_enrollments se ON se.class_id = ai.class_id
LEFT JOIN students s ON s.id = se.student_id
LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = s.id
GROUP BY a.id, a.title, a.description, a.type, a.course_id, ai.id, ai.class_id, 
         ai.starts_at, ai.ends_at, ai.teacher_id, c.name, cl.name;

-- ========================================
-- STEP 5: ADD COMMENTS AND DOCUMENTATION
-- ========================================

COMMENT ON TABLE assignment_instances IS 'Assignment instances represent specific assignments assigned to classes with scheduling information';
COMMENT ON COLUMN assignment_instances.assignment_id IS 'Reference to the base assignment definition';
COMMENT ON COLUMN assignment_instances.class_id IS 'Class to which this assignment is assigned';
COMMENT ON COLUMN assignment_instances.teacher_id IS 'Teacher who assigned this to the class';
COMMENT ON COLUMN assignment_instances.starts_at IS 'When the assignment becomes available (NULL = immediately)';
COMMENT ON COLUMN assignment_instances.ends_at IS 'When the assignment expires';
COMMENT ON COLUMN assignment_instances.duration_minutes IS 'Override for assignment duration (for evaluations)';
COMMENT ON COLUMN assignment_instances.max_attempts IS 'Override for maximum attempts allowed';

COMMENT ON VIEW student_available_assignments IS 'View showing assignments currently available to students by class';
COMMENT ON VIEW teacher_assignment_instances IS 'View for teachers to manage their assignment instances with statistics';

-- Drop the migration function as it's no longer needed
DROP FUNCTION IF EXISTS migrate_published_assignments();

-- ========================================
-- STEP 6: VALIDATION QUERIES
-- ========================================

-- These queries can be used to validate the migration
-- SELECT COUNT(*) FROM assignment_instances; -- Should show migrated instances
-- SELECT COUNT(*) FROM assignments WHERE status = 'published'; -- Original published count
-- SELECT COUNT(*) FROM assignment_submissions WHERE assignment_instance_id IS NOT NULL; -- Linked submissions
