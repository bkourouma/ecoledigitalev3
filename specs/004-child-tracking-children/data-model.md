# Data Model: Child Tracking Feature

**Date**: 2025-01-27  
**Feature**: Child Tracking (`004-child-tracking-children`)

## Overview

This document defines the data model for the parent child tracking feature. The feature leverages existing database tables and relationships, with no new tables required.

## Entities

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Links parent user accounts to student profiles, establishing the relationship that enables parent access to child data.

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

### Child/Student Profile

**Source Table**: `student_profiles`

**Purpose**: Represents a student linked to a parent account. Contains student information and status.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `user_id` (UUID) - References `users.id`
- `student_number` (VARCHAR) - Student identification number
- `current_year` (INTEGER) - Current academic year/grade level
- `status` (ENUM) - 'active', 'graduated', 'suspended', 'dropped', 'transfer'
- `bio` (TEXT) - Student biography
- `date_of_birth` (DATE) - Date of birth
- `place_of_birth` (VARCHAR) - Place of birth
- `nationality` (VARCHAR) - Nationality
- `address` (TEXT) - Address
- `phone` (VARCHAR) - Phone number
- `emergency_phone` (VARCHAR) - Emergency contact phone
- `is_active` (BOOLEAN) - Active status flag
- `created_at` (TIMESTAMP) - Creation timestamp
- `updated_at` (TIMESTAMP) - Last update timestamp

**Relationships**:
- One-to-one with `users` (via `user_id`)
- One-to-many with `student_parents` (via `student_id`)

**Status Handling**: 
- All statuses (active, suspended, dropped, transfer) are displayed in children list
- Status indicator shown for each child
- Data access allowed for all statuses as per specification

### Grade Record

**Source Table**: `assignment_submissions` (via joins)

**Purpose**: Represents an individual grade assignment for a student, used to calculate grades summary.

**Key Attributes**:
- `id` (UUID) - Submission ID (primary key)
- `assignment_id` (UUID) - References `assignments.id`
- `course_id` (UUID) - References `courses.id`
- `student_id` (UUID) - References `student_profiles.id`
- `final_score` (NUMERIC) - Final grade value
- `manual_score` (NUMERIC) - Manually entered grade
- `max_points` (INTEGER) - Maximum possible points
- `assignment_type` (VARCHAR) - Type of assignment
- `graded_at` (TIMESTAMP) - When grade was assigned
- `feedback` (TEXT) - Instructor feedback

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `assignments` (via `assignment_id`)
- Many-to-one with `courses` (via `course_id`)

**Aggregation Pattern**:
- All-time grades: All `assignment_submissions` for student with `final_score` or `manual_score` not null
- Average calculation: `SUM(grade * coefficient) / SUM(coefficient)` across all grades
- Distribution: Count grades in ranges (excellent >=16, good 14-15, average 12-13, below <12)

### Schedule/Session Instance

**Source Table**: `session_instances`

**Purpose**: Represents a scheduled class session for a student, used for weekly schedule and upcoming classes.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `class_id` (UUID) - References `classes.id`
- `course_id` (UUID) - References `courses.id`
- `teacher_id` (UUID) - References `teachers.id`
- `session_date` (DATE) - Date of session
- `start_datetime` (TIMESTAMP) - Start date/time
- `end_datetime` (TIMESTAMP) - End date/time
- `start_time` (TIME) - Start time
- `end_time` (TIME) - End time
- `status` (VARCHAR) - Session status
- `classroom` (VARCHAR) - Classroom/location
- `duration_minutes` (INTEGER) - Session duration
- `notes` (TEXT) - Session notes

**Relationships**:
- Many-to-one with `classes` (via `class_id`)
- Many-to-one with `courses` (via `course_id`)
- Many-to-one with `teachers` (via `teacher_id`)
- Linked to student via `inscriptions` table (student enrolled in class)

**Query Pattern for Student Schedule**:
```sql
SELECT si.*, c.name as course_name, c.code as course_code, cl.name as class_name
FROM session_instances si
JOIN inscriptions i ON si.class_id = i.classe_id
JOIN courses c ON si.course_id = c.id
JOIN classes cl ON si.class_id = cl.id
WHERE i.student_id = $student_id
  AND i.tenant_id = $tenant_id
  AND i.status = 'active'
  AND si.session_date >= $start_date
  AND si.session_date <= $end_date
ORDER BY si.session_date, si.start_time
```

### Attendance Record

**Source Table**: `student_attendance`

**Purpose**: Represents an attendance entry for a student in a specific session, used for attendance records and absence history.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `session_id` (UUID) - References `attendance_sessions.id`
- `student_id` (UUID) - References `student_profiles.id`
- `attendance_status` (ENUM) - 'present', 'absent', 'late', 'excused', 'medical_leave'
- `arrival_time` (TIME) - For late arrivals
- `departure_time` (TIME) - For early departures
- `excuse_reason` (TEXT) - Required for excused/medical_leave
- `excuse_document_url` (TEXT) - Document URL if applicable
- `marked_by` (UUID) - References `users.id` (who marked attendance)
- `marked_at` (TIMESTAMP) - When attendance was marked
- `is_makeup` (BOOLEAN) - Makeup session flag
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMP) - Creation timestamp
- `updated_at` (TIMESTAMP) - Last update timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `attendance_sessions` (via `session_id`)
- Many-to-one with `users` (via `marked_by`)

