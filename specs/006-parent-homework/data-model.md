# Data Model: Parent Homework & Courses Tracking Feature

**Date**: 2025-01-27  
**Feature**: Parent Homework & Courses Tracking (`006-parent-homework`)

## Overview

This document defines the data model for the parent homework and courses tracking feature. The feature leverages existing database tables and relationships, with no new tables required.

## Entities

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Links parent user accounts to student profiles, establishing the relationship that enables parent access to child's assignment and course data.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `parent_id` (UUID) - References `users.id` (authenticated parent user)
- `relationship_type` (ENUM) - 'parent', 'guardian', 'emergency_contact'
- `is_primary_contact` (BOOLEAN) - Primary contact flag
- `emergency_contact` (BOOLEAN) - Emergency contact flag
- `can_pickup` (BOOLEAN) - Pickup authorization
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMP) - Creation timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern**: 
```sql
SELECT sp.*, u.first_name, u.last_name, u.email
FROM student_parents sp_rel
JOIN student_profiles sp ON sp_rel.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
```

### Assignment Instance

**Source Table**: `assignment_instances`

**Purpose**: Represents a specific assignment assigned to a class with scheduling information, used for active assignments and upcoming deadlines.

**Key Attributes**:
- `id` (UUID) - Primary key (instance_id)
- `tenant_id` (UUID) - Multi-tenant isolation
- `assignment_id` (UUID) - References `assignments.id`
- `class_id` (UUID) - References `classes.id`
- `teacher_id` (UUID) - References `teachers.id`
- `starts_at` (TIMESTAMPTZ) - When assignment becomes available
- `ends_at` (TIMESTAMPTZ) - Assignment deadline
- `status` (VARCHAR) - Instance status
- `duration_minutes` (INTEGER) - Duration override
- `max_attempts` (INTEGER) - Max attempts override
- `late_submission_allowed` (BOOLEAN) - Late submission flag
- `late_penalty_percent` (NUMERIC) - Late penalty percentage
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `assignments` (via `assignment_id`)
- Many-to-one with `classes` (via `class_id`)
- Many-to-one with `courses` (via `assignments.course_id`)
- Linked to student via `student_enrollments` table (student enrolled in class)

**Query Pattern for Active Assignments**:
```sql
SELECT 
  ai.id as instance_id,
  a.id as assignment_id,
  a.title,
  a.description,
  a.type as submission_type,
  ai.ends_at as due_date,
  c.id as course_id,
  c.name as course_name,
  c.code as course_code,
  cl.id as class_id,
  cl.name as class_name,
  sp.id as student_id,
  u.first_name || ' ' || u.last_name as student_name
FROM assignment_instances ai
JOIN assignments a ON ai.assignment_id = a.id
JOIN courses c ON a.course_id = c.id
JOIN classes cl ON ai.class_id = cl.id
JOIN student_enrollments se ON cl.id = se.class_id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
  AND se.status = 'active'
  AND ai.ends_at > NOW()
  AND a.status = 'published'
ORDER BY ai.ends_at ASC
```

### Assignment Submission

**Source Table**: `assignment_submissions`

**Purpose**: Represents a student's submission for an assignment, used for completed assignments and grades.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `assignment_id` (UUID) - References `assignments.id`
- `assignment_instance_id` (UUID) - References `assignment_instances.id` (nullable)
- `student_id` (UUID) - References `student_profiles.id`
- `submitted_at` (TIMESTAMPTZ) - When assignment was submitted
- `final_score` (NUMERIC) - Final grade value
- `manual_score` (NUMERIC) - Manually entered grade
- `auto_score` (NUMERIC) - Auto-calculated grade (for evaluations)
- `max_points` (INTEGER) - Maximum possible points
- `feedback` (TEXT) - Instructor feedback
- `is_late` (BOOLEAN) - Late submission flag
- `status` (ENUM) - 'in_progress', 'submitted', 'graded'
- `graded_at` (TIMESTAMPTZ) - When grade was assigned
- `graded_by` (UUID) - References `users.id` (who graded)
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `assignments` (via `assignment_id`)
- Many-to-one with `assignment_instances` (via `assignment_instance_id`)
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `courses` (via `assignments.course_id`)

