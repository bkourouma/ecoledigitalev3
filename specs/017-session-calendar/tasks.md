# Tasks: Session Management & Calendar - Imhotep Data

**Input**: Design documents from `/specs/017-session-calendar/`  
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT included as they were not explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create sessions-pro contracts directory structure in `packages/contracts/src/sessions-pro/`
- [x] T002 [P] Install FullCalendar dependencies: `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`, `@fullcalendar/core` in `apps/web/`
- [x] T003 [P] Install exceljs dependency in `apps/api/` for export functionality
- [x] T004 [P] Create sessions-pro API route file structure in `apps/api/src/routes/sessions-pro.ts`
- [x] T005 [P] Create sessions-pro service directory structure in `apps/api/src/services/`
- [x] T006 [P] Create sessions-pro frontend pages directory structure in `apps/web/src/app/formations-professionnelles/sessions/`
- [x] T007 [P] Create sessions-pro components directory structure in `apps/web/src/components/sessions-pro/`
- [x] T008 [P] Create sessions-pro hooks file in `apps/web/src/lib/hooks/use-sessions-pro.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 Create Zod schemas for session management in `packages/contracts/src/sessions-pro/session.schema.ts` (SessionListQuerySchema, CalendarQuerySchema, CreateSessionSchema, UpdateSessionSchema, SessionStatusSchema, DeliveryModeSchema)
- [x] T010 [P] Create Zod schemas for calendar events in `packages/contracts/src/sessions-pro/calendar.schema.ts` (CalendarEventSchema, CalendarResponseSchema)
- [x] T011 [P] Create Zod schemas for admin endpoints in `packages/contracts/src/sessions-pro/admin.schema.ts` (AdminSessionListQuerySchema, TrainerAvailabilityQuerySchema, EnrollmentListQuerySchema, UpdateSessionStatusSchema, DuplicateSessionSchema)
- [x] T012 [P] Create TypeScript types export in `packages/contracts/src/sessions-pro/types.ts` (SessionListItem, SessionDetail, CalendarEvent, etc.)
- [x] T013 Create sessions-pro contracts index file in `packages/contracts/src/sessions-pro/index.ts` exporting all schemas and types
- [x] T014 Update `packages/contracts/src/index.ts` to export sessions-pro contracts
- [x] T015 Create SessionProService class skeleton in `apps/api/src/services/session-pro.service.ts` with tenant isolation
- [x] T016 [P] Create FormateurAvailabilityService class skeleton in `apps/api/src/services/formateur-availability.service.ts` with tenant isolation
- [x] T017 Verify RLS policies exist for `sessions_professionnelles` table (from Phase 1 migration 0037)
- [x] T018 [P] Create base API route structure in `apps/api/src/routes/sessions-pro.ts` with Fastify route registration and tenant context extraction

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Public Session Calendar (Priority: P1) 🎯 MVP

**Goal**: Enable public users to browse available training sessions through an interactive calendar with filtering capabilities

**Independent Test**: Access the public calendar page at `/formations-professionnelles/sessions`, view sessions in different date ranges, apply filters (mode, training topic, status), and verify session information (dates, mode, availability) is accurately displayed. This delivers immediate value by enabling session discovery without requiring any admin functionality.

### Implementation for User Story 1

- [X] T019 [US1] Implement GET /api/v1/sessions-pro endpoint in `apps/api/src/routes/sessions-pro.ts` with filtering, pagination, and sorting (formation_id, mode, date_debut, date_fin, statut, formateur_id, mois, annee, sort)
- [X] T020 [US1] Implement GET /api/v1/sessions-pro/calendrier endpoint in `apps/api/src/routes/sessions-pro.ts` returning FullCalendar-compatible events format
- [X] T021 [US1] Implement getSessionsList method in `apps/api/src/services/session-pro.service.ts` with tenant filtering, date range queries, and status filtering (exclude 'annulee' for public)
- [X] T022 [US1] Implement getSessionsCalendar method in `apps/api/src/services/session-pro.service.ts` transforming sessions to FullCalendar event format with colors based on mode_formation and statut
- [X] T023 [US1] Create CalendarComponent in `apps/web/src/components/sessions-pro/CalendarComponent.tsx` using FullCalendar with month/week/day/list views and French locale
- [X] T024 [US1] Create CalendarToolbar component in `apps/web/src/components/sessions-pro/CalendarToolbar.tsx` with filter controls (formations, modes, statuts, formateur) and view switcher
- [X] T025 [US1] Create SessionEventCard component in `apps/web/src/components/sessions-pro/SessionEventCard.tsx` for rendering session events in calendar with mode icons and availability badges
- [X] T026 [US1] Create useSessionsCalendar hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` using TanStack Query to fetch calendar events with filters
- [X] T027 [US1] Create public calendar page in `apps/web/src/app/formations-professionnelles/sessions/page.tsx` integrating CalendarComponent, CalendarToolbar, and filters
- [X] T028 [US1] Add calendar route registration in `apps/api/src/index.ts` to register sessions-pro routes with prefix `/api/v1/sessions-pro`
- [X] T029 [US1] Implement getColorByMode and getColorByStatut helper methods in `apps/api/src/services/session-pro.service.ts` for calendar event styling

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Users can view the public calendar, filter sessions, and see session information.