**Query Pattern for Attendance Records**:
```sql
SELECT sa.*, as.session_date, c.name as course_name, c.code as course_code
FROM student_attendance sa
JOIN attendance_sessions as ON sa.session_id = as.id
JOIN class_courses cc ON as.class_course_id = cc.id
JOIN courses c ON cc.course_id = c.id
WHERE sa.student_id = $student_id
  AND sa.tenant_id = $tenant_id
ORDER BY sa.marked_at DESC
LIMIT $limit OFFSET $offset
```

**Query Pattern for Absence History**:
```sql
SELECT sa.*, as.session_date, c.name as course_name, c.code as course_code
FROM student_attendance sa
JOIN attendance_sessions as ON sa.session_id = as.id
JOIN class_courses cc ON as.class_course_id = cc.id
JOIN courses c ON cc.course_id = c.id
WHERE sa.student_id = $student_id
  AND sa.tenant_id = $tenant_id
  AND sa.attendance_status IN ('absent', 'excused', 'medical_leave')
  AND ($date_range_filter)
  AND ($absence_type_filter)
  AND ($course_filter)
ORDER BY sa.marked_at DESC
```

## Relationships Summary

```
tenants (1) ──→ (N) student_parents
users (1) ──→ (N) student_parents (as parent)
student_profiles (1) ──→ (N) student_parents (as student)
student_profiles (1) ──→ (N) assignment_submissions (for grades)
student_profiles (1) ──→ (N) inscriptions ──→ (N) session_instances (for schedule)
student_profiles (1) ──→ (N) student_attendance (for attendance)
```

## Validation Rules

### Parent-Child Relationship
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship must exist in `student_parents` table for data access

### Grades Summary
- Only include grades where `final_score` or `manual_score` is not null
- Include all-time grades (all semesters/years) by default
- Calculate average using weighted coefficients if available, otherwise simple average
- Handle missing grades gracefully (show as "Not graded" or exclude from calculations)

### Schedule
- Only include sessions for classes where student is enrolled (via `inscriptions` with status 'active')
- Filter by date range for weekly view
- Filter by future dates for upcoming classes (next 7 days, max 10 classes)
- Include all statuses (active, suspended, dropped, transfer) as per specification

### Attendance Records
- Paginate with 20 records per page
- Order by `marked_at DESC` (most recent first)
- Include all attendance statuses
- Show excuse reasons for excused/medical_leave statuses

### Absence History
- Filter to only absences (statuses: 'absent', 'excused', 'medical_leave')
- Support date range filtering
- Support absence type filtering (excused, unexcused, medical)
- Support course filtering
- Calculate statistics: total count, excused vs unexcused breakdown, absence rate

## State Transitions

### Child Status
- **Active**: Normal enrollment, all features accessible
- **Suspended**: Temporarily not attending, all features accessible
- **Dropped**: Permanently withdrawn, all features accessible
- **Transfer**: Transferred to another institution, all features accessible
- **Graduated**: Completed program, all features accessible

**Note**: All statuses are displayed and accessible as per specification clarifications.

## Data Access Patterns

### Query Flow for Children List
1. Authenticate parent user (via `authMiddleware`)
2. Set tenant context (via `tenantContextPlugin`)
3. Query `student_parents` filtered by `parent_id = authenticated_user_id`
4. Join with `student_profiles` and `users` to get complete child information
5. Return children list with status indicators

### Query Flow for Grades Summary
1. Verify parent-child relationship exists
2. Query `assignment_submissions` filtered by `student_id`
3. Join with `assignments` and `courses` for context
4. Aggregate: calculate average, total assignments, graded count, best score, distribution
5. Return summary statistics

### Query Flow for Schedule
1. Verify parent-child relationship exists
2. Query `inscriptions` to get student's enrolled classes
3. Query `session_instances` filtered by class IDs and date range
4. Join with `courses` and `classes` for context
5. Return weekly schedule or upcoming classes

### Query Flow for Attendance Records
1. Verify parent-child relationship exists
2. Query `student_attendance` filtered by `student_id`
3. Join with `attendance_sessions` and courses for context
4. Apply pagination (20 per page)
5. Order by `marked_at DESC`
6. Return paginated attendance records

## Indexes Used

### Existing Indexes (Leveraged)
- `idx_student_parents_parent_id` ON `student_parents(parent_id)` - For querying children by parent
- `idx_student_parents_student_id` ON `student_parents(student_id)` - For relationship verification
- `idx_student_attendance_student_id` ON `student_attendance(student_id)` - For attendance queries
- `idx_student_attendance_tenant_id` ON `student_attendance(tenant_id)` - For tenant filtering
- Indexes on `assignment_submissions` for grades queries
- Indexes on `session_instances` for schedule queries

### No New Indexes Required
- All necessary indexes already exist
- Query patterns align with existing index strategy

## Data Integrity

### Multi-Tenant Isolation
- All queries filtered by `tenant_id` via RLS policies
- Tenant context set via `app.tenant_id` setting before queries
- No cross-tenant data leakage possible

### Access Control
- Parent can only access children linked via `student_parents` table
- Relationship verified at API level before data access
- RLS policies enforce tenant isolation at database level

### Data Consistency
- All foreign key relationships maintained via database constraints
- Status transitions handled at application level
- No orphaned records due to CASCADE deletes

