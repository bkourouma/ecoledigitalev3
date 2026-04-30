---
description: "Task list for Phase 2 - Gestion des Installations RSO-PFSO"
---

# Tasks: Phase 2 - Gestion des Installations RSO-PFSO

**Input**: Design documents from `/specs/022-phase/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification, so test tasks are NOT included. Focus on implementation tasks only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo structure**: `apps/api/src/` (backend), `apps/web/src/` (frontend), `packages/contracts/src/` (shared types)
- All RSO routes use `/rso/*` prefix
- All RSO tables use `rso_*` prefix

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for Phase 2

- [x] T001 [P] Install Phase 2 dependencies: `exceljs`, `pdfkit`, `@types/pdfkit`, `node-cron`, `@types/node-cron` in `apps/api/package.json`
- [x] T002 [P] Create Phase 2 directory structure: `apps/api/src/routes/rso/installations.ts`, `apps/api/src/routes/rso/annees.ts`, `apps/api/src/routes/rso/installation-responsables.ts`
- [x] T003 [P] Create Phase 2 service directory structure: `apps/api/src/services/rso/installation.service.ts`, `apps/api/src/services/rso/annee.service.ts`, `apps/api/src/services/rso/installation-code-generator.ts`
- [x] T004 [P] Create Phase 2 job directory: `apps/api/src/jobs/rso/year-increment.job.ts`
- [x] T005 [P] Create Phase 2 schema directory: `apps/api/src/schemas/rso/installation.schema.ts`, `apps/api/src/schemas/rso/annee.schema.ts`
- [x] T006 [P] Create Phase 2 frontend directory structure: `apps/web/src/app/rso/admin/installations/`, `apps/web/src/app/rso/formateur/installations/`, `apps/web/src/app/rso/annees/`
- [x] T007 [P] Create Phase 2 component directories: `apps/web/src/components/rso/installations/`, `apps/web/src/components/rso/annees/`
- [x] T008 [P] Create Phase 2 contracts: `packages/contracts/src/rso/installation.contracts.ts`, `packages/contracts/src/rso/annee.contracts.ts`

**Checkpoint**: Project structure ready for Phase 2 implementation

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 Create database migration script: `infra/scripts/migrations/0022_rso_phase2_installations.sql` with tables `rso_installations`, `rso_annees`, `rso_installation_responsables`, foreign key constraint on `rso_users.installation_id`, indexes, RLS policies, triggers
- [x] T010 Create database seed script: `infra/scripts/migrations/0022_rso_phase2_seed.sql` with 19 predefined installations and years 2004 to current year
- [x] T011 [P] Create TypeScript types: `packages/contracts/src/rso/installation.contracts.ts` with `RSOInstallation`, `CreateInstallationRequest`, `UpdateInstallationRequest`, `InstallationListResponse`, `InstallationDetailResponse`, `InstallationFilters`, `InstallationStatistics`, `GlobalInstallationStats`, `CheckCodeResponse`, `InstallationResponsable`, `CreateResponsableRequest`, `UpdateResponsableRequest` types
- [x] T012 [P] Create TypeScript types: `packages/contracts/src/rso/annee.contracts.ts` with `RSOAnnee`, `YearListResponse`, `CreateAnneeRequest`, `UpdateAnneeRequest`, `YearSelectorState` types
- [x] T013 [P] Create Zod validation schemas: `apps/api/src/schemas/rso/installation.schema.ts` with schemas for create, update, filters, code validation
- [x] T014 [P] Create Zod validation schemas: `apps/api/src/schemas/rso/annee.schema.ts` with schemas for year operations
- [x] T015 Create installation code generator utility: `apps/api/src/services/rso/installation-code-generator.ts` with `generateInstallationCode()` and `getUniqueCode()` functions
- [x] T016 Update RSO permissions: Add 'gestion_installations' module permissions to `rso_permissions` table for all roles (admin: full access, formateur: create/read/update, pfso: read only)

**Checkpoint**: Foundation ready - database schema, types, and utilities are in place. User story implementation can now begin.

---

## Phase 3: User Story 1 - Administrateur gère les installations portuaires (Priority: P1) 🎯 MVP

**Goal**: Administrateur can perform complete CRUD operations on installations, with search, filters, and export capabilities. 19 predefined installations are pre-loaded.

**Independent Test**: An administrator can access the installation list, see 19 predefined installations, create a new installation, modify an existing one, delete (archive) an installation, restore from archives, search/filter installations, and export to Excel/PDF. This demonstrates complete CRUD and basic installation management.

### Implementation for User Story 1

- [x] T017 [P] [US1] Create installation service: `apps/api/src/services/rso/installation.service.ts` with `list()`, `getById()`, `create()`, `update()`, `delete()`, `restore()`, `checkCodeUniqueness()`, `exportExcel()`, `exportPDF()`, `getStats()` methods
- [x] T018 [US1] Implement installation list method in service with filters (ville, type, statut, search), pagination, soft delete exclusion
- [x] T019 [US1] Implement installation create method in service with validation, code uniqueness check, activity logging
- [x] T020 [US1] Implement installation update method in service with validation, activity logging
- [x] T021 [US1] Implement installation delete (soft delete) method in service with dependency check (prevent if has Agent PFSO users), activity logging
- [x] T022 [US1] Implement installation restore method in service with code uniqueness check, activity logging
- [x] T023 [US1] Implement code uniqueness check method in service: `checkCodeUniqueness(code: string)`
- [x] T024 [US1] Create installation routes: `apps/api/src/routes/rso/installations.ts` with GET `/rso/installations`, GET `/rso/installations/:id`, POST `/rso/installations`, PUT `/rso/installations/:id`, DELETE `/rso/installations/:id`, POST `/rso/installations/:id/restore`, GET `/rso/installations/check-code/:code`, GET `/rso/installations/archives`, GET `/rso/installations/stats`, GET `/rso/installations/export/excel`, GET `/rso/installations/export/pdf`
- [x] T025 [US1] Register installation routes in `apps/api/src/index.ts`
- [x] T026 [P] [US1] Create installation API client: `apps/web/src/lib/rso/installations.ts` with `listInstallations()`, `getInstallation()`, `createInstallation()`, `updateInstallation()`, `deleteInstallation()`, `restoreInstallation()`, `checkCode()`, `exportExcel()`, `exportPDF()`, `getStats()` functions
- [x] T027 [P] [US1] Create installation list page: `apps/web/src/app/rso/admin/installations/page.tsx` with table view, pagination, filters integration
- [x] T028 [P] [US1] Create installation list component: `apps/web/src/components/rso/installations/InstallationList.tsx` with table/card view, pagination controls
- [x] T029 [P] [US1] Create installation filters component: `apps/web/src/components/rso/installations/InstallationFilters.tsx` with search, ville filter, type filter, statut filter, reset button
- [x] T030 [US1] Create installation form component: `apps/web/src/components/rso/installations/InstallationForm.tsx` with all fields (nom_port, code_installation, type_installation, ville, statut, adresse, contact fields, commentaire), validation, real-time code uniqueness check
- [x] T031 [US1] Create installation detail modal: `apps/web/src/components/rso/installations/InstallationDetail.tsx` with all information display, edit button, delete button
- [x] T032 [US1] Create installation create page/modal: Integration of InstallationForm for creating new installations
- [x] T033 [US1] Create installation edit page/modal: Integration of InstallationForm for editing existing installations
- [x] T034 [US1] Create archived installations page: `apps/web/src/app/rso/admin/installations/archives/page.tsx` with list of archived installations, restore button, permanent delete option
- [x] T035 [US1] Implement Excel export functionality in service using ExcelJS with formatting, column widths, headers
- [x] T036 [US1] Implement PDF export functionality in service using PDFKit with formatted list of installations
- [x] T037 [US1] Create export buttons component: `apps/web/src/components/rso/shared/ExportButtons.tsx` with Excel and PDF export buttons
- [x] T038 [US1] Add export buttons to installation list page
- [x] T039 [US1] Integrate activity logging for all installation operations (create, update, delete, restore) using existing `rsoActivityLogService` from Phase 1

**Checkpoint**: At this point, User Story 1 should be fully functional. Administrator can manage installations with full CRUD, search, filters, and exports.

---

## Phase 4: User Story 2 - Formateur RSO crée et gère ses installations (Priority: P1)

**Goal**: Formateur RSO can create installations, modify only installations they created, and view all installations. Cannot delete installations.

**Independent Test**: A Formateur RSO can create a new installation, see all installations with visual indication of ones they created, modify an installation they created, and get an error when trying to modify an installation created by another user. No delete option is visible. This validates delegation and appropriate restrictions.

### Implementation for User Story 2

- [x] T040 [US2] Add permission check in installation service update method: Verify `created_by === userId` for RSO Formateur role (admin can update any)
- [x] T041 [US2] Add permission check in installation routes: Restrict DELETE endpoint to administrators only
- [x] T042 [P] [US2] Create formateur installation page: `apps/web/src/app/rso/formateur/installations/page.tsx` with list view showing all installations, visual indicator for own installations
- [x] T043 [US2] Update installation list component to show creator information and highlight own installations for formateurs
- [x] T044 [US2] Hide delete button in installation detail modal for formateur role
- [x] T045 [US2] Add error handling in frontend for permission denied when formateur tries to edit another user's installation
- [x] T046 [US2] Update installation form to show read-only mode for formateurs editing other users' installations

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Formateurs can create and manage their own installations, admins have full control.

---

## Phase 5: User Story 3 - Système gère les années (2004 à aujourd'hui) (Priority: P1)

**Goal**: System pre-loads years 2004 to current, provides global year selector, persists selection across navigation, and automatically adds new year on January 1st.

**Independent Test**: A user can select a year in the global selector, see all years 2004 to current, and the selected year persists across page navigation. The system automatically adds the new year on January 1st. This validates complete year management system.

### Implementation for User Story 3

- [x] T047 [P] [US3] Create year service: `apps/api/src/services/rso/annee.service.ts` with `list()`, `getActive()`, `getById()`, `create()`, `update()`, `increment()` methods
- [x] T048 [US3] Implement year list method in service: Return all years ordered by year DESC
- [x] T049 [US3] Implement year increment method in service: Archive previous year, add new year with status 'active', log activity
- [x] T050 [US3] Create year routes: `apps/api/src/routes/rso/annees.ts` with GET `/rso/annees`, GET `/rso/annees/active`, GET `/rso/annees/:id`, POST `/rso/annees`, PUT `/rso/annees/:id`, POST `/rso/annees/increment` (admin only)
- [x] T051 [US3] Register year routes in `apps/api/src/index.ts`
- [x] T052 [US3] Create scheduled task: `apps/api/src/jobs/rso/year-increment.job.ts` with node-cron schedule `"0 1 1 1 *"` (January 1st at 01:00), call `anneeService.increment()`, error handling and logging
- [x] T053 [US3] Register scheduled task in `apps/api/src/index.ts`: Call `startYearIncrementJob()` on server startup
- [x] T054 [P] [US3] Create year API client: `apps/web/src/lib/rso/annees.ts` with `listYears()`, `getActiveYear()`, `selectYear()` functions
- [x] T055 [P] [US3] Create year selector component: `apps/web/src/components/rso/annees/YearSelector.tsx` with dropdown, sessionStorage persistence, year change handler, active year highlighting
- [x] T056 [US3] Add year selector to RSO layout/header: Make it globally accessible on all RSO pages
- [x] T057 [US3] Create year management page: `apps/web/src/app/rso/admin/annees/page.tsx` with list of all years, status display, manual status update (admin only)
- [x] T058 [US3] Implement year context/provider: Create React context to share selected year across all RSO components, update on year selector change
- [x] T059 [US3] Update all year-dependent queries to use selected year from context (installations stats, future activities, etc.)

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently. Year selector is globally available and persists across navigation.

---

## Phase 6: User Story 4 - Administrateur associe les agents PFSO aux installations (Priority: P2)

**Goal**: Administrator can assign an Agent PFSO to an installation during account creation and modify the assignment. Agent PFSO can only see data from their assigned installation.

**Independent Test**: An administrator can create an Agent PFSO and assign an installation from a dropdown. The agent can then log in and see only data from their assigned installation. If the administrator changes the assignment, the agent loses access to the old installation. This validates association and access restrictions.

### Implementation for User Story 4

- [x] T060 [US4] Update user creation form (Phase 1): `apps/web/src/components/rso/admin/CreateUserForm.tsx` - Add installation dropdown when role is 'agent_pfso', make it required, load active installations
- [x] T061 [US4] Update user update form (Phase 1): `apps/web/src/components/rso/admin/UpdateUserForm.tsx` - Add installation dropdown for agent_pfso role, allow changing assignment
- [x] T062 [US4] Update user service (Phase 1): `apps/api/src/services/rso/user.service.ts` - Validate installation_id is provided for agent_pfso role, validate installation exists and is active
- [x] T063 [US4] Update user list filters: Add installation filter to filter Agent PFSO users by installation
- [x] T064 [US4] Update RSO auth middleware: `apps/api/src/plugins/rso-auth-middleware.ts` - Add installation_id to request.user object for agent_pfso users
- [x] T065 [US4] Add installation filter to installation routes: For agent_pfso role, automatically filter to their assigned installation only
- [x] T066 [US4] Update user list component: Show installation name for agent_pfso users, add installation filter dropdown

**Checkpoint**: At this point, User Stories 1-4 should all work independently. Agent PFSO users are properly assigned to installations and have restricted access.

---

## Phase 7: User Story 5 - Administrateur gère les responsables d'installation (Priority: P2)

**Goal**: Administrator can assign responsible persons (PFSO Principal, PFSO Adjoint, RSO Référent) to installations with start/end dates and view complete history.

**Independent Test**: An administrator can access the responsible persons section of an installation, see current responsible persons, add a new responsible person with type and dates, modify or end a responsible assignment, and view complete history. This validates complete responsible person management.

### Implementation for User Story 5

- [x] T067 [P] [US5] Create responsible assignment service: `apps/api/src/services/rso/installation-responsable.service.ts` with `listByInstallation()`, `create()`, `update()`, `endAssignment()`, `getHistory()` methods
- [x] T068 [US5] Implement responsible assignment create method: Validate only one active PFSO Principal per installation, allow multiple Adjoints/Referents, validate dates
- [x] T069 [US5] Implement responsible assignment update method: Update type, dates, validate constraints
- [x] T070 [US5] Implement responsible assignment end method: Set date_fin and statut='inactif', maintain history
- [x] T071 [US5] Create responsible assignment routes: `apps/api/src/routes/rso/installation-responsables.ts` with GET `/rso/installations/:id/responsables`, POST `/rso/installations/:id/responsables`, PUT `/rso/installations/:id/responsables/:responsableId`, DELETE `/rso/installations/:id/responsables/:responsableId`
- [x] T072 [US5] Register responsible assignment routes in `apps/api/src/index.ts`
- [x] T073 [US5] Update installation detail service method: Include responsables in `getById()` response
- [x] T074 [P] [US5] Create responsible assignment API client: `apps/web/src/lib/rso/installation-responsables.ts` with `listResponsables()`, `createResponsable()`, `updateResponsable()`, `endResponsable()` functions
- [x] T075 [P] [US5] Create responsible assignment list component: `apps/web/src/components/rso/installations/ResponsableList.tsx` with current responsables display, type badges, dates
- [x] T076 [US5] Create responsible assignment form component: `apps/web/src/components/rso/installations/ResponsableForm.tsx` with user selection, type selection, date inputs, validation
- [x] T077 [US5] Add responsible assignment section to installation detail modal: Display current responsables, add button, edit/end buttons
- [x] T078 [US5] Create responsible assignment history view: Show all past and current assignments with dates
- [x] T079 [US5] Add validation in frontend: Prevent multiple active PFSO Principals, validate date ranges

**Checkpoint**: At this point, User Stories 1-5 should all work independently. Responsible person management is complete with full history tracking.

---

## Phase 8: User Story 6 - Utilisateurs consultent les statistiques par installation (Priority: P2)

**Goal**: Administrators and Formateurs RSO can view global and per-installation statistics (total installations, distribution by city/type, activities count, incidents count) filtered by selected year.

**Independent Test**: An administrator can access the installation statistics dashboard, see global metrics (total installations, distribution by city and type), select an installation and year to see detailed statistics, and statistics update when year changes. This validates statistics display functionality.

### Implementation for User Story 6

- [x] T080 [US6] Implement global statistics method in installation service: `getStats(year?: number)` - Calculate total installations, active/inactive/maintenance counts, distribution by ville, distribution by type
- [x] T081 [US6] Implement per-installation statistics method in installation service: `getInstallationStats(installationId: number, year: number)` - Calculate activities count (placeholder until Phase 3), incidents count (placeholder until Phase 4), last activity date
- [x] T082 [US6] Add statistics endpoints to installation routes: GET `/rso/installations/stats?year=YYYY`, GET `/rso/installations/:id/stats?year=YYYY`
- [x] T083 [P] [US6] Create statistics API client: `apps/web/src/lib/rso/installation-stats.ts` with `getGlobalStats()`, `getInstallationStats()` functions
- [x] T084 [P] [US6] Create statistics dashboard component: `apps/web/src/components/rso/installations/InstallationStats.tsx` with metrics cards, charts for distribution, year filter integration
- [x] T085 [US6] Create statistics dashboard page: `apps/web/src/app/rso/admin/installations/dashboard/page.tsx` with global statistics display, per-installation statistics selector
- [x] T086 [US6] Add statistics section to installation detail modal: Show statistics for selected year
- [x] T087 [US6] Integrate statistics with year selector: Update statistics when year changes
- [x] T088 [US6] Add permission check: Formateurs see statistics only for installations they can manage
- [x] T089 [US6] Create statistics visualization: Use charts library (recharts or similar) for distribution charts (by ville, by type)

**Checkpoint**: At this point, all User Stories 1-6 should be complete and independently functional. Statistics dashboard provides insights into installation data.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T090 [P] Add loading states and error handling to all installation components
- [x] T091 [P] Add confirmation dialogs for delete operations (installations, responsible assignments)
- [x] T092 [P] Implement optimistic updates for installation list (update UI immediately, rollback on error)
- [x] T093 [P] Add toast notifications for success/error messages across all operations
- [x] T094 [P] Optimize installation list queries with proper indexes and query optimization
- [x] T095 [P] Add caching for statistics calculations (5-minute TTL, invalidate on data changes)
- [x] T096 [P] Implement debounced search in installation filters (500ms delay)
- [x] T097 [P] Add export progress indicators for large exports (async export with polling)
- [x] T098 [P] Add keyboard shortcuts for common actions (create, search, filters)
- [x] T099 [P] Improve accessibility: ARIA labels, keyboard navigation, screen reader support
- [x] T100 [P] Add responsive design improvements for mobile/tablet views
- [x] T101 [P] Update documentation: API documentation, component documentation
- [x] T102 [P] Code cleanup: Remove unused code, optimize imports, add comments
- [x] T103 Run quickstart.md validation: Verify all steps work correctly
- [x] T104 Performance testing: Verify all success criteria (SC-001 to SC-024) are met

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User Stories 1, 2, 3 (P1) can proceed in parallel after Foundational
  - User Stories 4, 5, 6 (P2) can proceed in parallel after P1 stories or after Foundational
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories - **MVP**
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 for installation service/routes
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Independent, but integrates with US1/US2 for year filtering
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 for installations to exist, integrates with Phase 1 user management
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 for installations to exist
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 for installations, US3 for year filtering

### Within Each User Story

- Models/entities before services
- Services before routes/endpoints
- Routes before frontend API clients
- API clients before UI components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks (T001-T008) marked [P] can run in parallel
- All Foundational tasks marked [P] (T011-T014) can run in parallel
- Once Foundational phase completes:
  - User Stories 1, 2, 3 can start in parallel (if team capacity allows)
  - User Stories 4, 5, 6 can start in parallel after P1 stories
- Within US1: T026, T027, T028, T029 can run in parallel
- Within US3: T054, T055 can run in parallel
- Within US5: T074, T075 can run in parallel
- Within US6: T083, T084 can run in parallel
- All Polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all parallel tasks for User Story 1 together:
Task T026: Create installation API client in apps/web/src/lib/rso/installations.ts
Task T027: Create installation list page in apps/web/src/app/rso/admin/installations/page.tsx
Task T028: Create installation list component in apps/web/src/components/rso/installations/InstallationList.tsx
Task T029: Create installation filters component in apps/web/src/components/rso/installations/InstallationFilters.tsx

# Then sequential tasks:
Task T030: Create installation form component (depends on API client)
Task T031: Create installation detail modal (depends on API client)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Administrateur gère les installations)
4. **STOP and VALIDATE**: Test User Story 1 independently
   - Verify 19 installations are loaded
   - Test CRUD operations
   - Test search, filters, exports
   - Verify activity logging
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 3 (Years) → Test independently → Deploy/Demo (enables year filtering)
4. Add User Story 2 (Formateur) → Test independently → Deploy/Demo
5. Add User Story 4 (PFSO Assignment) → Test independently → Deploy/Demo
6. Add User Story 5 (Responsables) → Test independently → Deploy/Demo
7. Add User Story 6 (Statistics) → Test independently → Deploy/Demo
8. Polish phase → Final improvements

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (MVP)
   - Developer B: User Story 3 (Years) - can work in parallel
   - Developer C: User Story 2 (Formateur) - can work in parallel after US1 service is ready
3. After P1 stories complete:
   - Developer A: User Story 4 (PFSO Assignment)
   - Developer B: User Story 5 (Responsables)
   - Developer C: User Story 6 (Statistics)
4. All stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Database migrations (T009, T010) must be run before any user story implementation
- Year selector (US3) should be integrated early as it affects other features
- Activity logging uses existing Phase 1 infrastructure
- Export functionality should handle large datasets asynchronously if needed

---

## Task Summary

- **Total Tasks**: 104
- **Setup Tasks**: 8 (T001-T008)
- **Foundational Tasks**: 8 (T009-T016)
- **User Story 1 Tasks**: 23 (T017-T039) - MVP
- **User Story 2 Tasks**: 7 (T040-T046)
- **User Story 3 Tasks**: 13 (T047-T059)
- **User Story 4 Tasks**: 7 (T060-T066)
- **User Story 5 Tasks**: 13 (T067-T079)
- **User Story 6 Tasks**: 10 (T080-T089)
- **Polish Tasks**: 15 (T090-T104)

**Parallel Opportunities**: 35+ tasks can be executed in parallel across different files

**MVP Scope**: Phases 1-3 (Setup + Foundational + User Story 1) = 39 tasks

