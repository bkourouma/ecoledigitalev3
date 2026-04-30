# Tasks: Trainer Space (Espace Formateurs) - Imhotep Data

**Input**: Design documents from `/specs/019-espace-formateurs-imhotep/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Backend API**: `apps/api/src/`
- **Frontend**: `apps/web/src/app/`
- **Contracts**: `packages/contracts/src/formateurs/`
- **UI Components**: `packages/ui/src/components/formateur/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create directory structure for trainer space feature
  - Create `apps/api/src/routes/formateur.ts`
  - Create `apps/api/src/services/formateur.service.ts`
  - Create `apps/api/src/services/attendance.service.ts`
  - Create `apps/api/src/services/supports-cours.service.ts`
  - Create `apps/api/src/services/formateur-messaging.service.ts`
  - Create `apps/web/src/app/formateur/` directory structure
  - Create `packages/contracts/src/formateurs/` directory

- [x] T002 [P] Install required dependencies
  - Backend: Verify Fastify, PostgreSQL client, file upload libraries
  - Frontend: Install `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`, `@fullcalendar/core`
  - Frontend: Verify TanStack Query is installed
  - Verify existing FileStorageService, EmailService, SMSService are available

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create database migration for new tables
  - Create migration file: `infra/scripts/migrations/0040_formateur_space_tables.sql`
  - Add `session_attendance` table with all fields, indexes, RLS policy
  - Add `support_session_associations` table with all fields, indexes, RLS policy
  - Add `support_telechargements` table with all fields, indexes, RLS policy
  - Add `formateur_indisponibilites` table with all fields, indexes, RLS policy
  - Add `notifications_formateurs` table with all fields, indexes, RLS policy
  - Add `notes_formateur` and `notes_updated_at` columns to `sessions_professionnelles`
  - Create all required indexes for performance
  - Enable RLS policies for all new tables
  - Add triggers for `updated_at` timestamps

- [x] T004 [P] Create Zod schemas in contracts package
  - Create `packages/contracts/src/formateurs/index.ts` with exports
  - Create `packages/contracts/src/formateurs/dashboard.schema.ts` with DashboardStatsSchema, SessionListItemSchema, SupportListItemSchema, NotificationItemSchema
  - Create `packages/contracts/src/formateurs/schedule.schema.ts` with PlanningQuerySchema, IndisponibiliteItemSchema, CalendarSessionEventSchema, CreateIndisponibiliteSchema
  - Create `packages/contracts/src/formateurs/sessions.schema.ts` with SessionListQuerySchema, SessionDetailSchema, FormationInfoSchema, InscritItemSchema
  - Create `packages/contracts/src/formateurs/attendance.schema.ts` with MarkPresenceSchema, AttendanceResponseSchema
  - Create `packages/contracts/src/formateurs/supports.schema.ts` with SupportsListQuerySchema, SupportDetailSchema, UploadSupportSchema, UpdateSupportSchema, SupportStatisticsSchema
  - Create `packages/contracts/src/formateurs/messaging.schema.ts` with GroupMessageSchema, GroupMessageResponseSchema
  - Create `packages/contracts/src/formateurs/profil.schema.ts` with FormateurProfileSchema, FormateurStatisticsSchema, UpdateProfileSchema
  - Export all schemas from index.ts

- [x] T005 Implement trainer authentication middleware
  - Create `apps/api/src/middleware/formateurAuth.ts`
  - Verify user is authenticated (existing auth check)
  - Verify user has formateur record (formateurs.user_id = user.id)
  - Verify formateur is active (formateurs.actif = true)
  - Attach formateur to request (req.formateur, req.formateurId)
  - Return 403 if trainer verification fails

- [x] T006 [P] Create base trainer route structure
  - Create `apps/api/src/routes/formateur.ts` with Fastify route registration
  - Add formateurAuthMiddleware to all routes
  - Set up route prefix `/api/v1/formateur`
  - Add error handling wrapper for all routes
  - Add tenant context extraction and RLS setup

- [x] T007 [P] Create session access verification utility
  - Create `apps/api/src/utils/sessionAccess.ts`
  - Implement `verifySessionAccess(sessionId, formateurId, tenantId)` function
  - Query `session_formateurs` table to verify assignment
  - Throw error if trainer not assigned to session
  - Reusable across all session-related endpoints

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Trainer Dashboard Overview (Priority: P1) 🎯 MVP

**Goal**: Trainer can view comprehensive dashboard with statistics, upcoming sessions, recent activity, and notifications

**Independent Test**: Trainer logs in, accesses dashboard, sees all statistics cards, upcoming sessions list, recent sessions list, recent materials list, and notifications widget. All data is accurate and links work.