---

## Phase 4: User Story 2 - View Session Details (Priority: P1)

**Goal**: Enable learners to view comprehensive session details including dates, schedule, location/video link, trainers, pricing, and real-time availability

**Independent Test**: Navigate to a session detail page from the calendar or direct link, verify all session information is displayed correctly (training title, dates, schedule, delivery mode, location/video link, trainers, pricing, availability), and confirm that availability updates are reflected in real-time via polling. This delivers value by providing the information needed for enrollment decisions.

### Implementation for User Story 2

- [X] T030 [US2] Implement GET /api/v1/sessions-pro/:id endpoint in `apps/api/src/routes/sessions-pro.ts` returning full session details with formation and formateurs
- [X] T031 [US2] Implement GET /api/v1/sessions-pro/:id/disponibilite endpoint in `apps/api/src/routes/sessions-pro.ts` returning real-time availability information
- [X] T032 [US2] Implement getSessionById method in `apps/api/src/services/session-pro.service.ts` with tenant filtering and includes (formation, formateurs, inscriptions_count)
- [X] T033 [US2] Implement getSessionAvailability method in `apps/api/src/services/session-pro.service.ts` returning places_disponibles, places_reservees, places_totales, peut_inscrire flag, and message
- [X] T034 [US2] Create SessionDetailPage component in `apps/web/src/components/sessions-pro/SessionDetailPage.tsx` displaying session information (formation, dates, horaires, mode, lieu/lien_visio, formateurs, pricing, availability)
- [X] T035 [US2] Create SessionHeader component in `apps/web/src/components/sessions-pro/SessionHeader.tsx` with formation title, code session, and status badges
- [X] T036 [US2] Create SessionInfos component in `apps/web/src/components/sessions-pro/SessionInfos.tsx` displaying dates, horaires, mode, lieu (with map link if presentiel), lien_visio (if distanciel/hybride)
- [X] T037 [US2] Create SessionFormateurs component in `apps/web/src/components/sessions-pro/SessionFormateurs.tsx` displaying trainer list with photos, names, bios, and specialités
- [X] T038 [US2] Create SessionInscriptionSidebar component in `apps/web/src/components/sessions-pro/SessionInscriptionSidebar.tsx` with pricing, availability counter, enrollment button (disabled if complet), and contact information
- [X] T039 [US2] Create SessionStatusBanner component in `apps/web/src/components/sessions-pro/SessionStatusBanner.tsx` displaying status messages (annulée, en cours, terminée, complet)
- [X] T040 [US2] Create public session detail page in `apps/web/src/app/formations-professionnelles/sessions/[id]/page.tsx` integrating SessionDetailPage components
- [X] T041 [US2] Implement useSessionDetail hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` using TanStack Query to fetch session details
- [X] T042 [US2] Implement useSessionAvailability hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` with polling (30-second interval) for real-time availability updates
- [X] T043 [US2] Add event click handler in CalendarComponent to navigate to session detail page
- [X] T044 [US2] Create OtherSessionsCarousel component in `apps/web/src/components/sessions-pro/OtherSessionsCarousel.tsx` displaying other sessions of the same formation

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Users can view the calendar and access detailed session information with real-time availability.

