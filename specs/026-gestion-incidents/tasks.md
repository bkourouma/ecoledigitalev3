---
description: "Task list for Phase 6 - Gestion des Incidents"
---

# Tasks: Phase 6 - Gestion des Incidents

**Input**: Design documents from `/specs/026-gestion-incidents/`
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

**Purpose**: Project initialization and basic structure for incident management

- [X] T001 [P] Install backend dependencies: `@fastify/multipart`, `puppeteer`, `sharp`, `node-cron`, `exceljs` in `apps/api/`
- [X] T002 [P] Install frontend dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `recharts`, `react-dropzone` in `apps/web/`
- [X] T003 [P] Create incident module directory structure: `apps/api/src/routes/rso/incidents/`, `apps/api/src/services/rso/incident*.ts`
- [X] T004 [P] Create frontend incident pages structure: `apps/web/src/app/rso/incidents/`, `apps/web/src/components/rso/incidents/`
- [X] T005 [P] Create shared TypeScript contracts: `packages/contracts/src/rso/incidents.ts` (copy from `specs/026-gestion-incidents/contracts/incidents.contracts.ts`)
- [X] T006 [P] Add incident environment variables to `apps/api/.env.example`: File upload limits, MinIO/S3 config, PDF generation config

**Checkpoint**: Project structure ready for incident management module

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 Create database migration script: `infra/scripts/migrations/026_create_incidents_tables.sql` with all 6 tables (rso_incidents, rso_incidents_medias, rso_incidents_historique, rso_incidents_commentaires, rso_incidents_mesures, rso_incidents_stats)
- [X] T008 [P] Create database indexes and full-text search indexes in migration script
- [X] T009 [P] Create RLS policies for all incident tables in migration script
- [X] T010 Run database migration and verify all tables created successfully
- [X] T011 [P] Create base incident service: `apps/api/src/services/rso/incidentService.ts` with core CRUD methods
- [X] T012 [P] Create incident file service: `apps/api/src/services/rso/incidentFileService.ts` with MinIO/S3 integration and thumbnail generation
- [X] T013 [P] Create incident notification service: `apps/api/src/services/rso/incidentNotificationService.ts` extending existing notification infrastructure
- [X] T014 [P] Create incident code generator utility: `apps/api/src/utils/rso/incidentCodeGenerator.ts` for format INC-YYYY-CODE_INSTALLATION-XXX
- [X] T015 Create incident authorization middleware: `apps/api/src/plugins/rso-incident-auth.ts` for access control (agents only their installation, RSOs their installations, admins all)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Agent de Sûreté enregistre rapidement un incident (Priority: P1) 🎯 MVP

**Goal**: Enable security agents to quickly register incidents from desktop or mobile devices with essential information and evidence upload

**Independent Test**: An agent can access the quick registration form, fill required fields (installation, type, date/time, zone, short description, urgency), upload a photo, and save the incident. The incident is created with a unique code, "nouveau" status is assigned, and a notification is sent to the RSO. This demonstrates the complete emergency registration workflow.

### Implementation for User Story 1

- [x] T016 [US1] Create incident creation route: `apps/api/src/routes/rso/incidents/create.ts` with POST endpoint `/api/rso/incidents`
- [x] T017 [US1] Implement incident creation handler in `create.ts` with Zod validation schema for CreateIncidentRequest
- [x] T018 [US1] Implement incident code generation in `incidentService.ts` using `incidentCodeGenerator.ts` utility
- [x] T019 [US1] Add incident creation method to `incidentService.ts` with database insert and history logging
- [x] T020 [US1] Integrate notification service in incident creation to notify RSOs (in-app + email for critical)
- [x] T021 [US1] Create quick registration form component: `apps/web/src/components/rso/incidents/IncidentFormRapide.tsx` with mobile-optimized layout
- [x] T022 [US1] Implement form fields in `IncidentFormRapide.tsx`: installation (pre-filled), type, date/time (pre-filled), zone, description courte, niveau urgence
- [x] T023 [US1] Create file upload component: `apps/web/src/components/rso/incidents/IncidentMediaUpload.tsx` with drag-and-drop using react-dropzone
- [x] T024 [US1] Implement file upload route: `apps/api/src/routes/rso/incidents/medias.ts` with POST `/api/rso/incidents/:id/medias` using @fastify/multipart
- [x] T025 [US1] Add file validation in medias route: size (100 MB max), MIME types (JPG, PNG, MP4, PDF)
- [x] T026 [US1] Implement file storage in `incidentFileService.ts`: upload to MinIO/S3 with path structure `rso/incidents/{incident_id}/medias/{media_id}/original/{filename}`
- [x] T027 [US1] Implement thumbnail generation in `incidentFileService.ts` using Sharp for images
- [x] T028 [US1] Save media metadata to `rso_incidents_medias` table after successful upload
- [x] T029 [US1] Create incident creation page: `apps/web/src/app/rso/incidents/nouveau/page.tsx` using IncidentFormRapide component
- [ ] T030 [US1] Implement draft saving functionality: allow saving incomplete incidents with status "brouillon" (Optional for MVP)
- [x] T031 [US1] Add form validation and error handling in IncidentFormRapide component
- [x] T032 [US1] Integrate file upload in quick registration form with progress indicators

