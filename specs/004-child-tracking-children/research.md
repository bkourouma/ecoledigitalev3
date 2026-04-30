# Research: Child Tracking Feature

**Date**: 2025-01-27  
**Feature**: Child Tracking (`004-child-tracking-children`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent child tracking feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `student_parents` table relationships to query children linked to authenticated parent user.

**Rationale**: 
- The `student_parents` table already exists with proper RLS policies
- Provides parent-child relationship data with appropriate access control
- Supports multiple relationship types (parent, guardian, emergency_contact)

**Alternatives Considered**:
- Creating a new parent-child view: Rejected - unnecessary duplication
- Direct queries to `student_profiles`: Rejected - lacks relationship context and access control

**Implementation Notes**:
- Query joins `student_parents` with `student_profiles` and `users` to get complete child information
- Filter by `parent_id` matching authenticated user ID
- Include child status (active, suspended, dropped, transfer) in results as per specification

### Decision 2: Grades Summary Calculation

**Decision**: Reuse existing `student_grades` endpoint pattern with modifications for all-time aggregation.

**Rationale**:
- Existing `/api/v1/student/grades` endpoint already provides grade aggregation logic
- Statistics calculation pattern (average, distribution, best score) is already established
- Can extend to support parent context by filtering via parent-child relationships

**Alternatives Considered**:
- Creating new grades summary service: Rejected - would duplicate existing logic
- Direct database aggregation: Rejected - better to reuse existing validated patterns

**Implementation Notes**:
- Query grades via `assignment_submissions` table joined with student profiles
- Filter by student IDs linked to parent via `student_parents`
- Calculate all-time statistics (average, total assignments, graded count, best score, distribution)
- Support all child statuses (active, suspended, dropped, transfer)

### Decision 3: Schedule Data Retrieval

**Decision**: Use existing `session_instances` queries filtered by student class enrollment.

**Rationale**:
- `session_instances` table already contains scheduled class data
- Existing `getScheduleCalendar` pattern in `SchedulePersistenceService` can be adapted
- Need to filter by student's class enrollment via `inscriptions` table

**Alternatives Considered**:
- Creating new schedule view: Rejected - would duplicate `session_instances` data
- Direct class-based queries: Rejected - need student-specific filtering for access control

**Implementation Notes**:
- Join `session_instances` with `inscriptions` to get student's enrolled classes
- Filter by student ID linked to parent
- Support weekly view navigation (previous/next week)
- Include upcoming classes filter (next 7 days, max 10 classes)

### Decision 4: Attendance Records Pagination

**Decision**: Implement pagination with 20 records per page, reverse chronological order.

**Rationale**:
- Specification clarifies: "All attendance records with pagination (e.g., 20 per page)"
- Existing attendance query patterns in `attendance.ts` routes can be extended
- Reverse chronological order (most recent first) matches user expectations

**Alternatives Considered**:
- Fixed limit without pagination: Rejected - would not scale for children with many records
- Time-based filtering by default: Rejected - specification requires all records with pagination

**Implementation Notes**:
- Query `student_attendance` table filtered by student ID
- Order by `marked_at DESC` (most recent first)
- Implement offset-based pagination (limit 20, offset calculated from page number)
- Include all attendance statuses (present, absent, late, excused, medical leave)

### Decision 5: API Endpoint Structure

**Decision**: Create `/api/v1/parent/children` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/student/*`, `/api/v1/teacher/*`)
- Provides clear namespace for parent-specific endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/students` routes: Rejected - would mix parent and admin views
- Create `/api/v1/parents` routes: Rejected - focuses on parent entity, not children tracking

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/children` - List all children linked to parent
  - `GET /api/v1/parent/children/:childId` - Get child details
  - `GET /api/v1/parent/children/:childId/grades-summary` - Get grades summary
  - `GET /api/v1/parent/children/:childId/schedule` - Get weekly schedule
  - `GET /api/v1/parent/children/:childId/upcoming-classes` - Get upcoming classes
  - `GET /api/v1/parent/children/:childId/attendance` - Get attendance records (paginated)
  - `GET /api/v1/parent/children/:childId/absence-history` - Get absence history with filters

### Decision 6: Frontend Route Structure

**Decision**: Create `/parent/children` route group in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Supports nested routes for child detail pages

**Alternatives Considered**:
- Flat route structure: Rejected - would not scale well with child-specific pages
- Separate parent module: Rejected - over-engineering for current scope

**Implementation Notes**:
- Routes:
  - `/parent/children` - Children list page
  - `/parent/children/[childId]` - Child detail page (grades, schedule, attendance tabs)
  - `/parent/children/[childId]/schedule` - Schedule page (weekly view)
- Components:
  - `ChildrenList.tsx` - List of children with status indicators
  - `ChildGradesSummary.tsx` - Grades summary display
  - `ChildSchedule.tsx` - Weekly schedule view
  - `UpcomingClasses.tsx` - Upcoming classes list
  - `AttendanceRecords.tsx` - Attendance records with pagination
  - `AbsenceHistory.tsx` - Absence history with filters

### Decision 7: Data Access Control

**Decision**: Enforce parent-child relationship check at API level using RLS and query filters.

**Rationale**:
- Specification requires: "Parents can only access information for children explicitly linked to their account"
- Existing RLS policies on `student_parents` provide database-level security
- Additional application-level check ensures correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: `WHERE student_parents.parent_id = $authenticated_user_id`
- Verify relationship exists before returning child data
- Return 403 Forbidden if parent tries to access unlinked child
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `student_parents` table with RLS policies
- `student_profiles` table with student status
- `assignment_submissions` table for grades
- `session_instances` table for schedules
- `student_attendance` table for attendance records
- `inscriptions` table for class enrollment

### No New Dependencies Required
- All required database tables and relationships already exist
- Existing authentication and tenant context plugins can be reused
- No new external services or libraries needed

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from `students.ts`, `student-grades.ts`, `attendance.ts`
- Follow existing error handling and response patterns

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from `use-student-data.ts`
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from student/teacher pages
- Use existing authentication session handling

## Performance Considerations

### Database Queries
- Use existing indexes on `student_parents(parent_id)`, `student_profiles(id)`, `student_attendance(student_id)`
- Pagination for attendance records (20 per page) prevents large result sets
- Weekly schedule queries use date range filters for efficiency

### Caching Strategy
- Use TanStack Query with 5-minute stale time for grades summary (similar to existing student hooks)
- Cache children list with shorter stale time (1 minute) for freshness
- Attendance records not cached due to frequent updates

## Security Considerations

### Access Control
- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- No direct database access from frontend

### Data Privacy
- Only return data for children linked to authenticated parent
- No PII exposure beyond what's required for feature
- Respect child status (but show all children as per specification)

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid parent-child relationships
- Test access control (403 for unlinked children)
- Test pagination for attendance records
- Test filtering for absence history

### Integration Tests
- Test parent can view all their linked children
- Test grades summary calculations accuracy
- Test schedule retrieval for enrolled classes
- Test attendance records pagination

### E2E Tests
- Test parent login and navigation to children list
- Test viewing child grades summary
- Test viewing child weekly schedule
- Test viewing attendance records with pagination
- Test absence history filtering

