# Implementation Plan: Phase 5 - Recherche Avancée et Gestion des Recommandations

**Branch**: `025-phase` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-phase/spec.md`

## Summary

This feature implements an advanced search engine and comprehensive recommendation management system for the RSO-PFSO platform. The system includes full-text search with multi-criteria filtering, a flexible tag system for categorization, a recommendations dashboard with statistics and visualizations, automatic notifications and alerts, saved searches with automated alerts, and scheduled report generation.

**Primary Requirement**: Enable users to efficiently search across activities and recommendations using advanced filters and tags, track recommendations through a comprehensive dashboard, receive automatic notifications for important events, save frequently used searches with automated alerts, and generate scheduled reports for compliance and communication.

**Technical Approach**: Full-text search using PostgreSQL full-text indexes (with optional Elasticsearch for enhanced performance), tag management system with categories, notification service with real-time delivery, saved search tracking with automated execution, scheduled report generation using existing PDF/Excel infrastructure, and background job processing for automated tasks (cron jobs for deadline checks, alert execution, report generation).

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify 4.x, zod (validation), pg (PostgreSQL driver), node-cron (scheduled tasks), PostgreSQL full-text search (tsvector/tsquery)
- Frontend: Next.js 15, React 18, TanStack Query, Tailwind CSS, Radix UI (custom search UI components)
- Database: PostgreSQL 14+ with Row Level Security (RLS) for multi-tenant isolation
**Storage**: 
- PostgreSQL 14+ (rso_tags, rso_activites_tags, rso_recherches_enregistrees, rso_notifications, rso_rapports_planifies, rso_recommandations_historique tables, plus enhancements to rso_recommandations)
- Existing file storage for report attachments (MinIO/S3 compatible or local filesystem)
- Session storage for search state (localStorage or sessionStorage)
**Testing**: 
- Playwright (E2E search workflow, tag management, dashboard interactions, notification display, saved search creation)
- Vitest/Jest (unit tests for search query building, tag association logic, notification creation, report generation, scheduled task execution)
- Fastify test framework (backend API endpoint tests for search, tags, notifications, reports)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011) - same as main EcoleDigitale app
- Frontend: Next.js 15 (port 3000) - integrated into existing web app
- Database: PostgreSQL 14+ (shared database with tenant isolation)
- Optional: Elasticsearch server (if chosen, separate service on port 9200)
**Project Type**: Web application (monorepo with frontend + backend)  
**Performance Goals**: 
- Search results returned in < 2 seconds even with complex multi-criteria filters (SC-001)
- Search accuracy of 95% (results contain keywords and match filters) (SC-002)
- Multi-criteria search completion in < 30 seconds from page access to results (SC-003)
- Tag system supports 100+ unique tags without performance degradation (SC-004)
- Tag association to activity in < 10 seconds (SC-005)
- Dashboard loads all metrics and charts in < 3 seconds (SC-006)
- Notifications delivered within 1 minute of triggering event (SC-008)
- Report generation completes in < 30 seconds for up to 1000 items (SC-013)
- System supports 50+ concurrent search operations without degradation (SC-015)
**Constraints**: 
- Must integrate with existing Phase 3 (Activities) and Phase 1 (Authentication) infrastructure
- Must maintain tenant isolation (ASPCI tenant only)
- Must respect existing permission system (PFSO agents can only see permitted activities)
- Search must handle French language content (accents, special characters)
- Tag system must prevent deletion of tags in use
- Notifications must not overwhelm users (rate limiting, batching)
- Scheduled reports must handle failures gracefully (retry logic, error notifications)
- Background jobs must be reliable and recoverable (job queue or cron with logging)
**Scale/Scope**: 
- 6 new database tables (rso_tags, rso_activites_tags, rso_recherches_enregistrees, rso_notifications, rso_rapports_planifies, rso_recommandations_historique)
- Enhanced rso_recommandations table with additional fields
- 48 functional requirements
- 6 user stories (3 P1, 2 P2, 1 P3)
- New route prefixes: `/api/v1/rso/search/*`, `/api/v1/rso/tags/*`, `/api/v1/rso/notifications/*`, `/api/v1/rso/recherches-enregistrees/*`, `/api/v1/rso/rapports-planifies/*`
- Advanced search interface with multi-criteria filtering
- Tag management system with categories
- Recommendations dashboard with statistics and charts
- Notification system with real-time delivery
- Saved searches with automated alert execution
- Scheduled report generation and export functionality

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)
- ✅ **PASS**: All database queries must include tenant_id filtering via RLS policies
- ✅ **PASS**: Search routes must verify tenant context from request (ASPCI tenant only)
- ✅ **PASS**: Tag management must be tenant-scoped (tags are shared within tenant but isolated between tenants)
- ✅ **PASS**: Notifications must be tenant-scoped (users only see notifications for their tenant)
- ✅ **PASS**: Saved searches must be tenant-scoped (users only see their own searches within tenant)
- ✅ **PASS**: Scheduled reports must be tenant-scoped (reports only include tenant data)
- **Action Required**: Verify RLS policies exist for new `rso_tags`, `rso_activites_tags`, `rso_recherches_enregistrees`, `rso_notifications`, `rso_rapports_planifies`, `rso_recommandations_historique` tables, and enhanced `rso_recommandations` table

### 2. Type Safety & Validation (MANDATORY)
- ✅ **PASS**: All API contracts must be defined in `packages/contracts/src/rso/search/`, `packages/contracts/src/rso/tags/`, `packages/contracts/src/rso/notifications/`, etc.
- ✅ **PASS**: Zod schemas required for all request/response validation (search queries, tag creation/updates, notification creation, saved search configuration, scheduled report configuration)
- ✅ **PASS**: TypeScript strict mode enforced
- ✅ **PASS**: Search query sanitization required to prevent injection attacks
- **Action Required**: Create Zod schemas for search operations, tag management, notification creation, saved search CRUD, scheduled report CRUD, and recommendation history tracking

### 3. Security-First Design (NON-NEGOTIABLE)
- ✅ **PASS**: All search endpoints require RSO authentication (formateur RSO, PFSO agent, or admin)
- ✅ **PASS**: Tag management endpoints require administrator authentication
- ✅ **PASS**: Notification endpoints require authentication and user verification (users can only access their own notifications)
- ✅ **PASS**: Saved search endpoints require authentication and user verification (users can only access their own saved searches)
- ✅ **PASS**: Scheduled report endpoints require authentication and user verification (users can only access their own reports)
- ✅ **PASS**: Search results must respect permission restrictions (PFSO agents only see permitted activities)
- ✅ **PASS**: Search queries must be sanitized to prevent SQL injection and XSS
- **Action Required**: Implement permission verification middleware for search, tag management authorization checks, user ownership verification for notifications/saved searches/reports, and search query sanitization

### 4. API-First Architecture (MANDATORY)
- ✅ **PASS**: Business logic lives in backend services (`apps/api/src/services/rso/search/`, `apps/api/src/services/rso/tags/`, `apps/api/src/services/rso/notifications/`, etc.)
- ✅ **PASS**: Frontend consumes REST APIs via TanStack Query
- ✅ **PASS**: API versioning: `/api/v1/rso/search/*`, `/api/v1/rso/tags/*`, `/api/v1/rso/notifications/*`, `/api/v1/rso/recherches-enregistrees/*`, `/api/v1/rso/rapports-planifies/*`
- ✅ **PASS**: Background jobs communicate with backend services for scheduled tasks
- **Action Required**: Create service layer for search operations, tag management, notification delivery, saved search execution, scheduled report generation, and recommendation history tracking

### 5. Monorepo Standards (REQUIRED)
- ✅ **PASS**: Shared contracts in `packages/contracts/src/rso/search/`, `packages/contracts/src/rso/tags/`, `packages/contracts/src/rso/notifications/`, etc.
- ✅ **PASS**: Shared UI components in `packages/ui/` if reusable (search interface, tag selector, notification widget, dashboard components)
- ✅ **PASS**: API routes in `apps/api/src/routes/rso/search.ts`, `apps/api/src/routes/rso/tags.ts`, `apps/api/src/routes/rso/notifications.ts`, etc.
- ✅ **PASS**: Frontend pages in `apps/web/src/app/rso/recherche-avancee/`, `apps/web/src/app/rso/admin/tags/`, `apps/web/src/app/rso/recommandations/dashboard/`, etc.
- ✅ **PASS**: Background jobs in `apps/api/src/jobs/rso/` (notification checks, saved search execution, scheduled report generation)
- **Action Required**: Ensure contracts are exported from packages/contracts index, organize routes by feature area, create reusable UI components for search, tags, notifications, and dashboard

### 6. Production-Ready Code (MANDATORY)
- ✅ **PASS**: Error handling with proper HTTP status codes (400 for invalid search queries, 403 for unauthorized tag management, 404 for not found, etc.)
- ✅ **PASS**: Database transactions for tag associations, notification creation, saved search updates
- ✅ **PASS**: Logging for search operations, tag management actions, notification delivery, saved search executions, scheduled report runs
- ✅ **PASS**: Background job error handling with retry logic and failure notifications
- ✅ **PASS**: Search query validation and sanitization
- ✅ **PASS**: Notification rate limiting to prevent user overwhelm
- ✅ **PASS**: Scheduled report generation with timeout management and error recovery
- **Action Required**: Implement proper error handling, transaction management, background job error recovery, search query validation, notification rate limiting, and report generation error handling

**Overall Status**: ✅ **PASS** - All constitution principles satisfied with documented action items

## Project Structure

### Documentation (this feature)

```
specs/025-phase/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── search-api.md
│   ├── tags-api.md
│   ├── notifications-api.md
│   ├── saved-searches-api.md
│   ├── scheduled-reports-api.md
│   ├── recommendations-dashboard-api.md
│   └── search.contracts.ts
│   └── tags.contracts.ts
│   └── notifications.contracts.ts
│   └── saved-searches.contracts.ts
│   └── scheduled-reports.contracts.ts
│   └── recommendations-dashboard.contracts.ts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
apps/
├── api/
│   └── src/
│       ├── routes/
│       │   └── rso/
│       │       ├── search.ts                    # NEW: Advanced search routes
│       │       ├── tags.ts                      # NEW: Tag management routes
│       │       ├── notifications.ts             # NEW: Notification routes
│       │       ├── recherches-enregistrees.ts  # NEW: Saved search routes
│       │       ├── rapports-planifies.ts        # NEW: Scheduled report routes
│       │       └── recommandations-dashboard.ts # NEW: Recommendations dashboard routes
│       ├── services/
│       │   └── rso/
│       │       ├── search/
│       │       │   ├── search.service.ts        # NEW: Search business logic
│       │       │   ├── search-query-builder.ts  # NEW: Query construction
│       │       │   └── search-suggestions.service.ts # NEW: Auto-completion
│       │       ├── tags/
│       │       │   ├── tag.service.ts          # NEW: Tag CRUD operations
│       │       │   └── tag-association.service.ts # NEW: Activity-tag associations
│       │       ├── notifications/
│       │       │   ├── notification.service.ts  # NEW: Notification creation/delivery
│       │       │   └── notification-scheduler.service.ts # NEW: Automated notifications
│       │       ├── saved-searches/
│       │       │   ├── saved-search.service.ts  # NEW: Saved search CRUD
│       │       │   └── saved-search-executor.service.ts # NEW: Alert execution
│       │       ├── scheduled-reports/
│       │       │   ├── scheduled-report.service.ts # NEW: Report CRUD
│       │       │   └── report-generator.service.ts # NEW: Report generation
│       │       └── recommendations/
│       │           ├── recommendation-dashboard.service.ts # NEW: Dashboard data
│       │           └── recommendation-history.service.ts # NEW: History tracking
│       ├── jobs/
│       │   └── rso/
│       │       ├── check-echeances.job.ts       # NEW: Check recommendation deadlines
│       │       ├── execute-saved-searches.job.ts # NEW: Execute saved search alerts
│       │       ├── execute-rapports-planifies.job.ts # NEW: Execute scheduled reports
│       │       └── cleanup-notifications.job.ts # NEW: Cleanup old notifications
│       └── schemas/
│           └── rso/
│               ├── search.schema.ts            # NEW: Search query validation
│               ├── tag.schema.ts               # NEW: Tag validation
│               ├── notification.schema.ts      # NEW: Notification validation
│               ├── saved-search.schema.ts      # NEW: Saved search validation
│               └── scheduled-report.schema.ts  # NEW: Scheduled report validation
│
├── web/
│   └── src/
│       ├── app/
│       │   └── rso/
│       │       ├── recherche-avancee/           # NEW: Advanced search page
│       │       │   └── page.tsx
│       │       ├── admin/
│       │       │   └── tags/                    # NEW: Tag management page
│       │       │       └── page.tsx
│       │       ├── recommandations/
│       │       │   └── dashboard/              # NEW: Recommendations dashboard
│       │       │       └── page.tsx
│       │       ├── recherches-enregistrees/    # NEW: Saved searches page
│       │       │   └── page.tsx
│       │       └── rapports-planifies/         # NEW: Scheduled reports page
│       │           └── page.tsx
│       ├── components/
│       │   └── rso/
│       │       ├── search/
│       │       │   ├── SearchAdvanced.tsx      # NEW: Advanced search interface
│       │       │   ├── SearchResults.tsx       # NEW: Search results display
│       │       │   ├── SearchFilters.tsx      # NEW: Filter panel
│       │       │   └── SearchAutocomplete.tsx  # NEW: Auto-completion component
│       │       ├── tags/
│       │       │   ├── TagSelector.tsx         # NEW: Tag selection component
│       │       │   ├── TagBadge.tsx            # NEW: Tag display component
│       │       │   └── TagManagement.tsx       # NEW: Tag management interface
│       │       ├── notifications/
│       │       │   ├── NotificationWidget.tsx # NEW: Notification dropdown widget
│       │       │   └── NotificationList.tsx    # NEW: Notification list page
│       │       ├── saved-searches/
│       │       │   ├── SavedSearchList.tsx     # NEW: Saved searches list
│       │       │   └── SavedSearchForm.tsx     # NEW: Create/edit saved search
│       │       ├── scheduled-reports/
│       │       │   ├── ScheduledReportList.tsx # NEW: Scheduled reports list
│       │       │   └── ScheduledReportForm.tsx # NEW: Create/edit scheduled report
│       │       └── recommendations/
│       │           ├── RecommendationsDashboard.tsx # NEW: Dashboard main component
│       │           ├── RecommendationsStats.tsx # NEW: Statistics cards
│       │           ├── RecommendationsChart.tsx # NEW: Evolution chart
│       │           └── RecommendationsTable.tsx # NEW: Recommendations table
│       └── hooks/
│           └── rso/
│               ├── useSearch.ts                 # NEW: Search hook
│               ├── useTags.ts                   # NEW: Tags hook
│               ├── useNotifications.ts          # NEW: Notifications hook
│               └── useSavedSearches.ts         # NEW: Saved searches hook
│
└── packages/
    ├── contracts/
    │   └── src/
    │       └── rso/
    │           ├── search/                      # NEW: Search contracts
    │           │   └── search.contracts.ts
    │           ├── tags/                        # NEW: Tag contracts
    │           │   └── tags.contracts.ts
    │           ├── notifications/               # NEW: Notification contracts
    │           │   └── notifications.contracts.ts
    │           ├── saved-searches/              # NEW: Saved search contracts
    │           │   └── saved-searches.contracts.ts
    │           ├── scheduled-reports/           # NEW: Scheduled report contracts
    │           │   └── scheduled-reports.contracts.ts
    │           └── recommendations-dashboard/   # NEW: Dashboard contracts
    │               └── recommendations-dashboard.contracts.ts
    └── ui/
        └── src/
            └── components/
                └── rso/
                    ├── SearchAutocomplete.tsx    # NEW: Reusable search autocomplete
                    ├── TagSelector.tsx           # NEW: Reusable tag selector
                    └── NotificationWidget.tsx   # NEW: Reusable notification widget
```

**Structure Decision**: Web application (monorepo with frontend + backend). Following existing Phase 3 structure with:
- Backend services organized by feature area (search, tags, notifications, etc.)
- Frontend pages organized by route structure
- Shared contracts in packages/contracts
- Reusable UI components in packages/ui
- Background jobs in apps/api/src/jobs/rso/

## Complexity Tracking

*No violations - all constitution principles satisfied*

---

## Phase 0: Research Complete ✅

**Output**: `research.md`

**Decisions Made**:
1. **Search Engine**: PostgreSQL Full-Text Search (no Elasticsearch) - simpler, sufficient for current scale
2. **Search UI**: Custom implementation with Radix UI + TanStack Query - full control, consistent with existing stack
3. **Background Jobs**: node-cron with separate worker process - balances simplicity with isolation
4. **Notifications**: Polling with TanStack Query - simpler than WebSocket, sufficient for use case

---

## Phase 1: Design & Contracts Complete ✅

**Outputs**:
- `data-model.md` - Complete database schema for 6 new tables + enhanced recommendations table
- `contracts/` - TypeScript contracts with Zod schemas for all APIs:
  - `search.contracts.ts` - Search queries and results
  - `tags.contracts.ts` - Tag management
  - `notifications.contracts.ts` - Notification system
  - `saved-searches.contracts.ts` - Saved search management
  - `scheduled-reports.contracts.ts` - Scheduled report configuration
  - `recommendations-dashboard.contracts.ts` - Dashboard data structures
  - `search-api.md` - API documentation
- `quickstart.md` - Implementation guide with step-by-step instructions

**Agent Context Updated**: ✅ Cursor IDE context file updated with new technologies

---

## Next Steps

1. **Phase 2**: Run `/speckit.tasks` to generate implementation tasks
2. **Implementation**: Follow quickstart.md and implement features
3. **Testing**: Unit, integration, and E2E tests
4. **Deployment**: Database migrations, worker process setup, production deployment