**Checkpoint**: At this point, User Story 1 should be fully functional - agents can create incidents with essential info and upload evidence

---

## Phase 4: User Story 2 - RSO prend en charge et traite un incident (Priority: P1)

**Goal**: Enable RSOs to take charge of incidents, evaluate severity, assign to responsible persons, define priority, and track treatment until resolution

**Independent Test**: An RSO receives a notification for a new incident, accesses details, evaluates severity, assigns incident to a responsible person, changes status to "en investigation", adds immediate measures, and tracks evolution until resolution. This validates the complete treatment workflow.

### Implementation for User Story 2

- [x] T033 [US2] Create incident details route: `apps/api/src/routes/rso/incidents/details.ts` with GET `/api/rso/incidents/:id`
- [x] T034 [US2] Implement incident details handler with full data loading (incident, medias, commentaires, mesures, historique)
- [x] T035 [US2] Create status change route: `apps/api/src/routes/rso/incidents/status.ts` with PATCH `/api/rso/incidents/:id/statut`
- [x] T036 [US2] Implement status change validation in `incidentService.ts`: validate state transitions (nouveau → en_investigation → en_traitement → resolu → clos)
- [x] T037 [US2] Create assignment route: `apps/api/src/routes/rso/incidents/assign.ts` with PATCH `/api/rso/incidents/:id/assigner`
- [x] T038 [US2] Implement assignment logic in `incidentService.ts`: update assigne_a, set date_prise_en_charge, log history
- [x] T039 [US2] Add notification on assignment: notify assigned responsible person via notification service
- [x] T040 [US2] Create priority and category update in `incidentService.ts`: allow RSO to set priorite (P1-P4) and categorie
- [x] T041 [US2] Create measures route: `apps/api/src/routes/rso/incidents/mesures.ts` with POST `/api/rso/incidents/:id/mesures` for immediate measures
- [x] T042 [US2] Implement immediate measures storage: save to mesures_immediates field and create entry in rso_incidents_mesures table
- [x] T043 [US2] Create incident details page: `apps/web/src/app/rso/incidents/[id]/page.tsx` with full incident information display
- [x] T044 [US2] Create incident details component: Integrated in page with tabs for different sections
- [x] T045 [US2] Implement status change UI in IncidentDetails component with dropdown and confirmation
- [x] T046 [US2] Implement assignment UI in IncidentDetails component with user selector (via status change)
- [x] T047 [US2] Create measures component: `apps/web/src/components/rso/incidents/IncidentMeasures.tsx` for displaying and adding measures
- [x] T048 [US2] Create history component: `apps/web/src/components/rso/incidents/IncidentHistory.tsx` for displaying complete audit trail
- [x] T049 [US2] Implement validation route: `apps/api/src/routes/rso/incidents/validate.ts` with PATCH `/api/rso/incidents/:id/valider`
- [x] T050 [US2] Implement closure route: `apps/api/src/routes/rso/incidents/close.ts` with PATCH `/api/rso/incidents/:id/cloturer`
- [x] T051 [US2] Add date tracking: automatically set date_prise_en_charge, date_resolution, date_validation, date_cloture based on status changes

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - RSOs can take charge and process incidents

---

## Phase 5: User Story 3 - Responsable assigné traite un incident (Priority: P1)

**Goal**: Enable assigned responsible persons to consult details, add investigation information, define and track corrective and preventive measures, and update incident status