---

## Phase 5: User Story 3 - Admin: Create New Session (Priority: P2)

**Goal**: Enable administrators to create new training sessions with trainer availability validation, automatic session code generation, and publishing options

**Independent Test**: Admin user creates a new session through the admin interface, completes all required fields (training, dates, mode, trainers, capacity, pricing), verifies trainer availability validation works (warns on conflicts), confirms session code is auto-generated, and verifies the session appears in the public calendar after creation with status 'ouverte'. This delivers value by enabling session scheduling and management.

### Implementation for User Story 3

- [X] T045 [US3] Implement POST /api/v1/admin/sessions-pro endpoint in `apps/api/src/routes/sessions-pro.ts` with admin authentication and RBAC checks
- [X] T046 [US3] Implement createSession method in `apps/api/src/services/session-pro.service.ts` with validation (dates, mode requirements, capacity, pricing), trainer availability check, session code generation, and database transaction
- [X] T047 [US3] Implement generateCodeSession method in `apps/api/src/services/session-pro.service.ts` generating format PREFIX-YEAR-NUMBER (e.g., DATA-2024-001) from formation slug, year, and sequential number
- [X] T048 [US3] Implement assignFormateurs method in `apps/api/src/services/session-pro.service.ts` creating session_formateurs records for assigned trainers
- [X] T049 [US3] Implement checkFormateursDisponibilite method in `apps/api/src/services/formateur-availability.service.ts` checking date range overlaps with existing sessions (excluding cancelled/completed)
- [X] T050 [US3] Create SessionFormWizard component in `apps/web/src/components/sessions-pro/SessionFormWizard.tsx` with multi-step form (Step 1: General Info, Step 2: Formateurs & Capacity, Step 3: Tarification & Publication)
- [X] T051 [US3] Create FormStep1GeneralInfo component in `apps/web/src/components/sessions-pro/FormStep1GeneralInfo.tsx` with formation select, mode radio group, date range picker, time range picker, location input (if presentiel), visio link input (if distanciel/hybride)
- [X] T052 [US3] Create FormStep2Formateurs component in `apps/web/src/components/sessions-pro/FormStep2Formateurs.tsx` with formateurs multi-select, selected formateurs list with availability indicators, and capacity input
- [X] T053 [US3] Create FormStep3Tarification component in `apps/web/src/components/sessions-pro/FormStep3Tarification.tsx` with pricing inputs (HT/TTC with auto-calculation), status select, notes textarea, and recap card
- [X] T054 [US3] Create FormateursMultiSelect component in `apps/web/src/components/sessions-pro/FormateursMultiSelect.tsx` with search and trainer cards
- [X] T055 [US3] Create SelectedFormateursList component in `apps/web/src/components/sessions-pro/SelectedFormateursList.tsx` displaying selected trainers with availability badges (disponible, conflit, indisponible)
- [X] T056 [US3] Create DisponibiliteChecker hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` calling GET /api/v1/admin/formateurs/disponibilites when dates or trainers change
- [X] T057 [US3] Create admin session creation page in `apps/web/src/app/formations-professionnelles/admin/sessions/creer/page.tsx` integrating SessionFormWizard
- [X] T058 [US3] Implement useCreateSession hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` using TanStack Query mutation for session creation
- [X] T059 [US3] Add form validation in SessionFormWizard using Zod schemas (CreateSessionSchema) with step-by-step validation
- [X] T060 [US3] Implement auto-save draft functionality in SessionFormWizard (save every 30 seconds if form has data)
- [X] T061 [US3] Add error handling and user feedback for trainer conflicts in FormStep2Formateurs component

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should work independently. Admins can create sessions, and sessions appear in the public calendar.

