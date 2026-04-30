# Tasks: Phase 5 - Recherche Avancée et Gestion des Recommandations

**Input**: Design documents from `/specs/025-phase/`  
**Prerequisites**: plan.md, data-model.md, contracts/, research.md, quickstart.md

**Tests**: Tests are included as they are mentioned in the plan.md testing section (Playwright E2E, Vitest/Jest unit tests, Fastify API tests).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Web app**: `apps/api/src/` (backend), `apps/web/src/` (frontend)
- **Shared**: `packages/contracts/src/`, `packages/ui/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependency installation

- [x] T001 Install node-cron dependency in `apps/api/package.json` ✅ (déjà installé)
- [x] T002 [P] Create directory structure for new services: `apps/api/src/services/rso/search/`, `apps/api/src/services/rso/tags/`, `apps/api/src/services/rso/notifications/`, `apps/api/src/services/rso/saved-searches/`, `apps/api/src/services/rso/scheduled-reports/` ✅
- [x] T003 [P] Create directory structure for new routes: ensure `apps/api/src/routes/rso/` exists ✅ (déjà existant)
- [x] T004 [P] Create directory structure for jobs: `apps/api/src/jobs/rso/` ✅ (déjà existant)
- [x] T005 [P] Create directory structure for schemas: ensure `apps/api/src/schemas/rso/` exists ✅ (déjà existant)
- [x] T006 [P] Create directory structure for frontend pages: `apps/web/src/app/rso/recherche-avancee/`, `apps/web/src/app/rso/admin/tags/`, `apps/web/src/app/rso/recommandations/dashboard/`, `apps/web/src/app/rso/recherches-enregistrees/`, `apps/web/src/app/rso/rapports-planifies/` ✅
- [x] T007 [P] Create directory structure for frontend components: `apps/web/src/components/rso/search/`, `apps/web/src/components/rso/tags/`, `apps/web/src/components/rso/notifications/`, `apps/web/src/components/rso/saved-searches/`, `apps/web/src/components/rso/scheduled-reports/`, `apps/web/src/components/rso/recommendations/` ✅
- [x] T008 [P] Create directory structure for frontend hooks: `apps/web/src/hooks/rso/` ✅
- [x] T009 [P] Create directory structure for contracts: `packages/contracts/src/rso/search/`, `packages/contracts/src/rso/tags/`, `packages/contracts/src/rso/notifications/`, `packages/contracts/src/rso/saved-searches/`, `packages/contracts/src/rso/scheduled-reports/`, `packages/contracts/src/rso/recommendations-dashboard/` ✅

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T010 Create database migration file `infra/scripts/migrations/0025_rso_phase5_search_recommendations.sql` with all new tables (rso_tags, rso_activites_tags, rso_recherches_enregistrees, rso_notifications, rso_rapports_planifies, rso_recommandations_historique)
- [X] T011 Add enhanced columns to rso_recommandations table in migration (categorie, impact, cout_estime, delai_jours, piece_jointe, validation_requise, validee_par, date_validation, commentaire_validation)
- [X] T012 Create full-text search indexes in migration: idx_activites_recherche and idx_recommandations_recherche using GIN with French language configuration
- [X] T013 Create all required indexes in migration (foreign keys, common queries, performance indexes)
- [X] T014 Create RLS policies for all new tables (rso_tags, rso_activites_tags, rso_recherches_enregistrees, rso_notifications, rso_rapports_planifies, rso_recommandations_historique) ensuring tenant isolation
- [X] T015 [P] Copy contract files from `specs/025-phase/contracts/` to `packages/contracts/src/rso/` maintaining directory structure
- [X] T016 [P] Export all new contracts from `packages/contracts/src/rso/index.ts` or appropriate index file
- [X] T017 Create base worker process structure in `apps/api/src/worker.ts` with node-cron setup and logging
- [X] T018 [P] Create validation schemas directory structure and base files: `apps/api/src/schemas/rso/search.schema.ts`, `apps/api/src/schemas/rso/tag.schema.ts`, `apps/api/src/schemas/rso/notification.schema.ts`, `apps/api/src/schemas/rso/saved-search.schema.ts`, `apps/api/src/schemas/rso/scheduled-report.schema.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Recherche Avancée Multi-Critères (Priority: P1) 🎯 MVP