**Independent Test**: An assigned responsible person receives assignment notification, accesses the incident, adds investigation comments, creates corrective measures with due dates and responsible persons, updates measure status, and changes incident status to "en traitement" then "résolu". This validates complete operational treatment.

### Implementation for User Story 3

- [x] T052 [US3] Create commentaires route: `apps/api/src/routes/rso/incidents/commentaires.ts` with POST `/api/rso/incidents/:id/commentaires`
- [x] T053 [US3] Implement comment creation in `incidentService.ts`: save to rso_incidents_commentaires table with type_commentaire support
- [x] T054 [US3] Create commentaires update route: `apps/api/src/routes/rso/incidents/commentaires.ts` with PUT/DELETE `/api/rso/incidents/:id/commentaires/:commentId`
- [x] T055 [US3] Create measures CRUD routes: `apps/api/src/routes/rso/incidents/mesures-crud.ts` with GET/POST/PUT/DELETE
- [x] T056 [US3] Implement measure creation in `incidentService.ts`: save to rso_incidents_mesures with type_mesure (immediate, corrective, preventive)
- [x] T057 [US3] Create measure status change route: `apps/api/src/routes/rso/incidents/mesures-status.ts` with PATCH `/api/rso/incidents/:id/mesures/:mesureId/statut`
- [x] T058 [US3] Implement measure status tracking: update statut (planifiee, en_cours, terminee, annulee) with date_realisation
- [x] T059 [US3] Add notification on measure assignment: notify measure responsible person when measure is created
- [x] T060 [US3] Create comments component: `apps/web/src/components/rso/incidents/IncidentComments.tsx` for displaying and adding comments
- [x] T061 [US3] Implement comment form in IncidentComments component with type selection and visibility options
- [x] T062 [US3] Enhance IncidentMeasures component: add form for creating corrective and preventive measures
- [x] T063 [US3] Implement measure status update UI in IncidentMeasures component
- [x] T064 [US3] Add additional media upload capability: allow responsible persons to add more evidence files (via IncidentMediaUpload component)
- [x] T065 [US3] Implement incident status update to "en_traitement" when responsible person starts working
- [x] T066 [US3] Implement incident status update to "résolu" with resolution comment and date tracking

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently - complete workflow from creation to resolution

---

## Phase 6: User Story 4 - Administrateur consulte le dashboard des incidents (Priority: P2)

**Goal**: Enable administrators to consult a complete incident dashboard with global statistics, evolution charts, urgent incident alerts, and analyses by installation, type, and period

**Independent Test**: An administrator accesses the incident dashboard, sees global statistics (total, new, in progress, resolved), consults critical incidents in progress, visualizes monthly evolution charts, and analyzes distribution by incident type. Can filter by installation and period. This validates complete dashboard functionality.

### Implementation for User Story 4

- [ ] T067 [US4] Create statistics service: `apps/api/src/services/rso/incidentStatsService.ts` for calculating dashboard statistics
- [ ] T068 [US4] Implement statistics aggregation: calculate totals, by category, by status, by installation from rso_incidents_stats cache table
- [ ] T069 [US4] Create dashboard route: `apps/api/src/routes/rso/incidents/dashboard.ts` with GET `/api/rso/incidents/dashboard`
- [ ] T070 [US4] Implement dashboard endpoint: return IncidentDashboardResponse with stats, evolution, distribution, resolution times, urgent incidents
- [ ] T071 [US4] Implement monthly evolution calculation: group incidents by month with total, critiques, resolus counts
- [ ] T072 [US4] Implement type distribution calculation: count and percentage by incident type
- [ ] T073 [US4] Implement resolution time calculation: average resolution time by category with objective comparison
- [ ] T074 [US4] Create urgent incidents query: fetch incidents with niveau_urgence 'critique' or 'eleve' ordered by date
- [ ] T075 [US4] Create dashboard page: `apps/web/src/app/rso/incidents/dashboard/page.tsx`
- [ ] T076 [US4] Create dashboard component: `apps/web/src/components/rso/incidents/IncidentDashboard.tsx` with statistics cards
- [ ] T077 [US4] Implement statistics cards in IncidentDashboard: total, nouveaux, en_cours, resolus with visual indicators
- [ ] T078 [US4] Create charts component: `apps/web/src/components/rso/incidents/IncidentStats.tsx` using Recharts
- [ ] T079 [US4] Implement monthly evolution chart: bar chart showing total, critiques, resolus per month
- [ ] T080 [US4] Implement type distribution chart: pie or bar chart showing incident distribution by type
- [ ] T081 [US4] Implement resolution time display: table or cards showing average resolution time by category with objective indicators
- [ ] T082 [US4] Create urgent incidents list component in dashboard with links to incident details
- [ ] T083 [US4] Implement dashboard filters: installation selector and period selector (year, month range)
- [ ] T084 [US4] Add per-installation statistics table in dashboard showing totals, critiques, resolus per installation

