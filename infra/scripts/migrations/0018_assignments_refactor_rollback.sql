-- Rollback: 0018_assignments_refactor_rollback.sql
-- Description: Rollback script for assignments refactor migration
-- Date: 2025-09-24
-- Author: EcoleDigitale Platform Team

-- ========================================
-- ROLLBACK STEP 1: REMOVE VIEWS
-- ========================================

DROP VIEW IF EXISTS student_available_assignments;
DROP VIEW IF EXISTS teacher_assignment_instances;

-- ========================================
-- ROLLBACK STEP 2: REMOVE FOREIGN KEY FROM SUBMISSIONS
-- ========================================

-- Remove the assignment_instance_id column from assignment_submissions
ALTER TABLE assignment_submissions DROP COLUMN IF EXISTS assignment_instance_id;

-- ========================================
-- ROLLBACK STEP 3: DROP ASSIGNMENT_INSTANCES TABLE
-- ========================================

-- Drop the assignment_instances table and all its dependencies
DROP TABLE IF EXISTS assignment_instances CASCADE;

-- ========================================
-- ROLLBACK STEP 4: RESTORE ORIGINAL FUNCTIONALITY
-- ========================================

-- Note: The original assignment_status column should still exist
-- If it was removed, uncomment the following lines:

-- ALTER TABLE assignments ADD COLUMN IF NOT EXISTS status assignment_status DEFAULT 'draft';
-- UPDATE assignments SET status = 'published' WHERE id IN (
--   SELECT DISTINCT assignment_id FROM assignment_instances_backup
-- );

-- ========================================
-- VALIDATION
-- ========================================

-- Verify rollback success
SELECT 
  'Rollback completed successfully' as message,
  COUNT(*) as remaining_assignments
FROM assignments;

-- Check that assignment_instances table no longer exists
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assignment_instances')
    THEN 'ERROR: assignment_instances table still exists'
    ELSE 'SUCCESS: assignment_instances table removed'
  END as rollback_status;