**Goal**: Enable users to search across activities and recommendations using keywords and multi-criteria filters, with auto-completion and relevance-based results.

**Independent Test**: A user can access the advanced search page, enter a keyword "évacuation", apply filters (year 2024, installation "Port de commerce", type "Entraînements"), and receive relevant results with highlighted keywords, sorted by relevance, with pagination.

### Tests for User Story 1

- [ ] T019 [P] [US1] Create unit test for search query builder in `apps/api/src/services/rso/search/__tests__/search-query-builder.test.ts` - test filter combination, full-text search query construction
- [ ] T020 [P] [US1] Create unit test for search service in `apps/api/src/services/rso/search/__tests__/search.service.test.ts` - test search execution, pagination, sorting
- [ ] T021 [P] [US1] Create API integration test for POST /api/v1/rso/search in `apps/api/src/routes/rso/__tests__/search.test.ts` - test endpoint with various query combinations
- [ ] T022 [P] [US1] Create API integration test for GET /api/v1/rso/search/suggestions in `apps/api/src/routes/rso/__tests__/search.test.ts` - test autocomplete endpoint
- [ ] T023 [P] [US1] Create E2E test for advanced search workflow in `apps/web/e2e/rso/search.spec.ts` - test full user journey from search page to results

### Implementation for User Story 1

- [X] T024 [US1] Create search query builder service in `apps/api/src/services/rso/search/search-query-builder.ts` - build PostgreSQL queries with filters, full-text search, pagination
- [X] T025 [US1] Create search suggestions service in `apps/api/src/services/rso/search/search-suggestions.service.ts` - generate autocomplete suggestions from existing activities
- [X] T026 [US1] Create search service in `apps/api/src/services/rso/search/search.service.ts` - main search business logic, execute queries, format results with highlights
- [X] T027 [US1] Create search validation schema in `apps/api/src/schemas/rso/search.schema.ts` - Zod schema for search query validation
- [X] T028 [US1] Create search routes in `apps/api/src/routes/rso/search.ts` - POST /api/v1/rso/search, GET /api/v1/rso/search/suggestions, POST /api/v1/rso/search/export endpoints
- [X] T029 [US1] Register search routes in main API router with authentication middleware
- [X] T030 [US1] Create useSearch hook in `apps/web/src/hooks/rso/useSearch.ts` - TanStack Query hook for search API calls with debouncing
- [X] T031 [US1] Create SearchAutocomplete component in `apps/web/src/components/rso/search/SearchAutocomplete.tsx` - Radix UI Combobox with debounced suggestions
- [X] T032 [US1] Create SearchFilters component in `apps/web/src/components/rso/search/SearchFilters.tsx` - filter panel with year, installation, type, status, tags, dates
- [X] T033 [US1] Create SearchResults component in `apps/web/src/components/rso/search/SearchResults.tsx` - display results with highlights, pagination, sorting options
- [X] T034 [US1] Create SearchAdvanced main component in `apps/web/src/components/rso/search/SearchAdvanced.tsx` - combine all search components
- [X] T035 [US1] Create advanced search page in `apps/web/src/app/rso/recherche-avancee/page.tsx` - main search page using SearchAdvanced component
- [X] T036 [US1] Add search route to navigation/routing configuration

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently - users can perform advanced searches with filters and see relevant results

---

## Phase 4: User Story 2 - Système de Tags et Catégorisation (Priority: P1)

**Goal**: Enable administrators to create and manage tags for categorizing activities, and allow formateurs to associate tags with activities for better organization and searchability.

**Independent Test**: An administrator can create a tag "évacuation" in category "Thèmes" with color red and icon 🚨. A formateur can then associate this tag to an activity. The tag appears on the activity and can be used for filtering in search.

### Tests for User Story 2

- [ ] T037 [P] [US2] Create unit test for tag service in `apps/api/src/services/rso/tags/__tests__/tag.service.test.ts` - test CRUD operations, usage count tracking
- [ ] T038 [P] [US2] Create unit test for tag association service in `apps/api/src/services/rso/tags/__tests__/tag-association.service.test.ts` - test activity-tag associations, usage count updates
- [ ] T039 [P] [US2] Create API integration test for tag endpoints in `apps/api/src/routes/rso/__tests__/tags.test.ts` - test GET, POST, PUT, DELETE /api/v1/rso/tags
- [ ] T040 [P] [US2] Create API integration test for activity-tag association in `apps/api/src/routes/rso/__tests__/tags.test.ts` - test POST /api/v1/rso/activites/:id/tags
- [ ] T041 [P] [US2] Create E2E test for tag management in `apps/web/e2e/rso/tags.spec.ts` - test tag creation, association, filtering