### Implementation for User Story 1

- [x] T008 [US1] Implement dashboard service method
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getDashboardData(formateurId, tenantId)` method
  - Calculate statistics: sessions_a_venir, sessions_en_cours, sessions_terminees_mois, total_apprenants, heures_formation_mois
  - Query next 5 upcoming sessions (ordered by date_debut ASC)
  - Query last 5 completed sessions (ordered by date_fin DESC)
  - Query last 5 uploaded course materials (ordered by created_at DESC)
  - Query unread notifications count and recent 5 notifications
  - Return aggregated dashboard data

- [x] T009 [US1] Implement dashboard API endpoint
  - In `apps/api/src/routes/formateur.ts`
  - Create `GET /api/v1/formateur/dashboard` endpoint
  - Use formateurAuthMiddleware
  - Call formateurService.getDashboardData()
  - Return response matching DashboardResponseSchema
  - Add error handling

- [x] T010 [US1] Create dashboard page component
  - Create `apps/web/src/app/formateur/dashboard/page.tsx`
  - Use TanStack Query to fetch dashboard data
  - Display statistics cards (5 cards: upcoming, in progress, completed, learners, hours)
  - Display upcoming sessions widget (list of 5 sessions with links)
  - Display recent sessions widget (list of 5 sessions with links)
  - Display recent materials widget (list of 5 materials with links)
  - Display notifications widget (unread count + recent notifications)
  - Add loading states and error handling

- [x] T011 [US1] Create reusable dashboard components
  - Create `apps/web/src/components/formateur/DashboardStats.tsx` - Statistics cards component
  - Create `apps/web/src/components/formateur/ProchainesSessionsWidget.tsx` - Upcoming sessions list
  - Create `apps/web/src/components/formateur/SessionsRecentesWidget.tsx` - Recent sessions list
  - Create `apps/web/src/components/formateur/SupportsRecentsWidget.tsx` - Recent materials list
  - Create `apps/web/src/components/formateur/NotificationsWidget.tsx` - Notifications widget
  - All components should be responsive and follow design system

- [x] T012 [US1] Add trainer navigation and layout
  - Create `apps/web/src/app/formateur/layout.tsx` with trainer navigation
  - Add navigation links: Dashboard, Planning, Sessions, Supports, Profil
  - Add notification badge showing unread count
  - Add trainer profile header with name and photo
  - Ensure layout is responsive

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Trainer can view dashboard with all statistics and quick access to key information.

---

## Phase 4: User Story 2 - Trainer Schedule Management (Priority: P1)

**Goal**: Trainer can view schedule calendar with sessions and manage unavailability periods

**Independent Test**: Trainer views calendar for a month, sees all assigned sessions displayed, clicks on session to see details, adds unavailability period, sees it on calendar, removes unavailability period.

### Implementation for User Story 2

- [x] T013 [US2] Implement schedule service methods
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getSchedule(formateurId, tenantId, year, month)` method
  - Query assigned sessions for date range
  - Query unavailability periods for date range
  - Format sessions as FullCalendar events
  - Format unavailability as FullCalendar events (different color)
  - Return both arrays

- [x] T014 [US2] Implement unavailability CRUD service methods
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getIndisponibilites(formateurId, tenantId)` method
  - Create `createIndisponibilite(formateurId, tenantId, data)` method with validation
  - Create `deleteIndisponibilite(indispoId, formateurId, tenantId)` method with ownership check
  - All methods must verify formateur ownership

- [x] T015 [US2] Implement schedule API endpoints
  - In `apps/api/src/routes/formateur.ts`
  - Create `GET /api/v1/formateur/planning` endpoint with query params (annee, mois, vue)
  - Create `GET /api/v1/formateur/disponibilites` endpoint
  - Create `POST /api/v1/formateur/disponibilites` endpoint with CreateIndisponibiliteSchema validation
  - Create `DELETE /api/v1/formateur/disponibilites/:id` endpoint
  - All endpoints use formateurAuthMiddleware
  - Add error handling

- [x] T016 [US2] Create schedule calendar page
  - Create `apps/web/src/app/formateur/planning/page.tsx`
  - Install and configure FullCalendar with dayGridPlugin, timeGridPlugin, interactionPlugin
  - Use French locale for FullCalendar
  - Use TanStack Query to fetch schedule data
  - Display sessions in blue, unavailability in gray
  - Handle event click to show session details modal
  - Add month/week view toggle
  - Add "Add unavailability" button

- [x] T017 [US2] Create unavailability management components
  - Create `apps/web/src/components/formateur/IndisponibiliteModal.tsx` - Modal for creating unavailability
  - Add date range picker (date_debut, date_fin)
  - Add reason text input
  - Add validation (date_fin >= date_debut)
  - Create unavailability list component with delete action
  - Handle delete confirmation

- [x] T018 [US2] Create session detail modal
  - Create `apps/web/src/components/formateur/SessionDetailModal.tsx`
  - Display session information (code, formation, dates, mode, location/link)
  - Display enrolled learners count
  - Add link to full session details page
  - Handle modal open/close

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Trainer can view dashboard and manage schedule with unavailability periods.

---

## Phase 5: User Story 3 - View and Manage Assigned Sessions (Priority: P1)

**Goal**: Trainer can view list of assigned sessions, filter/search, and access detailed session information

**Independent Test**: Trainer views session list, applies filters (status, date range, formation), searches by code/title, clicks session to view details, sees enrolled learners list, sees associated materials.

### Implementation for User Story 3

- [x] T019 [US3] Implement session list service method
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getSessions(formateurId, tenantId, filters)` method
  - Filter by formateur_id via session_formateurs join
  - Apply status filters (statuts array)
  - Apply date range filters (date_debut, date_fin)
  - Apply formation_id filter
  - Apply search filter (code_session or formation.titre)
  - Add pagination support
  - Return sessions with formation info and enrolled learners count

