# Tasks: Teacher Students List with Class Filtering

**Feature**: 001-modify-teacher-students  
**Input**: Design documents from `/specs/001-modify-teacher-students/`  
**Prerequisites**: ✅ plan.md, ✅ spec.md, ✅ research.md, ✅ data-model.md, ✅ contracts/

**Tests**: Test tasks are NOT included per feature specification. Manual testing procedures are documented in quickstart.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Path Conventions
- **Backend**: `apps/api/src/`
- **Frontend**: `apps/web/src/`
- **Contracts**: `packages/contracts/src/`
- All paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify existing infrastructure is ready for feature implementation

- [ ] **T001** Verify development environment running (backend port 4000, frontend port 3000, database accessible)
- [ ] **T002** Verify test teacher account exists (kouadio.assi@ecoledigitale.ci) with active assignments
- [ ] **T003** [P] Create feature branch `001-modify-teacher-students` (already created by /speckit.specify)
- [ ] **T004** [P] Review quickstart.md for implementation walkthrough

**Checkpoint**: Development environment ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No foundational tasks needed - all required infrastructure exists

**✅ VERIFICATION**: The following infrastructure is already in place per plan.md Constitution Check:
- ✅ Multi-tenant isolation: RLS policies active on all required tables
- ✅ Type safety: Zod and TypeScript configured in monorepo
- ✅ Security: NextAuth.js with teacher role-based access control
- ✅ API-first: Fastify routing structure and error handling
- ✅ Monorepo: pnpm workspaces, packages/contracts exists
- ✅ Database tables: teachers, teacher_assignments, class_courses, classes, student_enrollments, student_profiles, users

**Checkpoint**: Foundation verified - user story implementation can begin

---

## Phase 3: User Stories 1 & 2 (Priority: P1) 🎯 MVP

**Combined Implementation**: These stories are tightly coupled (same endpoint, same page) and deliver together as MVP

### User Story 1 - View All Students Across Assigned Classes
**Goal**: Teacher can see consolidated list of all students from their assigned classes  
**Independent Test**: Login as teacher → navigate to /teacher/students → see all students from all classes (no duplicates)

### User Story 2 - Filter Students by Class
**Goal**: Teacher can filter student list by selecting specific class from dropdown  
**Independent Test**: Select class from dropdown → only students from that class displayed

### Backend Implementation (US1 & US2)

- [ ] **T005** [P] [US1,US2] Copy Zod schemas from `specs/001-modify-teacher-students/contracts/teacher-students.ts` to `packages/contracts/src/teacher-students.ts`
  - Create new file with TeacherStudentsQuerySchema, TeacherStudentsResponseSchema, and all related schemas
  - Export all types and schemas

- [ ] **T006** [US1,US2] Create `apps/api/src/routes/teacher-students.ts` - new route file
  - Import Zod schemas from packages/contracts
  - Import FastifyInstance, FastifyRequest, FastifyReply types
  - Create interface TeacherStudentsRequest extending FastifyRequest
  - Implement GET / handler function (see quickstart.md Step 1.1 for complete code)

- [ ] **T007** [US1,US2] Implement Query 1: Get teacher's classes in `apps/api/src/routes/teacher-students.ts`
  - SQL query from data-model.md (Get All Classes Assigned to Teacher)
  - Use teacher_assignments → class_courses → classes JOIN
  - Include LEFT JOIN student_enrollments for student count
  - Return array of { id, name, code, studentCount }

- [ ] **T008** [US1,US2] Implement Query 2: Get students with class filter in `apps/api/src/routes/teacher-students.ts`
  - SQL query from data-model.md (Get All Students for Teacher)
  - Use DISTINCT ON (sp.id, cl.id) for deduplication
  - JOIN path: teacher_assignments → class_courses → classes → student_enrollments → student_profiles → users
  - Support optional classId parameter ($3::uuid IS NULL OR cl.id = $3)
  - Include pagination with LIMIT/OFFSET