### Implementation for User Story 2

- [X] T042 [US2] Create tag service in `apps/api/src/services/rso/tags/tag.service.ts` - CRUD operations for tags, prevent deletion of tags in use
- [X] T043 [US2] Create tag association service in `apps/api/src/services/rso/tags/tag-association.service.ts` - manage activity-tag associations, update usage counts
- [X] T044 [US2] Create tag validation schema in `apps/api/src/schemas/rso/tag.schema.ts` - Zod schema for tag creation/update validation
- [X] T045 [US2] Create tag routes in `apps/api/src/routes/rso/tags.ts` - GET, POST, PUT, DELETE /api/v1/rso/tags, POST /api/v1/rso/activites/:id/tags
- [X] T046 [US2] Register tag routes in main API router with administrator authentication middleware
- [X] T047 [US2] Create useTags hook in `apps/web/src/hooks/rso/useTags.ts` - TanStack Query hook for tag operations
- [X] T048 [US2] Create TagBadge component in `apps/web/src/components/rso/tags/TagBadge.tsx` - display tag with color and icon
- [X] T049 [US2] Create TagSelector component in `apps/web/src/components/rso/tags/TagSelector.tsx` - multi-select tag picker with search
- [X] T050 [US2] Create TagManagement component in `apps/web/src/components/rso/tags/TagManagement.tsx` - tag list grouped by category, create/edit form
- [X] T051 [US2] Create tag management page in `apps/web/src/app/rso/admin/tags/page.tsx` - admin interface for tag management
- [X] T052 [US2] Integrate TagSelector into activity creation/edit forms (Phase 3 activities)
- [X] T053 [US2] Display tags on activity detail pages with TagBadge components

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - users can search and filter by tags, administrators can manage tags

---

## Phase 5: User Story 3 - Tableau de Bord des Recommandations (Priority: P1)

**Goal**: Provide a comprehensive dashboard showing recommendation statistics, overdue items, upcoming deadlines, evolution charts, and breakdown by installation.

**Independent Test**: A user can access the recommendations dashboard and see total count, pending count, overdue count, completed count, a chart showing monthly evolution, priority breakdown, list of overdue recommendations with days overdue, and upcoming deadlines within 7 days.

### Tests for User Story 3

- [ ] T054 [P] [US3] Create unit test for dashboard service in `apps/api/src/services/rso/recommendations/__tests__/recommendation-dashboard.service.test.ts` - test statistics aggregation, chart data generation
- [ ] T055 [P] [US3] Create API integration test for dashboard endpoints in `apps/api/src/routes/rso/__tests__/recommandations-dashboard.test.ts` - test GET /api/v1/rso/recommandations/dashboard, /statistiques, /en-retard
- [ ] T056 [P] [US3] Create E2E test for dashboard in `apps/web/e2e/rso/recommendations-dashboard.spec.ts` - test dashboard display, filtering, interactions

### Implementation for User Story 3

- [X] T057 [US3] Create recommendation dashboard service in `apps/api/src/services/rso/recommendations/recommendation-dashboard.service.ts` - aggregate statistics, generate chart data, filter by period/installation
- [X] T058 [US3] Create dashboard routes in `apps/api/src/routes/rso/recommandations-dashboard.ts` - GET /api/v1/rso/recommandations/dashboard, /statistiques, /en-retard, /echeance-proche
- [X] T059 [US3] Register dashboard routes in main API router with authentication middleware
- [X] T060 [US3] Create RecommendationsStats component in `apps/web/src/components/rso/recommendations/RecommendationsStats.tsx` - statistics cards (total, pending, overdue, completed)
- [X] T061 [US3] Create RecommendationsChart component in `apps/web/src/components/rso/recommendations/RecommendationsChart.tsx` - monthly evolution chart and priority breakdown chart
- [X] T062 [US3] Create RecommendationsTable component in `apps/web/src/components/rso/recommendations/RecommendationsTable.tsx` - table showing recommendations by installation
- [X] T063 [US3] Create RecommendationsDashboard main component in `apps/web/src/components/rso/recommendations/RecommendationsDashboard.tsx` - combine all dashboard components with filters
- [X] T064 [US3] Create dashboard page in `apps/web/src/app/rso/recommandations/dashboard/page.tsx` - main dashboard page
- [X] T065 [US3] Add dashboard route to navigation/routing configuration

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently - users have search, tags, and dashboard functionality