- [x] T020 [US3] Implement session detail service method
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getSessionDetails(sessionId, formateurId, tenantId)` method
  - Verify session access using verifySessionAccess utility
  - Query session with formation details
  - Query enrolled learners (inscriptions_professionnelles with apprenant info)
  - Query associated course materials (supports_cours via support_session_associations)
  - Query session notes (notes_formateur field)
  - Return complete session data

- [x] T021 [US3] Implement enrolled learners service method
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getSessionInscrits(sessionId, formateurId, tenantId)` method
  - Verify session access
  - Query inscriptions_professionnelles with apprenant details
  - Include attendance status if session is in progress or completed
  - Calculate statistics (total, confirmed, present, absent)
  - Return inscrits list and stats

- [x] T022 [US3] Implement session API endpoints
  - In `apps/api/src/routes/formateur.ts`
  - Create `GET /api/v1/formateur/sessions` endpoint with query params (page, limit, statuts, date_debut, date_fin, formation_id, search)
  - Create `GET /api/v1/formateur/sessions/:id` endpoint
  - Create `GET /api/v1/formateur/sessions/:id/inscrits` endpoint
  - All endpoints verify session access
  - Add validation using Zod schemas
  - Add error handling

- [x] T023 [US3] Create session list page
  - Create `apps/web/src/app/formateur/sessions/page.tsx`
  - Use TanStack Query to fetch sessions list
  - Display sessions in card or table format
  - Add filters: status dropdown, formation dropdown, date range picker, search input
  - Add pagination controls
  - Add "View details" link for each session
  - Add loading and empty states

- [x] T024 [US3] Create session detail page
  - Create `apps/web/src/app/formateur/sessions/[id]/details/page.tsx`
  - Use TanStack Query to fetch session details
  - Display session information (read-only for admin fields)
  - Add tabs: Informations, Inscrits, Supports, Notes
  - Display enrolled learners in table format
  - Display associated course materials list
  - Add "Back to list" navigation
  - Handle session not found or access denied

- [x] T025 [US3] Create enrolled learners page
  - Create `apps/web/src/app/formateur/sessions/[id]/inscrits/page.tsx`
  - Use TanStack Query to fetch enrolled learners
  - Display learners in table with columns: Name, Email, Phone, Company, Enrollment Status
  - Display attendance statistics if session is in progress or completed
  - Add export button (for later implementation in US4)
  - Add loading states

- [x] T026 [US3] Create session components
  - Create `packages/ui/src/components/formateur/SessionCard.tsx` - Session card for list view
  - Create `packages/ui/src/components/formateur/SessionFilters.tsx` - Filter component
  - Create `packages/ui/src/components/formateur/SessionInfoTab.tsx` - Session information display
  - Create `packages/ui/src/components/formateur/InscritsTable.tsx` - Enrolled learners table
  - All components should be responsive

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently. Trainer can view dashboard, manage schedule, and view/manage assigned sessions.

---

## Phase 6: User Story 4 - Manage Learner Attendance (Priority: P2)

**Goal**: Trainer can mark attendance for learners in in-progress or completed sessions

**Independent Test**: Trainer views enrolled learners for in-progress session, marks learners as present/absent, sees attendance statistics update, exports attendance list for completed session.

