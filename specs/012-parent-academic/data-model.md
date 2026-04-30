# Data Model: Parent Academic Information Feature

**Date**: 2025-01-27  
**Feature**: Parent Academic Information (`012-parent-academic`)

## Overview

This document defines the data model for the parent academic information feature. The feature leverages existing database tables and relationships to provide parents with comprehensive visibility into their children's academic program.

## Entities

### Enrolled Course

**Source Tables**: `student_enrollments`, `class_courses`, `courses`, `student_profiles`, `student_parents`, `teachers`, `users`

**Purpose**: Represents a course that a child is enrolled in, used for displaying enrolled courses to parents.

**Key Attributes**:
- `courseId` (UUID) - Course ID
- `courseName` (VARCHAR) - Course name
- `courseCode` (VARCHAR) - Course code
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `teacherId` (UUID) - Teacher ID
- `teacherName` (VARCHAR) - Teacher name
- `scheduleDay` (INTEGER) - Schedule day (1=Monday, 7=Sunday)
- `scheduleTime` (VARCHAR) - Schedule time (HH:MM format)
- `classroom` (VARCHAR) - Classroom
- `deliveryMode` (ENUM) - Delivery mode (presential, remote, hybrid, elearning)
- `courseStatus` (ENUM) - Course status (draft, active, inactive)
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `courses` (via `course_id`)
- Many-to-one with `teachers` (via `teacher_id`)
- Many-to-one with `academic_years` (via `academic_year_id`)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)

**Query Pattern for Enrolled Courses**:
```sql
SELECT 
  c.id as course_id,
  c.name as course_name,
  c.code as course_code,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  t.id as teacher_id,
  COALESCE(t.first_name || ' ' || t.last_name, t.name) as teacher_name,
  cc.schedule_day,
  cc.schedule_time,
  cc.classroom,
  c.delivery_mode,
  c.status as course_status,
  ay.id as academic_year_id,
  ay.name as academic_year_name
FROM student_enrollments se
JOIN class_courses cc ON se.class_id = cc.class_id AND se.academic_year_id = cc.academic_year_id
JOIN courses c ON cc.course_id = c.id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
LEFT JOIN teachers t ON cc.teacher_id = t.id
JOIN academic_years ay ON se.academic_year_id = ay.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND se.tenant_id = $tenant_id
  AND se.status = 'active'
ORDER BY c.name ASC
```

### Course Material

**Source Tables**: `course_materials` (may need to be created), `courses`, `student_enrollments`, `student_profiles`, `student_parents`

**Purpose**: Represents a material associated with a course, used for displaying course materials to parents.

**Key Attributes**:
- `materialId` (UUID) - Material ID
- `materialName` (VARCHAR) - Material name
- `materialType` (ENUM) - Material type (document, video, link, etc.)
- `courseId` (UUID) - Course ID
- `courseName` (VARCHAR) - Course name
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `uploadDate` (TIMESTAMPTZ) - Upload date
- `fileSize` (INTEGER) - File size in bytes (if applicable)
- `fileUrl` (VARCHAR) - File URL for download/view
- `downloadable` (BOOLEAN) - Whether material can be downloaded
- `viewable` (BOOLEAN) - Whether material can be viewed in browser

**Relationships**:
- Many-to-one with `courses` (via `course_id`)
- Many-to-one with `student_profiles` (via `student_id` through enrollment)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)

**Query Pattern for Course Materials**:
```sql
SELECT 
  cm.id as material_id,
  cm.name as material_name,
  cm.type as material_type,
  c.id as course_id,
  c.name as course_name,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  cm.upload_date,
  cm.file_size,
  cm.file_url,
  cm.downloadable,
  cm.viewable
FROM course_materials cm
JOIN courses c ON cm.course_id = c.id
JOIN class_courses cc ON c.id = cc.course_id
JOIN student_enrollments se ON cc.class_id = se.class_id AND cc.academic_year_id = se.academic_year_id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND cm.tenant_id = $tenant_id
  AND se.status = 'active'
ORDER BY cm.upload_date DESC
```

### Academic Calendar Event

**Source Tables**: `academic_calendar_events` (may need to be created), `academic_years`

**Purpose**: Represents an event in the academic calendar, used for displaying academic calendar to parents.

**Key Attributes**:
- `eventId` (UUID) - Event ID
- `eventName` (VARCHAR) - Event name
- `eventType` (ENUM) - Event type (semester_start, semester_end, holiday, break, special_event, academic_milestone)
- `eventDate` (DATE) - Event date
- `eventDescription` (TEXT) - Event description
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name
- `semester` (INTEGER) - Semester number (if applicable)