---

## Phase 6: User Story 4 - Notifications et Alertes Automatiques (Priority: P2)

**Goal**: Automatically create and deliver notifications for important events (recommendation deadlines, assignments, overdue items) with real-time polling display.

**Independent Test**: When a recommendation is assigned to a user, a notification is created. When a recommendation deadline approaches (7, 3, 1 days), notifications are sent. The user sees notifications in a widget with unread count, can mark as read, and filter by type.

### Tests for User Story 4

- [ ] T066 [P] [US4] Create unit test for notification service in `apps/api/src/services/rso/notifications/__tests__/notification.service.test.ts` - test notification creation, delivery, read status
- [ ] T067 [P] [US4] Create unit test for notification scheduler in `apps/api/src/services/rso/notifications/__tests__/notification-scheduler.service.test.ts` - test deadline checking, automatic notification triggers
- [ ] T068 [P] [US4] Create API integration test for notification endpoints in `apps/api/src/routes/rso/__tests__/notifications.test.ts` - test GET, PATCH /api/v1/rso/notifications
- [ ] T069 [P] [US4] Create E2E test for notifications in `apps/web/e2e/rso/notifications.spec.ts` - test notification display, marking as read, polling

### Implementation for User Story 4

- [X] T070 [US4] Create notification service in `apps/api/src/services/rso/notifications/notification.service.ts` - create notifications, mark as read, user-specific queries
- [X] T071 [US4] Create notification scheduler service in `apps/api/src/services/rso/notifications/notification-scheduler.service.ts` - check deadlines, create notifications for approaching deadlines and overdue items
- [X] T072 [US4] Create notification validation schema in `apps/api/src/schemas/rso/notification.schema.ts` - Zod schema for notification operations
- [X] T073 [US4] Create notification routes in `apps/api/src/routes/rso/notifications.ts` - GET /api/v1/rso/notifications, GET /api/v1/rso/notifications/non-lues, PATCH /api/v1/rso/notifications/:id/lire, PATCH /api/v1/rso/notifications/marquer-toutes-lues
- [X] T074 [US4] Register notification routes in main API router with authentication and user verification middleware
- [X] T075 [US4] Create check-echeances job in `apps/api/src/jobs/rso/check-echeances.job.ts` - daily job to check recommendation deadlines and create notifications
- [X] T076 [US4] Register check-echeances job in worker.ts (daily at 8am)
- [X] T077 [US4] Create useNotifications hook in `apps/web/src/hooks/rso/useNotifications.ts` - TanStack Query hook with polling (30 second interval)
- [X] T078 [US4] Create NotificationWidget component in `apps/web/src/components/rso/notifications/NotificationWidget.tsx` - header dropdown widget with unread count badge
- [X] T079 [US4] Create NotificationList component in `apps/web/src/components/rso/notifications/NotificationList.tsx` - full notification list page with filtering
- [X] T080 [US4] Integrate NotificationWidget into main layout/header
- [X] T081 [US4] Create notification list page in `apps/web/src/app/rso/notifications/page.tsx` (if separate page needed)
- [X] T082 [US4] Integrate notification creation into recommendation assignment workflow (Phase 3)

**Checkpoint**: At this point, User Stories 1-4 should all work - users receive automatic notifications and can view/manage them

---

## Phase 7: User Story 5 - Recherches Enregistrées et Alertes (Priority: P2)

**Goal**: Allow users to save frequently used search criteria and configure automated alerts that notify them when new results match those criteria.

**Independent Test**: A user can save a search with criteria (type "Entraînements", installation "Port de commerce", year 2024) and enable daily alerts. When new activities match these criteria, the user receives a notification with the count of new results and a link to view them.

### Tests for User Story 5