### Implementation for User Story 4

- [x] T027 [US4] Implement attendance service methods
  - In `apps/api/src/services/attendance.service.ts`
  - Create `markAttendance(sessionId, inscriptionId, present, formateurId, tenantId)` method
  - Verify session access using verifySessionAccess utility
  - Verify session status is 'en_cours' or 'terminee'
  - Upsert attendance record in session_attendance table
  - Log attendance action with timestamp and trainer ID
  - Return updated attendance record

- [x] T028 [US4] Implement attendance statistics calculation
  - In `apps/api/src/services/attendance.service.ts`
  - Create `getAttendanceStats(sessionId, tenantId)` method
  - Count total enrolled (confirmed inscriptions)
  - Count present (attendance.present = true)
  - Count absent (attendance.present = false)
  - Calculate attendance percentage
  - Return statistics object

- [x] T029 [US4] Implement attendance export service
  - In `apps/api/src/services/attendance.service.ts`
  - Create `exportAttendanceList(sessionId, format, tenantId)` method
  - Query attendance data with learner information
  - Generate CSV or PDF export
  - Return file buffer or stream
  - Handle format parameter ('csv' or 'pdf')

- [x] T030 [US4] Implement attendance API endpoints
  - In `apps/api/src/routes/formateur.ts`
  - Create `PATCH /api/v1/formateur/sessions/:id/inscrits/:inscritId/presence` endpoint
  - Create `GET /api/v1/formateur/sessions/:id/attendance/export` endpoint with format query param
  - Both endpoints verify session access
  - Add validation using MarkPresenceSchema
  - Add error handling (session status validation, etc.)

- [x] T031 [US4] Update enrolled learners page with attendance
  - Update `apps/web/src/app/formateur/sessions/[id]/inscrits/page.tsx`
  - Add attendance checkbox/toggle for each learner (only if session is in_progress or terminee)
  - Use TanStack Query mutation to update attendance
  - Display attendance statistics (total, present, absent, percentage)
  - Add export button that calls export endpoint
  - Update UI when attendance changes

- [x] T032 [US4] Create attendance components
  - Create `packages/ui/src/components/formateur/AttendanceTable.tsx` - Table with attendance checkboxes
  - Create `packages/ui/src/components/formateur/AttendanceStats.tsx` - Statistics display component
  - Create `packages/ui/src/components/formateur/ExportAttendanceButton.tsx` - Export button with format selection
  - Handle loading states during attendance updates

**Checkpoint**: At this point, User Stories 1-4 should all work independently. Trainer can view dashboard, manage schedule, view sessions, and mark attendance.

---

## Phase 7: User Story 5 - Upload and Manage Course Materials (Priority: P2)

**Goal**: Trainer can upload course materials, associate with sessions, manage metadata, and view download statistics

**Independent Test**: Trainer uploads material file, sets title/description, associates with session, views material list, edits metadata, views download statistics, deletes material.

### Implementation for User Story 5

- [x] T033 [US5] Implement course material upload service
  - In `apps/api/src/services/supports-cours.service.ts`
  - Create `uploadSupport(fileData, metadata, formateurId, tenantId)` method
  - Validate file type (PDF, PPT, PPTX, DOC, DOCX, ZIP, MP4, AVI)
  - Validate file size (max 100MB)
  - Use FileStorageService to upload file
  - Create supports_cours record in database
  - Create support_session_associations if session_ids provided
  - Return created support record

- [x] T034 [US5] Implement course material list service
  - In `apps/api/src/services/supports-cours.service.ts`
  - Create `getSupports(formateurId, tenantId, filters)` method
  - Filter by formateur_id
  - Apply filters: formation_id, session_id, type_fichier, search
  - Add pagination support
  - Include associated sessions via support_session_associations
  - Return supports list with download counts

- [x] T035 [US5] Implement course material update service
  - In `apps/api/src/services/supports-cours.service.ts`
  - Create `updateSupport(supportId, updates, formateurId, tenantId)` method
  - Verify formateur ownership
  - Update metadata (titre, description, visible_apprenants)
  - Update session associations (delete old, create new)
  - Return updated support record

- [x] T036 [US5] Implement course material delete service
  - In `apps/api/src/services/supports-cours.service.ts`
  - Create `deleteSupport(supportId, formateurId, tenantId)` method
  - Verify formateur ownership
  - Delete file from storage using FileStorageService
  - Delete support_session_associations
  - Delete support_telechargements records
  - Delete supports_cours record
  - Handle errors and cleanup

