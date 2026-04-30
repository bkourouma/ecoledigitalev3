# Research: Parent Grades & Evaluations Feature

**Date**: 2025-01-27  
**Feature**: Parent Grades & Evaluations (`008-parent-grades`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent grades and evaluations feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `student_parents` table relationships and `assignment_submissions` to query graded assignments for children linked to authenticated parent user.

**Rationale**: 
- The `student_parents` table already exists with proper RLS policies
- Provides parent-child relationship data with appropriate access control
- `assignment_submissions` table contains graded assignments with `final_score` or `manual_score`
- Supports multiple relationship types (parent, guardian, emergency_contact)

**Alternatives Considered**:
- Creating a new parent-grades view: Rejected - unnecessary duplication
- Direct queries to `assignment_submissions`: Rejected - lacks relationship context and access control

**Implementation Notes**:
- Query joins `student_parents` with `student_profiles` to get linked children
- Join `assignment_submissions` with `assignments` and `courses` to get grade data
- Filter by `parent_id` matching authenticated user ID
- Only include graded assignments (`final_score IS NOT NULL OR manual_score IS NOT NULL`)

### Decision 2: Grade Calculations

**Decision**: Calculate averages, percentages, and distributions from graded assignments using existing grade values and max points.

**Rationale**:
- Existing `assignment_submissions` table contains `final_score`, `manual_score`, and max points information
- Grade calculation patterns already established in `student-grades.ts` routes
- Can reuse existing calculation logic for consistency

**Alternatives Considered**:
- Creating new grade calculation service: Rejected - would duplicate existing logic
- Direct database aggregation: Rejected - better to reuse existing validated patterns

**Implementation Notes**:
- Calculate percentage: `(grade / max_points) * 100`
- Calculate course average: sum of grades / count of graded assignments
- Calculate overall average: sum of all grades / count of all graded assignments
- Grade distribution: categorize grades (excellent ≥16, good 14-15, average 12-13, below average <12) based on 0-20 scale

### Decision 3: Grade Trends Visualization

**Decision**: Use Chart.js or Recharts library for grade trends visualization (line or bar chart).

**Rationale**:
- Specification requires visual chart for grade trends
- Chart.js is lightweight and widely used in React applications
- Recharts is React-native and integrates well with Next.js
- Both support time-series data visualization

**Alternatives Considered**:
- Custom chart implementation: Rejected - would require significant development time
- Table-based trends: Rejected - specification explicitly requires visual chart
- D3.js: Rejected - too complex for this use case

**Implementation Notes**:
- Install charting library (Chart.js or Recharts) in `apps/web`
- Create `GradeTrends` component with chart visualization
- Group grades by time period (week, month, or semester)
- Support filtering by child, course, date range, or semester

### Decision 4: Grades by Course Organization

**Decision**: Group graded assignments by course and calculate course-level statistics.

**Rationale**:
- Specification requires grades organized by course
- Parents need to understand performance by subject area
- Course-level aggregation provides valuable insights

**Alternatives Considered**:
- Flat list of all grades: Rejected - does not meet specification requirement for course organization
- Only overall averages: Rejected - specification requires both course-level and overall views

**Implementation Notes**:
- Group graded assignments by `course_id`
- Calculate course average: sum of grades in course / count of graded assignments in course
- Display course name, course code, list of assignment grades, course average, total graded assignments
- Support filtering by child

### Decision 5: API Endpoint Structure

**Decision**: Create `/api/v1/parent/grades` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`)
- Provides clear namespace for parent-specific grades endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/homework/grades`: Rejected - grades feature is separate from homework feature
- Create `/api/v1/parent/children/:childId/grades`: Rejected - would require child selection first, limiting flexibility

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/grades/assignments` - List all graded assignments (filterable by child, course, date range)
  - `GET /api/v1/parent/grades/by-course` - Get grades organized by course (filterable by child)
  - `GET /api/v1/parent/grades/averages` - Get overall averages and statistics (filterable by child, date range, semester)
  - `GET /api/v1/parent/grades/trends` - Get grade trends data for chart (filterable by child, course, date range, semester)

### Decision 6: Frontend Route Structure

**Decision**: Create `/parent/grades` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for grades functionality

**Alternatives Considered**:
- Add to existing `/parent/homework` page: Rejected - grades feature is separate from homework feature
- Nested under `/parent/children/:childId/grades`: Rejected - would require child selection first, limiting flexibility

**Implementation Notes**:
- Routes:
  - `/parent/grades` - Main grades page with tabs/sections for different views
- Components:
  - `AssignmentGrades.tsx` - List of graded assignments with filters
  - `GradesByCourse.tsx` - Grades organized by course
  - `OverallAverages.tsx` - Overall averages and statistics
  - `GradeTrends.tsx` - Grade trends chart

### Decision 7: Data Access Control

**Decision**: Enforce parent-child relationship check at API level using RLS and query filters.

**Rationale**:
- Specification requires: "Parents can only access grade information for children explicitly linked to their account"
- Existing RLS policies on `student_parents` provide database-level security
- Additional application-level check ensures correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: `WHERE student_parents.parent_id = $authenticated_user_id`
- Verify relationship exists before returning grade data
- Return 403 Forbidden if parent tries to access unlinked child's grades
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `student_parents` table with RLS policies
- `student_profiles` table with student information
- `assignment_submissions` table for graded assignments
- `assignments` table for assignment information
- `courses` table for course information

### New Dependencies
- Chart.js or Recharts library for grade trends visualization (to be added to `apps/web`)

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from `parent-homework.ts`, `student-grades.ts`
- Follow existing error handling and response patterns

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from `use-parent-homework.ts`
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling

## Performance Considerations

### Database Queries
- Use existing indexes on `student_parents(parent_id)`, `assignment_submissions(student_id)`, `assignment_submissions(assignment_id)`
- Pagination for assignment grades (20 per page) prevents large result sets
- Grade trends queries use date range filters for efficiency
- Course grouping uses SQL GROUP BY for efficient aggregation

### Caching Strategy
- Use TanStack Query with 5-minute stale time for grades data (similar to existing parent hooks)
- Cache overall averages with shorter stale time (2 minutes) for freshness
- Grade trends not cached due to time-based filtering requirements

## Security Considerations

### Access Control
- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- No direct database access from frontend

### Data Privacy
- Only return grade data for children linked to authenticated parent
- No PII exposure beyond what's required for feature
- Grade data includes only graded assignments (not pending or unsubmitted)

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid parent-child relationships
- Test access control (403 for unlinked children)
- Test grade calculations accuracy (averages, percentages, distributions)
- Test filtering by child, course, date range, semester

### Integration Tests
- Test parent can view all their linked children's grades
- Test grade calculations accuracy (course averages, overall averages)
- Test grade trends data generation
- Test filtering and aggregation

### E2E Tests
- Test parent login and navigation to grades page
- Test viewing assignment grades with filters
- Test viewing grades by course
- Test viewing overall averages
- Test viewing grade trends chart

