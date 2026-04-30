# Tasks: Phase 3 - Gestion des Activités (CORE)

**Input**: Design documents from `/specs/023-gestion-activites-core/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, and basic structure

- [x] T001 Install npm dependencies: `@tinymce/tinymce-react`, `puppeteer`, `isomorphic-dompurify`, `@types/dompurify` in `apps/web/` and `apps/api/`
- [x] T002 [P] Create directory structure: `apps/api/src/routes/rso/`, `apps/api/src/services/rso/activites/`, `apps/api/src/services/rso/recommandations/`, `apps/web/src/app/rso/formateur/activites/`, `apps/web/src/app/rso/pfso/activites/`, `apps/web/src/components/rso/activites/`
- [x] T003 [P] Create contracts package structure: `packages/contracts/src/rso/activites/`, `packages/contracts/src/rso/recommandations/`, `packages/contracts/src/rso/recherche/`
- [x] T004 [P] Configure environment variables: `NEXT_PUBLIC_TINYMCE_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `MAX_FILE_SIZE`, `UPLOAD_DIR` in `.env` files

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create database migration script: `infra/scripts/migrations/0023_rso_phase3_activites.sql` with all 5 tables (rso_activites, rso_types_activites, rso_recommandations, rso_activites_pfso_access, rso_activites_medias), indexes, foreign keys, and RLS policies
- [x] T006 Create database seed script: `infra/scripts/migrations/0023_rso_phase3_seed.sql` with activity types hierarchy (6 root types + 10 sub-types)
- [x] T007 [P] Create TypeScript contracts: `packages/contracts/src/rso/activites/activite.contracts.ts` with all activity-related types and interfaces
- [x] T008 [P] Create TypeScript contracts: `packages/contracts/src/rso/recommandations/recommandation.contracts.ts` with recommendation types
- [x] T009 [P] Create TypeScript contracts: `packages/contracts/src/rso/recherche/recherche.contracts.ts` with search types
- [x] T010 [P] Create Zod validation schemas: `apps/api/src/schemas/rso/activite.schema.ts` for activity CRUD operations
- [x] T011 [P] Create Zod validation schemas: `apps/api/src/schemas/rso/recommandation.schema.ts` for recommendation operations
- [x] T012 [P] Create Zod validation schemas: `apps/api/src/schemas/rso/activite-search.schema.ts` for search queries
- [x] T013 Create HTML sanitization service: `apps/api/src/services/rso/activites/html-sanitizer.service.ts` using DOMPurify with whitelist configuration
- [x] T014 Create activity code generator utility: `apps/api/src/services/rso/activites/activite-code-generator.ts` with format ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN and collision handling

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Création d'Activité par Workflow Guidé (Priority: P1) 🎯 MVP

**Goal**: Enable formateurs RSO to create activities following a guided workflow: year selection → installation selection → activity type selection (with hierarchical sub-types) → general information entry → redirect to rich text editor

**Independent Test**: A formateur RSO can access the activity creation page, see the pre-filled year, select an installation, choose an activity type (e.g., Entraînements), see sub-types appear dynamically (Trimestre 1-4), select a sub-type, fill general information (title, date, duration, location, participants), validate the form, and be redirected to the rich text editor with the activity created and code generated.

### Implementation for User Story 1

- [x] T015 [US1] Create activity service: `apps/api/src/services/rso/activites/activite.service.ts` with `create()` method that validates inputs, generates activity code, and inserts into database with transaction
- [x] T016 [US1] Implement activity code generation logic in `activite-code-generator.ts`: query max sequence for combination, increment, format as ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN
- [x] T017 [US1] Create activity type service: `apps/api/src/services/rso/activites/activite-type.service.ts` with `getHierarchicalTypes()` method that returns parent types with nested sub-types
- [x] T018 [US1] Create activity routes: `apps/api/src/routes/rso/activites.ts` with `POST /api/v1/rso/formateur/activites` endpoint for activity creation
- [x] T019 [US1] Create activity type routes: `apps/api/src/routes/rso/types-activites.ts` with `GET /api/v1/rso/types-activites` endpoint returning hierarchical types
- [x] T020 [US1] Add validation in `activite.service.ts`: validate date is within selected year, validate video conference link if platform selected, validate sub-type required when type has sub-types
- [x] T021 [US1] Create activity form component: `apps/web/src/components/rso/activites/ActivityForm.tsx` with multi-step workflow (year display, installation select, type select with dynamic sub-type, general info form)
- [x] T022 [US1] Create activity creation page: `apps/web/src/app/rso/formateur/activites/creer/page.tsx` that uses ActivityForm and redirects to editor after creation
- [x] T023 [US1] Create activity API client: `apps/web/src/lib/rso/activites.ts` with `createActivity()` function using TanStack Query
- [x] T024 [US1] Add error handling and user feedback for validation errors in ActivityForm component