- [ ] **T009** [US1,US2] Implement student count query for pagination in `apps/api/src/routes/teacher-students.ts`
  - COUNT(DISTINCT sp.id) query
  - Same filters as Query 2
  - Calculate totalPages for pagination metadata

- [ ] **T010** [US1,US2] Implement data transformation logic in `apps/api/src/routes/teacher-students.ts`
  - Transform database rows (snake_case) to API response (camelCase)
  - Map student status using mapStatus helper function
  - Set average and attendance to null (Phase 5 will implement these)
  - Build response object matching TeacherStudentsResponseSchema

- [ ] **T011** [US1,US2] Add validation and error handling to `apps/api/src/routes/teacher-students.ts`
  - Validate tenantId exists (400 Bad Request if missing)
  - Validate query params with TeacherStudentsQuerySchema.safeParse()
  - Validate X-User-Id header exists (401 Unauthorized if missing)
  - Verify teacher exists (403 Forbidden if not found)
  - Add try/catch with fastify.log.error for 500 errors
  - Return structured error responses per contracts

- [ ] **T012** [US1,US2] Register route in `apps/api/src/index.ts`
  - Import teacherStudentsRoutes from './routes/teacher-students'
  - Add: await fastify.register(teacherStudentsRoutes, { prefix: '/api/v1/teacher/students' })
  - Place after other teacher-related routes

- [ ] **T013** [US1,US2] Test backend endpoint with curl/Postman
  - Test 1: GET without classId → returns all students and all classes
  - Test 2: GET with classId → returns only students from that class
  - Test 3: GET without X-User-Id → returns 401 Unauthorized
  - Test 4: GET with non-teacher user → returns 403 Forbidden
  - Verify response matches TeacherStudentsResponseSchema
  - Verify response time < 500ms for 100+ students

### Frontend Implementation (US1 & US2)

- [ ] **T014** [P] [US1,US2] Add useTeacherStudentsByClass hook to `apps/web/src/lib/hooks/use-teachers.ts`
  - Create new function useTeacherStudentsByClass(classId?: string, includeMetrics?: boolean)
  - Use useQuery with queryKey: ["teacher-students", classId, includeMetrics]
  - Build API URL with query parameters (classId if not 'all', includeMetrics if true)
  - Fetch from `${API_BASE_URL}/api/v1/teacher/students`
  - Include headers: Content-Type, X-Tenant, X-Dev-Auth, X-User-Id
  - Set staleTime: 5 minutes
  - Return query object (data, isLoading, error)

- [ ] **T015** [US1,US2] Update `apps/web/src/app/teacher/students/page.tsx` - Replace data fetching
  - Remove: useTeacherAssignments() and useTeacherStudents() hooks (old implementation)
  - Add: const { data, isLoading, error } = useTeacherStudentsByClass(selectedClass, false)
  - Remove: transformedStudents useMemo (no longer needed)
  - Update: const classes = data?.classes || []
  - Update: const students = data?.students || []
  - Keep: filteredStudents useMemo for search functionality (User Story 4 needs this)

- [ ] **T016** [US1,US2] Update class filter dropdown in `apps/web/src/app/teacher/students/page.tsx`
  - Change state variable: selectedCourse → selectedClass
  - Update dropdown value and onChange to use selectedClass
  - Map over classes array (from data.classes)
  - Show: {cls.name} ({cls.studentCount} étudiants)
  - Keep "Toutes les classes" option with value="all"

- [ ] **T017** [US1,US2] Update student table data source in `apps/web/src/app/teacher/students/page.tsx`
  - Verify table maps over filteredStudents (not transformedStudents)
  - Update class column to show: student.className and student.classCode
  - Remove: student.course and student.level references (now using className)
  - Update: Empty state messages to reference classes instead of courses

