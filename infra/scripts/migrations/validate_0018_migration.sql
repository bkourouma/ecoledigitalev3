-- Validation: validate_0018_migration.sql
-- Description: Validation queries for assignments refactor migration
-- Date: 2025-09-24
-- Author: EcoleDigitale Platform Team

-- ========================================
-- PRE-MIGRATION VALIDATION
-- ========================================

-- Count published assignments before migration
SELECT 
  'PRE-MIGRATION: Published assignments count' as check_name,
  COUNT(*) as count
FROM assignments 
WHERE status = 'published';

-- Count total assignments before migration
SELECT 
  'PRE-MIGRATION: Total assignments count' as check_name,
  COUNT(*) as count
FROM assignments;

-- Count assignment submissions before migration
SELECT 
  'PRE-MIGRATION: Assignment submissions count' as check_name,
  COUNT(*) as count
FROM assignment_submissions;

-- ========================================
-- POST-MIGRATION VALIDATION
-- ========================================

-- Verify assignment_instances table exists and has data
SELECT 
  'POST-MIGRATION: Assignment instances created' as check_name,
  COUNT(*) as count
FROM assignment_instances;

-- Verify all published assignments have corresponding instances
SELECT 
  'POST-MIGRATION: Published assignments with instances' as check_name,
  COUNT(DISTINCT a.id) as assignments_with_instances
FROM assignments a
JOIN assignment_instances ai ON ai.assignment_id = a.id
WHERE a.status = 'published';

-- Check for orphaned assignment instances (should be 0)
SELECT 
  'POST-MIGRATION: Orphaned instances (should be 0)' as check_name,
  COUNT(*) as count
FROM assignment_instances ai
LEFT JOIN assignments a ON a.id = ai.assignment_id
WHERE a.id IS NULL;

-- Verify assignment_submissions have been linked to instances
SELECT 
  'POST-MIGRATION: Submissions linked to instances' as check_name,
  COUNT(*) as linked_submissions
FROM assignment_submissions
WHERE assignment_instance_id IS NOT NULL;

-- Check for unlinked submissions (these might need manual review)
SELECT 
  'POST-MIGRATION: Unlinked submissions (review needed)' as check_name,
  COUNT(*) as unlinked_submissions
FROM assignment_submissions sub
JOIN assignments a ON a.id = sub.assignment_id
WHERE sub.assignment_instance_id IS NULL
  AND a.status = 'published';

-- ========================================
-- DATA INTEGRITY CHECKS
-- ========================================

-- Verify tenant isolation is maintained
SELECT 
  'INTEGRITY: Tenant isolation check' as check_name,
  CASE 
    WHEN COUNT(*) = 0 THEN 'PASS: No cross-tenant instances'
    ELSE CONCAT('FAIL: ', COUNT(*), ' cross-tenant instances found')
  END as result
FROM assignment_instances ai
JOIN assignments a ON a.id = ai.assignment_id
WHERE ai.tenant_id != a.tenant_id;

-- Verify class-course relationships are valid
SELECT 
  'INTEGRITY: Class-course relationship check' as check_name,
  CASE 
    WHEN COUNT(*) = 0 THEN 'PASS: All instances have valid class-course relationships'
    ELSE CONCAT('FAIL: ', COUNT(*), ' invalid relationships found')
  END as result
FROM assignment_instances ai
JOIN assignments a ON a.id = ai.assignment_id
LEFT JOIN class_courses cc ON cc.class_id = ai.class_id AND cc.course_id = a.course_id
WHERE cc.id IS NULL;

-- Verify date constraints
SELECT 
  'INTEGRITY: Date constraints check' as check_name,
  CASE 
    WHEN COUNT(*) = 0 THEN 'PASS: All date constraints valid'
    ELSE CONCAT('FAIL: ', COUNT(*), ' invalid date ranges found')
  END as result
FROM assignment_instances
WHERE starts_at IS NOT NULL AND starts_at >= ends_at;

-- ========================================
-- PERFORMANCE CHECKS
-- ========================================

-- Check if indexes were created properly
SELECT 
  'PERFORMANCE: Assignment instances indexes' as check_name,
  COUNT(*) as index_count
FROM pg_indexes 
WHERE tablename = 'assignment_instances';

-- Verify RLS policies are in place
SELECT 
  'SECURITY: RLS policies check' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN 'PASS: RLS policies found'
    ELSE 'FAIL: No RLS policies found'
  END as result
FROM pg_policies 
WHERE tablename = 'assignment_instances';

-- ========================================
-- FUNCTIONAL VALIDATION
-- ========================================

-- Test the student_available_assignments view
SELECT 
  'FUNCTIONAL: Student view test' as check_name,
  COUNT(*) as available_assignments
FROM student_available_assignments
LIMIT 5;

-- Test the teacher_assignment_instances view
SELECT 
  'FUNCTIONAL: Teacher view test' as check_name,
  COUNT(*) as teacher_instances
FROM teacher_assignment_instances
LIMIT 5;

-- ========================================
-- SUMMARY REPORT
-- ========================================

-- Generate a summary report
WITH migration_stats AS (
  SELECT 
    (SELECT COUNT(*) FROM assignments WHERE status = 'published') as published_assignments,
    (SELECT COUNT(*) FROM assignment_instances) as created_instances,
    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_instance_id IS NOT NULL) as linked_submissions,
    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_instance_id IS NULL) as unlinked_submissions
)
SELECT 
  'MIGRATION SUMMARY' as report_section,
  json_build_object(
    'published_assignments', published_assignments,
    'created_instances', created_instances,
    'linked_submissions', linked_submissions,
    'unlinked_submissions', unlinked_submissions,
    'migration_success_rate', 
    CASE 
      WHEN published_assignments > 0 
      THEN ROUND((created_instances::numeric / published_assignments) * 100, 2)
      ELSE 0 
    END
  ) as statistics
FROM migration_stats;

-- ========================================
-- CLEANUP RECOMMENDATIONS
-- ========================================

-- Show assignments that might need manual review
SELECT 
  'MANUAL REVIEW NEEDED' as section,
  a.id,
  a.title,
  a.status,
  COUNT(ai.id) as instance_count
FROM assignments a
LEFT JOIN assignment_instances ai ON ai.assignment_id = a.id
WHERE a.status = 'published' AND ai.id IS NULL
GROUP BY a.id, a.title, a.status
HAVING COUNT(ai.id) = 0;