**Checkpoint**: At this point, User Story 4 should be fully functional - administrators can view comprehensive dashboard

---

## Phase 7: User Story 5 - Utilisateur consulte et recherche des incidents (Priority: P2)

**Goal**: Enable authorized users to consult incident list with advanced filters, search by keywords, view in list or Kanban mode, and access complete incident details

**Independent Test**: A user accesses the incident list, applies filters (status, type, urgency, installation, period), performs keyword search, views results in list mode then Kanban mode, and opens incident details. This validates complete consultation and search functionality.

### Implementation for User Story 5

- [x] T085 [US5] Create incident list route: `apps/api/src/routes/rso/incidents/list.ts` with GET `/api/rso/incidents` with pagination
- [x] T086 [US5] Implement list endpoint with filters: support IncidentFilters (statut, type, urgence, categorie, installation, date range, assigne, declare_par)
- [x] T087 [US5] Implement full-text search: use PostgreSQL FTS with GIN index on titre, description_courte, description_detaillee
- [x] T088 [US5] Create search route: `apps/api/src/routes/rso/incidents/search.ts` with POST `/api/rso/incidents/search` for advanced search
- [x] T089 [US5] Implement search endpoint: combine full-text search with filters and return paginated results with ranking
- [x] T090 [US5] Create incident list page: `apps/web/src/app/rso/incidents/page.tsx` with list and Kanban view toggle
- [x] T091 [US5] Create list component: `apps/web/src/components/rso/incidents/IncidentList.tsx` with table view and pagination
- [x] T092 [US5] Create incident card component: `apps/web/src/components/rso/incidents/IncidentCard.tsx` for displaying incident summary
- [x] T093 [US5] Create filters component: `apps/web/src/components/rso/incidents/IncidentFilters.tsx` with all filter options
- [x] T094 [US5] Create search component: `apps/web/src/components/rso/incidents/IncidentSearch.tsx` with keyword input and search button
- [x] T095 [US5] Implement filter application: update list when filters change, persist filters in localStorage
- [x] T096 [US5] Implement search functionality: trigger search on keyword input with debouncing
- [x] T097 [US5] Create Kanban component: `apps/web/src/components/rso/incidents/IncidentKanban.tsx` using @dnd-kit/core
- [x] T098 [US5] Implement Kanban columns: organize incidents by statut (nouveau, en_investigation, en_traitement, resolu, clos)
- [x] T099 [US5] Implement drag-and-drop in Kanban: allow moving incidents between columns to change status
- [x] T100 [US5] Add status change on drop: call status change API when incident is dropped in new column
- [x] T101 [US5] Implement optimistic UI updates in Kanban: update UI immediately, rollback on API failure
- [x] T102 [US5] Create export route: `apps/api/src/routes/rso/incidents/export-excel.ts` with POST `/api/rso/incidents/export/excel`
- [x] T103 [US5] Implement Excel export: use exceljs to generate Excel file with filtered incident data
- [x] T104 [US5] Add export button in IncidentList component with format selection

**Checkpoint**: At this point, User Story 5 should be fully functional - users can search, filter, and view incidents in multiple ways

---

## Phase 8: User Story 6 - Système génère un rapport PDF d'incident (Priority: P2)

**Goal**: Enable system to generate professional and complete PDF report for an incident, including all information, evidence, measures, and history, formatted according to ISPS code standards

**Independent Test**: A user accesses a resolved or closed incident, clicks "Generate PDF report", and receives a complete PDF file with cover page, executive summary, detailed description, involved persons, impact, evidence, measures, chronology, and conclusion. PDF is well-formatted and professional. This validates complete report generation.

### Implementation for User Story 6