- [ ] T083 [P] [US5] Create unit test for saved search service in `apps/api/src/services/rso/saved-searches/__tests__/saved-search.service.test.ts` - test CRUD operations
- [ ] T084 [P] [US5] Create unit test for saved search executor in `apps/api/src/services/rso/saved-searches/__tests__/saved-search-executor.service.test.ts` - test alert execution, new result detection
- [ ] T085 [P] [US5] Create API integration test for saved search endpoints in `apps/api/src/routes/rso/__tests__/recherches-enregistrees.test.ts` - test GET, POST, PUT, DELETE, POST /executer
- [ ] T086 [P] [US5] Create E2E test for saved searches in `apps/web/e2e/rso/saved-searches.spec.ts` - test saving search, configuring alerts, receiving notifications

### Implementation for User Story 5

- [X] T087 [US5] Create saved search service in `apps/api/src/services/rso/saved-searches/saved-search.service.ts` - CRUD operations for saved searches, user-specific queries
- [X] T088 [US5] Create saved search executor service in `apps/api/src/services/rso/saved-searches/saved-search-executor.service.ts` - execute saved searches, detect new results, create notifications
- [X] T089 [US5] Create saved search validation schema in `apps/api/src/schemas/rso/saved-search.schema.ts` - Zod schema for saved search operations
- [X] T090 [US5] Create saved search routes in `apps/api/src/routes/rso/recherches-enregistrees.ts` - GET, POST, PUT, DELETE /api/v1/rso/recherches-enregistrees, POST /api/v1/rso/recherches-enregistrees/:id/executer
- [X] T091 [US5] Register saved search routes in main API router with authentication and user verification middleware
- [X] T092 [US5] Create execute-saved-searches job in `apps/api/src/jobs/rso/execute-saved-searches.job.ts` - hourly job to execute saved searches with active alerts
- [X] T093 [US5] Register execute-saved-searches job in worker.ts (hourly)
- [X] T094 [US5] Create useSavedSearches hook in `apps/web/src/hooks/rso/useSavedSearches.ts` - TanStack Query hook for saved search operations
- [X] T095 [US5] Create SavedSearchForm component in `apps/web/src/components/rso/saved-searches/SavedSearchForm.tsx` - form to create/edit saved search with alert configuration
- [X] T096 [US5] Create SavedSearchList component in `apps/web/src/components/rso/saved-searches/SavedSearchList.tsx` - list of saved searches with execute, edit, delete actions
- [X] T097 [US5] Create saved searches page in `apps/web/src/app/rso/recherches-enregistrees/page.tsx` - main page for saved searches
- [X] T098 [US5] Add "Save this search" button to SearchAdvanced component
- [X] T099 [US5] Add saved searches route to navigation/routing configuration

**Checkpoint**: At this point, User Stories 1-5 should all work - users can save searches and receive automated alerts

---

## Phase 8: User Story 6 - Rapports Planifiés et Exports (Priority: P3)

**Goal**: Allow administrators to create scheduled reports that execute automatically at specified intervals and generate reports in PDF, Excel, or CSV formats, with email delivery.

**Independent Test**: An administrator can create a scheduled report "Rapport mensuel des activités" that runs on the 1st of each month at 8am, generates a PDF with all activities from the previous month, and emails it to specified recipients. The report executes automatically and the administrator can see execution history.

### Tests for User Story 6

- [ ] T100 [P] [US6] Create unit test for scheduled report service in `apps/api/src/services/rso/scheduled-reports/__tests__/scheduled-report.service.test.ts` - test CRUD operations, schedule calculation
- [ ] T101 [P] [US6] Create unit test for report generator in `apps/api/src/services/rso/scheduled-reports/__tests__/report-generator.service.test.ts` - test PDF, Excel, CSV generation
- [ ] T102 [P] [US6] Create API integration test for scheduled report endpoints in `apps/api/src/routes/rso/__tests__/rapports-planifies.test.ts` - test GET, POST, PUT, DELETE, POST /executer
- [ ] T103 [P] [US6] Create E2E test for scheduled reports in `apps/web/e2e/rso/scheduled-reports.spec.ts` - test report creation, execution, email delivery

### Implementation for User Story 6