---

## Phase 6: User Story 4 - Admin: Manage Existing Sessions (Priority: P2)

**Goal**: Enable administrators to view, filter, search, and manage all existing sessions with statistics and bulk operations

**Independent Test**: Admin accesses the session management interface, applies various filters and search criteria (status, training topic, date range, delivery mode), views session statistics (total active sessions, enrollment rates, upcoming sessions), and performs bulk actions (status changes, exports). This delivers value by providing efficient session oversight and management capabilities.

### Implementation for User Story 4

- [X] T062 [US4] Implement GET /api/v1/admin/sessions-pro endpoint in `apps/api/src/routes/sessions-pro.ts` with admin authentication, extended filters (search by code_session or formation title), and includes notes_internes
- [X] T063 [US4] Implement getAdminSessionsList method in `apps/api/src/services/session-pro.service.ts` with search functionality, all statuses including 'annulee', and session statistics calculation
- [X] T064 [US4] Create AdminSessionsList component in `apps/web/src/components/sessions-pro/AdminSessionsList.tsx` with session table displaying code, formation, dates, mode, formateurs, inscriptions (X/Y), places dispo, prix TTC, and actions menu
- [X] T065 [US4] Create AdminSessionsHeader component in `apps/web/src/components/sessions-pro/AdminSessionsHeader.tsx` with page title, "Créer session" button, "Exporter Excel" button, and quick stats cards (sessions actives, sessions ce mois, taux remplissage, CA prévisionnel)
- [X] T066 [US4] Create AdminSessionsFilters component in `apps/web/src/components/sessions-pro/AdminSessionsFilters.tsx` with formation select, statut checkboxes, mode checkboxes, date range filter, search input, and reset button
- [X] T067 [US4] Create SessionActionsMenu component in `apps/web/src/components/sessions-pro/SessionActionsMenu.tsx` with dropdown actions (voir détails, modifier, voir inscrits, dupliquer, changer statut, contacter inscrits, supprimer)
- [X] T068 [US4] Create BulkActionsBar component in `apps/web/src/components/sessions-pro/BulkActionsBar.tsx` for selected sessions (export selection, changer statut, supprimer, désélectionner)
- [X] T069 [US4] Create QuickStatsCards component in `apps/web/src/components/sessions-pro/QuickStatsCards.tsx` displaying session management statistics
- [X] T070 [US4] Create admin session list page in `apps/web/src/app/formations-professionnelles/admin/sessions/page.tsx` integrating AdminSessionsList, AdminSessionsHeader, and AdminSessionsFilters
- [X] T071 [US4] Implement useAdminSessionsList hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` using TanStack Query with debounced search (300ms)
- [X] T072 [US4] Implement GET /api/v1/admin/sessions-pro/export endpoint in `apps/api/src/routes/sessions-pro.ts` generating Excel file using exceljs
- [X] T073 [US4] Implement exportSessionsToExcel method in `apps/api/src/services/session-pro.service.ts` creating Excel workbook with formatted headers, session data, and auto-filters
- [X] T074 [US4] Add table sorting functionality in AdminSessionsList (sortable columns: date_debut, prix_ttc, places_disponibles)
- [X] T075 [US4] Add pagination controls in AdminSessionsList with page size selector (10/25/50/100)

**Checkpoint**: At this point, User Stories 1-4 should work independently. Admins can view and manage all sessions with filtering, search, and export capabilities.

---

## Phase 7: User Story 5 - Admin: Edit Session Details (Priority: P2)

**Goal**: Enable administrators to update existing session information with validation (trainer availability, capacity constraints) and automatic participant notifications

**Independent Test**: Admin edits an existing session, modifies various fields (dates, location, trainers, capacity, pricing), verifies validation rules work (trainer conflicts detected, capacity reduction prevented if below enrollments), and confirms changes are reflected in the public view. This delivers value by enabling session information updates.

### Implementation for User Story 5

- [X] T076 [US5] Implement PUT /api/v1/admin/sessions-pro/:id endpoint in `apps/api/src/routes/sessions-pro.ts` with admin authentication and partial update support
- [X] T077 [US5] Implement updateSession method in `apps/api/src/services/session-pro.service.ts` with validation (capacity constraints, date validation, trainer availability re-check if dates/trainers change), status restrictions (cannot modify en_cours/terminee except to annulee), and transaction management
- [X] T078 [US5] Implement updateFormateurs method in `apps/api/src/services/session-pro.service.ts` updating session_formateurs records when trainers change
- [X] T079 [US5] Implement notifyInscrits method in `apps/api/src/services/session-pro.service.ts` sending email notifications when critical fields change (dates, location, video link)
- [X] T080 [US5] Create admin session edit page in `apps/web/src/app/formations-professionnelles/admin/sessions/[id]/modifier/page.tsx` reusing SessionFormWizard with pre-filled data
- [X] T081 [US5] Implement useUpdateSession hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` using TanStack Query mutation for session updates
- [X] T082 [US5] Add validation in updateSession service method to prevent capacity reduction below places_reservees
- [X] T083 [US5] Add field restriction logic in SessionFormWizard for sessions with status 'en_cours' or 'terminee' (disable most fields, allow only status change to 'annulee')
- [X] T084 [US5] Implement PATCH /api/v1/admin/sessions-pro/:id/statut endpoint in `apps/api/src/routes/sessions-pro.ts` for status updates
- [X] T085 [US5] Implement updateSessionStatus method in `apps/api/src/services/session-pro.service.ts` with status transition validation and notification triggers (if annulee)
- [X] T086 [US5] Add status change UI in AdminSessionDetail component with dropdown and confirmation dialog
- [X] T087 [US5] Implement change detection in updateSession service method to identify which fields changed for notification purposes

