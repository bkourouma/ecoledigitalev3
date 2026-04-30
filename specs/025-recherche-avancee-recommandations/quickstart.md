# Quick Start Guide: Phase 5 - Recherche Avancée et Gestion des Recommandations

**Date**: 2025-01-27  
**Feature**: Phase 5 - Recherche Avancée et Gestion des Recommandations  
**Branch**: `025-phase`

## Overview

This guide provides a quick start for implementing Phase 5 features: advanced search, tag management, notifications, saved searches, scheduled reports, and recommendations dashboard.

## Prerequisites

- Phase 3 (Activities) must be completed and deployed
- Phase 1 (Authentication) must be functional
- Database migrations from Phase 3 must be applied
- PostgreSQL 14+ with French language support

## Implementation Steps

### 1. Database Setup

1. **Run migrations** to create new tables:
   ```bash
   # Create migration file: infra/scripts/migrations/0025_rso_phase5_search_recommendations.sql
   pnpm migrate
   ```

2. **Verify RLS policies** are created for all new tables:
   - `rso_tags`
   - `rso_activites_tags`
   - `rso_recherches_enregistrees`
   - `rso_notifications`
   - `rso_rapports_planifies`
   - `rso_recommandations_historique`

3. **Create full-text search indexes**:
   ```sql
   CREATE INDEX idx_activites_recherche ON rso_activites 
   USING GIN (to_tsvector('french', COALESCE(titre, '') || ' ' || COALESCE(contenu_texte, '')));
   ```

### 2. Backend Implementation

#### 2.1 Install Dependencies

```bash
cd apps/api
pnpm add node-cron
```

#### 2.2 Create Service Layer

1. **Search Service** (`apps/api/src/services/rso/search/search.service.ts`):
   - Implement PostgreSQL full-text search
   - Build query with filters
   - Handle pagination and sorting
   - Return results with highlights

2. **Tag Service** (`apps/api/src/services/rso/tags/tag.service.ts`):
   - CRUD operations for tags
   - Tag association with activities
   - Usage count tracking

3. **Notification Service** (`apps/api/src/services/rso/notifications/notification.service.ts`):
   - Create notifications
   - Mark as read
   - Automatic notification triggers

4. **Saved Search Service** (`apps/api/src/services/rso/saved-searches/saved-search.service.ts`):
   - CRUD for saved searches
   - Execute saved searches
   - Alert execution logic

5. **Scheduled Report Service** (`apps/api/src/services/rso/scheduled-reports/scheduled-report.service.ts`):
   - CRUD for scheduled reports
   - Report generation
   - Schedule calculation

6. **Dashboard Service** (`apps/api/src/services/rso/recommendations/recommendation-dashboard.service.ts`):
   - Aggregate statistics
   - Generate charts data
   - Filter by period/installation

#### 2.3 Create API Routes

1. **Search routes** (`apps/api/src/routes/rso/search.ts`):
   - `POST /api/v1/rso/search` - Perform search
   - `GET /api/v1/rso/search/suggestions` - Get suggestions
   - `POST /api/v1/rso/search/export` - Export results

2. **Tag routes** (`apps/api/src/routes/rso/tags.ts`):
   - `GET /api/v1/rso/tags` - List tags
   - `POST /api/v1/rso/tags` - Create tag
   - `PUT /api/v1/rso/tags/:id` - Update tag
   - `DELETE /api/v1/rso/tags/:id` - Delete tag
   - `POST /api/v1/rso/activites/:id/tags` - Add tags to activity

3. **Notification routes** (`apps/api/src/routes/rso/notifications.ts`):
   - `GET /api/v1/rso/notifications` - List notifications
   - `GET /api/v1/rso/notifications/non-lues` - Unread notifications
   - `PATCH /api/v1/rso/notifications/:id/lire` - Mark as read
   - `PATCH /api/v1/rso/notifications/marquer-toutes-lues` - Mark all as read

4. **Saved search routes** (`apps/api/src/routes/rso/recherches-enregistrees.ts`):
   - `GET /api/v1/rso/recherches-enregistrees` - List saved searches
   - `POST /api/v1/rso/recherches-enregistrees` - Create saved search
   - `PUT /api/v1/rso/recherches-enregistrees/:id` - Update saved search
   - `DELETE /api/v1/rso/recherches-enregistrees/:id` - Delete saved search
   - `POST /api/v1/rso/recherches-enregistrees/:id/executer` - Execute saved search

5. **Scheduled report routes** (`apps/api/src/routes/rso/rapports-planifies.ts`):
   - `GET /api/v1/rso/rapports-planifies` - List scheduled reports
   - `POST /api/v1/rso/rapports-planifies` - Create scheduled report
   - `PUT /api/v1/rso/rapports-planifies/:id` - Update scheduled report
   - `DELETE /api/v1/rso/rapports-planifies/:id` - Delete scheduled report
   - `POST /api/v1/rso/rapports-planifies/:id/executer` - Execute now

