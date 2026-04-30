# Quick Start Guide: Phase 6 - Gestion des Incidents

**Feature**: Phase 6 - Gestion des Incidents  
**Date**: 2025-01-27

## Overview

This guide provides a quick reference for implementing the incident management system. It covers the essential steps to get started with development.

## Prerequisites

- Phase 1 (Infrastructure et Authentification) completed
- Phase 2 (Gestion des Installations) completed
- Database: PostgreSQL 14+ with RLS enabled
- File Storage: MinIO/S3 configured
- Email Service: Configured for notifications

## Database Setup

### 1. Run Migration

```bash
# Create all incident tables
psql -U postgres -d ecoledigitale -f infra/scripts/migrations/026_create_incidents_tables.sql
```

### 2. Verify Tables

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'rso_incidents%';

-- Expected tables:
-- - rso_incidents
-- - rso_incidents_medias
-- - rso_incidents_historique
-- - rso_incidents_commentaires
-- - rso_incidents_mesures
-- - rso_incidents_stats
```

## Backend Setup

### 1. Install Dependencies

```bash
cd apps/api
pnpm add @fastify/multipart puppeteer sharp node-cron exceljs
pnpm add -D @types/sharp
```

### 2. Create Service Files

```typescript
// apps/api/src/services/rso/incidentService.ts
// Core incident business logic

// apps/api/src/services/rso/incidentNotificationService.ts
// Notification logic

// apps/api/src/services/rso/incidentReportGenerator.ts
// PDF report generation

// apps/api/src/services/rso/incidentStatsService.ts
// Statistics calculation

// apps/api/src/services/rso/incidentFileService.ts
// File upload/download handling
```

### 3. Create Route Files

```typescript
// apps/api/src/routes/rso/incidents/index.ts
// Main router that registers all incident routes

// Individual route files:
// - create.ts
// - list.ts
// - details.ts
// - update.ts
// - status.ts
// - assign.ts
// - medias.ts
// - dashboard.ts
// etc.
```

### 4. Register Routes

```typescript
// apps/api/src/routes/rso/index.ts
import incidentsRoutes from './incidents';

export async function registerRSORoutes(fastify: FastifyInstance) {
  await fastify.register(incidentsRoutes, { prefix: '/incidents' });
}
```

## Frontend Setup

### 1. Install Dependencies

```bash
cd apps/web
pnpm add @dnd-kit/core @dnd-kit/sortable recharts react-dropzone
```

### 2. Create Page Components

```typescript
// apps/web/src/app/rso/incidents/page.tsx
// List view page

// apps/web/src/app/rso/incidents/nouveau/page.tsx
// Create incident page

// apps/web/src/app/rso/incidents/dashboard/page.tsx
// Dashboard page

// apps/web/src/app/rso/incidents/[id]/page.tsx
// Incident details page

// apps/web/src/app/rso/incidents/kanban/page.tsx
// Kanban view page
```

### 3. Create Shared Components

```typescript
// apps/web/src/components/rso/incidents/IncidentForm.tsx
// Create/edit form

// apps/web/src/components/rso/incidents/IncidentList.tsx
// List view component

// apps/web/src/components/rso/incidents/IncidentKanban.tsx
// Kanban view component

// apps/web/src/components/rso/incidents/IncidentDashboard.tsx
// Dashboard component
```

## Key Implementation Steps

### Step 1: Incident Creation

1. **Backend**: Implement `POST /api/rso/incidents`
   - Validate input with Zod
   - Generate unique incident code
   - Create incident record
   - Trigger notifications
   - Log history entry

2. **Frontend**: Create quick registration form
   - Mobile-optimized layout
   - Essential fields only
   - File upload support
   - Real-time validation

### Step 2: File Upload

1. **Backend**: Implement `POST /api/rso/incidents/:id/medias`
   - Use @fastify/multipart
   - Validate file size and type
   - Generate thumbnails (Sharp)
   - Store in MinIO/S3
   - Save metadata to database

2. **Frontend**: File upload component
   - Drag-and-drop interface
   - Progress indicators
   - Preview thumbnails
   - Multiple file support

### Step 3: Workflow Management

1. **Backend**: Implement status change endpoints
   - `PATCH /api/rso/incidents/:id/statut`
   - `PATCH /api/rso/incidents/:id/assigner`
   - Validate state transitions
   - Update dates automatically
   - Log history entries

2. **Frontend**: Kanban view
   - Drag-and-drop with @dnd-kit
   - Optimistic UI updates
   - Status change on drop

### Step 4: Dashboard

1. **Backend**: Implement `GET /api/rso/incidents/dashboard`
   - Calculate statistics
   - Use cached stats table
   - Aggregate by installation
   - Calculate resolution times

2. **Frontend**: Dashboard component
   - Charts with Recharts
   - Statistics cards
   - Urgent incidents list
   - Filters and date range

### Step 5: PDF Reports

1. **Backend**: Implement `GET /api/rso/incidents/:id/export/pdf`
   - Use Puppeteer
   - HTML template with CSS
   - Embed images from MinIO/S3
   - Generate PDF
   - Return as download

2. **Frontend**: PDF generation button
   - Show loading state
   - Download generated PDF
   - Handle errors gracefully

## Scheduled Tasks

### 1. Delay Detection

```typescript
// apps/api/src/jobs/rso/check-incidents-retard.job.ts
import cron from 'node-cron';

// Run every hour
cron.schedule('0 * * * *', async () => {
  await checkDelayedIncidents();
});
```

### 2. Statistics Aggregation

```typescript
// apps/api/src/jobs/rso/generate-incident-stats.job.ts

// Run daily at 23:00
cron.schedule('0 23 * * *', async () => {
  await aggregateIncidentStats();
});
```

## Testing Checklist

### Backend Tests

- [ ] Incident creation with valid data
- [ ] Incident code generation uniqueness
- [ ] File upload validation (size, type)
- [ ] Status transition validation
- [ ] Notification sending
- [ ] Statistics calculation
- [ ] PDF generation
- [ ] Full-text search

### Frontend Tests

- [ ] Quick registration form
- [ ] File upload component
- [ ] Kanban drag-and-drop
- [ ] Dashboard charts
- [ ] Search and filters
- [ ] Incident details page
- [ ] PDF download

### Integration Tests

- [ ] Complete workflow: create → assign → resolve → close
- [ ] File upload and retrieval
- [ ] Notification delivery
- [ ] Dashboard data accuracy
- [ ] PDF report completeness

## Common Issues & Solutions

### Issue: File Upload Fails

**Solution**: Check MinIO/S3 configuration, file size limits, and multipart settings.

### Issue: PDF Generation Slow

**Solution**: Use Puppeteer with headless mode, cache rendered HTML, optimize image sizes.

### Issue: Full-Text Search Not Working

**Solution**: Verify GIN indexes are created, check French language configuration, test tsvector generation.

### Issue: Notifications Not Sending

**Solution**: Check email service configuration, verify RSO assignments, check notification service logs.

## Next Steps

1. Implement core CRUD operations
2. Add file upload functionality
3. Implement workflow management
4. Build dashboard
5. Add PDF generation
6. Set up scheduled tasks
7. Add comprehensive tests

## Resources

- [Specification](./spec.md)
- [Data Model](./data-model.md)
- [Research](./research.md)
- [API Contracts](./contracts/incidents.contracts.ts)

