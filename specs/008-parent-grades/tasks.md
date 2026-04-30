# Tasks: Parent Grades & Evaluations

**Input**: Design documents from `/specs/008-parent-grades/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included as per Constitution Check requirement (Test-First: Commit contract tests and E2E before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create parent-grades route file structure in `apps/api/src/routes/parent-grades.ts`
- [X] T002 [P] Create parent grades TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `ParentGrade`, `ParentGradeList`, `CourseGradeSummary`, `OverallGradeStatistics`, `GradeTrendData`, `GradeFilter`
- [X] T003 [P] Create parent grades components directory structure `apps/web/src/app/parent/components/grades/`
- [X] T004 [P] Create parent grades pages directory structure `apps/web/src/app/parent/grades/`
- [X] T005 [P] Create parent grades hooks file `apps/web/src/lib/hooks/use-parent-grades.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentChildRelationshipForGrades` in `apps/api/src/routes/parent-grades.ts` that checks `student_parents` table and verifies child is linked to parent
- [X] T007 Register parent-grades routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/grades` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentGrades` in `apps/web/src/lib/hooks/use-parent-grades.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Assignment Grades (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view all graded assignments for their children with detailed information

**Independent Test**: Log in as a parent user, navigate to `/parent/grades` route, and verify all graded assignments for linked children are displayed with assignment name, course name, child name, grade value, percentage, and submission date. Test with multiple children, single child, filtering by child/course/date range, and no graded assignments scenarios.

### Tests for User Story 1

- [X] T009 [P] [US1] Contract test for `GET /api/v1/parent/grades/assignments` in `tests/contract/parent-grades.test.ts` - test filtering by child, course, date range, pagination, access control
- [X] T010 [P] [US1] Integration test for assignment grades filtering in `tests/integration/parent-assignment-grades.test.ts` - verify filter combinations, child relationship verification, grade calculations
- [X] T011 [P] [US1] E2E test for assignment grades display in `tests/e2e/parent-grades.spec.ts` - test assignment grades page, filter application, child selection, pagination

### Implementation for User Story 1

- [X] T012 [US1] Implement `GET /api/v1/parent/grades/assignments` endpoint in `apps/api/src/routes/parent-grades.ts` - query `assignment_submissions` joined with `assignments` and `courses` for graded assignments (`final_score IS NOT NULL OR manual_score IS NOT NULL`), filter by child_id, course_id, date range, verify parent-child relationship, calculate percentage, support pagination (page, limit)
- [X] T013 [P] [US1] Create `useAssignmentGrades(childId, filters, page)` hook in `apps/web/src/lib/hooks/use-parent-grades.ts` - fetch assignment grades with filters, handle filter parameters (child_id, course_id, startDate, endDate), handle pagination
- [X] T014 [P] [US1] Implement `AssignmentGrades` component in `apps/web/src/app/parent/components/grades/AssignmentGrades.tsx` - display list of graded assignments, show assignment name, course name, child name, grade value, percentage, submission date, grading date, feedback, add filter controls (child, course, date range), handle empty state, handle pagination
- [X] T015 [US1] Implement grades page in `apps/web/src/app/parent/grades/page.tsx` - use `AssignmentGrades` component, add filter controls (child selector, course selector, date range picker), fetch data via hook

**Checkpoint**: Parents can now view graded assignments for their children

---

## Phase 4: User Story 2 - View Grades by Course (Priority: P1)

**Goal**: Enable parents to view grades organized by course with course-level statistics

**Independent Test**: Navigate to grades by course view. Verify grades are grouped by course, show course name, course code, child name, list of assignment grades, course average, and total graded assignments. Test filtering by child.

### Tests for User Story 2

- [X] T016 [P] [US2] Contract test for `GET /api/v1/parent/grades/by-course` in `tests/contract/parent-grades.test.ts` - test course grouping, course average calculation, filtering by child, access control
- [X] T017 [P] [US2] Integration test for grades by course in `tests/integration/parent-grades-by-course.test.ts` - verify course grouping, course average calculation accuracy
- [X] T018 [P] [US2] E2E test for grades by course display in `tests/e2e/parent-grades.spec.ts` - test grades by course view, course grouping, course average display, child filtering

### Implementation for User Story 2

- [X] T019 [US2] Implement `GET /api/v1/parent/grades/by-course` endpoint in `apps/api/src/routes/parent-grades.ts` - query `assignment_submissions` grouped by `course_id`, join with `courses` and `student_profiles`, calculate course average (sum of grades / count of graded assignments), filter by child_id, verify parent-child relationship, return course name, course code, child name, list of assignment grades, course average, total graded assignments
- [X] T020 [P] [US2] Create `useGradesByCourse(childId)` hook in `apps/web/src/lib/hooks/use-parent-grades.ts` - fetch grades organized by course with optional child filter
- [X] T021 [P] [US2] Implement `GradesByCourse` component in `apps/web/src/app/parent/components/grades/GradesByCourse.tsx` - display grades grouped by course, show course name, course code, child name, list of assignment grades with grades and percentages, course average, total graded assignments, add child filter control, handle empty state
- [X] T022 [US2] Add grades by course section to grades page in `apps/web/src/app/parent/grades/page.tsx` - integrate `GradesByCourse` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view grades organized by course

---

## Phase 5: User Story 3 - View Overall Averages (Priority: P2)

**Goal**: Enable parents to view overall grade averages and statistics for their children

**Independent Test**: Navigate to overall averages section. Verify overall average grade, total graded assignments, grade distribution (excellent, good, average, below average), best score, and worst score are displayed. Test filtering by child, date range, or semester.

### Tests for User Story 3

- [X] T023 [P] [US3] Contract test for `GET /api/v1/parent/grades/averages` in `tests/contract/parent-grades.test.ts` - test statistics calculation, filtering by child, date range, semester, access control
- [X] T024 [P] [US3] Integration test for overall averages in `tests/integration/parent-overall-averages.test.ts` - verify statistics calculation accuracy (average, distribution, best/worst scores)
- [X] T025 [P] [US3] E2E test for overall averages display in `tests/e2e/parent-grades.spec.ts` - test overall averages section, statistics display, filter application

### Implementation for User Story 3

- [X] T026 [US3] Implement `GET /api/v1/parent/grades/averages` endpoint in `apps/api/src/routes/parent-grades.ts` - query `assignment_submissions` for graded assignments, calculate overall average (sum of all grades / count of all graded assignments), calculate grade distribution (excellent ≥16, good 14-15, average 12-13, below average <12), calculate best score and worst score, filter by child_id, date range, semester, verify parent-child relationship
- [X] T027 [P] [US3] Create `useOverallAverages(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-grades.ts` - fetch overall averages with filters (child_id, startDate, endDate, semester)
- [X] T028 [P] [US3] Implement `OverallAverages` component in `apps/web/src/app/parent/components/grades/OverallAverages.tsx` - display overall average grade, total graded assignments, grade distribution (excellent, good, average, below average) with counts, best score, worst score, add filter controls (child, date range, semester), handle empty state
- [X] T029 [US3] Add overall averages section to grades page in `apps/web/src/app/parent/grades/page.tsx` - integrate `OverallAverages` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view overall grade averages and statistics

---

## Phase 6: User Story 4 - View Grade Trends (Priority: P2)

**Goal**: Enable parents to view grade trends showing how their children's grades have changed over time

**Independent Test**: Navigate to grade trends section. Verify visual chart (line or bar chart) displays grade progression over time. Test filtering by child, course, date range, or semester. Test with different time periods (week, month, semester).

### Tests for User Story 4

- [X] T030 [P] [US4] Contract test for `GET /api/v1/parent/grades/trends` in `tests/contract/parent-grades.test.ts` - test trend data generation, filtering by child, course, date range, semester, time period grouping, access control
- [X] T031 [P] [US4] Integration test for grade trends in `tests/integration/parent-grade-trends.test.ts` - verify trend data calculation, time period grouping accuracy
- [X] T032 [P] [US4] E2E test for grade trends display in `tests/e2e/parent-grades.spec.ts` - test grade trends section, chart rendering, filter application, time period selection

### Implementation for User Story 4

- [X] T033 [US4] Implement `GET /api/v1/parent/grades/trends` endpoint in `apps/api/src/routes/parent-grades.ts` - query `assignment_submissions` for graded assignments, group by time period (week, month, or semester) using `DATE_TRUNC`, calculate average grade per time period, filter by child_id, course_id, date range, semester, verify parent-child relationship, return trend data with period_start, period_end, period_label, average_grade, grade_count
- [X] T034 [P] [US4] Install charting library (Chart.js or Recharts) in `apps/web` package.json
- [X] T035 [P] [US4] Create `useGradeTrends(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-grades.ts` - fetch grade trends data with filters (child_id, course_id, startDate, endDate, semester, period)
- [X] T036 [P] [US4] Implement `GradeTrends` component in `apps/web/src/app/parent/components/grades/GradeTrends.tsx` - display visual chart (line or bar chart) showing grade progression over time, use Chart.js or Recharts library, show time periods on x-axis, grade values on y-axis, add filter controls (child, course, date range, semester, time period), handle empty state (insufficient data)
- [X] T037 [US4] Add grade trends section to grades page in `apps/web/src/app/parent/grades/page.tsx` - integrate `GradeTrends` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view grade trends showing progression over time

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [X] T038 [P] Add error handling and error states to all grade components (network errors, empty states, loading states)
- [X] T039 [P] Add loading skeletons to all grade components for better UX
- [X] T040 [P] Add responsive design for grades page (mobile, tablet, desktop)
- [X] T041 [P] Add accessibility features (ARIA labels, keyboard navigation) to all grade components
- [ ] T042 [P] Add unit tests for grade calculation utilities (averages, percentages, distributions)
- [X] T043 [P] Add performance optimizations (memoization, query optimization) for large grade datasets
- [X] T044 [P] Add logging and error tracking for grade API endpoints

**Checkpoint**: Feature complete and polished

---

## Dependencies & Execution Order

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- User Stories 1, 2, 3, and 4 can run in parallel (no dependencies between them)
- All Polish tasks marked [P] can run in parallel

---

## Notes

- All endpoints must verify parent-child relationship before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Only graded assignments (`final_score IS NOT NULL OR manual_score IS NOT NULL`) should be returned
- Grade calculations must be accurate (averages, percentages, distributions)
- Frontend components should support filtering by child (if parent has multiple children)
- Pagination should be implemented for large lists (20 items per page default)
- All date/time calculations should account for timezone
- Grade trends chart should handle empty states gracefully (insufficient data)
- Course averages should be calculated correctly based on all graded assignments in that course