6. **Dashboard routes** (`apps/api/src/routes/rso/recommandations-dashboard.ts`):
   - `GET /api/v1/rso/recommandations/dashboard` - Get dashboard data
   - `GET /api/v1/rso/recommandations/statistiques` - Get statistics
   - `GET /api/v1/rso/recommandations/en-retard` - Get overdue recommendations

#### 2.4 Create Background Jobs

1. **Worker process** (`apps/api/src/worker.ts`):
   ```typescript
   import cron from 'node-cron';
   import { checkEcheances } from './jobs/rso/check-echeances.job';
   import { executeSavedSearches } from './jobs/rso/execute-saved-searches.job';
   import { executeRapportsPlanifies } from './jobs/rso/execute-rapports-planifies.job';
   import { cleanupNotifications } from './jobs/rso/cleanup-notifications.job';

   // Daily at 8am: Check recommendation deadlines
   cron.schedule('0 8 * * *', checkEcheances);

   // Hourly: Execute saved search alerts
   cron.schedule('0 * * * *', executeSavedSearches);

   // Hourly: Execute scheduled reports
   cron.schedule('0 * * * *', executeRapportsPlanifies);

   // Weekly on Monday at 2am: Cleanup old notifications
   cron.schedule('0 2 * * 1', cleanupNotifications);
   ```

### 3. Frontend Implementation

#### 3.1 Create Pages

1. **Advanced Search** (`apps/web/src/app/rso/recherche-avancee/page.tsx`):
   - Search input with autocomplete
   - Filter panel (year, installation, type, status, tags, dates)
   - Results display with pagination
   - Export options

2. **Tag Management** (`apps/web/src/app/rso/admin/tags/page.tsx`):
   - Tag list grouped by category
   - Create/edit tag form
   - Tag usage statistics

3. **Recommendations Dashboard** (`apps/web/src/app/rso/recommandations/dashboard/page.tsx`):
   - Statistics cards
   - Charts (evolution, priority breakdown)
   - Overdue recommendations list
   - Upcoming deadlines list

4. **Saved Searches** (`apps/web/src/app/rso/recherches-enregistrees/page.tsx`):
   - List of saved searches
   - Create/edit form
   - Alert configuration

5. **Scheduled Reports** (`apps/web/src/app/rso/rapports-planifies/page.tsx`):
   - List of scheduled reports
   - Create/edit form
   - Execution history

#### 3.2 Create Components

1. **Search Components** (`apps/web/src/components/rso/search/`):
   - `SearchAdvanced.tsx` - Main search interface
   - `SearchResults.tsx` - Results display
   - `SearchFilters.tsx` - Filter panel
   - `SearchAutocomplete.tsx` - Autocomplete input

2. **Tag Components** (`apps/web/src/components/rso/tags/`):
   - `TagSelector.tsx` - Tag selection component
   - `TagBadge.tsx` - Tag display badge
   - `TagManagement.tsx` - Tag management interface

3. **Notification Components** (`apps/web/src/components/rso/notifications/`):
   - `NotificationWidget.tsx` - Header notification widget
   - `NotificationList.tsx` - Full notification list

4. **Dashboard Components** (`apps/web/src/components/rso/recommendations/`):
   - `RecommendationsDashboard.tsx` - Main dashboard
   - `RecommendationsStats.tsx` - Statistics cards
   - `RecommendationsChart.tsx` - Evolution chart

#### 3.3 Create Hooks

1. **useSearch** (`apps/web/src/hooks/rso/useSearch.ts`):
   - Search query management
   - Results fetching with TanStack Query
   - Debounced autocomplete

2. **useTags** (`apps/web/src/hooks/rso/useTags.ts`):
   - Tag list fetching
   - Tag CRUD operations

3. **useNotifications** (`apps/web/src/hooks/rso/useNotifications.ts`):
   - Notification fetching with polling
   - Mark as read operations

### 4. Testing

1. **Unit Tests**:
   - Search query building
   - Tag association logic
   - Notification creation
   - Report generation

2. **Integration Tests**:
   - Search API endpoints
   - Tag management flow
   - Notification delivery

3. **E2E Tests** (Playwright):
   - Advanced search workflow
   - Tag management
   - Dashboard interactions
   - Saved search creation and execution

### 5. Deployment

1. **Database Migration**:
   ```bash
   pnpm migrate
   ```

2. **Start Worker Process**:
   ```bash
   # In production, use PM2 or similar
   node apps/api/src/worker.js
   ```

3. **Verify Background Jobs**:
   - Check logs for job execution
   - Verify notifications are created
   - Verify reports are generated

## Key Implementation Notes

- **Search**: Use PostgreSQL `to_tsvector` and `to_tsquery` for full-text search
- **Tags**: Prevent deletion of tags in use (deactivate instead)
- **Notifications**: Poll every 30 seconds when user is active
- **Background Jobs**: Run in separate process to avoid affecting API
- **RLS**: All queries must respect tenant isolation (ASPCI tenant only)
- **Validation**: Use Zod schemas for all API inputs
- **Error Handling**: Proper HTTP status codes and error messages

## Next Steps

After implementation:
1. Run full test suite
2. Perform manual testing of all features
3. Verify performance meets success criteria
4. Deploy to staging environment
5. User acceptance testing
6. Production deployment