- [x] T105 [US6] Create PDF report generator service: `apps/api/src/services/rso/incidentReportGenerator.ts` using Puppeteer
- [x] T106 [US6] Create HTML template for PDF: `apps/api/src/templates/rso/incident-report.html` with professional styling
- [x] T107 [US6] Implement cover page generation: include incident code, type, installation, urgency level with visual indicators
- [x] T108 [US6] Implement executive summary section: key information table with all essential incident data
- [x] T109 [US6] Implement detailed description section: formatted description with circumstances
- [x] T110 [US6] Implement involved persons section: display witnesses, suspects, victims with contact information
- [x] T111 [US6] Implement impact section: material, operational, human impact with estimated costs
- [x] T112 [US6] Implement evidence section: embed images from MinIO/S3 URLs in PDF with captions
- [x] T113 [US6] Implement measures section: display immediate, corrective, preventive measures with status and dates
- [x] T114 [US6] Implement chronology section: timeline of all history entries with dates and actions
- [x] T115 [US6] Implement conclusion section: closure date and preventive measures summary for closed incidents
- [x] T116 [US6] Configure Puppeteer PDF options: A4 format, margins, print background graphics, page breaks
- [x] T117 [US6] Create PDF export route: `apps/api/src/routes/rso/incidents/export-pdf.ts` with GET `/api/rso/incidents/:id/export/pdf`
- [x] T118 [US6] Implement PDF generation endpoint: load incident data, generate HTML, render to PDF, return as download
- [x] T119 [US6] Add PDF generation button in IncidentDetails component with loading state
- [x] T120 [US6] Handle large evidence files: optimize image sizes or use async generation for incidents with >20 images

**Checkpoint**: At this point, User Story 6 should be fully functional - professional PDF reports can be generated

---

## Phase 9: User Story 7 - Système envoie des notifications automatiques (Priority: P2)

**Goal**: Enable system to automatically send notifications to concerned users upon incident creation, status changes, assignments, and delayed incident treatment

**Independent Test**: An agent creates a critical incident, RSO immediately receives notification in application and email. RSO assigns incident to responsible person, who receives notification. A critical incident exceeds 6 hours without treatment, system sends delay alert. This validates complete notification system.

### Implementation for User Story 7

- [x] T121 [US7] Extend notification service: add incident-specific notification types (incident_nouveau, incident_changement_statut, incident_assignation, incident_retard)
- [x] T122 [US7] Implement new incident notification: notify all RSOs of installation when incident is created (in-app + email for critical)
- [x] T123 [US7] Implement status change notification: notify declarant and assigned responsible when status changes
- [x] T124 [US7] Implement assignment notification: notify new responsible person (in-app + email) when incident is assigned
- [x] T125 [US7] Create delay detection service: `apps/api/src/services/rso/incidentDelayDetection.ts` for checking delayed incidents
- [x] T126 [US7] Implement delay detection logic: check incidents exceeding thresholds (critical: 6h, high: 24h, moderate: 7 days, minor: 14 days)
- [x] T127 [US7] Create scheduled task: `apps/api/src/jobs/rso/check-incidents-retard.job.ts` using node-cron (run hourly)
- [x] T128 [US7] Implement delay notification: notify assigned responsible and administrators when incident is delayed
- [x] T129 [US7] Register scheduled task in Fastify application startup
- [x] T130 [US7] Create statistics aggregation task: `apps/api/src/jobs/rso/generate-incident-stats.job.ts` (run daily at 23:00)
- [x] T131 [US7] Implement statistics aggregation: calculate and store daily statistics in rso_incidents_stats table
- [x] T132 [US7] Register statistics aggregation task in Fastify application startup
- [x] T133 [US7] Create notification route: `apps/api/src/routes/rso/incidents/notify.ts` with POST `/api/rso/incidents/:id/notifier` for manual notifications
- [x] T134 [US7] Add notification links: ensure all notifications include direct link to incident details page
- [x] T135 [US7] Implement email templates: create HTML email templates for critical incident notifications and assignment notifications

**Checkpoint**: At this point, User Story 7 should be fully functional - automatic notifications work for all incident events

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final integration