**Checkpoint**: At this point, User Story 1 should be fully functional - formateurs can create activities with all metadata and be redirected to editor

---

## Phase 4: User Story 2 - Rédaction avec Éditeur de Texte Riche Professionnel (Priority: P1)

**Goal**: Enable formateurs RSO to edit activity content in a rich text editor with advanced formatting, tables, images, videos, maps, galleries, and auto-save functionality

**Independent Test**: A formateur RSO in the editor can format text (bold, italic, headings), create tables, insert images (uploaded), insert YouTube videos (embed), insert Google Maps (iframe), create image galleries, and the system auto-saves every 30 seconds with unsaved changes warning.

### Implementation for User Story 2

- [x] T025 [US2] Create rich text editor component: `apps/web/src/components/rso/activites/RichTextEditor.tsx` wrapping TinyMCE with French locale, plugins (advlist, autolink, lists, link, image, table, media, autosave, etc.), and custom buttons for maps and galleries
- [x] T026 [US2] Configure TinyMCE in RichTextEditor: set language to 'fr_FR', enable autosave plugin with 30-second interval, configure image upload handler pointing to `/api/v1/rso/formateur/activites/upload-image`
- [x] T027 [US2] Create image upload endpoint: `POST /api/v1/rso/formateur/activites/upload-image` in `apps/api/src/routes/rso/activites.ts` with validation (file type, size max 5MB), storage in tenant-specific directory, return URL
- [x] T028 [US2] Implement image upload service logic: validate MIME type (jpg, jpeg, png, gif, webp), validate size, generate unique filename, store in `uploads/aspci/activites/{year}/{activity_id}/`, return accessible URL
- [x] T029 [US2] Create Google Maps insertion modal: custom TinyMCE button and modal in RichTextEditor for address search and iframe insertion
- [x] T030 [US2] Create image gallery modal: custom TinyMCE button and modal in RichTextEditor for multi-image upload (drag & drop), preview grid, column selection (2-4), and gallery HTML insertion
- [x] T031 [US2] Create draft auto-save endpoint: `PATCH /api/v1/rso/formateur/activites/:id/draft` in `apps/api/src/routes/rso/activites.ts` that saves content without changing status
- [x] T032 [US2] Implement auto-save logic in RichTextEditor: use TinyMCE autosave plugin to call draft endpoint every 30 seconds, display "Last saved: X minutes ago" indicator
- [x] T033 [US2] Add unsaved changes warning: implement `onbeforeunload` handler in RichTextEditor that warns user if editor has unsaved changes
- [x] T034 [US2] Create content update endpoint: `PATCH /api/v1/rso/formateur/activites/:id/contenu` in `apps/api/src/routes/rso/activites.ts` that sanitizes HTML, extracts plain text for search, and saves both
- [x] T035 [US2] Implement HTML sanitization in content update: use html-sanitizer.service.ts to sanitize content before saving, extract plain text version (strip HTML tags) for `contenu_texte` column
- [x] T036 [US2] Create activity edit page: `apps/web/src/app/rso/formateur/activites/[id]/modifier/page.tsx` that loads activity, pre-fills RichTextEditor with existing content, and saves on submit
- [x] T037 [US2] Add content restoration: on page load, restore editor content from latest saved version (draft or final)

**Checkpoint**: At this point, User Story 2 should be fully functional - formateurs can edit activity content with rich formatting, media insertion, and auto-save

---

## Phase 5: User Story 3 - Gestion des Permissions de Visualisation (Priority: P1)