- [x] T037 [US5] Implement download statistics service
  - In `apps/api/src/services/supports-cours.service.ts`
  - Create `getSupportStatistics(supportId, formateurId, tenantId)` method
  - Verify formateur ownership
  - Count total downloads from support_telechargements
  - Get last download timestamp
  - Group downloads by session
  - Return statistics object

- [x] T038 [US5] Implement course materials API endpoints
  - In `apps/api/src/routes/formateur.ts`
  - Create `GET /api/v1/formateur/supports` endpoint with query params
  - Create `POST /api/v1/formateur/supports/upload` endpoint (multipart/form-data)
  - Create `GET /api/v1/formateur/supports/:id` endpoint
  - Create `PUT /api/v1/formateur/supports/:id` endpoint
  - Create `DELETE /api/v1/formateur/supports/:id` endpoint
  - Create `GET /api/v1/formateur/supports/:id/statistiques` endpoint
  - All endpoints verify formateur ownership
  - Add file upload handling with size/type validation
  - Add error handling

- [x] T039 [US5] Create course materials list page
  - Create `apps/web/src/app/formateur/supports/page.tsx`
  - Use TanStack Query to fetch supports list
  - Display materials in card or table format
  - Add filters: formation, session, type, search
  - Add "Upload material" button
  - Add actions: View, Edit, Delete, Statistics
  - Add pagination

- [x] T040 [US5] Create material upload page
  - Create `apps/web/src/app/formateur/supports/upload/page.tsx`
  - Create upload form with file input (drag & drop support)
  - Add fields: titre (required), description, formation_id (select), session_ids (multi-select), visible_apprenants (checkbox)
  - Add file validation (type, size) before upload
  - Show upload progress
  - Handle upload success/error
  - Redirect to materials list on success
  - Create `apps/web/src/app/formateur/supports/upload/page.tsx`
  - Create upload form with file input (drag & drop support)
  - Add fields: titre (required), description, formation_id (select), session_ids (multi-select), visible_apprenants (checkbox)
  - Add file validation (type, size) before upload
  - Show upload progress
  - Handle upload success/error
  - Redirect to materials list on success

- [x] T041 [US5] Create material edit page
  - Create `apps/web/src/app/formateur/supports/[id]/edit/page.tsx`
  - Use TanStack Query to fetch material details
  - Create edit form (titre, description, visible_apprenants, session associations)
  - Use TanStack Query mutation to update material
  - Handle update success/error
  - Add "Back to list" navigation
  - Create `apps/web/src/app/formateur/supports/[id]/edit/page.tsx`
  - Use TanStack Query to fetch material details
  - Create edit form (titre, description, visible_apprenants, session associations)
  - Use TanStack Query mutation to update material
  - Handle update success/error
  - Add "Back to list" navigation

- [x] T042 [US5] Create material components
  - Create `apps/web/src/components/formateur/MaterialCard.tsx` - Material card for list
  - Create `apps/web/src/components/formateur/MaterialStatsModal.tsx` - Statistics modal
  - Create `apps/web/src/components/formateur/MaterialEditForm.tsx` - Edit form component
  - All components handle file validation and errors
  - Create `packages/ui/src/components/formateur/MaterialUpload.tsx` - Upload form component
  - Create `packages/ui/src/components/formateur/MaterialCard.tsx` - Material card for list
  - Create `packages/ui/src/components/formateur/MaterialStatsModal.tsx` - Statistics modal
  - Create `packages/ui/src/components/formateur/MaterialEditForm.tsx` - Edit form component
  - All components should handle file validation and errors

**Checkpoint**: At this point, User Stories 1-5 should all work independently. Trainer can manage dashboard, schedule, sessions, attendance, and course materials.

---

## Phase 8: User Story 6 - Add Session Notes (Priority: P3)

**Goal**: Trainer can add and edit private notes for sessions

**Independent Test**: Trainer views session details, accesses notes tab, adds notes, saves, views session later and sees saved notes, edits notes.

### Implementation for User Story 6

- [x] T043 [US6] Implement session notes service method
  - In `apps/api/src/services/formateur.service.ts`
  - Create `updateSessionNotes(sessionId, notes, formateurId, tenantId)` method
  - Verify session access using verifySessionAccess utility
  - Update notes_formateur and notes_updated_at in sessions_professionnelles
  - Return updated session with notes

- [x] T044 [US6] Implement session notes API endpoint
  - In `apps/api/src/routes/formateur.ts`
  - Create `POST /api/v1/formateur/sessions/:id/notes` endpoint
  - Verify session access
  - Validate notes content (max 10000 chars)
  - Call formateurService.updateSessionNotes()
  - Return updated notes with timestamp
  - Add error handling