- [ ] **T018** [US1,US2] Test frontend page functionality
  - Start dev server and navigate to http://localhost:3000/teacher/students
  - Login as kouadio.assi@ecoledigitale.ci
  - Verify: All classes appear in filter dropdown with student counts
  - Verify: "Toutes les classes" selected by default shows all students
  - Verify: Selecting specific class filters students correctly
  - Verify: No duplicate students appear
  - Verify: Class name and code display in each student row
  - Verify: Loading state shows while fetching
  - Verify: Error state shows if API fails

**Checkpoint**: MVP Complete - Teacher can view all students and filter by class

---

## Phase 4: User Story 3 - View Student Details and Class Context (Priority: P2)

**Goal**: Each student row displays name, matricule, email, class name, and performance metrics  
**Independent Test**: View student list → verify each row shows firstName, lastName, matricule, email, className, average (or -), attendance (or -)

**Note**: This story is mostly implemented by Phase 3. These tasks ensure data is displayed correctly.

- [ ] **T019** [US3] Verify student data display in `apps/web/src/app/teacher/students/page.tsx`
  - Confirm table shows: student.firstName, student.lastName (Étudiant column)
  - Confirm table shows: student.matricule (below name)
  - Confirm table shows: student.email (below matricule)
  - Confirm table shows: student.className (Classe column)
  - Confirm table shows: student.classCode (below class name)
  - Confirm table shows: student.average with fallback '-/20' if null (Moyenne column)
  - Confirm table shows: student.attendance with fallback '-%' if null (Présence column)

- [ ] **T020** [US3] Verify status display in `apps/web/src/app/teacher/students/page.tsx`
  - Confirm getStatusColor function exists (maps active/warning/inactive to colors)
  - Confirm getStatusLabel function exists (maps to French labels)
  - Confirm status badge shows with correct color and label
  - Test all status values: active, warning, inactive

- [ ] **T021** [US3] Test student details display
  - View student list with at least 3 students
  - Verify all fields display correctly (no undefined/null showing incorrectly)
  - Verify phone shows "Non renseigné" if null
  - Verify grades show "-/20" if null
  - Verify attendance shows "-%" if null
  - Verify class information is accurate for each student

**Checkpoint**: Student details display correctly with proper fallbacks for missing data

---

## Phase 5: User Story 4 - Search Students Across All Classes (Priority: P2)

**Goal**: Teacher can search for students by name, email, or matricule across all classes  
**Independent Test**: Type "Jean" in search box → only students with "Jean" in name appear

**Note**: Search functionality already exists in current implementation. These tasks ensure it works with new data structure.

- [ ] **T022** [US4] Verify search state in `apps/web/src/app/teacher/students/page.tsx`
  - Confirm: const [searchTerm, setSearchTerm] = useState('') exists
  - Confirm: Search input has value={searchTerm} and onChange handler

- [ ] **T023** [US4] Verify filteredStudents logic in `apps/web/src/app/teacher/students/page.tsx`
  - Confirm: filteredStudents useMemo exists
  - Confirm: Filters by students array (from API, not transformedStudents)
  - Confirm: matchesSearch checks firstName, lastName, matricule, email
  - Confirm: Uses .toLowerCase().includes() for case-insensitive search
  - Confirm: Does NOT filter by matchesCourse (old implementation)
  - Confirm: Search works across all students regardless of class filter

- [ ] **T024** [US4] Test search functionality
  - Select "Toutes les classes" filter
  - Type student first name in search → verify only matching students shown
  - Type student last name in search → verify only matching students shown
  - Type student email in search → verify only matching students shown
  - Type student matricule in search → verify only matching students shown
  - Select specific class filter + search term → verify both filters apply
  - Clear search → verify all students (or class-filtered students) reappear
  - Type non-matching search → verify "Aucun étudiant ne correspond" message

**Checkpoint**: Search works correctly across all fields and combines with class filter

---

