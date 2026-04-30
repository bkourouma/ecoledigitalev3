# Tasks: Child Tracking

**Input**: Design documents from `/specs/004-child-tracking-children/`
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

- [ ] T001 Create parent-children route file structure in `apps/api/src/routes/parent-children.ts`
- [ ] T002 [P] Create parent TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `ChildListItem`, `GradesSummary`, `ScheduleSession`, `AttendanceRecord`, `AbsenceRecord`, `AbsenceStatistics`
- [ ] T003 [P] Create parent components directory structure `apps/web/src/app/parent/components/`
- [ ] T004 [P] Create parent pages directory structure `apps/web/src/app/parent/children/`
- [ ] T005 [P] Create parent hooks file `apps/web/src/lib/hooks/use-parent-children.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Create shared access control utility function `verifyParentChildRelationship` in `apps/api/src/routes/parent-children.ts` that checks `student_parents` table for parent-child relationship
- [ ] T007 Register parent-children routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/children` and ensure auth middleware is applied
- [ ] T008 [P] Create base React hook `useParentChildren` in `apps/web/src/lib/hooks/use-parent-children.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Children List (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view a list of all their linked children with basic information and status indicators

**Independent Test**: Log in as a parent user, navigate to `/parent/children` route, and verify all children linked to the parent account are displayed with name, current year, status, and summary indicator. Test with multiple children, single child, and no children scenarios.

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/children` in `tests/contract/parent-children.test.ts` - test successful response, empty state, access control (403 for non-parent)
- [ ] T010 [P] [US1] Contract test for `GET /api/v1/parent/children/:childId` in `tests/contract/parent-children.test.ts` - test child details, 403 for unlinked child, 404 for non-existent child
- [ ] T011 [P] [US1] E2E test for children list page in `tests/integration/parent-children-list.spec.ts` - test parent login, navigation to `/parent/children`, verify children list display, test empty state

### Implementation for User Story 1