- [X] T104 [US6] Create scheduled report service in `apps/api/src/services/rso/scheduled-reports/scheduled-report.service.ts` - CRUD operations, calculate next execution time
- [X] T105 [US6] Create report generator service in `apps/api/src/services/rso/scheduled-reports/report-generator.service.ts` - generate PDF (using existing Puppeteer/PDFKit), Excel, CSV reports
- [X] T106 [US6] Create scheduled report validation schema in `apps/api/src/schemas/rso/scheduled-report.schema.ts` - Zod schema for scheduled report operations
- [X] T107 [US6] Create scheduled report routes in `apps/api/src/routes/rso/rapports-planifies.ts` - GET, POST, PUT, DELETE /api/v1/rso/rapports-planifies, POST /api/v1/rso/rapports-planifies/:id/executer
- [X] T108 [US6] Register scheduled report routes in main API router with authentication and user verification middleware
- [X] T109 [US6] Create execute-rapports-planifies job in `apps/api/src/jobs/rso/execute-rapports-planifies.job.ts` - hourly job to check and execute scheduled reports
- [X] T110 [US6] Register execute-rapports-planifies job in worker.ts (hourly)
- [X] T111 [US6] Create ScheduledReportForm component in `apps/web/src/components/rso/scheduled-reports/ScheduledReportForm.tsx` - form to create/edit scheduled report with frequency, format, email configuration
- [X] T112 [US6] Create ScheduledReportList component in `apps/web/src/components/rso/scheduled-reports/ScheduledReportList.tsx` - list of scheduled reports with execution history, activate/deactivate, execute now
- [X] T113 [US6] Create scheduled reports page in `apps/web/src/app/rso/rapports-planifies/page.tsx` - main page for scheduled reports
- [X] T114 [US6] Add export functionality to search results (PDF, Excel, CSV) using report generator service
- [X] T115 [US6] Add scheduled reports route to navigation/routing configuration

**Checkpoint**: At this point, all User Stories 1-6 should be complete - full Phase 5 functionality is available

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, integration, and finalization

- [X] T116 [P] Create recommendation history service in `apps/api/src/services/rso/recommendations/recommendation-history.service.ts` - track all recommendation changes for audit trail
- [X] T117 [P] Integrate recommendation history tracking into recommendation update operations (Phase 3)
- [X] T118 [P] Create cleanup-notifications job in `apps/api/src/jobs/rso/cleanup-notifications.job.ts` - weekly job to delete old read notifications and expired notifications
- [X] T119 [P] Register cleanup-notifications job in worker.ts (weekly on Monday at 2am)
- [X] T120 [P] Add error handling and logging to all background jobs
- [X] T121 [P] Create reusable SearchAutocomplete component in `packages/ui/src/components/rso/SearchAutocomplete.tsx` for use across the app
- [X] T122 [P] Create reusable TagSelector component in `packages/ui/src/components/rso/TagSelector.tsx` for use across the app
- [X] T123 [P] Create reusable NotificationWidget component in `packages/ui/src/components/rso/NotificationWidget.tsx` for use across the app
- [X] T124 [P] Update activity detail pages to display tags with TagBadge components
- [X] T125 [P] Integrate tag filtering into search interface (already in US1, ensure it works with US2 tags)
- [X] T126 [P] Add recommendation history display to recommendation detail pages
- [X] T127 [P] Performance optimization: ensure search queries use indexes, optimize dashboard queries
- [X] T128 [P] Add rate limiting to notification creation to prevent user overwhelm
- [X] T129 [P] Add retry logic and error notifications for scheduled report failures
- [X] T130 [P] Update documentation in README or docs/ with Phase 5 features
- [X] T131 [P] Run quickstart.md validation checklist
- [X] T132 [P] Code cleanup and refactoring across all Phase 5 code
- [X] T133 [P] Security review: verify all endpoints have proper authentication, RLS policies are enforced, input validation is complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS all user stories**
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed) OR sequentially in priority order (P1 → P2 → P3)
  - US1 (Search) can start immediately after Foundational
  - US2 (Tags) can start immediately after Foundational (needed by US1 for tag filtering, but can be implemented in parallel)
  - US3 (Dashboard) can start after Foundational (uses existing recommendations from Phase 3)
  - US4 (Notifications) can start after Foundational (can integrate with US3 later)
  - US5 (Saved Searches) depends on US1 (uses search functionality)
  - US6 (Scheduled Reports) can start after Foundational (uses search and report generation)
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1 - Search)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P1 - Tags)**: Can start after Foundational - No dependencies, but US1 can use tags for filtering once both are complete
- **User Story 3 (P1 - Dashboard)**: Can start after Foundational - Uses existing recommendations from Phase 3
- **User Story 4 (P2 - Notifications)**: Can start after Foundational - Can integrate with US3 (dashboard) for recommendation notifications
- **User Story 5 (P2 - Saved Searches)**: Depends on US1 (Search) - Uses search functionality
- **User Story 6 (P3 - Scheduled Reports)**: Can start after Foundational - Uses search and existing report generation infrastructure

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Services before routes
- Routes before frontend components
- Hooks before components
- Components before pages
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: All setup tasks marked [P] can run in parallel
- **Phase 2**: Tasks T015-T018 marked [P] can run in parallel
- **After Phase 2**: User Stories 1, 2, 3, 4, 6 can start in parallel (US5 waits for US1)
- **Within each story**: All tests marked [P] can run in parallel, all services marked [P] can run in parallel
- **Phase 9**: All polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task T019: "Create unit test for search query builder"
Task T020: "Create unit test for search service"
Task T021: "Create API integration test for POST /api/v1/rso/search"
Task T022: "Create API integration test for GET /api/v1/rso/search/suggestions"
Task T023: "Create E2E test for advanced search workflow"