## Phase 6: User Story 5 - View Statistics Across Filtered Students (Priority: P3)

**Goal**: Statistics (total students, average grade, average attendance) update based on current filters  
**Independent Test**: Filter by class → verify statistics show only that class's numbers

**Note**: Statistics calculations already exist. These tasks ensure they update correctly with filtered data.

- [ ] **T025** [US5] Verify statistics calculations in `apps/web/src/app/teacher/students/page.tsx`
  - Confirm: totalStudents = filteredStudents.length
  - Confirm: activeStudents filters filteredStudents by status === 'active'
  - Confirm: averageGrade calculates from filteredStudents (not all students)
  - Confirm: averageAttendance calculates from filteredStudents (not all students)
  - Confirm: Handles division by zero (returns 0 if filteredStudents.length === 0)

- [ ] **T026** [US5] Verify statistics cards in `apps/web/src/app/teacher/students/page.tsx`
  - Confirm: "Total Étudiants" card shows {totalStudents}
  - Confirm: "Moyenne Générale" card shows {averageGrade.toFixed(1)}/20
  - Confirm: "Présence Moyenne" card shows {averageAttendance.toFixed(0)}%
  - Confirm: Cards use purple/blue/green color scheme
  - Confirm: Icons: Users, Award, TrendingUp are displayed

- [ ] **T027** [US5] Test statistics updates
  - View page with "Toutes les classes" → note total student count and averages
  - Select specific class → verify statistics update to show only that class
  - Apply search filter → verify statistics update to show only matching students
  - Apply class + search filters → verify statistics show intersection
  - Clear filters → verify statistics return to "all students" values
  - Test with class that has 0 students → verify statistics show 0, not NaN or error

**Checkpoint**: Statistics correctly reflect filtered student set in real-time

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] **T028** [P] Review and update error messages for consistency
  - Backend: Verify all error messages are clear and actionable
  - Frontend: Verify empty states have helpful messages
  - Ensure French translations are correct throughout

- [ ] **T029** [P] Performance verification
  - Test with 100+ students: verify page load < 2 seconds
  - Test with 100+ students: verify class filter response < 500ms
  - Test with 100+ students: verify search response < 300ms
  - Run EXPLAIN ANALYZE on backend queries to verify < 100ms execution
  - Check for console warnings or errors

- [ ] **T030** Security validation
  - Test cross-tenant access: Student from tenant A should not appear for teacher in tenant B
  - Test role-based access: Student user cannot access /teacher/students page
  - Test authentication: Logged-out user redirects to /login
  - Verify all API requests include X-Tenant header
  - Verify tenant isolation query filters are present

- [ ] **T031** [P] Code cleanup
  - Remove unused imports in modified files
  - Remove commented-out code
  - Ensure consistent code formatting (Prettier/ESLint)
  - Remove console.log statements used for debugging

- [ ] **T032** [P] Documentation updates
  - Update Actual_ReadMe.md if needed (document new endpoint)
  - Ensure quickstart.md matches implementation
  - Verify contracts match actual API responses
  - Update any developer documentation references

- [ ] **T033** Manual testing via quickstart.md
  - Follow quickstart.md Section 4.1 Manual Testing Checklist
  - Complete all 10 checklist items
  - Document any deviations or issues found
  - Verify empty states work correctly
  - Verify all edge cases from spec.md

- [ ] **T034** Final validation before deployment
  - Run linter: `pnpm lint` in apps/api and apps/web
  - Fix any linting errors
  - Test in both Chrome and Firefox
  - Test with different screen sizes (mobile, tablet, desktop)
  - Ensure accessibility (keyboard navigation works)