- [x] T045 [US6] Add notes tab to session detail page
  - Update `apps/web/src/app/formateur/sessions/[id]/details/page.tsx`
  - Add "Notes" tab to existing tabs
  - Create notes textarea component
  - Use TanStack Query to fetch session notes
  - Use TanStack Query mutation to save notes
  - Add auto-save or manual save button
  - Display "Private notes" label
  - Show last updated timestamp

- [x] T046 [US6] Create session notes component
  - Create `packages/ui/src/components/formateur/SessionNotesTab.tsx`
  - Textarea for notes input (with character count)
  - Save button with loading state
  - Display last updated timestamp
  - Add "Private - visible only to you" indicator
  - Handle save success/error

**Checkpoint**: At this point, User Stories 1-6 should all work independently. Trainer can add private notes to sessions.

---

## Phase 9: User Story 7 - Send Group Messages to Enrolled Learners (Priority: P3)

**Goal**: Trainer can send group messages to enrolled learners via email or SMS

**Independent Test**: Trainer views session with enrolled learners, composes group message, selects communication method, filters recipients, sends message, sees delivery confirmation.

### Implementation for User Story 7

- [x] T047 [US7] Implement group messaging service
  - In `apps/api/src/services/formateur-messaging.service.ts`
  - Create `sendGroupMessage(sessionId, messageData, formateurId, tenantId)` method
  - Verify session access using verifySessionAccess utility
  - Query enrolled learners for session
  - Filter recipients by attendance status if specified (tous, presents, absents)
  - Use EmailService to send emails if type includes 'email'
  - Use SMSService to send SMS if type includes 'sms'
  - Handle missing email/phone gracefully (skip and log)
  - Log sent message in database (create messages_formateurs table if needed)
  - Return delivery confirmation with counts

- [x] T048 [US7] Implement group messaging API endpoint
  - In `apps/api/src/routes/formateur.ts`
  - Create `POST /api/v1/formateur/sessions/:id/message-groupe` endpoint
  - Verify session access
  - Validate request using GroupMessageSchema
  - Call formateurMessagingService.sendGroupMessage()
  - Return delivery confirmation
  - Add error handling

- [x] T049 [US7] Create group messaging component
  - Create `packages/ui/src/components/formateur/MessageGroupeModal.tsx`
  - Add form fields: sujet (required), message (required), type (email/sms/both), destinataires (tous/presents/absents)
  - Show recipient count preview based on filters
  - Use TanStack Query mutation to send message
  - Display sending progress
  - Show delivery confirmation with counts
  - Handle errors (missing emails/phones)

- [x] T050 [US7] Add messaging button to session detail page
  - Update `apps/web/src/app/formateur/sessions/[id]/details/page.tsx`
  - Add "Send group message" button in enrolled learners section
  - Open MessageGroupeModal on click
  - Pass enrolled learners data to modal

**Checkpoint**: At this point, User Stories 1-7 should all work independently. Trainer can communicate with learners via group messages.

---

## Phase 10: User Story 8 - Manage Trainer Profile (Priority: P3)

**Goal**: Trainer can view and update professional profile including bio, expertise, LinkedIn, photo, and CV

**Independent Test**: Trainer views profile page, updates bio and expertise, uploads photo, uploads CV, views training statistics, sees assigned training programs.

### Implementation for User Story 8