**Goal**: Enable formateurs RSO to control which PFSO agents can view each activity (visible to all OR individual selection), and enforce permission checks at database level

**Independent Test**: A formateur RSO creates an activity, checks "Visible to all PFSO agents", saves. A PFSO agent of that installation can view it. Formateur unchecks "all" and selects 2 specific PFSO agents. Only those 2 agents can view it, others cannot.

### Implementation for User Story 3

- [x] T038 [US3] Create permission service: `apps/api/src/services/rso/activites/activite-permission.service.ts` with `updatePermissions()` method that handles visible_tous_pfso flag and individual permissions in transaction
- [x] T039 [US3] Implement permission update logic: when visible_tous_pfso=true, clear individual permissions; when false, require at least one individual permission, update rso_activites_pfso_access junction table
- [x] T040 [US3] Create permission check service method: `checkPermission()` in `activite-permission.service.ts` that verifies user has access (visible_tous_pfso OR individual permission) based on role and installation
- [x] T041 [US3] Create permission routes: `apps/api/src/routes/rso/activites-permissions.ts` with `POST /api/v1/rso/formateur/activites/:id/permissions` endpoint
- [x] T042 [US3] Add permission middleware: create permission verification middleware that checks access before allowing activity retrieval, returns 403 if no permission
- [x] T043 [US3] Update activity list queries: modify all activity list endpoints to filter by permissions (visible_tous_pfso OR individual permission) based on user role and installation
- [x] T044 [US3] Create permission management component: `apps/web/src/components/rso/activites/ActivityPermissions.tsx` with checkbox for "visible to all" and list of PFSO agents with individual checkboxes
- [x] T045 [US3] Integrate permission component: add ActivityPermissions to activity creation and edit pages, save permissions on form submit
- [x] T046 [US3] Add permission display: show current permissions in activity detail view with list of PFSO agents having access and grant dates
- [x] T047 [US3] Implement audit logging: log all permission changes (who granted, when, what changed) for ISPS compliance

**Checkpoint**: At this point, User Story 3 should be fully functional - permissions are managed and enforced at database level

---

## Phase 6: User Story 4 - Gestion des Recommandations (Priority: P2)

**Goal**: Enable formateurs RSO to create recommendations linked to activities with priority, responsible person, due date, and status tracking workflow

**Independent Test**: A formateur RSO views a completed training activity, clicks "Add recommendation", fills form (title, description, priority: high, responsible: PFSO agent, due date: 30 days), saves. Recommendation appears in list. Later, responsible marks as "in progress", then "completed" with actions taken. Formateur can view all recommendations with filters.

### Implementation for User Story 4

- [x] T048 [US4] Create recommendation service: `apps/api/src/services/rso/recommandations/recommandation.service.ts` with `create()`, `update()`, `updateStatus()`, `list()`, `getStats()` methods
- [x] T049 [US4] Implement recommendation status workflow: validate status transitions (en_attente → en_cours → terminee → validee), require actions_prises and date_resolution when status = terminee
- [x] T050 [US4] Create recommendation routes: `apps/api/src/routes/rso/recommandations.ts` with CRUD endpoints: `GET /api/v1/rso/formateur/activites/:activiteId/recommandations`, `POST /api/v1/rso/formateur/activites/:activiteId/recommandations`, `PUT /api/v1/rso/formateur/recommandations/:id`, `PATCH /api/v1/rso/formateur/recommandations/:id/statut`, `DELETE /api/v1/rso/formateur/recommandations/:id`
- [x] T051 [US4] Create recommendation list endpoint: `GET /api/v1/rso/formateur/recommandations` with filters (statut, priorite, installation, periode, enRetard) and pagination
- [x] T052 [US4] Create recommendation stats endpoint: `GET /api/v1/rso/formateur/recommandations/stats` returning total, by status, and overdue count
- [x] T053 [US4] Implement overdue calculation: query recommendations where date_echeance < CURRENT_DATE AND statut IN ('en_attente', 'en_cours'), calculate days overdue
- [x] T054 [US4] Create recommendation form component: `apps/web/src/components/rso/recommandations/RecommendationForm.tsx` with fields (titre min 10 chars, description min 150 chars, priorite, responsable, date_echeance)
- [x] T055 [US4] Create recommendation list component: `apps/web/src/components/rso/recommandations/RecommendationList.tsx` with filters, status badges, priority indicators, overdue alerts
- [x] T056 [US4] Create recommendation card component: `apps/web/src/components/rso/recommandations/RecommendationCard.tsx` displaying recommendation details with status and priority
- [x] T057 [US4] Create recommendation stats component: `apps/web/src/components/rso/recommandations/RecommendationStats.tsx` displaying metrics cards
- [x] T058 [US4] Create recommendation tracking page: `apps/web/src/app/rso/formateur/activites/recommandations/page.tsx` with list, filters, and stats
- [x] T059 [US4] Integrate recommendations in activity detail: display recommendations list in activity detail view with status and priority
- [x] T060 [US4] Create recommendation API client: `apps/web/src/lib/rso/recommandations.ts` with TanStack Query hooks for all recommendation operations