- [x] T136 [P] Create media gallery component: `apps/web/src/components/rso/incidents/IncidentMediaGallery.tsx` for displaying evidence files with lightbox
- [x] T137 [P] Implement media viewing: allow users to view full-size images and download files
- [x] T138 [P] Add incident archiving functionality: automatically archive incidents older than 2 years from closure
- [x] T139 [P] Create archiving scheduled task: `apps/api/src/jobs/rso/archive-incidents.job.ts` (run monthly)
- [x] T140 [P] Implement access control validation: ensure agents can only access incidents from their installation
- [x] T141 [P] Add comprehensive error handling across all incident endpoints
- [x] T142 [P] Implement request logging for all incident operations (ISPS compliance)
- [x] T143 [P] Add input sanitization and XSS prevention in all forms
- [x] T144 [P] Optimize database queries: add missing indexes, optimize full-text search queries
- [x] T145 [P] Add loading states and error messages in all frontend components
- [x] T146 [P] Implement form validation feedback with clear error messages
- [x] T147 [P] Add responsive design improvements for mobile devices
- [x] T148 [P] Run quickstart.md validation checklist
- [x] T149 [P] Update documentation with incident management API endpoints
- [x] T150 [P] Code cleanup and refactoring: remove unused code, improve code organization

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories - **MVP CANDIDATE**
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 (needs incidents to exist) but independently testable
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 and US2 (needs incidents with assignments) but independently testable
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (needs incidents for statistics) but independently testable
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (needs incidents to list) but independently testable
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (needs incidents for reports) but independently testable
- **User Story 7 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (needs incidents to notify about) but independently testable

### Within Each User Story

- Models/entities before services
- Services before endpoints/routes
- Backend routes before frontend components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks (T001-T006) marked [P] can run in parallel
- All Foundational tasks marked [P] (T008, T011-T014) can run in parallel (within Phase 2)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows)
- Within each user story, tasks marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members (after US1 completes)

---

## Parallel Example: User Story 1

```bash
# Launch all setup tasks together:
Task: "Install backend dependencies" (T001)
Task: "Install frontend dependencies" (T002)
Task: "Create incident module directory structure" (T003)
Task: "Create frontend incident pages structure" (T004)
Task: "Create shared TypeScript contracts" (T005)
Task: "Add incident environment variables" (T006)

# Launch foundational tasks marked [P] together:
Task: "Create database indexes" (T008)
Task: "Create base incident service" (T011)
Task: "Create incident file service" (T012)
Task: "Create incident notification service" (T013)
Task: "Create incident code generator utility" (T014)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Rapid incident registration)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

**MVP Deliverable**: Agents can create incidents quickly with essential info and evidence upload, RSOs receive notifications

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (RSO workflow)
4. Add User Story 3 → Test independently → Deploy/Demo (Complete treatment workflow)
5. Add User Stories 4-7 → Test independently → Deploy/Demo (Full feature set)
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (MVP - blocking)
   - Developer B: Prepare User Story 2 (can start after US1 creates first incident)
   - Developer C: Prepare User Story 4 (dashboard - can work on stats service)
3. After US1 completes:
   - Developer A: User Story 2 (RSO workflow)
   - Developer B: User Story 3 (Responsible person workflow)
   - Developer C: User Story 4 (Dashboard)
   - Developer D: User Story 5 (Search/List)
   - Developer E: User Story 6 (PDF reports)
   - Developer F: User Story 7 (Notifications)
4. Stories complete and integrate independently

---

## Summary

**Total Tasks**: 150 tasks
**Task Count by User Story**:
- Setup (Phase 1): 6 tasks
- Foundational (Phase 2): 9 tasks
- User Story 1 (P1): 17 tasks - **MVP**
- User Story 2 (P1): 19 tasks
- User Story 3 (P1): 15 tasks
- User Story 4 (P2): 18 tasks
- User Story 5 (P2): 20 tasks
- User Story 6 (P2): 16 tasks
- User Story 7 (P2): 15 tasks
- Polish (Phase 10): 15 tasks

**Parallel Opportunities**: 
- 6 setup tasks can run in parallel
- 5 foundational tasks can run in parallel
- Multiple user stories can be worked on in parallel after US1 completes
- Within each story, many tasks marked [P] can run in parallel

**Independent Test Criteria**:
- US1: Agent creates incident with code, status, notification
- US2: RSO receives notification, assigns, changes status, adds measures
- US3: Responsible person receives assignment, adds comments, creates measures, resolves
- US4: Administrator views dashboard with stats, charts, urgent incidents
- US5: User searches, filters, views list/Kanban, exports
- US6: User generates PDF report with all information
- US7: System sends notifications for creation, status change, assignment, delays

**Suggested MVP Scope**: User Story 1 only (rapid incident registration) - 32 tasks total (Setup + Foundational + US1)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All file paths are relative to repository root
- Follow existing RSO-PFSO patterns from Phases 1-5