- [ ] T012 [US1] Implement `GET /api/v1/parent/children` endpoint in `apps/api/src/routes/parent-children.ts` - query `student_parents` joined with `student_profiles` and `users`, return all children regardless of status, include summary indicator (grade average or attendance status)
- [ ] T013 [US1] Implement `GET /api/v1/parent/children/:childId` endpoint in `apps/api/src/routes/parent-children.ts` - verify parent-child relationship, return child details with status
- [ ] T014 [P] [US1] Implement `ChildrenList` component in `apps/web/src/app/parent/components/ChildrenList.tsx` - display list of children with status indicators, handle empty state, link to child detail page
- [ ] T015 [US1] Implement children list page in `apps/web/src/app/parent/children/page.tsx` - use `ChildrenList` component, fetch data via `useParentChildren` hook, handle loading and error states
- [ ] T016 [US1] Add error handling and logging for children list endpoints in `apps/api/src/routes/parent-children.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently - parents can view their children list

---

## Phase 4: User Story 2 - View Child Grades Summary (Priority: P1)

**Goal**: Enable parents to view a comprehensive grades summary for a selected child showing all-time academic performance metrics

**Independent Test**: Select a child from the children list, navigate to child detail page, view grades summary section. Verify average grade, total assignments, graded count, best score, and grade distribution are displayed correctly. Test with child having grades, child with no grades (empty state).

### Tests for User Story 2

- [ ] T017 [P] [US2] Contract test for `GET /api/v1/parent/children/:childId/grades-summary` in `tests/contract/parent-children.test.ts` - test grades summary calculation, all-time aggregation, empty state, access control
- [ ] T018 [P] [US2] Integration test for grades summary calculation in `tests/integration/parent-grades-summary.test.ts` - verify average calculation, distribution breakdown, best score extraction
- [ ] T019 [P] [US2] E2E test for grades summary display in `tests/integration/parent-grades-summary.spec.ts` - test viewing grades summary, verify metrics display, test empty state

### Implementation for User Story 2

- [ ] T020 [US2] Implement `GET /api/v1/parent/children/:childId/grades-summary` endpoint in `apps/api/src/routes/parent-children.ts` - query `assignment_submissions` filtered by student_id, calculate all-time statistics (average, total, graded count, best score, distribution), verify parent-child relationship
- [ ] T021 [P] [US2] Create `useChildGradesSummary(childId)` hook in `apps/web/src/lib/hooks/use-parent-children.ts` - fetch grades summary with TanStack Query, handle caching
- [ ] T022 [P] [US2] Implement `ChildGradesSummary` component in `apps/web/src/app/parent/components/ChildGradesSummary.tsx` - display grades summary metrics, grade distribution chart/visualization, handle empty state
- [ ] T023 [US2] Add grades summary section to child detail page in `apps/web/src/app/parent/children/[childId]/page.tsx` - integrate `ChildGradesSummary` component, fetch data via hook

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - parents can view children list and grades summary

---

## Phase 5: User Story 3 - View Child Weekly Schedule (Priority: P2)

**Goal**: Enable parents to view their child's weekly schedule with all scheduled classes organized by day of the week

**Independent Test**: Select a child, navigate to `/parent/children/[childId]/schedule`, verify weekly schedule displays classes by day with time, course name, location. Test week navigation (previous/next week), test empty state for week with no classes.

### Tests for User Story 3

- [ ] T024 [P] [US3] Contract test for `GET /api/v1/parent/children/:childId/schedule` in `tests/contract/parent-children.test.ts` - test weekly schedule retrieval, week parameter handling, access control
- [ ] T025 [P] [US3] Integration test for schedule query in `tests/integration/parent-schedule.test.ts` - verify session filtering by student enrollment, date range filtering
- [ ] T026 [P] [US3] E2E test for weekly schedule view in `tests/integration/parent-schedule.spec.ts` - test schedule page, week navigation, verify class display

### Implementation for User Story 3

- [ ] T027 [US3] Implement `GET /api/v1/parent/children/:childId/schedule` endpoint in `apps/api/src/routes/parent-children.ts` - query `session_instances` joined with `inscriptions` to get student's enrolled classes, filter by week date range, verify parent-child relationship
- [ ] T028 [P] [US3] Create `useChildSchedule(childId, week)` hook in `apps/web/src/lib/hooks/use-parent-children.ts` - fetch weekly schedule with TanStack Query, handle week parameter
- [ ] T029 [P] [US3] Implement `ChildSchedule` component in `apps/web/src/app/parent/components/ChildSchedule.tsx` - display weekly schedule grid, organize classes by day, show time, course name, location, handle empty state
- [ ] T030 [US3] Implement schedule page in `apps/web/src/app/parent/children/[childId]/schedule/page.tsx` - use `ChildSchedule` component, add week navigation controls (previous/next week), fetch data via hook

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently - parents can view children list, grades summary, and weekly schedule

---

## Phase 6: User Story 4 - View Upcoming Classes (Priority: P2)

**Goal**: Enable parents to quickly view their child's upcoming classes (next 7 days, max 10 classes) for immediate scheduling needs

**Independent Test**: View upcoming classes section on schedule page or child detail page. Verify classes from next 7 days are shown (max 10), ordered by date and time. Test with no upcoming classes (empty state).

### Tests for User Story 4

- [ ] T031 [P] [US4] Contract test for `GET /api/v1/parent/children/:childId/upcoming-classes` in `tests/contract/parent-children.test.ts` - test upcoming classes filter (next 7 days, max 10), access control
- [ ] T032 [P] [US4] Integration test for upcoming classes query in `tests/integration/parent-upcoming-classes.test.ts` - verify date filtering, limit enforcement (10 max)
- [ ] T033 [P] [US4] E2E test for upcoming classes display in `tests/integration/parent-upcoming-classes.spec.ts` - test upcoming classes section, verify filtering and limit

### Implementation for User Story 4

- [ ] T034 [US4] Implement `GET /api/v1/parent/children/:childId/upcoming-classes` endpoint in `apps/api/src/routes/parent-children.ts` - query `session_instances` for future sessions (next 7 days), limit to 10 classes, order by date and time, verify parent-child relationship
- [ ] T035 [P] [US4] Create `useUpcomingClasses(childId)` hook in `apps/web/src/lib/hooks/use-parent-children.ts` - fetch upcoming classes with TanStack Query
- [ ] T036 [P] [US4] Implement `UpcomingClasses` component in `apps/web/src/app/parent/components/UpcomingClasses.tsx` - display list of upcoming classes, show date, time, course name, location, handle empty state
- [ ] T037 [US4] Add upcoming classes section to schedule page or child detail page - integrate `UpcomingClasses` component, fetch data via hook

**Checkpoint**: At this point, User Stories 1, 2, 3, AND 4 should all work independently - parents can view children list, grades summary, weekly schedule, and upcoming classes

---

## Phase 7: User Story 5 - View Child Attendance Records (Priority: P2)

**Goal**: Enable parents to view their child's attendance records with pagination (20 records per page, reverse chronological order)

**Independent Test**: View attendance records section for a child. Verify paginated list displays attendance entries with date, course name, status, arrival time (if late), excuse reason (if excused/medical). Test pagination controls, test empty state.

### Tests for User Story 5

- [ ] T038 [P] [US5] Contract test for `GET /api/v1/parent/children/:childId/attendance` in `tests/contract/parent-children.test.ts` - test pagination (page, limit), reverse chronological order, access control
- [ ] T039 [P] [US5] Integration test for attendance records pagination in `tests/integration/parent-attendance.test.ts` - verify pagination logic, ordering by marked_at DESC
- [ ] T040 [P] [US5] E2E test for attendance records display in `tests/integration/parent-attendance.spec.ts` - test attendance records page, pagination navigation, verify record details

### Implementation for User Story 5

- [ ] T041 [US5] Implement `GET /api/v1/parent/children/:childId/attendance` endpoint in `apps/api/src/routes/parent-children.ts` - query `student_attendance` filtered by student_id, paginate (20 per page), order by marked_at DESC, verify parent-child relationship
- [ ] T042 [P] [US5] Create `useChildAttendance(childId, page)` hook in `apps/web/src/lib/hooks/use-parent-children.ts` - fetch attendance records with pagination, handle page parameter
- [ ] T043 [P] [US5] Implement `AttendanceRecords` component in `apps/web/src/app/parent/components/AttendanceRecords.tsx` - display paginated attendance records, show date, course name, status, arrival time, excuse reason, add pagination controls, handle empty state
- [ ] T044 [US5] Add attendance records section to child detail page in `apps/web/src/app/parent/children/[childId]/page.tsx` - integrate `AttendanceRecords` component, fetch data via hook

**Checkpoint**: At this point, User Stories 1, 2, 3, 4, AND 5 should all work independently - parents can view children list, grades summary, schedule, upcoming classes, and attendance records

---

## Phase 8: User Story 6 - View Child Absence History (Priority: P3)

**Goal**: Enable parents to view comprehensive absence history for their child with filtering options and statistics

**Independent Test**: View absence history section for a child. Verify all absences (absent, excused, medical leave) are shown. Test filtering by date range, absence type, and course. Verify absence statistics (total, excused vs unexcused, absence rate) are displayed. Test empty state.

### Tests for User Story 6

- [ ] T045 [P] [US6] Contract test for `GET /api/v1/parent/children/:childId/absence-history` in `tests/contract/parent-children.test.ts` - test filtering (date range, absence type, course), statistics calculation, access control
- [ ] T046 [P] [US6] Integration test for absence history filtering in `tests/integration/parent-absence-history.test.ts` - verify filter combinations, statistics accuracy
- [ ] T047 [P] [US6] E2E test for absence history display in `tests/integration/parent-absence-history.spec.ts` - test absence history page, filter application, statistics display

### Implementation for User Story 6

- [ ] T048 [US6] Implement `GET /api/v1/parent/children/:childId/absence-history` endpoint in `apps/api/src/routes/parent-children.ts` - query `student_attendance` filtered by student_id and absence statuses (absent, excused, medical_leave), apply filters (date range, type, course), calculate statistics (total, excused count, unexcused count, medical count, absence rate), verify parent-child relationship
- [ ] T049 [P] [US6] Create `useAbsenceHistory(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-children.ts` - fetch absence history with filters, handle filter parameters
- [ ] T050 [P] [US6] Implement `AbsenceHistory` component in `apps/web/src/app/parent/components/AbsenceHistory.tsx` - display absence records, add filter controls (date range, absence type, course), display absence statistics, handle empty state
- [ ] T051 [US6] Add absence history section to child detail page in `apps/web/src/app/parent/children/[childId]/page.tsx` - integrate `AbsenceHistory` component, fetch data via hook

**Checkpoint**: At this point, all user stories should work independently - parents can view children list, grades summary, schedule, upcoming classes, attendance records, and absence history

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T052 [P] Add loading states and error handling to all parent components
- [ ] T053 [P] Add empty states with appropriate messaging to all parent components
- [ ] T054 [P] Add responsive design and mobile optimization for parent pages
- [ ] T055 [P] Add accessibility features (ARIA labels, keyboard navigation) to parent components
- [ ] T056 [P] Update API logging and error messages for parent-child tracking endpoints
- [ ] T057 [P] Add performance monitoring and optimization for parent queries
- [ ] T058 [P] Update documentation in `docs/` with parent child tracking feature
- [ ] T059 Run quickstart.md validation - verify all implementation steps are complete
- [ ] T060 Code cleanup and refactoring - ensure consistent patterns across all parent components
- [ ] T061 Security review - verify all access control checks are in place
- [ ] T062 [P] Additional unit tests for utility functions and helper methods

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 for child selection/navigation
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 for child selection
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 for child selection, can leverage US3 schedule logic
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 for child selection
- **User Story 6 (P3)**: Can start after Foundational (Phase 2) - Depends on US1 for child selection, can leverage US5 attendance logic

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- API endpoints and frontend hooks within a story marked [P] can run in parallel
- Components within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Contract test for GET /api/v1/parent/children in tests/contract/parent-children.test.ts"
Task: "Contract test for GET /api/v1/parent/children/:childId in tests/contract/parent-children.test.ts"
Task: "E2E test for children list page in tests/integration/parent-children-list.spec.ts"

# Launch API endpoints for User Story 1 together:
Task: "Implement GET /api/v1/parent/children endpoint in apps/api/src/routes/parent-children.ts"
Task: "Implement GET /api/v1/parent/children/:childId endpoint in apps/api/src/routes/parent-children.ts"

# Launch frontend components for User Story 1 together:
Task: "Implement ChildrenList component in apps/web/src/app/parent/components/ChildrenList.tsx"
Task: "Implement children list page in apps/web/src/app/parent/children/page.tsx"
```

---

## Parallel Example: User Story 2

```bash
# Launch all tests for User Story 2 together:
Task: "Contract test for GET /api/v1/parent/children/:childId/grades-summary in tests/contract/parent-children.test.ts"
Task: "Integration test for grades summary calculation in tests/integration/parent-grades-summary.test.ts"
Task: "E2E test for grades summary display in tests/integration/parent-grades-summary.spec.ts"

# Launch implementation for User Story 2 together:
Task: "Implement GET /api/v1/parent/children/:childId/grades-summary endpoint in apps/api/src/routes/parent-children.ts"
Task: "Create useChildGradesSummary(childId) hook in apps/web/src/lib/hooks/use-parent-children.ts"
Task: "Implement ChildGradesSummary component in apps/web/src/app/parent/components/ChildGradesSummary.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (View Children List)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Stories 3, 4, 5 → Test independently → Deploy/Demo
5. Add User Story 6 → Test independently → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (MVP)
   - Developer B: User Story 2 (can start after US1 endpoint exists)
   - Developer C: User Story 3 (can start after US1 endpoint exists)
3. After US1 completes:
   - Developer A: User Story 4
   - Developer B: User Story 5
   - Developer C: User Story 6
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All endpoints must verify parent-child relationship before returning data
- All queries must respect tenant isolation via RLS
- Pagination uses 20 records per page for attendance records
- Upcoming classes limited to next 7 days, max 10 classes
- Grades summary includes all-time grades (all semesters/years)