- [x] T051 [US8] Implement profile service methods
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getProfile(formateurId, tenantId)` method
  - Query formateur with user info
  - Query assigned training programs (via session_formateurs)
  - Calculate statistics: nb_sessions_total, nb_apprenants_formes, heures_formation_total, nb_supports_crees
  - Return complete profile data

- [x] T052 [US8] Implement profile update service
  - In `apps/api/src/services/formateur.service.ts`
  - Create `updateProfile(formateurId, updates, tenantId)` method
  - Update bio, specialites, linkedin_url fields
  - Handle photo upload if provided (validate type JPG/PNG, size max 5MB)
  - Use FileStorageService to upload photo
  - Update photo_url in formateurs table
  - Return updated profile

- [x] T053 [US8] Implement CV upload service
  - In `apps/api/src/services/formateur.service.ts`
  - Create `uploadCV(formateurId, fileData, tenantId)` method
  - Validate file type (PDF only)
  - Validate file size (max 10MB)
  - Use FileStorageService to upload CV
  - Update cv_url in formateurs table
  - Return CV URL

- [x] T054 [US8] Implement profile API endpoints
  - In `apps/api/src/routes/formateur.ts`
  - Create `GET /api/v1/formateur/profil` endpoint
  - Create `PUT /api/v1/formateur/profil` endpoint with UpdateProfileSchema validation
  - Create `POST /api/v1/formateur/profil/cv` endpoint (multipart/form-data)
  - All endpoints use formateurAuthMiddleware
  - Add file upload handling for photo and CV
  - Add error handling

- [x] T055 [US8] Create profile page
  - Create `apps/web/src/app/formateur/profil/page.tsx`
  - Use TanStack Query to fetch profile data
  - Display profile information (name, email, phone - read-only)
  - Add editable fields: bio (textarea), specialites (tags input), linkedin_url (url input)
  - Add photo upload component
  - Add CV upload component
  - Display training statistics cards
  - Display assigned training programs list
  - Use TanStack Query mutations to update profile and upload CV
  - Handle save success/error

- [x] T056 [US8] Create profile components
  - Create `packages/ui/src/components/formateur/PhotoUpload.tsx` - Photo upload with preview
  - Create `packages/ui/src/components/formateur/CVUpload.tsx` - CV upload component
  - Create `packages/ui/src/components/formateur/SpecialitesEditor.tsx` - Tags input for expertise
  - Create `packages/ui/src/components/formateur/ProfileStats.tsx` - Statistics display
  - All components should handle validation and errors

**Checkpoint**: At this point, ALL user stories (1-8) should be fully functional and independently testable. Trainer can manage complete profile.

---

## Phase 11: Notifications System (Cross-Cutting)

**Purpose**: Implement notification system for trainers (referenced in US1 dashboard)

- [x] T057 [US1] Implement notification service
  - In `apps/api/src/services/formateur.service.ts`
  - Create `getNotifications(formateurId, tenantId, filters)` method
  - Query notifications_formateurs table
  - Filter by lue status if specified
  - Add pagination support
  - Return notifications list and unread count

- [x] T058 [US1] Implement mark notification as read
  - In `apps/api/src/services/formateur.service.ts`
  - Create `markNotificationRead(notificationId, formateurId, tenantId)` method
  - Verify formateur ownership
  - Update lue = true and lue_at timestamp
  - Return updated notification

- [x] T059 [US1] Implement notification API endpoints
  - In `apps/api/src/routes/formateur.ts`
  - Create `GET /api/v1/formateur/notifications` endpoint with query params
  - Create `PATCH /api/v1/formateur/notifications/:id/lire` endpoint
  - Both endpoints verify formateur ownership
  - Add error handling

- [x] T060 [US1] Create notification components (if not already created)
  - Update `packages/ui/src/components/formateur/NotificationsWidget.tsx` to fetch from API
  - Create notification list component with mark as read functionality
  - Add notification badge to navigation

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T061 [P] Add comprehensive error handling
  - Review all API endpoints for proper error responses
  - Add error boundaries in React components
  - Add user-friendly error messages
  - Log errors appropriately

- [x] T062 [P] Add loading states and skeletons
  - Add loading skeletons for dashboard
  - Add loading states for all data fetching
  - Add loading indicators for mutations
  - Improve UX during async operations

- [x] T063 [P] Add audit logging
  - Log all trainer actions (attendance, material uploads, messages, etc.)
  - Include trainer ID, timestamp, action type, and relevant IDs
  - Store in audit log table or file

- [x] T064 [P] Optimize database queries
  - Review all queries for N+1 problems
  - Add missing indexes if needed
  - Optimize joins and aggregations
  - Add query result caching where appropriate

- [x] T065 [P] Add input validation and sanitization
  - Ensure all user inputs are validated
  - Sanitize text inputs to prevent XSS
  - Validate file uploads thoroughly
  - Add rate limiting for file uploads

- [x] T066 [P] Improve responsive design
  - Test all pages on mobile devices
  - Ensure calendar works on small screens
  - Make tables responsive
  - Optimize touch interactions

- [x] T067 [P] Add accessibility improvements
  - Add ARIA labels to interactive elements
  - Ensure keyboard navigation works
  - Add focus indicators
  - Test with screen readers

- [x] T068 [P] Documentation updates
  - Update API documentation
  - Add code comments for complex logic
  - Update README if needed
  - Document environment variables

- [x] T069 Run quickstart.md validation
  - Test all examples from quickstart.md
  - Verify all code snippets work
  - Update quickstart.md if needed
  - Ensure all endpoints are accessible

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Notifications (Phase 11)**: Depends on US1 (dashboard) but can be implemented separately
- **Polish (Phase 12)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Depends on US3 (needs session detail page) - Can start after US3
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 6 (P3)**: Depends on US3 (needs session detail page) - Can start after US3
- **User Story 7 (P3)**: Depends on US3 (needs session detail page) - Can start after US3
- **User Story 8 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Service methods before API endpoints
- API endpoints before frontend pages
- Base components before complex components
- Core functionality before polish

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes:
  - US1, US2, US3, US5, US8 can start in parallel (no dependencies)
  - US4, US6, US7 can start after US3 completes
- All service methods within a story marked [P] can run in parallel
- All frontend components within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all service and API tasks together:
Task: "Implement dashboard service method" (T008)
Task: "Implement dashboard API endpoint" (T009)

# Launch all frontend components together:
Task: "Create dashboard page component" (T010)
Task: "Create reusable dashboard components" (T011)
Task: "Add trainer navigation and layout" (T012)
```

