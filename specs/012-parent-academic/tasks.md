# Tasks: Parent Academic Information

**Input**: Design documents from `/specs/012-parent-academic/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included as per Constitution Check requirement (Test-First: Commit contract tests and E2E before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create parent-academic route file structure in `apps/api/src/routes/parent-academic.ts`
- [X] T002 [P] Create parent academic TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `EnrolledCourse`, `AcademicCourseMaterial`, `AcademicCalendarEvent`, `ExamSchedule`, `AcademicYearInfo`, `EnrolledCourseFilter`, `AcademicCourseMaterialFilter`, `AcademicCalendarFilter`, `ExamScheduleFilter`, `AcademicYearFilter`
- [X] T003 [P] Create parent academic components directory structure `apps/web/src/app/parent/components/academic/`
- [X] T004 [P] Create parent academic pages directory structure `apps/web/src/app/parent/academic/`
- [X] T005 [P] Create parent academic hooks file `apps/web/src/lib/hooks/use-parent-academic.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentChildAccess` in `apps/api/src/routes/parent-academic.ts` that checks authenticated user ID matches parent ID through `student_parents` relationship
- [X] T007 Register parent-academic routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/academic` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentAcademic` in `apps/web/src/lib/hooks/use-parent-academic.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Enrolled Courses (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view enrolled courses for their children

**Independent Test**: Log in as a parent user, navigate to `/parent/academic` route, and verify enrolled courses are displayed with course name, course code, child name, teacher name, schedule information, delivery mode, and course status. Test filtering by child, course, teacher, and academic year.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/academic/enrolled-courses` in `tests/contract/parent-academic.test.ts` - test access control, data retrieval, filtering
- [ ] T010 [P] [US1] Integration test for enrolled courses filtering in `tests/integration/parent-enrolled-courses.test.ts` - verify filtering, access control, data retrieval
- [ ] T011 [P] [US1] E2E test for enrolled courses display in `tests/e2e/parent-academic.spec.ts` - test enrolled courses viewing, filtering, empty state

### Implementation for User Story 1

- [X] T012 [US1] Implement `GET /api/v1/parent/academic/enrolled-courses` endpoint in `apps/api/src/routes/parent-academic.ts` - query `student_enrollments` joined with `class_courses`, `courses`, `student_profiles`, `student_parents`, and `teachers` for authenticated parent's children's enrolled courses, verify parent-child relationship, support filtering by child, course, teacher, academic year, return courses data
- [X] T013 [P] [US1] Create `useEnrolledCourses(childId?, courseId?, teacherId?, academicYearId?)` hook in `apps/web/src/lib/hooks/use-parent-academic.ts` - fetch enrolled courses with filtering support
- [X] T014 [P] [US1] Implement `EnrolledCourses` component in `apps/web/src/app/parent/components/academic/EnrolledCourses.tsx` - display list of enrolled courses, show course name, code, child name, teacher name, schedule information, delivery mode, course status, add filtering by child, course, teacher, academic year, handle empty state
- [X] T015 [US1] Add enrolled courses section to academic page in `apps/web/src/app/parent/academic/page.tsx` - integrate `EnrolledCourses` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view enrolled courses for their children

---

## Phase 4: User Story 2 - View Course Materials (Priority: P1)

**Goal**: Enable parents to view course materials for their children's courses

**Independent Test**: Navigate to course materials section in academic information. Verify course materials are displayed with material name, course name, child name, material type, upload date, file size (if applicable), and download/view capability. Test filtering by child, course, material type, and date range.

### Tests for User Story 2

- [ ] T016 [P] [US2] Contract test for `GET /api/v1/parent/academic/course-materials` in `tests/contract/parent-academic.test.ts` - test access control, data retrieval, filtering
- [ ] T017 [P] [US2] Integration test for course materials filtering in `tests/integration/parent-course-materials.test.ts` - verify filtering, access control, data retrieval
- [ ] T018 [P] [US2] E2E test for course materials display in `tests/e2e/parent-academic.spec.ts` - test course materials viewing, filtering, download/view capability, empty state

### Implementation for User Story 2

- [X] T019 [US2] Implement `GET /api/v1/parent/academic/course-materials` endpoint in `apps/api/src/routes/parent-academic.ts` - query `course_materials` joined with `courses`, `student_enrollments`, and `student_parents` for authenticated parent's children's course materials, verify parent-child relationship, support filtering by child, course, material type, date range, return materials data
- [X] T020 [P] [US2] Create `useCourseMaterials(childId?, courseId?, materialType?, startDate?, endDate?)` hook in `apps/web/src/lib/hooks/use-parent-academic.ts` - fetch course materials with filtering support
- [X] T021 [P] [US2] Implement `CourseMaterials` component in `apps/web/src/app/parent/components/academic/CourseMaterials.tsx` - display list of course materials, show material name, course name, child name, material type, upload date, file size, download/view buttons, add filtering by child, course, material type, date range, handle download/view capability, handle empty state
- [X] T022 [US2] Add course materials section to academic page in `apps/web/src/app/parent/academic/page.tsx` - integrate `CourseMaterials` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view course materials for their children's courses

---

## Phase 5: User Story 3 - View Academic Calendar (Priority: P2)

**Goal**: Enable parents to view academic calendar events

**Independent Test**: Navigate to academic calendar section in academic information. Verify academic calendar events are displayed with important dates including semester start/end dates, holidays, breaks, special events, and academic milestones. Test filtering by academic year, semester, and date range. Test calendar view and list view.

### Tests for User Story 3

- [ ] T023 [P] [US3] Contract test for `GET /api/v1/parent/academic/calendar` in `tests/contract/parent-academic.test.ts` - test access control, data retrieval, filtering
- [ ] T024 [P] [US3] Integration test for academic calendar filtering in `tests/integration/parent-academic-calendar.test.ts` - verify filtering, access control, data retrieval
- [ ] T025 [P] [US3] E2E test for academic calendar display in `tests/e2e/parent-academic.spec.ts` - test academic calendar viewing, filtering, calendar/list view, empty state

### Implementation for User Story 3

- [X] T026 [US3] Implement `GET /api/v1/parent/academic/calendar` endpoint in `apps/api/src/routes/parent-academic.ts` - query `academic_calendar_events` joined with `academic_years` for authenticated parent's tenant's academic calendar events, support filtering by academic year, semester, date range, return events data
- [X] T027 [P] [US3] Create `useAcademicCalendar(academicYearId?, semester?, startDate?, endDate?)` hook in `apps/web/src/lib/hooks/use-parent-academic.ts` - fetch academic calendar events with filtering support
- [X] T028 [P] [US3] Implement `AcademicCalendar` component in `apps/web/src/app/parent/components/academic/AcademicCalendar.tsx` - display academic calendar events, show important dates (semester start/end, holidays, breaks, special events, academic milestones), add filtering by academic year, semester, date range, support calendar view and list view, handle empty state
- [X] T029 [US3] Add academic calendar section to academic page in `apps/web/src/app/parent/academic/page.tsx` - integrate `AcademicCalendar` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view academic calendar events

---

## Phase 6: User Story 4 - View Exam Schedules (Priority: P2)

**Goal**: Enable parents to view exam schedules for their children's courses

**Independent Test**: Navigate to exam schedules section in academic information. Verify exam schedules are displayed with exam name, course name, child name, exam date, exam time, duration, location, and exam type. Test filtering by child, course, exam type, date range, and academic year.

### Tests for User Story 4

- [ ] T030 [P] [US4] Contract test for `GET /api/v1/parent/academic/exam-schedules` in `tests/contract/parent-academic.test.ts` - test access control, data retrieval, filtering
- [ ] T031 [P] [US4] Integration test for exam schedules filtering in `tests/integration/parent-exam-schedules.test.ts` - verify filtering, access control, data retrieval
- [ ] T032 [P] [US4] E2E test for exam schedules display in `tests/e2e/parent-academic.spec.ts` - test exam schedules viewing, filtering, empty state

### Implementation for User Story 4

- [X] T033 [US4] Implement `GET /api/v1/parent/academic/exam-schedules` endpoint in `apps/api/src/routes/parent-academic.ts` - query `exam_schedules` joined with `courses`, `student_enrollments`, and `student_parents` for authenticated parent's children's exam schedules, verify parent-child relationship, support filtering by child, course, exam type, date range, academic year, sort by exam date (soonest first), return exams data
- [X] T034 [P] [US4] Create `useExamSchedules(childId?, courseId?, examType?, startDate?, endDate?, academicYearId?)` hook in `apps/web/src/lib/hooks/use-parent-academic.ts` - fetch exam schedules with filtering support
- [X] T035 [P] [US4] Implement `ExamSchedules` component in `apps/web/src/app/parent/components/academic/ExamSchedules.tsx` - display list of exam schedules, show exam name, course name, child name, exam date, exam time, duration, location, exam type, add filtering by child, course, exam type, date range, academic year, handle empty state
- [X] T036 [US4] Add exam schedules section to academic page in `apps/web/src/app/parent/academic/page.tsx` - integrate `ExamSchedules` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view exam schedules for their children's courses

---

## Phase 7: User Story 5 - View Academic Year Information (Priority: P2)

**Goal**: Enable parents to view academic year information

**Independent Test**: Navigate to academic year information section in academic information. Verify academic year information is displayed with academic year name, start date, end date, semester information, enrollment details, and academic milestones. Test filtering by child and academic year.

### Tests for User Story 5

- [ ] T037 [P] [US5] Contract test for `GET /api/v1/parent/academic/academic-year` in `tests/contract/parent-academic.test.ts` - test access control, data retrieval, filtering
- [ ] T038 [P] [US5] Integration test for academic year information filtering in `tests/integration/parent-academic-year.test.ts` - verify filtering, access control, data retrieval
- [ ] T039 [P] [US5] E2E test for academic year information display in `tests/e2e/parent-academic.spec.ts` - test academic year information viewing, filtering, empty state

### Implementation for User Story 5

- [X] T040 [US5] Implement `GET /api/v1/parent/academic/academic-year` endpoint in `apps/api/src/routes/parent-academic.ts` - query `academic_years` joined with `student_enrollments` for authenticated parent's tenant's academic year information, support filtering by child, academic year, return academic year data with enrollment details
- [X] T041 [P] [US5] Create `useAcademicYearInfo(childId?, academicYearId?)` hook in `apps/web/src/lib/hooks/use-parent-academic.ts` - fetch academic year information with filtering support
- [X] T042 [P] [US5] Implement `AcademicYearInfo` component in `apps/web/src/app/parent/components/academic/AcademicYearInfo.tsx` - display academic year information, show academic year name, start date, end date, semester information, enrollment details, academic milestones, add filtering by child, academic year, handle empty state
- [X] T043 [US5] Add academic year information section to academic page in `apps/web/src/app/parent/academic/page.tsx` - integrate `AcademicYearInfo` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view academic year information

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [ ] T044 [P] Add error handling and error states to all academic components (network errors, empty states, loading states)
- [ ] T045 [P] Add loading skeletons to all academic components for better UX
- [ ] T046 [P] Add responsive design for academic page (mobile, tablet, desktop)
- [ ] T047 [P] Add accessibility features (ARIA labels, keyboard navigation) to all academic components
- [ ] T048 [P] Add unit tests for filtering utilities (date range, child filter, course filter, etc.)
- [ ] T049 [P] Add performance optimizations (memoization, query optimization) for academic data
- [ ] T050 [P] Add logging and error tracking for academic API endpoints
- [ ] T051 [P] Add calendar view component for academic calendar display (if not using existing library)

**Checkpoint**: Feature complete and polished

---

## Dependencies & Execution Order

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- User Stories 1, 2, 3, 4, and 5 can run in parallel (no dependencies between them)
- All Polish tasks marked [P] can run in parallel

---

## Notes

- All endpoints must verify authenticated user ID matches parent ID through `student_parents` relationship before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Enrolled courses queries must filter by active enrollments only
- Course materials queries must filter by enrolled courses only
- Exam schedules queries must filter by enrolled courses only
- Academic calendar events are tenant-specific (not parent-specific)
- Academic year information is tenant-specific with parent's children's enrollment details
- Frontend components should support filtering with real-time updates
- All date/time calculations should account for timezone
- Course materials download/view capability should support different material types (document, video, link, etc.)
- Academic calendar should support both calendar view and list view
- Exam schedules should be sorted by exam date (soonest first)
- Academic year information should include enrollment details for parent's children only

