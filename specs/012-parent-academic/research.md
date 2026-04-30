# Research: Parent Academic Information Feature

**Date**: 2025-01-27  
**Feature**: Parent Academic Information (`012-parent-academic`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent academic information feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `student_enrollments`, `class_courses`, `courses`, `course_materials`, `academic_years`, `exam_schedules`, and `academic_calendar_events` tables. Query through parent-child relationships via `student_parents` table.

**Rationale**: 
- The `student_enrollments` table already exists with student enrollment data
- The `class_courses` table already exists with course-class relationships
- The `courses` table already exists with course information
- Course materials, academic calendar events, and exam schedules may need to be queried from existing tables or created
- Supports multi-tenant RLS policies
- Parent-child relationships via `student_parents` enable proper access control

**Alternatives Considered**:
- Creating new tables for parent academic information: Rejected - would duplicate existing data
- Direct queries without parent-child relationship verification: Rejected - need proper access control

**Implementation Notes**:
- Query `student_enrollments` joined with `class_courses`, `courses`, `student_profiles`, and `student_parents` for enrolled courses
- Query course materials from existing course materials table (may need to be created or identified)
- Query academic calendar events from existing academic calendar table (may need to be created or identified)
- Query exam schedules from existing exam schedules table (may need to be created or identified)
- Query `academic_years` for academic year information
- Verify authenticated user ID matches parent ID through `student_parents` relationship

### Decision 2: Enrolled Courses Query Pattern

**Decision**: Query enrolled courses by joining `student_enrollments`, `class_courses`, `courses`, `student_profiles`, `student_parents`, and `teachers` tables.

**Rationale**:
- Specification requires displaying course name, course code, child name, teacher name, schedule information, delivery mode, and course status
- Multiple tables need to be joined to get complete course information
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Single table query: Rejected - data is normalized across multiple tables
- Separate queries for each piece of information: Rejected - inefficient, multiple round trips

**Implementation Notes**:
- Join `student_enrollments` with `class_courses` to get course-class relationships
- Join with `courses` to get course details (name, code, delivery mode, status)
- Join with `student_profiles` and `users` to get child name
- Join with `class_courses` and `teachers` to get teacher name
- Join with `student_parents` to verify parent-child relationship
- Filter by authenticated parent ID and tenant ID

### Decision 3: Course Materials Query Pattern

**Decision**: Query course materials from existing course materials table (may need to be created or identified) joined with courses and student enrollments.

**Rationale**:
- Specification requires displaying material name, course name, child name, material type, upload date, file size, and download/view capability
- Course materials need to be linked to courses and filtered by child enrollment
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Store materials in courses table as JSONB: Rejected - less queryable, harder to manage
- Separate materials table: Preferred - better structure, easier to query and manage

**Implementation Notes**:
- Query course materials table joined with courses and student enrollments
- Filter by child enrollment and parent-child relationship
- Support filtering by child, course, material type, and date range
- Support download/view capability based on material type

### Decision 4: Academic Calendar Query Pattern

**Decision**: Query academic calendar events from existing academic calendar table (may need to be created or identified) filtered by tenant and academic year.

**Rationale**:
- Specification requires displaying important dates including semester start/end dates, holidays, breaks, special events, and academic milestones
- Academic calendar events are tenant-specific and academic year-specific
- Calendar view and list view support needed

**Alternatives Considered**:
- Store events in academic_years table as JSONB: Rejected - less queryable, harder to manage
- Separate calendar events table: Preferred - better structure, easier to query and manage

**Implementation Notes**:
- Query academic calendar events table filtered by tenant and academic year
- Support filtering by child (if child-specific events), academic year, semester, and date range
- Support calendar view and list view display
- Display important dates including semester start/end dates, holidays, breaks, special events, and academic milestones

### Decision 5: Exam Schedules Query Pattern

**Decision**: Query exam schedules from existing exam schedules table (may need to be created or identified) joined with courses and student enrollments.

**Rationale**:
- Specification requires displaying exam name, course name, child name, exam date, exam time, duration, location, and exam type
- Exam schedules need to be linked to courses and filtered by child enrollment
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Store exams in courses table as JSONB: Rejected - less queryable, harder to manage
- Separate exam schedules table: Preferred - better structure, easier to query and manage

**Implementation Notes**:
- Query exam schedules table joined with courses and student enrollments
- Filter by child enrollment and parent-child relationship
- Support filtering by child, course, exam type, date range, and academic year
- Sort by exam date (soonest first)

### Decision 6: Academic Year Information Query Pattern

**Decision**: Query academic year information from existing `academic_years` table joined with student enrollments for enrollment details.

**Rationale**:
- Specification requires displaying academic year name, start date, end date, semester information, enrollment details, and academic milestones
- Academic year information is tenant-specific
- Enrollment details need to be linked to parent's children

**Alternatives Considered**:
- Separate query for enrollment details: Rejected - inefficient, multiple round trips
- Single query with joins: Preferred - efficient, single round trip

**Implementation Notes**:
- Query `academic_years` table filtered by tenant
- Join with `student_enrollments` to get enrollment details for parent's children
- Support filtering by child and academic year
- Display academic year name, start date, end date, semester information, enrollment details, and academic milestones

### Decision 7: API Endpoint Structure

**Decision**: Create `/api/v1/parent/academic` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`, `/api/v1/parent/grades`, `/api/v1/parent/payments`, `/api/v1/parent/messages`, `/api/v1/parent/settings`)
- Provides clear namespace for parent-specific academic information endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/children` routes: Rejected - academic information is separate concern
- Create `/api/v1/parent/courses` routes: Rejected - academic information is more comprehensive and includes calendar, exams, and academic year information

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/academic/enrolled-courses` - Get enrolled courses for parent's children
  - `GET /api/v1/parent/academic/course-materials` - Get course materials for parent's children
  - `GET /api/v1/parent/academic/calendar` - Get academic calendar events
  - `GET /api/v1/parent/academic/exam-schedules` - Get exam schedules for parent's children
  - `GET /api/v1/parent/academic/academic-year` - Get academic year information

### Decision 8: Frontend Route Structure

**Decision**: Create `/parent/academic` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for academic information functionality

**Alternatives Considered**:
- Add to existing `/parent/children` page: Rejected - academic information is separate concern
- Nested under `/parent/courses`: Rejected - academic information is more comprehensive

**Implementation Notes**:
- Routes:
  - `/parent/academic` - Main academic information page with tabs/sections for different academic information
- Components:
  - `EnrolledCourses.tsx` - Enrolled courses view with filtering
  - `CourseMaterials.tsx` - Course materials view with filtering
  - `AcademicCalendar.tsx` - Academic calendar view (calendar/list view)
  - `ExamSchedules.tsx` - Exam schedules view with filtering
  - `AcademicYearInfo.tsx` - Academic year information view

### Decision 9: Data Access Control

**Decision**: Enforce parent user ID check at API level using authentication and query filters through `student_parents` relationship.

**Rationale**:
- Specification requires: "Parents can only view information for their own linked children"
- Authentication provides user ID
- `student_parents` relationship provides parent-child link
- Additional query filters ensure correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: Join with `student_parents` table and filter by `parent_id = $authenticated_user_id`
- Verify authenticated user ID matches parent ID through `student_parents` relationship
- Return 403 Forbidden if parent tries to access another parent's children's information
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `student_enrollments` table with student enrollment data
- `class_courses` table with course-class relationships
- `courses` table with course information
- `academic_years` table with academic year information
- `student_parents` table with parent-child relationship data
- `student_profiles` table with student information
- `teachers` table with teacher information
- Authentication system for user ID verification

### New Dependencies
- May need to create or identify `course_materials` table if it doesn't exist
- May need to create or identify `academic_calendar_events` table if it doesn't exist
- May need to create or identify `exam_schedules` table if it doesn't exist
- Calendar view component for academic calendar display

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from other parent routes
- Follow existing error handling and response patterns
- Use existing JOIN patterns from enrollment and course queries

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from other parent hooks
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling
- Use existing filtering and pagination patterns

## Performance Considerations

### Database Queries
- Use existing indexes on `student_enrollments(student_id)`, `student_parents(parent_id)`, `courses(id)`, `academic_years(tenant_id)`
- Enrolled courses queries are parent-specific and should be fast with proper indexes
- Course materials queries are parent-specific and should be fast with proper indexes
- Academic calendar queries are tenant-specific and should be fast with proper indexes
- Exam schedules queries are parent-specific and should be fast with proper indexes
- Academic year information queries are tenant-specific and should be fast with proper indexes

### Caching Strategy
- Use TanStack Query with 5-minute stale time for academic information data
- Cache academic calendar with longer stale time (10 minutes) unless updated
- Cache academic year information with longer stale time (10 minutes) unless updated
- Invalidate cache on enrollment or course updates

## Security Considerations

### Access Control
- All queries filtered by authenticated user ID through `student_parents` relationship
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent-child relationship before returning data
- No direct database access from frontend

### Data Privacy
- Only return academic information for authenticated parent's linked children
- No PII exposure beyond what's required for feature
- Course materials access restricted to enrolled children's parents
- Exam schedules access restricted to enrolled children's parents

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid authenticated user
- Test access control (403 for other users' children's information)
- Test filtering functionality for all endpoints
- Test pagination for large result sets

### Integration Tests
- Test parent can view enrolled courses for their linked children
- Test parent can view course materials for their linked children
- Test parent can view academic calendar events
- Test parent can view exam schedules for their linked children
- Test parent can view academic year information

### E2E Tests
- Test parent login and navigation to academic information page
- Test viewing enrolled courses with filtering
- Test viewing course materials with filtering
- Test viewing academic calendar (calendar/list view)
- Test viewing exam schedules with filtering
- Test viewing academic year information

