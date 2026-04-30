# Implementation Plan: Phase 4 - Gestion des Médias et Documents

**Branch**: `024-gestion-medias-documents` | **Date**: 2025-11-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-gestion-medias-documents/spec.md`

## Summary

This feature implements comprehensive media and document management for the RSO-PFSO platform, enabling formateurs RSO to upload, organize, and manage media files (images, videos, documents) for activities, with automatic image compression, video thumbnail generation, professional PDF export, multi-format exports (Word, Excel), optimized printing, and quota management. The system extends Phase 3 activity management with rich media capabilities.

**Primary Requirement**: Enable formateurs RSO to enrich activities with multimedia content (photos, videos, documents), manage a centralized media library, generate professional PDF reports with embedded media, export to multiple formats, and maintain storage quotas. The system must handle secure file uploads, automatic processing (compression, thumbnails), and provide a user-friendly media management interface.

**Technical Approach**: Extend existing `rso_activites_medias` table from Phase 3 with additional fields, implement secure file upload with validation using Fastify multipart, integrate Sharp for image processing (compression, thumbnails, EXIF), integrate FFmpeg for video processing (thumbnails, metadata), use Puppeteer for PDF generation (already used in Phase 3), integrate docx library for Word exports, integrate exceljs for Excel exports, implement quota tracking and management, and create media library UI with filtering and search.

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify 4.x, @fastify/multipart (file uploads), sharp (image processing), fluent-ffmpeg (video processing), puppeteer (PDF generation, already in use), docx (Word generation), exceljs (Excel generation), pg (PostgreSQL driver), zod (validation)
- Frontend: Next.js 15, React 18, TanStack Query, Tailwind CSS, Radix UI, react-dropzone (drag & drop uploads), react-image-gallery or similar (image galleries)
- Database: PostgreSQL 14+ with Row Level Security (RLS) for multi-tenant isolation
**Storage**: 
- PostgreSQL 14+ (extended `rso_activites_medias`, new `rso_documents_exports`, new `rso_quotas_utilisateurs` tables)
- File storage for media files (local filesystem organized by year/month/type, following existing pattern from Phase 3)
- Storage structure: `uploads/aspci/medias/{year}/{month}/{type}/{uuid_filename}`
**Testing**: 
- Playwright (E2E media upload workflow, gallery management, PDF export, quota management)
- Vitest/Jest (unit tests for image compression, video processing, quota calculations, export generation)
- Fastify test framework (backend API endpoint tests for upload, media management, exports)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011) - same as main EcoleDigitale app
- Frontend: Next.js 15 (port 3000) - integrated into existing web app
- Database: PostgreSQL 14+ (shared database with tenant isolation)
- Server requirements: FFmpeg installed for video processing, sufficient disk space for media storage
**Project Type**: Web application (monorepo with frontend + backend)  
**Performance Goals**: 
- Single image upload (10 MB) completes in < 10 seconds (SC-001)
- Image compression completes in < 2 seconds per image (SC-002)
- Media library displays correctly for up to 1000 files (SC-003)
- Full-text search returns results in < 1 second for 1000 files (SC-004)
- PDF generation completes in < 5 seconds for 10 pages + 20 images (SC-005)
- PDF generation completes in < 15 seconds for 50 pages + 100 images (SC-006)
- Quota updates within 1 second of upload/deletion (SC-010)
- Media processing succeeds for 98% of valid files (SC-015)
- Concurrent uploads (up to 10) complete successfully (SC-016)
**Constraints**: 
- Must extend existing Phase 3 `rso_activites_medias` table structure
- Must integrate with existing Phase 3 activity management system
- Must maintain tenant isolation (ASPCI tenant only)
- File uploads must validate type, size, and security (MIME type validation, file extension validation, size limits)
- Image compression must preserve quality while reducing file size
- Video processing requires FFmpeg on server (system dependency)
- PDF generation must handle large content gracefully (timeout management, memory management)
- Storage quotas must be enforced before upload begins
- Media files must be organized for efficient retrieval and cleanup
**Scale/Scope**: 
- 3 database tables (extended `rso_activites_medias`, new `rso_documents_exports`, new `rso_quotas_utilisateurs`)
- 57 functional requirements
- 7 user stories (4 P1, 3 P2)
- New route prefixes: `/rso/formateur/medias/*`, `/rso/formateur/activites/:id/medias/*`, `/rso/formateur/activites/:id/export/*`
- Media processing pipeline (image compression, video thumbnails, EXIF extraction)
- Export generation (PDF, Word, Excel)
- Quota management system
- Media library with filtering, search, and organization

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)
- ✅ **PASS**: All database queries must include tenant_id filtering via RLS policies
- ✅ **PASS**: Media routes must verify tenant context from request (ASPCI tenant only)
- ✅ **PASS**: Media files must be stored in tenant-specific directories (`uploads/aspci/medias/`)
- ✅ **PASS**: Quota management must be tenant-scoped (each user's quota is independent)
- ✅ **PASS**: Media access must respect activity permissions (PFSO agents can only access media for activities they have permission to view)
- **Action Required**: Verify RLS policies exist for extended `rso_activites_medias`, new `rso_documents_exports`, and new `rso_quotas_utilisateurs` tables. Ensure media file paths are tenant-scoped.

### 2. Type Safety & Validation (MANDATORY)
- ✅ **PASS**: All API contracts must be defined in `packages/contracts/src/rso/medias/` or similar
- ✅ **PASS**: Zod schemas required for all request/response validation (media upload, media management, export requests, quota management)
- ✅ **PASS**: TypeScript strict mode enforced
- ✅ **PASS**: File upload validation required (MIME type, file extension, file size, security scanning)
- **Action Required**: Create Zod schemas for media upload, media CRUD operations, export generation requests, quota management, and gallery management.

### 3. Security-First Design (NON-NEGOTIABLE)
- ✅ **PASS**: All media endpoints require RSO authentication (formateur RSO or admin)
- ✅ **PASS**: Media access must respect activity permissions (enforced at database query level)
- ✅ **PASS**: File uploads must validate file type, size, and scan for malicious content
- ✅ **PASS**: Media file paths must be secure (no directory traversal, unique filenames)
- ✅ **PASS**: Export generation must validate user permissions before generating documents
- ✅ **PASS**: Quota enforcement must prevent quota overruns before file transfer begins
- **Action Required**: Implement file upload validation middleware, secure file path generation, permission verification for media access, and quota pre-check before upload.

### 4. API-First Architecture (MANDATORY)
- ✅ **PASS**: Business logic lives in backend services (`apps/api/src/services/rso/medias/`)
- ✅ **PASS**: Frontend consumes REST APIs via TanStack Query
- ✅ **PASS**: API versioning: `/api/v1/rso/formateur/medias`, `/api/v1/rso/formateur/activites/:id/medias`, `/api/v1/rso/formateur/activites/:id/export`
- ✅ **PASS**: Media processing (compression, thumbnails) happens on backend
- ✅ **PASS**: Export generation happens on backend
- **Action Required**: Create service layer for media management, media processing (image/video), export generation (PDF/Word/Excel), and quota management.

### 5. Monorepo Standards (REQUIRED)
- ✅ **PASS**: Shared contracts in `packages/contracts/src/rso/medias/`
- ✅ **PASS**: Shared UI components in `packages/ui/` if reusable (media uploader, media gallery, media preview)
- ✅ **PASS**: API routes in `apps/api/src/routes/rso/medias/` and `apps/api/src/routes/rso/activites-export.ts`
- ✅ **PASS**: Frontend pages in `apps/web/src/app/rso/formateur/medias/` and media components in `apps/web/src/components/rso/medias/`
- **Action Required**: Ensure contracts are exported from packages/contracts index, organize routes by functionality (medias vs exports), create reusable media components.

### 6. Production-Ready Code (MANDATORY)
- ✅ **PASS**: Error handling with proper HTTP status codes (400 for validation errors, 403 for permission denied, 413 for file too large, etc.)
- ✅ **PASS**: Database transactions for media uploads and quota updates
- ✅ **PASS**: Logging for media uploads, deletions, quota changes, export generation
- ✅ **PASS**: Media processing with error recovery (failed compression doesn't block upload)
- ✅ **PASS**: Export generation with proper error handling and timeout management
- ✅ **PASS**: Orphaned media cleanup job (scheduled task for 30-day retention)
- **Action Required**: Implement proper error handling, transaction management, media processing error recovery, export generation error handling, and scheduled cleanup job.

**Overall Status**: ✅ **PASS** - All constitution principles satisfied with documented action items

## Project Structure

### Documentation (this feature)

```
specs/024-gestion-medias-documents/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── medias-api.md
│   └── medias.contracts.ts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
apps/
├── api/
│   └── src/
│       ├── routes/
│       │   └── rso/
│       │       ├── medias.ts                    # NEW: Media CRUD routes (upload, list, get, update, delete)
│       │       ├── activites-medias.ts          # NEW: Activity media association routes
│       │       ├── activites-export.ts          # EXTEND: Add Word/Excel export to existing PDF export
│       │       └── quotas.ts                    # NEW: Quota management routes (get, update for admin)
│       ├── services/
│       │   └── rso/
│       │       ├── medias/
│       │       │   ├── media.service.ts         # NEW: Media business logic (CRUD, gallery management)
│       │       │   ├── media-upload.service.ts  # NEW: File upload handling, validation, storage
│       │       │   ├── media-processing.service.ts # NEW: Image compression, video thumbnail generation
│       │       │   ├── media-quota.service.ts   # NEW: Quota calculation, enforcement, management
│       │       │   └── media-cleanup.service.ts # NEW: Orphaned media cleanup (30-day retention)
│       │       └── exports/
│       │           ├── pdf-export.service.ts   # EXTEND: Enhance existing PDF export from Phase 3
│       │           ├── word-export.service.ts  # NEW: Word (DOCX) export generation
│       │           └── excel-export.service.ts # NEW: Excel (XLSX) export generation
│       ├── jobs/
│       │   └── rso/
│       │       └── media-cleanup.job.ts         # NEW: Scheduled job for orphaned media cleanup
│       └── schemas/
│           └── rso/
│               ├── media.schema.ts             # NEW: Media validation schemas
│               ├── export.schema.ts            # NEW: Export request validation schemas
│               └── quota.schema.ts             # NEW: Quota management validation schemas
│
├── web/
│   └── src/
│       ├── app/
│       │   └── rso/
│       │       └── formateur/
│       │           ├── medias/                 # NEW: Media library pages
│       │           │   ├── page.tsx            # Media library list with filters
│       │           │   └── [id]/
│       │           │       └── page.tsx         # Media preview/edit page
│       │           └── activites/
│       │               └── [id]/
│       │                   ├── medias/          # NEW: Activity media gallery page
│       │                   │   └── page.tsx
│       │                   └── export/          # NEW: Export options page
│       │                       └── page.tsx
│       ├── components/
│       │   └── rso/
│       │       ├── medias/                     # NEW: Media components
│       │       │   ├── MediaUploader.tsx       # Drag & drop upload component
│       │       │   ├── MediaLibrary.tsx        # Media library list/grid view
│       │       │   ├── MediaGallery.tsx        # Activity image gallery component
│       │       │   ├── MediaPreview.tsx        # Media preview modal
│       │       │   ├── MediaFilters.tsx        # Filter component for media library
│       │       │   ├── QuotaDashboard.tsx      # Quota usage dashboard
│       │       │   └── MediaCard.tsx           # Individual media card component
│       │       └── exports/                    # NEW: Export components
│       │           ├── ExportOptions.tsx       # Export format selection and options
│       │           └── ExportProgress.tsx      # Export generation progress indicator
│       └── lib/
│           └── rso/
│               ├── medias.ts                   # NEW: Media API client
│               ├── exports.ts                  # NEW: Export API client
│               └── quotas.ts                   # NEW: Quota API client
│
└── packages/
    └── contracts/
        └── src/
            └── rso/
                └── medias/                     # NEW: Media contracts
                    ├── media.contracts.ts
                    ├── export.contracts.ts
                    ├── quota.contracts.ts
                    └── index.ts
└── infra/
    └── scripts/
        └── migrations/
            ├── 0024_rso_phase4_medias.sql      # NEW: Media schema extensions and new tables
            └── 0024_rso_phase4_quotas.sql      # NEW: Quota management schema
```

**Structure Decision**: 
- **Monorepo integration**: Phase 4 extends existing RSO-PFSO module structure from Phases 1, 2, and 3
- **Route organization**: Media routes organized by functionality (`/rso/formateur/medias/*` for library, `/rso/formateur/activites/:id/medias/*` for activity galleries, `/rso/formateur/activites/:id/export/*` for exports)
- **Service layer**: Business logic separated into service files (media.service.ts, media-upload.service.ts, media-processing.service.ts, media-quota.service.ts, export services)
- **Media processing**: Dedicated service for image compression (Sharp) and video processing (FFmpeg)
- **Export generation**: Separate services for PDF (extend existing), Word (docx), and Excel (exceljs)
- **Quota management**: Dedicated service for quota tracking, calculation, and enforcement
- **Database migrations**: Separate migration files for media schema extensions and quota management schema
- **Scheduled jobs**: Cleanup job for orphaned media files (30-day retention)

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations identified. All design decisions align with existing architecture and constitution principles. The complexity is justified by:
- Media processing pipeline is necessary for automatic image compression and video thumbnail generation
- Multiple export formats (PDF, Word, Excel) are required for different use cases and user preferences
- Quota management is essential for storage cost control and resource planning
- Media library with filtering and search is required for managing large numbers of media files
- Integration with FFmpeg for video processing is a standard requirement for video thumbnail generation