**Relationships**:
- Many-to-one with `academic_years` (via `academic_year_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern for Academic Calendar Events**:
```sql
SELECT 
  ace.id as event_id,
  ace.name as event_name,
  ace.type as event_type,
  ace.event_date,
  ace.description as event_description,
  ay.id as academic_year_id,
  ay.name as academic_year_name,
  ace.semester
FROM academic_calendar_events ace
JOIN academic_years ay ON ace.academic_year_id = ay.id
WHERE ace.tenant_id = $tenant_id
  AND ($academic_year_id IS NULL OR ace.academic_year_id = $academic_year_id)
  AND ($semester IS NULL OR ace.semester = $semester)
  AND ($start_date IS NULL OR ace.event_date >= $start_date)
  AND ($end_date IS NULL OR ace.event_date <= $end_date)
ORDER BY ace.event_date ASC
```

### Exam Schedule

**Source Tables**: `exam_schedules` (may need to be created), `courses`, `student_enrollments`, `student_profiles`, `student_parents`

**Purpose**: Represents an exam scheduled for a course, used for displaying exam schedules to parents.

**Key Attributes**:
- `examId` (UUID) - Exam ID
- `examName` (VARCHAR) - Exam name
- `examType` (ENUM) - Exam type (midterm, final, quiz, etc.)
- `courseId` (UUID) - Course ID
- `courseName` (VARCHAR) - Course name
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `examDate` (DATE) - Exam date
- `examTime` (TIME) - Exam time
- `duration` (INTEGER) - Duration in minutes
- `location` (VARCHAR) - Exam location
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name

**Relationships**:
- Many-to-one with `courses` (via `course_id`)
- Many-to-one with `student_profiles` (via `student_id` through enrollment)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)
- Many-to-one with `academic_years` (via `academic_year_id`)

**Query Pattern for Exam Schedules**:
```sql
SELECT 
  es.id as exam_id,
  es.name as exam_name,
  es.type as exam_type,
  c.id as course_id,
  c.name as course_name,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  es.exam_date,
  es.exam_time,
  es.duration,
  es.location,
  ay.id as academic_year_id,
  ay.name as academic_year_name
FROM exam_schedules es
JOIN courses c ON es.course_id = c.id
JOIN class_courses cc ON c.id = cc.course_id
JOIN student_enrollments se ON cc.class_id = se.class_id AND cc.academic_year_id = se.academic_year_id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN academic_years ay ON es.academic_year_id = ay.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND es.tenant_id = $tenant_id
  AND se.status = 'active'
  AND ($child_id IS NULL OR sp.id = $child_id)
  AND ($course_id IS NULL OR c.id = $course_id)
  AND ($exam_type IS NULL OR es.type = $exam_type)
  AND ($start_date IS NULL OR es.exam_date >= $start_date)
  AND ($end_date IS NULL OR es.exam_date <= $end_date)
  AND ($academic_year_id IS NULL OR es.academic_year_id = $academic_year_id)
ORDER BY es.exam_date ASC, es.exam_time ASC
```

### Academic Year Information

**Source Tables**: `academic_years`, `student_enrollments`, `student_profiles`, `student_parents`

**Purpose**: Represents academic year details, used for displaying academic year information to parents.

**Key Attributes**:
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name
- `startDate` (DATE) - Start date
- `endDate` (DATE) - End date
- `isCurrent` (BOOLEAN) - Whether this is the current academic year
- `semesterInfo` (JSONB) - Semester information (semester 1 start/end, semester 2 start/end, etc.)
- `enrollmentDetails` (JSONB) - Enrollment details for parent's children
- `academicMilestones` (JSONB) - Academic milestones

**Relationships**:
- Many-to-one with `tenants` (via `tenant_id`)
- One-to-many with `student_enrollments` (via `academic_year_id`)

**Query Pattern for Academic Year Information**:
```sql
SELECT 
  ay.id as academic_year_id,
  ay.name as academic_year_name,
  ay.start_date,
  ay.end_date,
  ay.is_current,
  ay.semester_info,
  ay.academic_milestones,
  jsonb_agg(
    jsonb_build_object(
      'childId', sp.id,
      'childName', COALESCE(u.first_name || ' ' || u.last_name, u.name),
      'enrollmentDate', se.enrollment_date,
      'status', se.status
    )
  ) as enrollment_details
FROM academic_years ay
LEFT JOIN student_enrollments se ON ay.id = se.academic_year_id
LEFT JOIN student_profiles sp ON se.student_id = sp.id
LEFT JOIN users u ON sp.user_id = u.id
LEFT JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE ay.tenant_id = $tenant_id
  AND ($academic_year_id IS NULL OR ay.id = $academic_year_id)
  AND (sp_rel.parent_id = $parent_id OR sp_rel.parent_id IS NULL)
GROUP BY ay.id, ay.name, ay.start_date, ay.end_date, ay.is_current, ay.semester_info, ay.academic_milestones
ORDER BY ay.start_date DESC
```

## Validation Rules

### Enrolled Courses
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only active enrollments should be returned
- Course information must be complete (name, code, teacher, schedule, etc.)

### Course Materials
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only materials for enrolled courses should be returned
- Material information must be complete (name, type, upload date, file URL, etc.)

### Academic Calendar Events
- Must have valid `tenant_id` matching authenticated tenant
- Events must be within specified date range (if provided)
- Events must be for specified academic year (if provided)
- Events must be for specified semester (if provided)
- Event information must be complete (name, type, date, description, etc.)

### Exam Schedules
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only exams for enrolled courses should be returned
- Exam information must be complete (name, type, date, time, duration, location, etc.)

### Academic Year Information
- Must have valid `tenant_id` matching authenticated tenant
- Academic year information must be complete (name, start date, end date, semester info, etc.)
- Enrollment details must only include children linked to authenticated parent
- Academic milestones must be complete (if provided)