# Launch services in parallel (after tests):
Task T024: "Create search query builder service"
Task T025: "Create search suggestions service"
Task T026: "Create search service"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Advanced Search)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 (Search) → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 (Tags) → Test independently → Deploy/Demo
4. Add User Story 3 (Dashboard) → Test independently → Deploy/Demo
5. Add User Story 4 (Notifications) → Test independently → Deploy/Demo
6. Add User Story 5 (Saved Searches) → Test independently → Deploy/Demo
7. Add User Story 6 (Scheduled Reports) → Test independently → Deploy/Demo
8. Add Phase 9 (Polish) → Final validation → Production deployment

Each story adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - **Developer A**: User Story 1 (Search) - MVP
   - **Developer B**: User Story 2 (Tags) - Can work in parallel, integrates with US1 later
   - **Developer C**: User Story 3 (Dashboard) - Can work in parallel
3. After US1 complete:
   - **Developer A**: User Story 5 (Saved Searches) - Depends on US1
   - **Developer B**: User Story 4 (Notifications) - Can work in parallel
   - **Developer C**: User Story 6 (Scheduled Reports) - Can work in parallel
4. All developers: Phase 9 (Polish) - Parallel tasks

---

## Summary

**Total Tasks**: 133 tasks

**Task Count by User Story**:
- Setup (Phase 1): 9 tasks
- Foundational (Phase 2): 9 tasks
- User Story 1 (Search - P1): 18 tasks (5 tests + 13 implementation)
- User Story 2 (Tags - P1): 17 tasks (5 tests + 12 implementation)
- User Story 3 (Dashboard - P1): 12 tasks (3 tests + 9 implementation)
- User Story 4 (Notifications - P2): 17 tasks (4 tests + 13 implementation)
- User Story 5 (Saved Searches - P2): 17 tasks (4 tests + 13 implementation)
- User Story 6 (Scheduled Reports - P3): 16 tasks (4 tests + 12 implementation)
- Polish (Phase 9): 18 tasks

**Parallel Opportunities Identified**: 
- Phase 1: 8 parallel tasks
- Phase 2: 4 parallel tasks
- After Phase 2: US1, US2, US3, US4, US6 can run in parallel (US5 waits for US1)
- Within each story: Tests and services can run in parallel
- Phase 9: 18 parallel tasks

**Independent Test Criteria**:
- **US1**: User can perform advanced search with filters and see relevant results
- **US2**: Administrator can create tags, formateur can associate tags to activities
- **US3**: User can view recommendation dashboard with statistics and charts
- **US4**: User receives automatic notifications and can view/manage them
- **US5**: User can save searches and receive automated alerts for new results
- **US6**: Administrator can create scheduled reports that execute automatically

**Suggested MVP Scope**: User Story 1 (Advanced Search) - provides immediate value for finding activities and recommendations

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Background jobs require separate worker process (see worker.ts setup)
- All database operations must respect RLS policies for tenant isolation
- All API endpoints must have proper authentication and authorization
- Use Zod schemas for all input validation
- Follow existing Phase 3 patterns for consistency