**Checkpoint**: At this point, User Story 4 should be fully functional - recommendations can be created, tracked, and managed

---

## Phase 7: User Story 5 - Consultation des Activités par les Agents PFSO (Priority: P2)

**Goal**: Enable PFSO agents to view activities (read-only) for which they have permission, with search, filters, PDF export, and print functionality

**Independent Test**: A PFSO agent accesses the activity consultation page, sees only activities of their installation with permissions. They filter by year and type, search by keyword, click an activity to view full content (formatted text, tables, images, maps, videos), export to PDF, and print. No edit/delete buttons are visible.

### Implementation for User Story 5

- [x] T061 [US5] Create PFSO activity routes: `apps/api/src/routes/rso/activites-pfso.ts` with `GET /api/v1/rso/pfso/activites` (list with permission filter) and `GET /api/v1/rso/pfso/activites/:id` (detail with permission check, returns 403 if no access)
- [x] T062 [US5] Implement permission filtering in PFSO list endpoint: query only activities where (visible_tous_pfso=true AND installation_id=user_installation_id) OR (id IN individual permissions for user)
- [x] T063 [US5] Create PDF export service: `apps/api/src/services/rso/activites/activite-export.service.ts` using Puppeteer to generate PDF from HTML template with activity data, logo, metadata, recommendations
- [x] T064 [US5] Create PDF export endpoint: `GET /api/v1/rso/formateur/activites/:id/export/pdf` in `apps/api/src/routes/rso/activites-export.ts` that generates PDF and streams to response
- [x] T065 [US5] Implement PDF template: create HTML template in `activite-export.service.ts` with header (logo, title), metadata section, content section, recommendations section, footer (page numbers, date)
- [x] T066 [US5] Configure Puppeteer PDF generation: A4 format, margins (top/bottom 20mm, left/right 15mm), printBackground true, handle page breaks for large content
- [x] T067 [US5] Create PFSO activity list page: `apps/web/src/app/rso/pfso/activites/page.tsx` with read-only activity list, filters (year, type), search, and pagination
- [x] T068 [US5] Create PFSO activity detail page: `apps/web/src/app/rso/pfso/activites/[id]/page.tsx` displaying full activity content (HTML rendered), recommendations, with PDF export and print buttons (no edit/delete)
- [x] T069 [US5] Create print-optimized CSS: add print media queries to hide navigation, optimize layout for printing in activity detail view
- [x] T070 [US5] Implement print functionality: add print button that triggers browser print dialog with optimized layout
- [x] T071 [US5] Create PFSO activity API client: `apps/web/src/lib/rso/activites.ts` with PFSO-specific functions (getActivitiesForPFSO, getActivityForPFSO, exportPDF) using TanStack Query

**Checkpoint**: At this point, User Story 5 should be fully functional - PFSO agents can view, search, filter, export, and print activities

---

## Phase 8: User Story 6 - Recherche Avancée d'Activités (Priority: P2)

**Goal**: Enable advanced full-text search with filters (year, installation, type, status, date range) and sorting (relevance, date, title), respecting permission restrictions

**Independent Test**: A formateur RSO accesses advanced search, enters "évacuation", selects year 2024, installation "Port de commerce", type "Entraînements", period "Jan-Mar 2024", searches. System returns 8 results with "évacuation" highlighted, sorted by relevance. Each result shows excerpt with keywords highlighted, date, installation, relevance score.

