# Implementation Plan: Phase 3 - Gestion des Activités (CORE)

**Branch**: `023-gestion-activites-core` | **Date**: 2025-11-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-gestion-activites-core/spec.md`

## Summary

This feature implements the core activity management system for the RSO-PFSO platform, enabling formateurs RSO to create, manage, and share security activities (reports, exercises, training, audits, evaluations) with PFSO agents. The system includes a guided workflow for activity creation, a professional rich text editor with advanced formatting capabilities, granular permission management, recommendation tracking, advanced search, and PDF export functionality.

**Primary Requirement**: Enable formateurs RSO to create comprehensive security activity reports following ISPS code compliance, with rich content editing (tables, images, videos, maps, galleries), controlled visibility permissions for PFSO agents, recommendation tracking for improvement points, and professional document export capabilities.

**Technical Approach**: Rich text editor integration (TinyMCE or Quill.js), hierarchical activity type system with parent-child relationships, full-text search using PostgreSQL full-text indexes, PDF generation using Puppeteer/PDFKit, image upload handling with validation, permission-based access control extending Phase 1 RSO authentication, and recommendation workflow management.

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify 4.x, zod (validation), puppeteer or pdfkit (PDF generation), pg (PostgreSQL driver), node-cron (scheduled tasks if needed)
- Frontend: Next.js 15, React 18, TanStack Query, Tailwind CSS, Radix UI, TinyMCE or Quill.js (rich text editor), react-select or shadcn/ui Select
- Database: PostgreSQL 14+ with Row Level Security (RLS) for multi-tenant isolation
**Storage**: 
- PostgreSQL 14+ (rso_activites, rso_types_activites, rso_recommandations, rso_activites_pfso_access, rso_activites_medias tables)
- File storage for uploaded images (MinIO/S3 compatible or local filesystem)
- Session storage for auto-save drafts (localStorage or sessionStorage)
**Testing**: 
- Playwright (E2E activity creation workflow, editor functionality, permission management)
- Vitest/Jest (unit tests for activity validation, code generation, permission checks, recommendation status transitions)
- Fastify test framework (backend API endpoint tests)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011) - same as main EcoleDigitale app
- Frontend: Next.js 15 (port 3000) - integrated into existing web app
- Database: PostgreSQL 14+ (shared database with tenant isolation)
**Project Type**: Web application (monorepo with frontend + backend)  
**Performance Goals**: 
- Activity creation workflow completion < 5 minutes for basic activity (SC-001)
- Rich text editor loads and ready < 2 seconds (SC-002)
- Auto-save completes within 30 seconds (SC-003)
- Full-text search returns results < 1 second for 1000 activities (SC-004)
- PDF export generation < 5 seconds for 10-page content (SC-005)
- Image upload completes < 10 seconds for 5MB files (SC-009)
- Permission changes take effect < 1 second (SC-010)
- Activity list displays correctly for 500 activities (SC-012)
**Constraints**: 
- Must integrate with existing Phase 1 (Authentication) and Phase 2 (Installations) RSO-PFSO infrastructure
- Must maintain tenant isolation (ASPCI tenant only)
- Must comply with ISPS code requirements (audit trails, activity logging)
- Activity codes must be unique and auto-generated
- HTML content must be sanitized to prevent XSS attacks
- Image uploads must be validated (type, size) and stored securely
- Full-text search must respect permission restrictions
- PDF generation must handle large content gracefully
**Scale/Scope**: 
- 5 new database tables (rso_activites, rso_types_activites, rso_recommandations, rso_activites_pfso_access, rso_activites_medias)
- 6 main activity types with hierarchical sub-types (10+ total types)
- 33 functional requirements
- 7 user stories (3 P1, 4 P2)
- New route prefix: `/rso/formateur/activites/*`, `/rso/pfso/activites/*`, `/rso/recherche/*`
- Rich text editor with advanced features (tables, images, videos, maps, galleries)
- Permission management system with granular access control
- Recommendation tracking with status workflow
- Advanced search with full-text capabilities

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)
- ✅ **PASS**: All database queries must include tenant_id filtering via RLS policies
- ✅ **PASS**: Activity routes must verify tenant context from request (ASPCI tenant only)
- ✅ **PASS**: Permission checks must be tenant-scoped (PFSO agents can only access activities from their tenant)
- ✅ **PASS**: Image uploads must be stored in tenant-specific directories
- **Action Required**: Verify RLS policies exist for new `rso_activites`, `rso_types_activites`, `rso_recommandations`, `rso_activites_pfso_access`, `rso_activites_medias` tables

### 2. Type Safety & Validation (MANDATORY)
- ✅ **PASS**: All API contracts must be defined in `packages/contracts/src/rso/activites/` or similar
- ✅ **PASS**: Zod schemas required for all request/response validation (activity creation, updates, permissions, recommendations)
- ✅ **PASS**: TypeScript strict mode enforced
- ✅ **PASS**: HTML content sanitization required (use DOMPurify or similar)
- **Action Required**: Create Zod schemas for activity CRUD operations, permission management, recommendation workflows, search queries, and PDF export requests

### 3. Security-First Design (NON-NEGOTIABLE)
- ✅ **PASS**: All activity endpoints require RSO authentication (formateur RSO or admin)
- ✅ **PASS**: PFSO agent endpoints require authentication and permission verification
- ✅ **PASS**: Permission checks must be enforced at database query level (not just UI)
- ✅ **PASS**: HTML content must be sanitized before storage to prevent XSS
- ✅ **PASS**: Image uploads must validate file type, size, and scan for malicious content
- ✅ **PASS**: Activity code generation must be secure and collision-resistant
- **Action Required**: Implement permission verification middleware, HTML sanitization service, image upload validation, and secure code generation

### 4. API-First Architecture (MANDATORY)
- ✅ **PASS**: Business logic lives in backend services (`apps/api/src/services/rso/activites/`)
- ✅ **PASS**: Frontend consumes REST APIs via TanStack Query
- ✅ **PASS**: API versioning: `/api/v1/rso/formateur/activites`, `/api/v1/rso/pfso/activites`, `/api/v1/rso/recherche`
- ✅ **PASS**: Rich text editor communicates with backend for image uploads and auto-save
- **Action Required**: Create service layer for activity management, permission management, recommendation tracking, search functionality, and PDF generation

### 5. Monorepo Standards (REQUIRED)
- ✅ **PASS**: Shared contracts in `packages/contracts/src/rso/activites/`
- ✅ **PASS**: Shared UI components in `packages/ui/` if reusable (rich text editor wrapper, activity card, etc.)
- ✅ **PASS**: API routes in `apps/api/src/routes/rso/activites/`
- ✅ **PASS**: Frontend pages in `apps/web/src/app/rso/formateur/activites/` and `apps/web/src/app/rso/pfso/activites/`
- **Action Required**: Ensure contracts are exported from packages/contracts index, organize routes by role (formateur vs pfso)

### 6. Production-Ready Code (MANDATORY)
- ✅ **PASS**: Error handling with proper HTTP status codes (403 for permission denied, 404 for not found, etc.)
- ✅ **PASS**: Database transactions for activity creation and permission updates
- ✅ **PASS**: Logging for activity creation, permission changes, recommendation status updates
- ✅ **PASS**: Auto-save functionality with error recovery
- ✅ **PASS**: PDF generation with proper error handling and timeout management
- **Action Required**: Implement proper error handling, transaction management, auto-save recovery, and PDF generation error handling

**Overall Status**: ✅ **PASS** - All constitution principles satisfied with documented action items

## Project Structure

### Documentation (this feature)

```
specs/023-gestion-activites-core/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── activites-api.md
│   └── activites.contracts.ts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
apps/
├── api/
│   └── src/
│       ├── routes/
│       │   └── rso/
│       │       ├── activites.ts              # NEW: Activity CRUD routes (formateur)
│       │       ├── activites-pfso.ts         # NEW: Activity consultation routes (PFSO)
│       │       ├── types-activites.ts         # NEW: Activity type management routes
│       │       ├── recommandations.ts        # NEW: Recommendation CRUD routes
│       │       ├── activites-permissions.ts   # NEW: Permission management routes
│       │       ├── activites-search.ts        # NEW: Advanced search routes
│       │       └── activites-export.ts        # NEW: PDF export routes
│       ├── services/
│       │   └── rso/
│       │       ├── activites/
│       │       │   ├── activite.service.ts           # NEW: Activity business logic
│       │       │   ├── activite-code-generator.ts    # NEW: Code generation utility
│       │       │   ├── activite-permission.service.ts # NEW: Permission management
│       │       │   ├── activite-search.service.ts    # NEW: Full-text search
│       │       │   └── activite-export.service.ts    # NEW: PDF generation
│       │       ├── recommandations/
│       │       │   └── recommandation.service.ts     # NEW: Recommendation workflow
│       │       └── activites/
│       │           └── html-sanitizer.service.ts     # NEW: HTML content sanitization
│       ├── jobs/
│       │   └── rso/
│       │       └── activites-cleanup.job.ts          # NEW: Optional cleanup jobs
│       └── schemas/
│           └── rso/
│               ├── activite.schema.ts        # NEW: Activity validation schemas
│               ├── recommandation.schema.ts  # NEW: Recommendation validation schemas
│               └── activite-search.schema.ts # NEW: Search query validation
│
├── web/
│   └── src/
│       ├── app/
│       │   └── rso/
│       │       ├── formateur/
│       │       │   └── activites/             # NEW: Formateur activity pages
│       │       │       ├── page.tsx          # Activity list
│       │       │       ├── creer/
│       │       │       │   └── page.tsx      # Create activity workflow
│       │       │       ├── [id]/
│       │       │       │   ├── page.tsx      # Activity detail view
│       │       │       │   └── modifier/
│       │       │       │       └── page.tsx  # Edit activity
│       │       │       └── recommandations/
│       │       │           └── page.tsx      # Recommendation tracking
│       │       └── pfso/
│       │           └── activites/            # NEW: PFSO consultation pages
│       │               ├── page.tsx          # Activity list (read-only)
│       │               └── [id]/
│       │                   └── page.tsx      # Activity detail (read-only)
│       ├── components/
│       │   └── rso/
│       │       ├── activites/                 # NEW: Activity components
│       │       │   ├── ActivityList.tsx
│       │       │   ├── ActivityForm.tsx
│       │       │   ├── ActivityDetail.tsx
│       │       │   ├── ActivityFilters.tsx
│       │       │   ├── ActivityCard.tsx
│       │       │   ├── ActivityPermissions.tsx
│       │       │   └── RichTextEditor.tsx    # Rich text editor wrapper
│       │       ├── recommandations/           # NEW: Recommendation components
│       │       │   ├── RecommendationList.tsx
│       │       │   ├── RecommendationForm.tsx
│       │       │   ├── RecommendationCard.tsx
│       │       │   └── RecommendationStats.tsx
│       │       └── recherche/                 # NEW: Search components
│       │           ├── AdvancedSearch.tsx
│       │           └── SearchResults.tsx
│       └── lib/
│           └── rso/
│               ├── activites.ts              # NEW: Activity API client
│               ├── recommandations.ts       # NEW: Recommendation API client
│               └── recherche.ts             # NEW: Search API client
│
└── packages/
    └── contracts/
        └── src/
            └── rso/
                ├── activites/                # NEW: Activity contracts
                │   ├── activite.contracts.ts
                │   ├── activite.schema.ts
                │   └── index.ts
                ├── recommandations/         # NEW: Recommendation contracts
                │   ├── recommandation.contracts.ts
                │   ├── recommandation.schema.ts
                │   └── index.ts
                └── recherche/                # NEW: Search contracts
                    ├── recherche.contracts.ts
                    ├── recherche.schema.ts
                    └── index.ts
└── infra/
    └── scripts/
        └── migrations/
            ├── 0023_rso_phase3_activites.sql  # NEW: Activities schema
            └── 0023_rso_phase3_seed.sql        # NEW: Activity types seed data
```

**Structure Decision**: 
- **Monorepo integration**: Phase 3 extends existing RSO-PFSO module structure from Phases 1 and 2
- **Route organization**: Activity routes organized by role (`/rso/formateur/activites/*` for creators, `/rso/pfso/activites/*` for readers)
- **Service layer**: Business logic separated into service files (activite.service.ts, permission.service.ts, search.service.ts, export.service.ts)
- **Rich text editor**: Wrapper component in `components/rso/activites/RichTextEditor.tsx` that integrates TinyMCE or Quill.js
- **Permission management**: Dedicated service and routes for granular access control
- **Search functionality**: Separate service and routes for advanced full-text search
- **Database migrations**: Separate migration files for schema creation and activity types seed data

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations identified. All design decisions align with existing architecture and constitution principles. The complexity is justified by:
- Rich text editor integration is necessary for professional activity reports
- Permission system complexity is required for ISPS compliance and security
- Full-text search is essential for finding activities in a growing database
- PDF export is a core requirement for document sharing and archiving
