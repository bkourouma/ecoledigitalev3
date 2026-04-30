# Implementation Plan: Phase 6 - Gestion des Incidents

**Branch**: `026-gestion-incidents` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/026-gestion-incidents/spec.md`

## Summary

Implement comprehensive incident management system for the RSO-PFSO module, building on Phases 1-5 infrastructure. This phase enables:

- **Rapid incident registration** by security agents from desktop or mobile devices
- **Complete incident workflow** from detection to closure (nouveau → en_investigation → en_traitement → resolu → clos → archive)
- **Evidence file management** (photos, videos, documents) with secure storage and access control
- **Automatic notifications** to RSOs and administrators for new incidents, status changes, and delayed incidents
- **Comprehensive dashboard** with statistics, charts, and urgent incident alerts
- **Advanced search and filtering** with full-text search capabilities
- **Kanban view** for workflow management with drag-and-drop status changes
- **Professional PDF report generation** for incidents with all information, evidence, and history
- **Measure tracking** (immediate, corrective, preventive) with responsible persons and due dates
- **Complete audit trail** with history tracking for all incident actions

**Primary Requirements**:
- Incident codes must follow format INC-YYYY-CODE_INSTALLATION-XXX (e.g., INC-2024-PAD_COM-001)
- File uploads limited to 100 MB per file (JPG, PNG, MP4, PDF formats)
- Automatic notification system for critical incidents (email + in-app)
- Delay detection thresholds: critical (6h), high (24h), moderate (7 days), minor (14 days)
- Incident archiving after 2 years from closure (configurable)
- Full-text search on title, short description, and detailed description
- PDF reports must include all evidence, measures, and history

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify 4.x, zod (validation), multer or fastify-multipart (file uploads), pdfkit or puppeteer (PDF generation), exceljs (Excel export), node-cron (scheduled tasks), sharp (image processing/thumbnails)
- Frontend: Next.js 15, React 18, TanStack Query, Tailwind CSS, Radix UI, react-beautiful-dnd or @dnd-kit/core (Kanban drag-and-drop), react-dropzone (file uploads), recharts or chart.js (dashboard charts)
- Database: PostgreSQL 14+ with Row Level Security (RLS) for multi-tenant isolation, full-text search indexes
**Storage**: 
- PostgreSQL 14+ (rso_incidents, rso_incidents_medias, rso_incidents_historique, rso_incidents_commentaires, rso_incidents_mesures, rso_incidents_stats tables)
- File storage: MinIO/S3 compatible storage for evidence files (photos, videos, documents)
- Thumbnail generation for images (stored alongside original files)
- Session storage for filters and view preferences (localStorage)
**Testing**: 
- Playwright (E2E incident creation, workflow, dashboard, PDF generation)
- Vitest/Jest (unit tests for incident validation, code generation, notification logic, statistics calculation)
- Fastify test framework (backend API endpoint tests, file upload tests)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011) - same as main EcoleDigitale app
- Frontend: Next.js 15 (port 3000) - integrated into existing web app
- Database: PostgreSQL 14+ (shared database with tenant isolation)
- File Storage: MinIO/S3 compatible storage (shared with main app)
**Project Type**: Web application (monorepo with frontend + backend)  
**Performance Goals**: 
- Rapid incident registration < 2 minutes (SC-001)
- Incident creation processing < 5 seconds (SC-002)
- Notification delivery < 10 seconds (SC-003)
- Dashboard loading < 2 seconds for 500 incidents (SC-004)
- PDF generation < 10 seconds for 20 evidence files (SC-005)
- Search results < 1 second for 1000+ incidents (SC-006)
- Concurrent incident creation (10 simultaneous) without degradation (SC-007)
- File upload < 30 seconds for 100 MB files (SC-008)
- 95% success rate for incident registrations (SC-009)
- Delay detection within 1 hour (SC-010)
- Filter/view operations < 1 second (SC-011)
- Kanban drag-and-drop with immediate feedback (SC-012)
**Constraints**: 
- Must integrate with existing Phase 1-5 RSO-PFSO infrastructure
- Must maintain tenant isolation (ASPCI tenant only)
- Must comply with ISPS code requirements (audit trails, activity logging, data retention)
- File uploads must be validated (size, format, security scanning)
- Evidence files must be securely stored with access control
- PDF reports must be professionally formatted for regulatory compliance
- Notifications must be reliable (email delivery, in-app persistence)
- Scheduled tasks must be reliable (delay detection, statistics aggregation)
- Full-text search must be performant with proper indexing
**Scale/Scope**: 
- 6 new database tables (rso_incidents, rso_incidents_medias, rso_incidents_historique, rso_incidents_commentaires, rso_incidents_mesures, rso_incidents_stats)
- 30+ functional requirements
- 7 user stories (P1-P2 priorities)
- New route prefix: `/rso/incidents/*`
- File upload handling with validation and storage
- PDF generation service
- Notification service (email + in-app)
- Scheduled task system (delay detection, statistics aggregation)
- Dashboard with charts and statistics
- Kanban view component
- Full-text search implementation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Multi-Tenant Isolation
- ✅ **PASS**: Incidents will be isolated within ASPCI tenant using existing RLS infrastructure
- ✅ **PASS**: New `rso_incidents*` tables with tenant_id foreign key
- ✅ **PASS**: All incident routes will validate tenant context (ASPCI only)
- ✅ **PASS**: Evidence files stored with tenant isolation in MinIO/S3
- ✅ **PASS**: Agents can only create/view incidents for their assigned installation

### Security Requirements
- ✅ **PASS**: Input validation and sanitization (Zod schemas, XSS/SQL injection prevention)
- ✅ **PASS**: File upload validation (size limits, format validation, security scanning)
- ✅ **PASS**: Comprehensive activity logging for all incident actions (ISPS compliance)
- ✅ **PASS**: Role-based access control extending Phase 1 permissions
- ✅ **PASS**: Evidence files access control (only authorized users can view/download)
- ✅ **PASS**: Secure file storage with proper access controls
- ✅ **PASS**: Incident data retention and archiving for compliance

### Code Organization
- ✅ **PASS**: New routes follow existing monorepo structure (apps/api/src/routes/rso/incidents)
- ✅ **PASS**: Separate routes under `/rso/incidents/*` prefix
- ✅ **PASS**: Shared contracts package for TypeScript types
- ✅ **PASS**: Reuse existing validation, logging, authentication, and notification patterns from Phases 1-5
- ✅ **PASS**: File upload service integrated with existing MinIO/S3 infrastructure
- ✅ **PASS**: PDF generation service follows existing service patterns

### Data Integrity
- ✅ **PASS**: Foreign key constraints ensure referential integrity (incidents → installations, users, years)
- ✅ **PASS**: Unique constraints on incident codes prevent duplicates
- ✅ **PASS**: Check constraints validate incident types, statuses, categories, urgency levels
- ✅ **PASS**: Full-text search indexes for performant search operations
- ✅ **PASS**: Statistics cache table for performance optimization
- ⚠️ **NOTE**: Scheduled tasks for delay detection and statistics aggregation must be reliable (cron jobs or equivalent)

### Performance & Scalability
- ✅ **PASS**: Full-text search indexes for fast keyword searches
- ✅ **PASS**: Statistics cache table reduces query load
- ✅ **PASS**: File uploads handled asynchronously with progress tracking
- ✅ **PASS**: PDF generation can be asynchronous for large reports
- ✅ **PASS**: Dashboard queries optimized with proper indexing and caching

## Project Structure

### Documentation (this feature)

```
specs/026-gestion-incidents/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
apps/
├── api/
│   └── src/
│       ├── routes/
│       │   └── rso/
│       │       └── incidents/
│       │           ├── index.ts              # Main incidents router
│       │           ├── create.ts             # POST /api/rso/incidents
│       │           ├── list.ts               # GET /api/rso/incidents
│       │           ├── details.ts             # GET /api/rso/incidents/:id
│       │           ├── update.ts              # PUT /api/rso/incidents/:id
│       │           ├── delete.ts              # DELETE /api/rso/incidents/:id
│       │           ├── status.ts              # PATCH /api/rso/incidents/:id/statut
│       │           ├── assign.ts              # PATCH /api/rso/incidents/:id/assigner
│       │           ├── validate.ts            # PATCH /api/rso/incidents/:id/valider
│       │           ├── close.ts               # PATCH /api/rso/incidents/:id/cloturer
│       │           ├── medias.ts              # POST/GET /api/rso/incidents/:id/medias
│       │           ├── medias-delete.ts        # DELETE /api/rso/incidents/:id/medias/:mediaId
│       │           ├── historique.ts          # GET /api/rso/incidents/:id/historique
│       │           ├── commentaires.ts         # GET/POST /api/rso/incidents/:id/commentaires
│       │           ├── commentaires-update.ts # PUT/DELETE /api/rso/incidents/:id/commentaires/:commentId
│       │           ├── mesures.ts             # GET/POST /api/rso/incidents/:id/mesures
│       │           ├── mesures-update.ts      # PUT/DELETE /api/rso/incidents/:id/mesures/:mesureId
│       │           ├── mesures-status.ts      # PATCH /api/rso/incidents/:id/mesures/:mesureId/statut
│       │           ├── dashboard.ts           # GET /api/rso/incidents/dashboard
│       │           ├── statistiques.ts        # GET /api/rso/incidents/statistiques
│       │           ├── search.ts              # POST /api/rso/incidents/search
│       │           ├── urgents.ts             # GET /api/rso/incidents/urgents
│       │           ├── en-retard.ts            # GET /api/rso/incidents/en-retard
│       │           ├── mes-incidents.ts        # GET /api/rso/incidents/mes-incidents
│       │           ├── export-pdf.ts           # GET /api/rso/incidents/:id/export/pdf
│       │           ├── export-excel.ts         # POST /api/rso/incidents/export/excel
│       │           └── notify.ts               # POST /api/rso/incidents/:id/notifier
│       ├── services/
│       │   └── rso/
│       │       ├── incidentService.ts         # Core incident business logic
│       │       ├── incidentNotificationService.ts  # Notification logic
│       │       ├── incidentReportGenerator.ts      # PDF report generation
│       │       ├── incidentStatsService.ts         # Statistics calculation
│       │       └── incidentFileService.ts          # File upload/download handling
│       └── plugins/
│           └── rso-incident-auth.ts           # Authorization middleware for incidents

apps/
└── web/
    └── src/
        ├── app/
        │   └── rso/
        │       └── incidents/
        │           ├── page.tsx                # List view page
        │           ├── nouveau/
        │           │   └── page.tsx            # Create incident page
        │           ├── dashboard/
        │           │   └── page.tsx            # Dashboard page
        │           ├── [id]/
        │           │   └── page.tsx           # Incident details page
        │           └── kanban/
        │               └── page.tsx            # Kanban view page
        ├── components/
        │   └── rso/
        │       └── incidents/
        │           ├── IncidentForm.tsx       # Create/edit incident form
        │           ├── IncidentFormRapide.tsx # Quick registration form
        │           ├── IncidentList.tsx        # List view component
        │           ├── IncidentKanban.tsx      # Kanban view component
        │           ├── IncidentCard.tsx        # Incident card component
        │           ├── IncidentDetails.tsx     # Details view component
        │           ├── IncidentDashboard.tsx  # Dashboard component
        │           ├── IncidentFilters.tsx   # Filter component
        │           ├── IncidentSearch.tsx     # Search component
        │           ├── IncidentMediaUpload.tsx # File upload component
        │           ├── IncidentMediaGallery.tsx # Media gallery component
        │           ├── IncidentComments.tsx   # Comments component
        │           ├── IncidentMeasures.tsx   # Measures component
        │           ├── IncidentHistory.tsx    # History timeline component
        │           └── IncidentStats.tsx      # Statistics charts component

packages/
└── contracts/
    └── src/
        └── rso/
            └── incidents.ts                   # TypeScript types for incidents

infra/
└── scripts/
    ├── migrations/
    │   └── 026_create_incidents_tables.sql    # Database migration
    └── cron/
        ├── check-incidents-retard.js          # Delay detection task
        └── generate-incident-stats.js         # Statistics aggregation task
```

**Structure Decision**: Monorepo web application structure following existing RSO-PFSO patterns. Backend routes organized under `/rso/incidents/*` prefix. Frontend pages and components organized in `/rso/incidents/` directory. Shared TypeScript contracts in packages/contracts. File storage uses existing MinIO/S3 infrastructure. Scheduled tasks for delay detection and statistics aggregation.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | No violations - all requirements align with existing architecture |