**Checkpoint**: At this point, User Stories 1-5 should work independently. Admins can create, view, and edit sessions with full validation and notification support.

---

## Phase 8: User Story 6 - Admin: View Session Enrollment Details (Priority: P3)

**Goal**: Enable administrators to view enrollment details for sessions including participant information, enrollment status, payment status, and export capabilities

**Independent Test**: Admin views a session's enrollment details, sees the list of enrolled participants with their contact information, enrollment status, and payment status, applies filters (enrollment status, payment status), and exports the enrollment list. This delivers value by providing enrollment visibility for session management.

### Implementation for User Story 6

- [X] T088 [US6] Implement GET /api/v1/admin/sessions-pro/:id/inscrits endpoint in `apps/api/src/routes/sessions-pro.ts` with admin authentication and filtering (statut, paiement, search)
- [X] T089 [US6] Implement getSessionEnrollments method in `apps/api/src/services/session-pro.service.ts` with tenant filtering, includes (apprenant, entreprise), and enrollment/payment status filtering
- [X] T090 [US6] Create InscritListsTab component in `apps/web/src/components/sessions-pro/InscritListsTab.tsx` with enrollment table displaying participant info, enrollment type, entreprise, enrollment status, payment status, date inscription, and actions
- [X] T091 [US6] Create InscritActionsToolbar component in `apps/web/src/components/sessions-pro/InscritActionsToolbar.tsx` with export button and email groupé button
- [X] T092 [US6] Create InscritTable component in `apps/web/src/components/sessions-pro/InscritTable.tsx` with columns, filters, search, and row actions menu
- [X] T093 [US6] Create InscritActionsMenu component in `apps/web/src/components/sessions-pro/InscritActionsMenu.tsx` with actions (voir détail, envoyer email, marquer présent/absent, annuler inscription, rembourser)
- [X] T094 [US6] Create admin session detail page in `apps/web/src/app/formations-professionnelles/admin/sessions/[id]/details/page.tsx` with tabs (Informations, Inscrits, Statistiques)
- [X] T095 [US6] Create SessionInfoTab component in `apps/web/src/components/sessions-pro/SessionInfoTab.tsx` displaying session details with quick actions (changer statut, progression capacité, revenus, télécharger documents)
- [X] T096 [US6] Create StatsTab component in `apps/web/src/components/sessions-pro/StatsTab.tsx` with charts (inscriptions timeline, type inscription pie, payment status bar, capacity gauge) using recharts or Chart.js
- [X] T097 [US6] Implement GET /api/v1/admin/sessions-pro/:id/inscrits/export endpoint in `apps/api/src/routes/sessions-pro.ts` generating Excel file
- [X] T098 [US6] Implement exportEnrollmentsToExcel method in `apps/api/src/services/session-pro.service.ts` creating Excel workbook with enrollment data
- [X] T099 [US6] Implement GET /api/v1/admin/sessions-pro/:id/stats endpoint in `apps/api/src/routes/sessions-pro.ts` returning session statistics (inscriptions timeline, type distribution, payment status, capacity metrics)
- [X] T100 [US6] Implement getSessionStats method in `apps/api/src/services/session-pro.service.ts` calculating enrollment trends, type distribution, payment status breakdown, and capacity utilization
- [X] T101 [US6] Add enrollment filters in InscritTable (statut inscription, statut paiement, type)
- [X] T102 [US6] Implement useSessionEnrollments hook in `apps/web/src/lib/hooks/use-sessions-pro.ts` using TanStack Query with filters

