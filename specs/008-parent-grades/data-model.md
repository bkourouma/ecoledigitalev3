# Data Model: Parent Grades & Evaluations Feature

**Date**: 2025-01-27  
**Feature**: Parent Grades & Evaluations (`008-parent-grades`)

## Overview

This document defines the data model for the parent grades and evaluations feature. The feature leverages existing database tables and relationships, with no new tables required.

## Entities

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Links parent user accounts to student profiles, establishing the relationship that enables parent access to child's grade data.

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

### Assignment Submission (Graded)

**Source Table**: `assignment_submissions`

**Purpose**: Represents a student's submission for an assignment that has been graded, used for displaying assignment grades and calculating statistics.

**Key Attributes**:
- `id` (UUID) - Primary key (submission_id)
- `tenant_id` (UUID) - Multi-tenant isolation
- `assignment_id` (UUID) - References `assignments.id`
- `student_id` (UUID) - References `student_profiles.id`
- `final_score` (NUMERIC) - Final grade value
- `manual_score` (NUMERIC) - Manually entered grade
- `max_points` (INTEGER) - Maximum possible points (default 100, may vary by assignment)
- `submitted_at` (TIMESTAMPTZ) - When assignment was submitted
- `graded_at` (TIMESTAMPTZ) - When grade was assigned
- `feedback` (TEXT) - Instructor feedback
- `status` (ENUM) - 'in_progress', 'submitted', 'graded'

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `assignments` (via `assignment_id`)
- Many-to-one with `courses` (via `assignments.course_id`)

**Query Pattern for Graded Assignments**:
```sql
SELECT 
  s.id as submission_id,
  s.assignment_id,
  s.student_id,
  COALESCE(s.final_score, s.manual_score) as grade,
  100 as max_points,
  s.submitted_at,
  s.graded_at,
  s.feedback,
  a.title as assignment_name,
  a.type as assignment_type,
  c.id as course_id,
  c.name as course_name,
  c.code as course_code
FROM assignment_submissions s
JOIN assignments a ON s.assignment_id = a.id
JOIN courses c ON a.course_id = c.id
WHERE s.student_id = $student_id
  AND s.tenant_id = $tenant_id
  AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
ORDER BY s.graded_at DESC
```

### Course Grade Summary

**Source Table**: Aggregated from `assignment_submissions` grouped by `course_id`

**Purpose**: Represents aggregated grade information for a course, showing all graded assignments in that course with course-level statistics.

**Key Attributes**:
- `course_id` (UUID) - References `courses.id`
- `course_name` (VARCHAR) - Course name
- `course_code` (VARCHAR) - Course code
- `child_id` (UUID) - References `student_profiles.id`
- `child_name` (VARCHAR) - Child/student name
- `assignment_grades` (ARRAY) - List of graded assignments in this course
- `course_average` (NUMERIC) - Average grade for this course
- `total_graded` (INTEGER) - Total number of graded assignments in this course

**Relationships**:
- Many-to-one with `courses` (via `course_id`)
- Many-to-one with `student_profiles` (via `child_id`)

**Query Pattern for Grades by Course**:
```sql
SELECT 
  c.id as course_id,
  c.name as course_name,
  c.code as course_code,
  sp.id as student_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
  COUNT(s.id) as total_graded,
  AVG(COALESCE(s.final_score, s.manual_score)) as course_average
FROM courses c
JOIN assignments a ON c.id = a.course_id
JOIN assignment_submissions s ON a.id = s.assignment_id
JOIN student_profiles sp ON s.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE s.student_id = $student_id
  AND s.tenant_id = $tenant_id
  AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
GROUP BY c.id, c.name, c.code, sp.id, u.first_name, u.last_name, u.name
ORDER BY c.name
```

### Overall Grade Statistics

**Source Table**: Aggregated from `assignment_submissions`

**Purpose**: Represents aggregated grade statistics across all courses for a child, showing overall performance metrics.

**Key Attributes**:
- `overall_average` (NUMERIC) - Average grade across all courses
- `total_graded` (INTEGER) - Total number of graded assignments
- `grade_distribution` (JSON) - Distribution of grades by category (excellent, good, average, below average)
- `best_score` (NUMERIC) - Highest grade received
- `worst_score` (NUMERIC) - Lowest grade received
- `time_period` (VARCHAR) - Time period for statistics (all-time, semester, date range)

**Relationships**:
- Aggregated from `assignment_submissions` via `student_id`

**Query Pattern for Overall Averages**:
```sql
SELECT 
  COUNT(s.id) as total_graded,
  AVG(COALESCE(s.final_score, s.manual_score)) as overall_average,
  MAX(COALESCE(s.final_score, s.manual_score)) as best_score,
  MIN(COALESCE(s.final_score, s.manual_score)) as worst_score
FROM assignment_submissions s
WHERE s.student_id = $student_id
  AND s.tenant_id = $tenant_id
  AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
  AND ($date_filter_conditions)
```

### Grade Trend Data

**Source Table**: `assignment_submissions` grouped by time period

**Purpose**: Represents grade progression over time for trend visualization.

**Key Attributes**:
- `time_period` (VARCHAR) - Time period identifier (week, month, semester)
- `period_start` (DATE) - Start date of time period
- `period_end` (DATE) - End date of time period
- `average_grade` (NUMERIC) - Average grade for this time period
- `grade_count` (INTEGER) - Number of grades in this time period
- `course_id` (UUID) - Optional: course filter (if filtered by course)
- `child_id` (UUID) - Optional: child filter (if filtered by child)

**Relationships**:
- Aggregated from `assignment_submissions` grouped by time period

**Query Pattern for Grade Trends**:
```sql
SELECT 
  DATE_TRUNC('month', s.graded_at) as period_start,
  COUNT(s.id) as grade_count,
  AVG(COALESCE(s.final_score, s.manual_score)) as average_grade
FROM assignment_submissions s
WHERE s.student_id = $student_id
  AND s.tenant_id = $tenant_id
  AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
  AND s.graded_at >= $start_date
  AND s.graded_at <= $end_date
GROUP BY DATE_TRUNC('month', s.graded_at)
ORDER BY period_start ASC
```

## Validation Rules

### Parent-Child Relationship
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship must exist in `student_parents` table for data access

### Graded Assignments
- Only include submissions where `final_score IS NOT NULL OR manual_score IS NOT NULL` (graded)
- Calculate percentage: `(grade / max_points) * 100`
- Support filtering by child_id, course_id, date range
- Order by `graded_at DESC` (most recent first) or `submitted_at DESC`

### Grades by Course
- Group graded assignments by `course_id`
- Calculate course average: `SUM(grades) / COUNT(graded_assignments)`
- Support filtering by child_id
- Display course name, course code, list of assignment grades, course average, total graded assignments

### Overall Averages
- Calculate overall average: `SUM(all_grades) / COUNT(all_graded_assignments)`
- Calculate grade distribution: categorize grades (excellent ≥16, good 14-15, average 12-13, below average <12) based on 0-20 scale
- Support filtering by child_id, date range, semester
- Calculate statistics: average grade, total graded, grade distribution, best score, worst score

### Grade Trends
- Group grades by time period (week, month, or semester)
- Calculate average grade per time period
- Support filtering by child_id, course_id, date range, semester
- Display as visual chart (line or bar chart) showing grade progression over time
- Default to current academic year, with ability to filter by different time periods