**Checkpoint**: Feature complete, tested, and ready for deployment

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately ✅
- **Foundational (Phase 2)**: Depends on Setup - Verification only (no implementation) ✅
- **User Stories 1 & 2 (Phase 3)**: Depends on Foundational - MVP core functionality 🎯
- **User Story 3 (Phase 4)**: Depends on Phase 3 (uses same data, verifies display)
- **User Story 4 (Phase 5)**: Depends on Phase 3 (filters Phase 3 data)
- **User Story 5 (Phase 6)**: Depends on Phase 3, 5 (calculates stats from filtered data)
- **Polish (Phase 7)**: Depends on all implemented user stories

### User Story Dependencies

```
Phase 1 (Setup) → Phase 2 (Foundation Verified)
                          ↓
        Phase 3 (US1 & US2 - MVP) ← CRITICAL PATH
                ↓        ↓        ↓
         Phase 4   Phase 5   Phase 6
         (US3)     (US4)     (US5)
                ↓        ↓        ↓
              Phase 7 (Polish)
```

- **US1 & US2 (P1)**: Foundational - Must complete first (MVP)
- **US3 (P2)**: Depends on US1/US2 (displays their data correctly)
- **US4 (P2)**: Depends on US1/US2 (searches their data) - Can parallelize with US3
- **US5 (P3)**: Depends on US1/US2 and US4 (calculates stats from filtered data)

### Within Each Phase

**Phase 3 (Backend before Frontend)**:
- T005 (Contracts) → T006-T012 (Backend) → T013 (Backend test) → T014-T018 (Frontend)

**Phase 4-6 (Verification tasks)**:
- Can be done in any order after Phase 3 completes
- Mostly verification, minimal code changes

**Phase 7 (Polish)**:
- T028-T034 can run in parallel (marked [P] where applicable)

### Parallel Opportunities

**Within Phase 3**:
```bash
# Parallel: Backend + Frontend preparation
T005 (Copy contracts to packages/) [P]
T014 (Add frontend hook) [P] 

# Then sequential: Backend implementation
T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013

# Then sequential: Frontend implementation  
T015 → T016 → T017 → T018
```

**Within Phase 7**:
```bash
# All polish tasks can run in parallel:
T028 (Error messages) [P]
T029 (Performance) [P]
T031 (Code cleanup) [P]
T032 (Documentation) [P]

# Then sequential verification:
T030 (Security validation)
T033 (Manual testing)
T034 (Final validation)
```

**Between Phases 4, 5, 6**:
```bash
# If multiple developers available:
Developer A: Phase 4 (US3 verification)
Developer B: Phase 5 (US4 search testing)
Developer C: Phase 6 (US5 statistics testing)

# All can work in parallel after Phase 3 completes
```

---

## Parallel Example: Phase 3 (MVP)

```bash
# Step 1: Parallel preparation (different files)
Task T005: "Copy Zod schemas to packages/contracts/src/teacher-students.ts"
Task T014: "Add useTeacherStudentsByClass hook to apps/web/src/lib/hooks/use-teachers.ts"

# Step 2: Sequential backend (same file dependencies)
Task T006: "Create apps/api/src/routes/teacher-students.ts"
Task T007: "Implement Query 1: Get teacher's classes"
Task T008: "Implement Query 2: Get students with class filter"
Task T009: "Implement student count query for pagination"
Task T010: "Implement data transformation logic"
Task T011: "Add validation and error handling"
Task T012: "Register route in apps/api/src/index.ts"
Task T013: "Test backend endpoint with curl/Postman"

# Step 3: Sequential frontend (depends on backend completion)
Task T015: "Update page.tsx - Replace data fetching"
Task T016: "Update class filter dropdown"
Task T017: "Update student table data source"
Task T018: "Test frontend page functionality"
```

---

## Implementation Strategy

### MVP First (Phases 1-3 Only) - Recommended ⭐

1. ✅ Complete Phase 1: Setup (5 minutes)
2. ✅ Complete Phase 2: Foundational verification (5 minutes)
3. 🎯 Complete Phase 3: User Stories 1 & 2 (4-5 hours)
   - Backend: T005-T013 (2-3 hours)
   - Frontend: T014-T018 (1-2 hours)