### Implementation for User Story 6

- [x] T072 [US6] Create full-text search index: ensure GIN index exists on `rso_activites` table for `titre` and `contenu_texte` columns using French text search configuration (from migration T005)
- [x] T073 [US6] Create search service: `apps/api/src/services/rso/activites/activite-search.service.ts` with `search()` method using PostgreSQL full-text search with `to_tsvector('french', ...)`, `to_tsquery('french', ...)`, `ts_rank()` for relevance
- [x] T074 [US6] Implement permission-aware search: combine full-text search query with permission filters (visible_tous_pfso OR individual permission) based on user role and installation
- [x] T075 [US6] Implement search result highlighting: use `ts_headline('french', ...)` to generate excerpts with search keywords highlighted in results
- [x] T076 [US6] Create search routes: `apps/api/src/routes/rso/activites-search.ts` with `GET /api/v1/rso/recherche/activites` endpoint accepting query parameters (q, anneeId, installationId, typeActivite, statut, dateDebut, dateFin, tri, page, limit)
- [x] T077 [US6] Implement search sorting: support sorting by pertinence (ts_rank), date_desc, date_asc, titre_asc in search service
- [x] T078 [US6] Create advanced search component: `apps/web/src/components/rso/recherche/AdvancedSearch.tsx` with search input, filters (year, installation, type, status, date range), sort dropdown, reset button
- [x] T079 [US6] Create search results component: `apps/web/src/components/rso/recherche/SearchResults.tsx` displaying results with highlighted excerpts, metadata, relevance scores, pagination
- [x] T080 [US6] Create search page: `apps/web/src/app/rso/recherche/page.tsx` combining AdvancedSearch and SearchResults components
- [x] T081 [US6] Create search API client: `apps/web/src/lib/rso/recherche.ts` with `searchActivities()` function using TanStack Query

**Checkpoint**: At this point, User Story 6 should be fully functional - advanced search with full-text, filters, and permission-aware results

---

## Phase 9: User Story 7 - Gestion et Liste des Activités (Priority: P2)

**Goal**: Enable formateurs RSO to view, filter, and manage their activities list with quick actions (view, edit, export, delete)

**Independent Test**: A formateur RSO accesses activity management page, sees list of all their activities with key info (type, title, installation, date, duration, participants, status). Applies filters (installation: Port de commerce, type: Entraînements, status: Terminé). List updates. Clicks "View" to see details, "Export PDF" to download, "Delete" to soft delete.

### Implementation for User Story 7

- [x] T082 [US7] Create activity list endpoint: `GET /api/v1/rso/formateur/activites` in `apps/api/src/routes/rso/activites.ts` with filters (installationId, typeActivite, statut, anneeId, search), pagination, and role-based filtering (formateurs see own, admins see all)
- [x] T083 [US7] Implement activity list service method: `list()` in `activite.service.ts` with filtering, pagination, and permission-based access (formateurs see own activities unless admin)
- [x] T084 [US7] Create activity detail endpoint: `GET /api/v1/rso/formateur/activites/:id` in `apps/api/src/routes/rso/activites.ts` returning full activity with recommendations and permissions
- [x] T085 [US7] Create activity update endpoint: `PUT /api/v1/rso/formateur/activites/:id` in `apps/api/src/routes/rso/activites.ts` for updating activity metadata (not content)
- [x] T086 [US7] Create activity status update endpoint: `PATCH /api/v1/rso/formateur/activites/:id/statut` in `apps/api/src/routes/rso/activites.ts` with role-based status transition validation
- [x] T087 [US7] Create activity soft delete endpoint: `DELETE /api/v1/rso/formateur/activites/:id` in `apps/api/src/routes/rso/activites.ts` that sets deleted_at timestamp (preserves for admins)
- [x] T088 [US7] Create activity list component: `apps/web/src/components/rso/activites/ActivityList.tsx` displaying activities in cards/table with key info (type icon, title, installation, date, duration, participants, status badge, actions)
- [x] T089 [US7] Create activity filters component: `apps/web/src/components/rso/activites/ActivityFilters.tsx` with quick filters (installation, type, status) that update URL and trigger list refresh
- [x] T090 [US7] Create activity card component: `apps/web/src/components/rso/activites/ActivityCard.tsx` displaying single activity with actions (view, edit, export, delete) based on user role
- [x] T091 [US7] Create activity detail component: `apps/web/src/components/rso/activites/ActivityDetail.tsx` displaying full activity information, content (HTML rendered), recommendations, permissions, with actions
- [x] T092 [US7] Create activity list page: `apps/web/src/app/rso/formateur/activites/page.tsx` combining ActivityList and ActivityFilters with "New Activity" button
- [x] T093 [US7] Create activity detail page: `apps/web/src/app/rso/formateur/activites/[id]/page.tsx` using ActivityDetail component
- [x] T094 [US7] Update activity API client: add `listActivities()`, `getActivity()`, `updateActivity()`, `updateActivityStatus()`, `deleteActivity()` functions in `apps/web/src/lib/rso/activites.ts`
- [x] T095 [US7] Implement URL-based filtering: update ActivityFilters to sync with URL query parameters for shareable filtered views

