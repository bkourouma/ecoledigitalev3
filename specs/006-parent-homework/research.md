# Research: Parent Homework & Courses Tracking Feature

**Date**: 2025-01-27  
**Feature**: Parent Homework & Courses Tracking (`006-parent-homework`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent homework and courses tracking feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `student_parents` table relationships and `student_enrollments` to query assignments for children linked to authenticated parent user.

**Rationale**: 
- The `student_parents` table already exists with proper RLS policies
- Provides parent-child relationship data with appropriate access control
- `student_enrollments` table links students to classes, which link to assignments via `assignment_instances`
- Supports multiple relationship types (parent, guardian, emergency_contact)

**Alternatives Considered**:
- Creating a new parent-assignment view: Rejected - unnecessary duplication
- Direct queries to `assignment_instances`: Rejected - lacks relationship context and access control

**Implementation Notes**:
- Query joins `student_parents` with `student_profiles` to get linked children
- Join `student_enrollments` to get classes where children are enrolled
- Join `assignment_instances` with `assignments` and `courses` to get assignment data
- Filter by `parent_id` matching authenticated user ID
- Verify child enrollment in class before showing assignments

### Decision 2: Active Assignments Filtering

**Decision**: Filter active assignments by `ends_at > NOW()` and `status = 'published'`, calculate days remaining for priority assignment.

**Rationale**:
- Existing `assignment_instances` table contains deadline information (`ends_at`)
- Assignment status (`published`) ensures only available assignments are shown
- Days remaining calculation enables priority indicators (high, medium, low)
- Matches existing student assignment filtering pattern

**Alternatives Considered**:
- Filtering by `starts_at` as well: Rejected - specification focuses on deadlines, not start dates
- Including draft assignments: Rejected - only published assignments should be visible to parents

**Implementation Notes**:
- Filter: `WHERE ai.ends_at > NOW() AND a.status = 'published'`
- Calculate days remaining: `EXTRACT(DAY FROM (ai.ends_at - NOW()))`
- Assign priority: high (<3 days), medium (3-7 days), low (>7 days)
- Support filtering by child_id and course_id

### Decision 3: Upcoming Deadlines Calculation

**Decision**: Filter assignments with deadlines within next 30 days, sort by urgency (soonest first), assign priority based on days remaining.

**Rationale**:
- 30-day window provides reasonable visibility into upcoming deadlines
- Sorting by deadline (soonest first) matches user expectations
- Priority indicators help parents focus on urgent assignments
- Matches existing deadline calculation patterns

**Alternatives Considered**:
- 7-day window: Rejected - too short for planning purposes
- 60-day window: Rejected - too long, reduces urgency focus
- No priority indicators: Rejected - priority helps parents focus on urgent items

**Implementation Notes**:
- Filter: `WHERE ai.ends_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'`
- Sort: `ORDER BY ai.ends_at ASC`
- Calculate days remaining and assign priority
- Highlight urgent deadlines (within 3 days) with visual indicators

### Decision 4: Completed Assignments Definition

**Decision**: Include both submitted assignments and expired assignments (past deadline without submission) in completed assignments view.

**Rationale**:
- Specification clarifies: "completed assignments include both submitted assignments and expired assignments that were never submitted"
- Parents need visibility into all past assignments, not just submitted ones
- Expired assignments provide context for missing work
- Matches user expectations for "completed" view

**Alternatives Considered**:
- Only submitted assignments: Rejected - specification requires expired assignments
- Only expired assignments: Rejected - submitted assignments are also completed
- Separate views for submitted and expired: Rejected - specification requires unified view

**Implementation Notes**:
- Filter: `WHERE ai.ends_at < NOW() OR sub.submitted_at IS NOT NULL`
- Show submission status: 'submitted', 'expired', 'pending'
- Order by `COALESCE(submitted_at, ends_at) DESC` (most recent first)
- Paginate with 20 records per page

### Decision 5: Grades Display Pattern

**Decision**: Display grades by assignment with filtering and aggregation capabilities, calculate statistics (average, total, distribution).

**Rationale**:
- Existing `assignment_submissions` table contains grade data (`final_score`, `manual_score`)
- Assignment-level display provides detailed insight into performance
- Filtering and aggregation enable course-level and overall statistics
- Matches existing grade display patterns from student grades feature

**Alternatives Considered**:
- Course-level aggregation only: Rejected - assignment-level detail is valuable
- Assignment-level only: Rejected - statistics provide valuable context
- Separate views for assignment and course: Rejected - unified view with filtering is better UX

**Implementation Notes**:
- Query `assignment_submissions` where `final_score IS NOT NULL OR manual_score IS NOT NULL`
- Join with `assignments` and `courses` for context
- Calculate percentage: `(grade / max_points) * 100`
- Support filtering by child_id, course_id, date range
- Calculate statistics: average grade, total graded, grade distribution

### Decision 6: Course Materials Access

**Decision**: Verify child enrollment in course via `student_enrollments` → `classes` → `class_courses` → `courses` before allowing material access.

**Rationale**:
- `course_materials` table links to `courses` directly
- Child enrollment verification ensures parents only access materials for courses where child is enrolled
- Enrollment check via `student_enrollments` provides proper access control
- Matches existing material access patterns

**Alternatives Considered**:
- Direct course access without enrollment check: Rejected - security risk
- Course-level access only: Rejected - need to verify child enrollment
- Material-level permissions: Rejected - enrollment check is sufficient

**Implementation Notes**:
- Join `course_materials` with `courses`
- Join `class_courses` with `classes` to get course-class relationships
- Join `student_enrollments` to verify child enrollment
- Filter by `se.status = 'active'` to ensure active enrollment
- Verify material access (is_public or uploaded_by check)

### Decision 7: API Endpoint Structure

**Decision**: Create `/api/v1/parent/homework` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children/*`, `/api/v1/student/assignments/*`)
- Provides clear namespace for parent-specific homework endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/children` routes: Rejected - homework is separate concern
- Create `/api/v1/parent/assignments` routes: Rejected - homework includes materials, not just assignments
- Create `/api/v1/parent/courses` routes: Rejected - homework includes assignments, not just courses

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/homework/assignments/active` - Get active assignments
  - `GET /api/v1/parent/homework/assignments/upcoming-deadlines` - Get upcoming deadlines
  - `GET /api/v1/parent/homework/assignments/completed` - Get completed assignments (paginated)
  - `GET /api/v1/parent/homework/grades` - Get grades with filters and statistics
  - `GET /api/v1/parent/homework/course-materials` - Get course materials
  - `GET /api/v1/parent/homework/course-materials/:materialId/download` - Download course material

### Decision 8: Frontend Route Structure

**Decision**: Create `/parent/homework` route in Next.js app directory with sections for each feature.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Single page with sections provides unified homework view
- Supports filtering and navigation within page

**Alternatives Considered**:
- Separate routes for each feature: Rejected - unified view is better UX
- Nested routes: Rejected - sections on single page are sufficient
- Separate parent module: Rejected - over-engineering for current scope

**Implementation Notes**:
- Route: `/parent/homework` - Main homework page with sections
- Components:
  - `ActiveAssignments.tsx` - Active assignments list with filters
  - `UpcomingDeadlines.tsx` - Upcoming deadlines with priority indicators
  - `CompletedAssignments.tsx` - Completed assignments with pagination
  - `GradesReceived.tsx` - Grades list with filters and statistics
  - `CourseMaterials.tsx` - Course materials list with download capability

### Decision 9: Priority Calculation

**Decision**: Calculate priority based on days remaining until deadline: high (<3 days), medium (3-7 days), low (>7 days).

**Rationale**:
- 3-day threshold for high priority matches common urgency perception
- 7-day threshold for medium priority provides reasonable buffer
- Priority indicators help parents focus on urgent assignments
- Matches existing priority calculation patterns

**Alternatives Considered**:
- 1-day threshold for high priority: Rejected - too short, doesn't allow planning
- 5-day threshold for high priority: Rejected - too long, reduces urgency
- No priority indicators: Rejected - priority helps parents focus

**Implementation Notes**:
- Calculate days remaining: `EXTRACT(DAY FROM (ends_at - NOW()))`
- Assign priority:
  - High: `days_remaining <= 3`
  - Medium: `3 < days_remaining <= 7`
  - Low: `days_remaining > 7`
- Display priority with visual indicators (badges, colors)

### Decision 10: Data Access Control

**Decision**: Enforce parent-child relationship check at API level using RLS and query filters, verify child enrollment for assignments and materials.

**Rationale**:
- Specification requires: "Parents can only access information for children explicitly linked to their account"
- Existing RLS policies on `student_parents` provide database-level security
- Additional application-level check ensures correctness
- Enrollment verification ensures parents only see assignments for enrolled classes

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security
- No enrollment check: Rejected - security risk, parents could see assignments for unenrolled classes

**Implementation Notes**:
- Query filter: `WHERE student_parents.parent_id = $authenticated_user_id`
- Verify relationship exists before returning assignment data
- Verify child enrollment in class before showing assignments
- Verify child enrollment in course before showing materials
- Return 403 Forbidden if parent tries to access unlinked child or unenrolled class/course
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `student_parents` table with RLS policies
- `student_profiles` table with student status
- `student_enrollments` table for class enrollment
- `assignment_instances` table for assignment scheduling
- `assignments` table for assignment definitions
- `assignment_submissions` table for submissions and grades
- `course_materials` table for course materials
- `courses` table for course information
- `classes` table for class information
- `class_courses` table for course-class relationships

### No New Dependencies Required
- All required database tables and relationships already exist
- Existing authentication and tenant context plugins can be reused
- No new external services or libraries needed

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from `student-assignments.ts`, `student-grades.ts`
- Follow existing error handling and response patterns
- Reuse existing material download patterns from `materials.ts`

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from `use-parent-children.ts`
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent/student pages
- Use existing authentication session handling
- Reuse existing filter and pagination patterns

## Performance Considerations

### Database Queries
- Use existing indexes on `student_parents(parent_id)`, `student_enrollments(student_id)`, `assignment_instances(class_id, ends_at)`, `assignment_submissions(student_id, assignment_id)`, `course_materials(course_id)`
- Pagination for completed assignments (20 per page) prevents large result sets
- Date range filters for upcoming deadlines use indexed columns
- Join optimization: use appropriate join order and indexes

### Caching Strategy
- Use TanStack Query with 2-minute stale time for active assignments (frequent updates)
- Cache upcoming deadlines with 5-minute stale time (less frequent updates)
- Cache completed assignments with 5-minute stale time (historical data)
- Cache grades with 5-minute stale time (less frequent updates)
- Cache course materials with 10-minute stale time (rarely changes)

## Security Considerations

### Access Control
- All queries filtered by parent-child relationship via `student_parents` table
- All queries filtered by child enrollment via `student_enrollments` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship and child enrollment before returning data
- No direct database access from frontend

### Data Privacy
- Only return data for children linked to authenticated parent
- Only return assignments for classes where child is enrolled
- Only return materials for courses where child is enrolled
- No PII exposure beyond what's required for feature
- Respect child status (but show all children as per specification)

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid parent-child relationships
- Test access control (403 for unlinked children, unenrolled classes)
- Test pagination for completed assignments
- Test filtering for all endpoints (child, course, date range)
- Test priority calculation for upcoming deadlines
- Test material download access control

### Integration Tests
- Test parent can view all active assignments for their children
- Test upcoming deadlines calculation and priority assignment
- Test completed assignments pagination and filtering
- Test grades statistics calculation accuracy
- Test course materials access for enrolled courses only

### E2E Tests
- Test parent login and navigation to homework page
- Test viewing active assignments with filters
- Test viewing upcoming deadlines with priority indicators
- Test viewing completed assignments with pagination
- Test viewing grades with filters and statistics
- Test accessing and downloading course materials