4. **STOP and VALIDATE**: Test MVP functionality thoroughly
5. Deploy to staging or demo if ready
6. Gather feedback before building additional user stories

**MVP Delivers**:
- ✅ Teacher can view all students from assigned classes
- ✅ Teacher can filter by class
- ✅ No duplicate students
- ✅ Proper tenant isolation and security

### Incremental Delivery (All Phases)

1. Foundation: Phases 1-2 (10 minutes)
2. **MVP Deployed**: Phase 3 (4-5 hours) → Deploy & Demo 🎯
3. **Incremental**: Phase 4 (30 minutes) → Deploy & Demo
4. **Incremental**: Phase 5 (30 minutes) → Deploy & Demo
5. **Incremental**: Phase 6 (30 minutes) → Deploy & Demo
6. **Polish**: Phase 7 (1 hour) → Final deployment

**Total Time**: 7-8 hours for complete feature

### Parallel Team Strategy

With 2 developers:

1. **Together**: Phases 1-2 (10 minutes)
2. **Together**: Phase 3 Backend (2-3 hours)
3. **Split**:
   - Developer A: Phase 3 Frontend (1-2 hours)
   - Developer B: Start Phase 4 verification tasks
4. **Split**:
   - Developer A: Phase 5
   - Developer B: Phase 6
5. **Together**: Phase 7 Polish

**Saves**: ~1 hour with parallel work

---

## Task Summary

| Phase | Story | Task Count | Est. Time | Complexity |
|-------|-------|------------|-----------|------------|
| 1 - Setup | - | 4 tasks | 5 min | Trivial |
| 2 - Foundation | - | 0 tasks (verification) | 5 min | Trivial |
| 3 - MVP | US1, US2 (P1) | 14 tasks | 4-5 hours | Medium |
| 4 - Display | US3 (P2) | 3 tasks | 30 min | Low |
| 5 - Search | US4 (P2) | 3 tasks | 30 min | Low |
| 6 - Statistics | US5 (P3) | 3 tasks | 30 min | Low |
| 7 - Polish | - | 7 tasks | 1 hour | Low |
| **Total** | **5 stories** | **34 tasks** | **7-8 hours** | **Medium** |

### MVP Scope (Recommended for First Delivery)
- **Phases 1-3 only** (18 tasks)
- **Time**: 4-5 hours
- **Delivers**: Core functionality (view all students, filter by class)
- **Value**: Teachers can see and manage their student roster

### Parallel Opportunities Identified
- 2 tasks can run in parallel in Phase 3 (T005 + T014)
- 4 tasks can run in parallel in Phase 7 (T028, T029, T031, T032)
- Phases 4, 5, 6 can run in parallel with multiple developers
- **Total parallelizable**: ~20% of tasks

### Independent Test Criteria
- **US1**: Load page → see all students from all assigned classes (no duplicates)
- **US2**: Select class from filter → see only that class's students
- **US3**: View student row → verify all fields display correctly with proper fallbacks
- **US4**: Type in search box → see only matching students
- **US5**: Change class filter → verify statistics update to match filtered set

---

## Notes

- [P] tasks = different files, no dependencies, can parallelize
- [Story] label (US1-US5) maps task to specific user story for traceability
- Each phase has a checkpoint to validate story completion
- Backend tasks (T006-T013) must complete before frontend tasks (T014-T018)
- Verification tasks (Phases 4-6) are quick checks, not full implementations
- Stop after Phase 3 for MVP deployment, or continue through Phase 7 for complete feature
- No test tasks included per feature specification (manual testing via quickstart.md instead)
- Commit after completing each phase or logical task group
- Refer to quickstart.md for detailed code examples and implementation guidance

---

**Ready to Begin** 🚀  
Start with Phase 1 and work sequentially through MVP (Phase 3), or continue to full feature completion.