---

## Parallel Example: User Story 3

```bash
# Launch all service methods together:
Task: "Implement session list service method" (T019)
Task: "Implement session detail service method" (T020)
Task: "Implement enrolled learners service method" (T021)

# Launch all API endpoints together:
Task: "Implement session API endpoints" (T022)

# Launch all frontend pages together:
Task: "Create session list page" (T023)
Task: "Create session detail page" (T024)
Task: "Create enrolled learners page" (T025)

# Launch all components together:
Task: "Create session components" (T026)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Dashboard)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 (Dashboard) → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 (Schedule) → Test independently → Deploy/Demo
4. Add User Story 3 (Sessions) → Test independently → Deploy/Demo
5. Add User Story 4 (Attendance) → Test independently → Deploy/Demo
6. Add User Story 5 (Materials) → Test independently → Deploy/Demo
7. Add User Stories 6-8 (Notes, Messaging, Profile) → Test independently → Deploy/Demo
8. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Dashboard)
   - Developer B: User Story 2 (Schedule)
   - Developer C: User Story 3 (Sessions)
   - Developer D: User Story 5 (Materials) or User Story 8 (Profile)
3. After US3 completes:
   - Developer A: User Story 4 (Attendance)
   - Developer B: User Story 6 (Notes)
   - Developer C: User Story 7 (Messaging)
4. Stories complete and integrate independently

---

## Task Summary

- **Total Tasks**: 69
- **Setup Tasks**: 2 (T001-T002)
- **Foundational Tasks**: 5 (T003-T007)
- **User Story 1 Tasks**: 5 (T008-T012)
- **User Story 2 Tasks**: 6 (T013-T018)
- **User Story 3 Tasks**: 8 (T019-T026)
- **User Story 4 Tasks**: 6 (T027-T032)
- **User Story 5 Tasks**: 10 (T033-T042)
- **User Story 6 Tasks**: 4 (T043-T046)
- **User Story 7 Tasks**: 4 (T047-T050)
- **User Story 8 Tasks**: 6 (T051-T056)
- **Notifications Tasks**: 4 (T057-T060)
- **Polish Tasks**: 9 (T061-T069)

### Parallel Opportunities

- **Phase 1**: 1 parallel task (T002)
- **Phase 2**: 3 parallel tasks (T004, T006, T007)
- **Phase 3 (US1)**: Multiple components can be built in parallel
- **Phase 4 (US2)**: Service methods and components can be parallel
- **Phase 5 (US3)**: All service methods, all pages, all components can be parallel
- **Phase 6 (US4)**: Service methods and components can be parallel
- **Phase 7 (US5)**: All service methods can be parallel, all components can be parallel
- **Phase 8-10 (US6-8)**: Service methods and components can be parallel
- **Phase 12 (Polish)**: All tasks marked [P] can run in parallel

### Independent Test Criteria

- **US1**: Trainer logs in, sees dashboard with all statistics and widgets, can navigate to other sections
- **US2**: Trainer views calendar, sees sessions and unavailability, can add/remove unavailability
- **US3**: Trainer views session list, filters/searches, views session details, sees enrolled learners
- **US4**: Trainer marks attendance for learners, sees statistics, exports attendance list
- **US5**: Trainer uploads material, views list, edits metadata, views statistics, deletes material
- **US6**: Trainer adds notes to session, saves, views notes later, edits notes
- **US7**: Trainer composes group message, selects method and recipients, sends, sees confirmation
- **US8**: Trainer views profile, updates bio/expertise, uploads photo/CV, views statistics

### Suggested MVP Scope

**MVP = User Story 1 (Dashboard) only**

This provides immediate value by giving trainers a centralized view of their activities. All other stories can be added incrementally.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All file paths are relative to repository root
- All API endpoints must include tenant context and trainer authentication
- All database operations must respect RLS policies