**Checkpoint**: At this point, all user stories should work independently. Admins have full session management capabilities including enrollment visibility and statistics.

---

## Phase 9: Additional Features & Polish

**Purpose**: Cross-cutting features and improvements

- [X] T103 [P] Implement POST /api/v1/admin/sessions-pro/:id/dupliquer endpoint in `apps/api/src/routes/sessions-pro.ts` for session duplication
- [X] T104 [P] Implement duplicateSession method in `apps/api/src/services/session-pro.service.ts` copying session data with new dates and validating trainer availability
- [X] T105 [P] Implement GET /api/v1/admin/formateurs/disponibilites endpoint in `apps/api/src/routes/sessions-pro.ts` for trainer availability checking
- [X] T106 [P] Implement getFormateursDisponibilites method in `apps/api/src/services/formateur-availability.service.ts` returning availability status and conflicts for each trainer
- [X] T107 [P] Implement updateSessionCapacity method in `apps/api/src/services/session-pro.service.ts` automatically updating places_reservees and statut (complete/ouverte) when enrollments change
- [X] T108 [P] Add capacity update trigger/hook to call updateSessionCapacity after enrollment create/update/delete operations
- [X] T109 [P] Implement email notification templates for session modifications (dates, location, video link changes) in `apps/api/src/services/notification.service.ts` (if separate service exists)
- [X] T110 [P] Implement email notification for session cancellation in `apps/api/src/services/notification.service.ts` with refund initiation logic
- [X] T111 [P] Add responsive design for calendar view (mobile, tablet, desktop breakpoints)
- [X] T112 [P] Add loading states and error handling in all frontend components
- [X] T113 [P] Add breadcrumb navigation in admin pages
- [X] T114 [P] Add session code validation and uniqueness check in generateCodeSession method
- [X] T115 [P] Implement session deletion with soft delete (set status to 'annulee') instead of hard delete if enrollments exist
- [X] T116 [P] Add French locale support for FullCalendar (import from @fullcalendar/core/locales/fr)
- [X] T117 [P] Add session detail modal for calendar event clicks (alternative to navigation)
- [X] T118 [P] Run quickstart.md validation to ensure all examples work correctly

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
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 for navigation from calendar
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories (creates sessions that appear in US1)
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories (manages sessions)
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Depends on US3 (sessions must exist to edit)
- **User Story 6 (P3)**: Can start after Foundational (Phase 2) - Depends on US3 (sessions must exist to view enrollments, though enrollments are Phase 4)

