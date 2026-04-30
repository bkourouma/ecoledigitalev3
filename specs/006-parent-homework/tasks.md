# Tasks: Parent Homework & Courses Tracking

**Input**: Design documents from `/specs/006-parent-homework/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included as per Constitution Check requirement (Test-First: Commit contract tests and E2E before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create parent-homework route file structure in `apps/api/src/routes/parent-homework.ts`
- [ ] T002 [P] Create parent homework TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `ParentAssignment`, `ParentAssignmentList`, `CourseMaterial`, `AssignmentStatus`, `AssignmentFilter`
- [ ] T003 [P] Create parent homework components directory structure `apps/web/src/app/parent/components/homework/`
- [ ] T004 [P] Create parent homework pages directory structure `apps/web/src/app/parent/homework/`
- [ ] T005 [P] Create parent homework hooks file `apps/web/src/lib/hooks/use-parent-homework.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Create shared access control utility function `verifyParentChildRelationshipForAssignment` in `apps/api/src/routes/parent-homework.ts` that checks `student_parents` table and verifies child is enrolled in the assignment's class
- [ ] T007 Register parent-homework routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/homework` and ensure auth middleware is applied
- [ ] T008 [P] Create base React hook `useParentHomework` in `apps/web/src/lib/hooks/use-parent-homework.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Active Assignments (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view all active assignments for their children with upcoming deadlines

**Independent Test**: Log in as a parent user, navigate to `/parent/homework` route, and verify all active assignments for linked children are displayed with assignment title, course name, deadline, and status. Test with multiple children, single child, and no active assignments scenarios.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/homework/assignments/active` in `tests/contract/parent-homework.test.ts` - test filtering by child, course, status, access control
- [ ] T010 [P] [US1] Integration test for active assignments filtering in `tests/integration/parent-active-assignments.test.ts` - verify filter combinations, child relationship verification
- [ ] T011 [P] [US1] E2E test for active assignments display in `tests/e2e/parent-homework.spec.ts` - test active assignments page, filter application, child selection

### Implementation for User Story 1

- [ ] T012 [US1] Implement `GET /api/v1/parent/homework/assignments/active` endpoint in `apps/api/src/routes/parent-homework.ts` - query `assignment_instances` joined with `assignments`, `courses`, `student_enrollments` to get active assignments for parent's children, filter by `ends_at > NOW()`, verify parent-child relationship, support filtering by child_id, course_id
- [ ] T013 [P] [US1] Create `useActiveAssignments(filters)` hook in `apps/web/src/lib/hooks/use-parent-homework.ts` - fetch active assignments with filters, handle filter parameters (child_id, course_id, status)
- [ ] T014 [P] [US1] Implement `ActiveAssignments` component in `apps/web/src/app/parent/components/homework/ActiveAssignments.tsx` - display list of active assignments, show assignment title, course name, deadline countdown, child name, status badge, handle empty state
- [ ] T015 [US1] Implement homework page in `apps/web/src/app/parent/homework/page.tsx` - use `ActiveAssignments` component, add filter controls (child selector, course selector), fetch data via hook

**Checkpoint**: Parents can now view active assignments for their children

---

## Phase 4: User Story 2 - View Upcoming Deadlines (Priority: P1)

**Goal**: Enable parents to see upcoming assignment deadlines with priority indicators

**Independent Test**: View upcoming deadlines section on homework page. Verify assignments are sorted by deadline (soonest first), show days remaining, highlight urgent deadlines (within 3 days), and display deadline countdown.

### Tests for User Story 2

- [ ] T016 [P] [US2] Contract test for `GET /api/v1/parent/homework/assignments/upcoming-deadlines` in `tests/contract/parent-homework.test.ts` - test deadline sorting, priority calculation, access control
- [ ] T017 [P] [US2] Integration test for upcoming deadlines in `tests/integration/parent-upcoming-deadlines.test.ts` - verify deadline calculation, priority assignment
- [ ] T018 [P] [US2] E2E test for upcoming deadlines display in `tests/e2e/parent-homework.spec.ts` - test upcoming deadlines section, deadline countdown, priority indicators

### Implementation for User Story 2

- [x] T019 [US2] Implement `GET /api/v1/parent/homework/assignments/upcoming-deadlines` endpoint in `apps/api/src/routes/parent-homework.ts` - query active assignments filtered by `ends_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'`, order by `ends_at ASC`, calculate days remaining, assign priority (high: <3 days, medium: 3-7 days, low: >7 days), verify parent-child relationship
- [x] T020 [P] [US2] Create `useUpcomingDeadlines(childId?)` hook in `apps/web/src/lib/hooks/use-parent-homework.ts` - fetch upcoming deadlines with optional child filter, handle deadline calculation
- [x] T021 [P] [US2] Implement `UpcomingDeadlines` component in `apps/web/src/app/parent/components/homework/UpcomingDeadlines.tsx` - display upcoming deadlines list, show days remaining, priority badges, deadline countdown, handle empty state
- [x] T022 [US2] Add upcoming deadlines section to homework page in `apps/web/src/app/parent/homework/page.tsx` - integrate `UpcomingDeadlines` component, fetch data via hook

**Checkpoint**: Parents can now see upcoming deadlines with priority indicators

---

## Phase 5: User Story 3 - View Completed Assignments (Priority: P2)

**Goal**: Enable parents to view completed assignments for their children with submission status and grades

**Independent Test**: View completed assignments section. Verify completed assignments are displayed with submission date, grade (if available), feedback, and course information. Test filtering by child and course.

### Tests for User Story 3

- [x] T023 [P] [US3] Contract test for `GET /api/v1/parent/homework/assignments/completed` in `tests/contract/parent-homework.test.ts` - test filtering, pagination, access control
- [x] T024 [P] [US3] Integration test for completed assignments in `tests/integration/parent-completed-assignments.test.ts` - verify submission status, grade display
- [x] T025 [P] [US3] E2E test for completed assignments display in `tests/e2e/parent-homework.spec.ts` - test completed assignments section, grade display, feedback viewing

### Implementation for User Story 3

- [x] T026 [US3] Implement `GET /api/v1/parent/homework/assignments/completed` endpoint in `apps/api/src/routes/parent-homework.ts` - query `assignment_instances` joined with `assignment_submissions` for completed assignments (`submitted_at IS NOT NULL` or `ends_at < NOW()`), paginate (20 per page), order by `submitted_at DESC` or `ends_at DESC`, include grade and feedback, verify parent-child relationship
- [x] T027 [P] [US3] Create `useCompletedAssignments(childId, page, filters)` hook in `apps/web/src/lib/hooks/use-parent-homework.ts` - fetch completed assignments with pagination, handle filter parameters
- [x] T028 [P] [US3] Implement `CompletedAssignments` component in `apps/web/src/app/parent/components/homework/CompletedAssignments.tsx` - display paginated completed assignments, show submission date, grade, feedback, course name, add pagination controls, handle empty state
- [x] T029 [US3] Add completed assignments section to homework page in `apps/web/src/app/parent/homework/page.tsx` - integrate `CompletedAssignments` component, fetch data via hook

**Checkpoint**: Parents can now view completed assignments with grades and feedback

---

## Phase 6: User Story 4 - View Grades Received (Priority: P2)

**Goal**: Enable parents to view all grades received by their children for assignments with detailed breakdown

**Independent Test**: View grades section. Verify grades are displayed with assignment name, course, grade value, max points, percentage, submission date, and feedback. Test filtering by child, course, and date range.

### Tests for User Story 4

- [x] T030 [P] [US4] Contract test for `GET /api/v1/parent/homework/grades` in `tests/contract/parent-homework.test.ts` - test filtering, statistics calculation, access control
- [x] T031 [P] [US4] Integration test for grades display in `tests/integration/parent-grades.test.ts` - verify grade calculation, statistics accuracy
- [x] T032 [P] [US4] E2E test for grades display in `tests/e2e/parent-homework.spec.ts` - test grades section, filter application, statistics display

### Implementation for User Story 4

- [x] T033 [US4] Implement `GET /api/v1/parent/homework/grades` endpoint in `apps/api/src/routes/parent-homework.ts` - query `assignment_submissions` joined with `assignments` and `courses` for graded assignments (`final_score IS NOT NULL OR manual_score IS NOT NULL`), filter by child_id, course_id, date range, calculate statistics (average, total graded, grade distribution), verify parent-child relationship
- [x] T034 [P] [US4] Create `useParentGrades(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-homework.ts` - fetch grades with filters, handle filter parameters
- [x] T035 [P] [US4] Implement `GradesReceived` component in `apps/web/src/app/parent/components/homework/GradesReceived.tsx` - display grades list, show assignment name, course, grade value, percentage, submission date, feedback, add filter controls (child, course, date range), display statistics, handle empty state
- [x] T036 [US4] Add grades section to homework page in `apps/web/src/app/parent/homework/page.tsx` - integrate `GradesReceived` component, fetch data via hook

**Checkpoint**: Parents can now view all grades received by their children

---

## Phase 7: User Story 5 - Access Course Materials (Priority: P3)

**Goal**: Enable parents to access course materials (documents, resources) for their children's courses

**Independent Test**: View course materials section. Verify materials are displayed with material name, course, upload date, file type, and download capability. Test filtering by child and course.

### Tests for User Story 5

- [x] T037 [P] [US5] Contract test for `GET /api/v1/parent/homework/course-materials` in `tests/contract/parent-homework.test.ts` - test filtering, access control, material access verification
- [ ] T038 [P] [US5] Integration test for course materials access in `tests/integration/parent-course-materials.test.ts` - verify material access, download functionality
- [ ] T039 [P] [US5] E2E test for course materials display in `tests/e2e/parent-homework.spec.ts` - test course materials section, material download, filter application

### Implementation for User Story 5

- [x] T040 [US5] Implement `GET /api/v1/parent/homework/course-materials` endpoint in `apps/api/src/routes/parent-homework.ts` - query `course_materials` joined with `courses` and `student_enrollments` to get materials for parent's children's courses, filter by child_id, course_id, verify parent-child relationship and child enrollment in course
- [x] T041 [P] [US5] Create `useCourseMaterials(childId, courseId?)` hook in `apps/web/src/lib/hooks/use-parent-homework.ts` - fetch course materials with optional filters, handle material access
- [x] T042 [P] [US5] Implement `CourseMaterials` component in `apps/web/src/app/parent/components/homework/CourseMaterials.tsx` - display course materials list, show material name, course, upload date, file type icon, download button, add filter controls (child, course), handle empty state
- [x] T043 [US5] Implement `GET /api/v1/parent/homework/course-materials/:materialId/download` endpoint in `apps/api/src/routes/parent-homework.ts` - verify parent-child relationship and material access, return material file
- [x] T044 [US5] Add course materials section to homework page in `apps/web/src/app/parent/homework/page.tsx` - integrate `CourseMaterials` component, fetch data via hook

**Checkpoint**: Parents can now access course materials for their children's courses

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T045 [P] Add loading states and error handling to all parent homework components
- [X] T046 [P] Add empty states with appropriate messaging to all parent homework components
- [X] T047 [P] Add responsive design and mobile optimization for parent homework pages
- [X] T048 [P] Add accessibility features (ARIA labels, keyboard navigation) to parent homework components
- [X] T049 [P] Update API logging and error messages for parent-homework endpoints
- [X] T050 [P] Add performance monitoring and optimization for parent homework queries
- [X] T051 [P] Code cleanup and refactoring - ensure consistent patterns across all parent homework components
- [X] T052 Security review - verify all access control checks are in place

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Can leverage US1 active assignments logic
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Can leverage US3 completed assignments logic
- **User Story 5 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- User Stories 1, 3, and 5 can run in parallel (no dependencies between them)
- User Stories 2 and 4 can leverage logic from US1 and US3 respectively but can start independently

---

## Notes

- All endpoints must verify parent-child relationship before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Frontend components should support filtering by child (if parent has multiple children)
- Pagination should be implemented for large lists (20 items per page default)
- All date/time calculations should account for timezone
- Course materials access should verify child enrollment in the course