**Query Pattern for Completed Assignments**:
```sql
SELECT 
  ai.id as instance_id,
  a.id as assignment_id,
  a.title,
  a.description,
  a.type as submission_type,
  ai.ends_at as due_date,
  c.id as course_id,
  c.name as course_name,
  c.code as course_code,
  sp.id as student_id,
  u.first_name || ' ' || u.last_name as student_name,
  sub.submitted_at,
  sub.final_score,
  sub.manual_score,
  sub.feedback,
  sub.status as submission_status,
  CASE 
    WHEN sub.submitted_at IS NOT NULL THEN 'submitted'
    WHEN ai.ends_at < NOW() THEN 'expired'
    ELSE 'pending'
  END as completion_status
FROM assignment_instances ai
JOIN assignments a ON ai.assignment_id = a.id
JOIN courses c ON a.course_id = c.id
JOIN classes cl ON ai.class_id = cl.id
JOIN student_enrollments se ON cl.id = se.class_id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sp.id = sub.student_id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
  AND se.status = 'active'
  AND (ai.ends_at < NOW() OR sub.submitted_at IS NOT NULL)
ORDER BY COALESCE(sub.submitted_at, ai.ends_at) DESC
LIMIT $limit OFFSET $offset
```

**Query Pattern for Grades**:
```sql
SELECT 
  sub.id as submission_id,
  a.id as assignment_id,
  a.title as assignment_name,
  a.type as assignment_type,
  c.id as course_id,
  c.name as course_name,
  c.code as course_code,
  sp.id as student_id,
  u.first_name || ' ' || u.last_name as student_name,
  sub.final_score,
  sub.manual_score,
  sub.auto_score,
  sub.max_points,
  sub.feedback,
  sub.submitted_at,
  sub.graded_at,
  ai.ends_at as due_date
FROM assignment_submissions sub
JOIN assignments a ON sub.assignment_id = a.id
JOIN courses c ON a.course_id = c.id
JOIN student_profiles sp ON sub.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
LEFT JOIN assignment_instances ai ON sub.assignment_instance_id = ai.id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
  AND (sub.final_score IS NOT NULL OR sub.manual_score IS NOT NULL)
ORDER BY sub.graded_at DESC, sub.submitted_at DESC
```

### Course Material

**Source Table**: `course_materials`