**Checkpoint**: At this point, User Story 7 should be fully functional - formateurs can manage their activities list with filters and actions

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, error handling, performance, and final integration

- [x] T096 [P] Add comprehensive error handling: implement proper HTTP status codes (400, 401, 403, 404, 500) with user-friendly error messages in all endpoints
- [x] T097 [P] Add transaction management: ensure all multi-step operations (activity creation with permissions, recommendation status updates) use database transactions
- [x] T098 [P] Add logging: implement structured logging for activity creation, permission changes, recommendation status updates, search queries for audit trail
- [x] T099 [P] Optimize database queries: add missing indexes, optimize full-text search queries, add query result caching where appropriate
- [x] T100 [P] Add input validation: ensure all user inputs are validated (Zod schemas) and sanitized (HTML content, file uploads) before processing
- [x] T101 [P] Add rate limiting: implement rate limiting for image uploads and PDF generation to prevent abuse
- [x] T102 [P] Add PDF generation error handling: implement timeout (30 seconds), error recovery, and proper cleanup of temporary files in PDF export service
- [x] T103 [P] Add auto-save error recovery: implement retry logic and offline detection for auto-save functionality
- [x] T104 [P] Add loading states and skeletons: improve UX with loading indicators during API calls, image uploads, PDF generation
- [x] T105 [P] Add accessibility improvements: ensure all components are keyboard navigable, have proper ARIA labels, and work with screen readers
- [x] T106 [P] Run quickstart.md validation: verify all steps in quickstart.md work correctly, update if needed
- [x] T107 [P] Documentation updates: update API documentation, add component usage examples, document environment variables

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS all user stories**
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed) OR sequentially in priority order (P1 → P2)
  - US1, US2, US3 (P1) should be completed before P2 stories for MVP
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Depends on US1 (needs activity created to edit content) - Can start after US1 checkpoint
- **User Story 3 (P1)**: Depends on US1 (needs activity to set permissions) - Can start after US1 checkpoint
- **User Story 4 (P2)**: Depends on US1 (needs activity to attach recommendations) - Can start after US1 checkpoint
- **User Story 5 (P2)**: Depends on US1 and US3 (needs activities with permissions) - Can start after US1 and US3 checkpoints
- **User Story 6 (P2)**: Depends on US1 (needs activities to search) - Can start after US1 checkpoint
- **User Story 7 (P2)**: Depends on US1 (needs activities to list) - Can start after US1 checkpoint

### Within Each User Story