### Within Each User Story

- Contracts/schemas before services
- Services before endpoints
- Endpoints before frontend components
- Components before pages
- Core implementation before integration

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows)
- Models/services within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members
- Frontend and backend work for the same story can be parallelized

---

## Parallel Example: User Story 1

```bash
# Launch all foundational contract schemas together:
Task: "Create Zod schemas for session management in packages/contracts/src/sessions-pro/session.schema.ts"
Task: "Create Zod schemas for calendar events in packages/contracts/src/sessions-pro/calendar.schema.ts"
Task: "Create Zod schemas for admin endpoints in packages/contracts/src/sessions-pro/admin.schema.ts"
Task: "Create TypeScript types export in packages/contracts/src/sessions-pro/types.ts"

# Launch service and route setup together:
Task: "Create SessionProService class skeleton in apps/api/src/services/session-pro.service.ts"
Task: "Create FormateurAvailabilityService class skeleton in apps/api/src/services/formateur-availability.service.ts"
Task: "Create base API route structure in apps/api/src/routes/sessions-pro.ts"

# Launch frontend components together:
Task: "Create CalendarComponent in apps/web/src/components/sessions-pro/CalendarComponent.tsx"
Task: "Create CalendarToolbar component in apps/web/src/components/sessions-pro/CalendarToolbar.tsx"
Task: "Create SessionEventCard component in apps/web/src/components/sessions-pro/SessionEventCard.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Public Calendar)
4. Complete Phase 4: User Story 2 (Session Details)
5. **STOP and VALIDATE**: Test User Stories 1 & 2 independently
6. Deploy/demo if ready

**MVP Value**: Users can discover and view training sessions, enabling the core discovery workflow.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Stories 1 & 2 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 3 → Test independently → Deploy/Demo (Admins can create sessions)
4. Add User Story 4 → Test independently → Deploy/Demo (Admins can manage sessions)
5. Add User Story 5 → Test independently → Deploy/Demo (Admins can edit sessions)
6. Add User Story 6 → Test independently → Deploy/Demo (Full admin capabilities)
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Stories 1 & 2 (Public calendar & details)
   - Developer B: User Story 3 (Create sessions)
   - Developer C: User Story 4 (Manage sessions)
3. After User Story 3 completes:
   - Developer A: User Story 5 (Edit sessions)
   - Developer B: User Story 6 (Enrollment details)
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Database schema already exists from Phase 1 (migration 0037) - no schema changes needed
- Trainer availability checks must be tenant-scoped
- All queries must include tenant_id filtering via RLS
- Real-time availability uses polling (30-second interval) via TanStack Query
- Session codes auto-generated in format PREFIX-YEAR-NUMBER
- Capacity updates automatic via service method after enrollment changes

---

## Summary

- **Total Tasks**: 118 tasks
- **User Story 1 (P1)**: 11 tasks - Public calendar viewing
- **User Story 2 (P1)**: 15 tasks - Session detail viewing
- **User Story 3 (P2)**: 17 tasks - Admin session creation
- **User Story 4 (P2)**: 14 tasks - Admin session management
- **User Story 5 (P2)**: 12 tasks - Admin session editing
- **User Story 6 (P3)**: 15 tasks - Admin enrollment details
- **Setup**: 8 tasks
- **Foundational**: 10 tasks
- **Polish**: 16 tasks

**Suggested MVP Scope**: User Stories 1 & 2 (Public calendar and session details) - 26 tasks total after Setup and Foundational phases.