**Purpose**: Represents a document or resource available for a course, used for course materials access.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `course_id` (UUID) - References `courses.id`
- `title` (VARCHAR) - Material title/name
- `description` (TEXT) - Material description
- `file_url` (TEXT) - File storage URL
- `file_name` (VARCHAR) - Original file name
- `file_type` (VARCHAR) - File MIME type
- `file_size` (INTEGER) - File size in bytes
- `uploaded_by` (UUID) - References `users.id` (who uploaded)
- `uploaded_at` (TIMESTAMPTZ) - Upload timestamp
- `is_public` (BOOLEAN) - Public access flag
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `courses` (via `course_id`)
- Many-to-one with `users` (via `uploaded_by`)
- Linked to student via `student_enrollments` table (student enrolled in course's class)

**Query Pattern for Course Materials**:
```sql
SELECT 
  cm.id as material_id,
  cm.title,
  cm.description,
  cm.file_url,
  cm.file_name,
  cm.file_type,
  cm.file_size,
  cm.uploaded_at,
  c.id as course_id,
  c.name as course_name,
  c.code as course_code,
  sp.id as student_id,
  u.first_name || ' ' || u.last_name as student_name
FROM course_materials cm
JOIN courses c ON cm.course_id = c.id
JOIN class_courses cc ON c.id = cc.course_id
JOIN classes cl ON cc.class_id = cl.id
JOIN student_enrollments se ON cl.id = se.class_id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
  AND se.status = 'active'
  AND (cm.is_public = true OR cm.uploaded_by IS NOT NULL)
ORDER BY cm.uploaded_at DESC
```

## Relationships Summary

```
tenants (1) ──→ (N) student_parents
users (1) ──→ (N) student_parents (as parent)
student_profiles (1) ──→ (N) student_parents (as student)
student_profiles (1) ──→ (N) student_enrollments ──→ (N) classes
classes (1) ──→ (N) assignment_instances
assignments (1) ──→ (N) assignment_instances
assignments (1) ──→ (N) assignment_submissions
student_profiles (1) ──→ (N) assignment_submissions
courses (1) ──→ (N) assignments
courses (1) ──→ (N) course_materials
student_enrollments ──→ classes ──→ class_courses ──→ courses
```

## Validation Rules

### Parent-Child Relationship
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship must exist in `student_parents` table for data access

### Active Assignments
- Only include assignments where `ends_at > NOW()` (not yet expired)
- Only include assignments for classes where student is enrolled (via `student_enrollments` with status 'active')
- Only include published assignments (`assignments.status = 'published'`)
- Calculate days remaining: `ends_at - NOW()`
- Assign priority: high (<3 days), medium (3-7 days), low (>7 days)

### Upcoming Deadlines
- Filter by `ends_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'`
- Sort by `ends_at ASC` (soonest first)
- Calculate days remaining for each assignment
- Assign priority based on days remaining

### Completed Assignments
- Include assignments where `ends_at < NOW()` (expired) OR `submitted_at IS NOT NULL` (submitted)
- Order by `COALESCE(submitted_at, ends_at) DESC` (most recent first)
- Paginate with 20 records per page
- Show submission status: 'submitted', 'expired', 'pending'

### Grades Received
- Only include submissions where `final_score IS NOT NULL OR manual_score IS NOT NULL` (graded)
- Calculate percentage: `(grade / max_points) * 100`
- Support filtering by child_id, course_id, date range
- Calculate statistics: average grade, total graded, grade distribution

### Course Materials
- Only include materials for courses where student is enrolled (via `student_enrollments` → `classes` → `class_courses` → `courses`)
- Verify student enrollment status is 'active'
- Support filtering by child_id, course_id
- Verify material access permissions (is_public or uploaded_by check)

## State Transitions

### Assignment Status
- **Pending**: Assignment available, not yet started (`ends_at > NOW()`, no submission)
- **In Progress**: Assignment started but not submitted (`submitted_at IS NULL`, `ends_at > NOW()`)
- **Submitted**: Assignment submitted before deadline (`submitted_at IS NOT NULL`, `submitted_at <= ends_at`)
- **Expired**: Assignment deadline passed without submission (`ends_at < NOW()`, `submitted_at IS NULL`)
- **Graded**: Assignment submitted and graded (`final_score IS NOT NULL OR manual_score IS NOT NULL`)

### Priority Levels
- **High**: Deadline within 3 days (`ends_at - NOW() <= 3 days`)
- **Medium**: Deadline between 3-7 days (`ends_at - NOW() BETWEEN 3 AND 7 days`)
- **Low**: Deadline more than 7 days away (`ends_at - NOW() > 7 days`)

## Data Access Patterns

### Query Flow for Active Assignments
1. Authenticate parent user (via `authMiddleware`)
2. Set tenant context (via `tenantContextPlugin`)
3. Query `student_parents` to get linked children
4. Query `assignment_instances` joined with `assignments`, `courses`, `classes`, `student_enrollments`
5. Filter by `ends_at > NOW()` and `status = 'published'`
6. Filter by parent's children via `student_enrollments`
7. Return active assignments with deadline and priority

### Query Flow for Upcoming Deadlines
1. Verify parent-child relationship exists
2. Query active assignments filtered by `ends_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'`
3. Calculate days remaining and assign priority
4. Sort by `ends_at ASC`
5. Return upcoming deadlines with priority indicators

### Query Flow for Completed Assignments
1. Verify parent-child relationship exists
2. Query `assignment_instances` where `ends_at < NOW()` OR `assignment_submissions.submitted_at IS NOT NULL`
3. Join with `assignment_submissions` to get submission status and grades
4. Apply pagination (20 per page)
5. Order by `COALESCE(submitted_at, ends_at) DESC`
6. Return completed assignments with submission status

### Query Flow for Grades
1. Verify parent-child relationship exists
2. Query `assignment_submissions` where `final_score IS NOT NULL OR manual_score IS NOT NULL`
3. Join with `assignments` and `courses` for context
4. Filter by child_id, course_id, date range if provided
5. Calculate statistics (average, total, distribution)
6. Return grades with statistics

### Query Flow for Course Materials
1. Verify parent-child relationship exists
2. Query `course_materials` joined with `courses`
3. Join with `class_courses`, `classes`, `student_enrollments` to verify child enrollment
4. Filter by child_id, course_id if provided
5. Verify material access (is_public or uploaded_by check)
6. Return course materials with download capability

## Indexes Used

### Existing Indexes (Leveraged)
- `idx_student_parents_parent_id` ON `student_parents(parent_id)` - For querying children by parent
- `idx_student_parents_student_id` ON `student_parents(student_id)` - For relationship verification
- `idx_assignment_instances_class_id` ON `assignment_instances(class_id)` - For assignment queries
- `idx_assignment_instances_dates` ON `assignment_instances(starts_at, ends_at)` - For deadline filtering
- `idx_assignment_submissions_student_id` ON `assignment_submissions(student_id)` - For submission queries
- `idx_assignment_submissions_assignment_id` ON `assignment_submissions(assignment_id)` - For assignment-submission joins
- `idx_course_materials_course_id` ON `course_materials(course_id)` - For course material queries
- `idx_student_enrollments_student_id` ON `student_enrollments(student_id)` - For enrollment verification

### No New Indexes Required
- All necessary indexes already exist
- Query patterns align with existing index strategy

## Data Integrity

### Multi-Tenant Isolation
- All queries filtered by `tenant_id` via RLS policies
- Tenant context set via `app.tenant_id` setting before queries
- No cross-tenant data leakage possible

### Access Control
- Parent can only access assignments for children linked via `student_parents` table
- Relationship verified at API level before data access
- RLS policies enforce tenant isolation at database level
- Course materials access verified via student enrollment

### Data Consistency
- All foreign key relationships maintained via database constraints
- Assignment status transitions handled at application level
- No orphaned records due to CASCADE deletes