- Models/entities before services
- Services before endpoints/routes
- Backend endpoints before frontend components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: All Setup tasks marked [P] can run in parallel
- **Phase 2**: All Foundational tasks marked [P] can run in parallel (contracts, schemas, services)
- **After Phase 2**: User stories US1, US4, US6, US7 can start in parallel (they don't depend on each other)
- **After US1**: US2, US3, US4, US5, US6, US7 can proceed in parallel
- **Phase 10**: All Polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch foundational contracts in parallel:
Task T007: "Create TypeScript contracts: activite.contracts.ts"
Task T008: "Create TypeScript contracts: recommandation.contracts.ts"
Task T009: "Create TypeScript contracts: recherche.contracts.ts"
Task T010: "Create Zod validation schemas: activite.schema.ts"
Task T011: "Create Zod validation schemas: recommandation.schema.ts"
Task T012: "Create Zod validation schemas: activite-search.schema.ts"

# Launch US1 implementation tasks that can run in parallel:
Task T016: "Implement activity code generation logic"
Task T017: "Create activity type service"
Task T021: "Create activity form component"
Task T023: "Create activity API client"
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, 3 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Activity Creation Workflow)
4. Complete Phase 4: User Story 2 (Rich Text Editor)
5. Complete Phase 5: User Story 3 (Permissions)
6. **STOP and VALIDATE**: Test all three stories together - formateurs can create activities, edit content, and set permissions
7. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (Basic MVP - activities can be created)
3. Add User Story 2 → Test independently → Deploy/Demo (Content editing enabled)
4. Add User Story 3 → Test independently → Deploy/Demo (Permissions enabled)
5. Add User Story 4 → Test independently → Deploy/Demo (Recommendations enabled)
6. Add User Story 5 → Test independently → Deploy/Demo (PFSO consultation enabled)
7. Add User Story 6 → Test independently → Deploy/Demo (Search enabled)
8. Add User Story 7 → Test independently → Deploy/Demo (Activity management enabled)
9. Add Phase 10 Polish → Final integration and optimization

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Activity Creation)
   - Developer B: User Story 4 (Recommendations) - can start after US1
   - Developer C: User Story 6 (Search) - can start after US1
3. After US1 completes:
   - Developer A: User Story 2 (Rich Text Editor)
   - Developer B: User Story 3 (Permissions)
   - Developer C: User Story 7 (Activity List)
4. After US2 and US3 complete:
   - Developer A: User Story 5 (PFSO Consultation)
   - Developer B: Phase 10 Polish
   - Developer C: Testing and integration

---

## Summary

**Total Tasks**: 107 tasks
- **Phase 1 (Setup)**: 4 tasks
- **Phase 2 (Foundational)**: 10 tasks
- **Phase 3 (US1 - Activity Creation)**: 10 tasks
- **Phase 4 (US2 - Rich Text Editor)**: 13 tasks
- **Phase 5 (US3 - Permissions)**: 10 tasks
- **Phase 6 (US4 - Recommendations)**: 13 tasks
- **Phase 7 (US5 - PFSO Consultation)**: 11 tasks
- **Phase 8 (US6 - Search)**: 10 tasks
- **Phase 9 (US7 - Activity List)**: 14 tasks
- **Phase 10 (Polish)**: 12 tasks

**Task Count per User Story**:
- US1: 10 tasks
- US2: 13 tasks
- US3: 10 tasks
- US4: 13 tasks
- US5: 11 tasks
- US6: 10 tasks
- US7: 14 tasks

**Parallel Opportunities Identified**: 
- 4 tasks in Phase 1
- 7 tasks in Phase 2
- Multiple tasks within each user story phase
- All user stories can proceed in parallel after Foundational phase (with dependency awareness)

**Independent Test Criteria**:
- **US1**: Formateur can create activity with workflow, code generated, redirected to editor
- **US2**: Formateur can edit content with rich formatting, media, auto-save works
- **US3**: Formateur can set permissions, PFSO agents see/hide activities based on permissions
- **US4**: Formateur can create recommendations, track status, view stats
- **US5**: PFSO agent can view activities, search, filter, export PDF, print
- **US6**: Users can search activities with full-text, filters, sorted results
- **US7**: Formateur can list, filter, view, edit, export, delete activities

**Suggested MVP Scope**: 
- **Minimum**: Phases 1-3 (Setup + Foundational + US1) - Activities can be created
- **Recommended**: Phases 1-5 (Setup + Foundational + US1 + US2 + US3) - Full activity creation, editing, and permission management
- **Complete**: All phases - Full feature set with recommendations, PFSO consultation, search, and management

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All tasks include specific file paths for clarity
- Database migration (T005) must be run before any user story implementation
- Rich text editor (T025-T026) requires TinyMCE API key configuration
- PDF generation (T063-T066) requires Puppeteer installation and may need headless Chrome dependencies

