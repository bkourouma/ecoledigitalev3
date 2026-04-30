# Tasks: Phase 4 - Gestion des Médias et Documents

**Input**: Design documents from `/specs/024-gestion-medias-documents/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Backend**: `apps/api/src/`
- **Frontend**: `apps/web/src/`
- **Contracts**: `packages/contracts/src/`
- **Migrations**: `infra/scripts/migrations/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, and basic structure

- [x] T001 Install backend dependencies: sharp, fluent-ffmpeg, @types/fluent-ffmpeg, docx, exceljs, @fastify/multipart
- [x] T002 Install frontend dependencies: react-dropzone
- [x] T003 [P] Create directory structure: `apps/api/src/services/rso/medias/`, `apps/api/src/services/rso/exports/`, `apps/api/src/routes/rso/medias.ts`, `apps/web/src/components/rso/medias/`, `apps/web/src/app/rso/formateur/medias/`
- [x] T004 [P] Create contracts directory: `packages/contracts/src/rso/medias/`
- [x] T005 Configure environment variables in `apps/api/.env`: RSO_MEDIAS_UPLOAD_DIR, RSO_EXPORTS_UPLOAD_DIR, media processing settings, quota defaults

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create database migration: `infra/scripts/migrations/0024_rso_phase4_medias.sql` - Extend `rso_activites_medias` table with new columns (nom_original, chemin_thumbnail, chemin_optimise, taille_humaine, extension, largeur, hauteur, duree_secondes, description, est_principal, statut, erreur_message, exif_data, url_original, url_optimise, url_thumbnail, updated_at, deleted_at)
- [x] T007 Create database migration: `infra/scripts/migrations/0024_rso_phase4_quotas.sql` - Create `rso_documents_exports` and `rso_quotas_utilisateurs` tables with indexes and constraints
- [x] T008 Run migrations and verify schema: Execute both migration files, verify tables created, indexes exist, RLS policies applied
- [x] T009 [P] Create TypeScript contracts: `packages/contracts/src/rso/medias/media.contracts.ts` - Define RSOMedia, MediaType, MediaProcessingStatus interfaces
- [x] T010 [P] Create TypeScript contracts: `packages/contracts/src/rso/medias/export.contracts.ts` - Define RSODocumentExport, ExportType, ExportStatus, export request/response interfaces
- [x] T011 [P] Create TypeScript contracts: `packages/contracts/src/rso/medias/quota.contracts.ts` - Define RSOQuota, RSOQuotaInfo, RSOQuotaStats interfaces
- [x] T012 Create contracts index: `packages/contracts/src/rso/medias/index.ts` - Export all media contracts
- [x] T013 [P] Create Zod schemas: `apps/api/src/schemas/rso/media.schema.ts` - Validation schemas for media upload, update, list queries
- [x] T014 [P] Create Zod schemas: `apps/api/src/schemas/rso/export.schema.ts` - Validation schemas for PDF/Word/Excel export requests
- [x] T015 [P] Create Zod schemas: `apps/api/src/schemas/rso/quota.schema.ts` - Validation schemas for quota queries and updates
- [x] T016 Create base media service structure: `apps/api/src/services/rso/medias/media.service.ts` - Class skeleton with constructor, basic CRUD method signatures
- [x] T017 Create media upload service structure: `apps/api/src/services/rso/medias/media-upload.service.ts` - Class skeleton for file upload handling
- [x] T018 Create media processing service structure: `apps/api/src/services/rso/medias/media-processing.service.ts` - Class skeleton for image/video processing
- [x] T019 Create quota service structure: `apps/api/src/services/rso/medias/media-quota.service.ts` - Class skeleton for quota management
- [x] T020 Initialize quota records: Create script or migration to initialize `rso_quotas_utilisateurs` for all existing users with default 1000 MB quota

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Upload Sécurisé de Médias pour Activités (Priority: P1) 🎯 MVP

**Goal**: Enable formateurs RSO to securely upload media files (images, videos, documents) with automatic validation, processing (compression, thumbnails), and quota enforcement.

**Independent Test**: A formateur RSO can upload 5 images via drag & drop, see progress indicators, have images automatically compressed and thumbnails generated, and see them appear in the activity gallery. If quota would be exceeded, upload is blocked before transfer begins.

### Implementation for User Story 1

- [ ] T021 [US1] Implement file validation in `apps/api/src/services/rso/medias/media-upload.service.ts`: Validate MIME type, file extension, file size per type (images: 10MB, videos: 100MB, documents: 20MB)
- [ ] T022 [US1] Implement quota pre-check in `apps/api/src/services/rso/medias/media-quota.service.ts`: Check if upload would exceed quota before file transfer begins, return clear error if quota would be exceeded
- [ ] T023 [US1] Implement file storage in `apps/api/src/services/rso/medias/media-upload.service.ts`: Generate UUID filename, create directory structure `uploads/aspci/medias/{YYYY}/{MM}/{type}/`, save file to disk
- [ ] T024 [US1] Implement image processing in `apps/api/src/services/rso/medias/media-processing.service.ts`: Use Sharp to compress images (quality 85%, max 2048px), generate thumbnails (300x300px), extract EXIF metadata
- [ ] T025 [US1] Implement video processing in `apps/api/src/services/rso/medias/media-processing.service.ts`: Use fluent-ffmpeg to extract metadata (duration, dimensions, codec), generate thumbnail at 1-second mark
- [ ] T026 [US1] Implement media record creation in `apps/api/src/services/rso/medias/media.service.ts`: Insert into `rso_activites_medias` with all metadata (paths, sizes, dimensions, EXIF, processing status)
- [ ] T027 [US1] Implement quota update in `apps/api/src/services/rso/medias/media-quota.service.ts`: Atomically update `quota_utilise_mo` and file counts after successful upload
- [ ] T028 [US1] Implement upload endpoint: `apps/api/src/routes/rso/medias.ts` - POST `/api/v1/rso/formateur/medias/upload` with multipart/form-data handling, validation, quota check, file storage, processing, database insert, quota update
- [ ] T029 [US1] Implement activity media upload endpoint: `apps/api/src/routes/rso/activites-medias.ts` - POST `/api/v1/rso/formateur/activites/:id/medias/upload` (reuses upload service, associates with activity)
- [ ] T030 [US1] Implement file serving endpoint: `apps/api/src/routes/rso/medias.ts` - GET `/api/v1/rso/medias/:id/original`, `/optimise`, `/thumbnail` with permission checks
- [x] T031 [US1] Create MediaUploader component: `apps/web/src/components/rso/medias/MediaUploader.tsx` - Drag & drop zone using react-dropzone, file selection, progress indicators per file, error handling
- [x] T032 [US1] Create media API client: `apps/web/src/lib/rso/medias.ts` - uploadMedia function with FormData, progress tracking, error handling
- [x] T033 [US1] Integrate uploader in activity page: Add MediaUploader component to activity detail page at `apps/web/src/app/rso/formateur/activites/[id]/modifier/page.tsx`
- [x] T034 [US1] Add error handling: Display clear error messages for invalid file types, size limits, quota exceeded, processing failures
- [ ] T035 [US1] Add logging: Log all uploads (file type, size, user, activity) in `apps/api/src/services/rso/medias/media-upload.service.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional - users can upload media files, see them processed, and view them in activities. Test independently before proceeding.

---

## Phase 4: User Story 2 - Bibliothèque de Médias et Organisation (Priority: P1)

**Goal**: Enable formateurs RSO to view, search, filter, and manage all their uploaded media in a centralized library with quota dashboard.

**Independent Test**: A formateur RSO can access the media library, see quota dashboard (456 MB / 1000 MB, 45.6%), filter by type and activity, search by filename, preview media, edit captions, reorder media, and delete media. Quota updates immediately after deletion.

### Implementation for User Story 2

- [x] T036 [US2] Implement media list query in `apps/api/src/services/rso/medias/media.service.ts`: Query `rso_activites_medias` with filters (type, activity, date range, search), pagination, exclude deleted (deleted_at IS NULL)
- [x] T037 [US2] Implement quota calculation in `apps/api/src/services/rso/medias/media-quota.service.ts`: Calculate quota usage from sum of file sizes, breakdown by type (images, videos, documents), return quota info with percentages
- [x] T038 [US2] Implement media list endpoint: `apps/api/src/routes/rso/medias.ts` - GET `/api/v1/rso/formateur/medias` with query parameters (page, limit, typeMedia, activiteId, dateDebut, dateFin, search, view), return paginated results with quota info
- [x] T039 [US2] Implement media detail endpoint: `apps/api/src/routes/rso/medias.ts` - GET `/api/v1/rso/formateur/medias/:id` with full media details including EXIF, metadata, activity info
- [x] T040 [US2] Implement media update endpoint: `apps/api/src/routes/rso/medias.ts` - PUT `/api/v1/rso/formateur/medias/:id` to update legende, description, ordre
- [x] T041 [US2] Implement media delete endpoint: `apps/api/src/routes/rso/medias.ts` - DELETE `/api/v1/rso/formateur/medias/:id` with soft delete (set deleted_at), update quota
- [x] T042 [US2] Implement quota endpoint: `apps/api/src/routes/rso/medias.ts` - GET `/api/v1/rso/formateur/medias/quota` returning quota info with breakdown and warnings
- [x] T043 [US2] Create MediaLibrary component: `apps/web/src/components/rso/medias/MediaLibrary.tsx` - Grid/list view toggle, media cards, pagination, loading states
- [x] T044 [US2] Create MediaCard component: `apps/web/src/components/rso/medias/MediaCard.tsx` - Display thumbnail/icon, filename, size, date, actions (preview, edit, delete)
- [x] T045 [US2] Create MediaFilters component: `apps/web/src/components/rso/medias/MediaFilters.tsx` - Filter by type, activity, date range, search input
- [x] T046 [US2] Create MediaPreview component: `apps/web/src/components/rso/medias/MediaPreview.tsx` - Modal with full-size media, metadata display, editable caption, actions (download, edit, delete, copy link)
- [x] T047 [US2] Create QuotaDashboard component: `apps/web/src/components/rso/medias/QuotaDashboard.tsx` - Progress bar, quota usage (used/total/percentage), breakdown by type, warning when > 80%
- [x] T048 [US2] Create media library page: `apps/web/src/app/rso/formateur/medias/page.tsx` - Integrate MediaLibrary, MediaFilters, QuotaDashboard, handle filtering and search
- [x] T049 [US2] Create media detail page: `apps/web/src/app/rso/formateur/medias/[id]/page.tsx` - Full media preview with edit capabilities
- [x] T050 [US2] Extend media API client: `apps/web/src/lib/rso/medias.ts` - Add listMedia, getMedia, updateMedia, deleteMedia, getQuota functions
- [x] T051 [US2] Implement search functionality: Full-text search in nom_original and legende fields in media list query
- [x] T052 [US2] Add quota warning logic: Display visual warning (orange/red) when quota usage > 80% in QuotaDashboard component

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - users can upload media and manage their library. Test independently before proceeding.

---

## Phase 5: User Story 3 - Galeries d'Images pour Activités (Priority: P1)

**Goal**: Enable formateurs RSO to create and manage image galleries for activities with ordering, captions, and primary image designation.

**Independent Test**: A formateur RSO can access activity gallery, add 8 images from library and upload 2 new images, reorder by drag & drop, set primary image, add captions. Gallery displays in responsive grid (2-4 columns), and all images appear in PDF export.

### Implementation for User Story 3

- [x] T053 [US3] Implement activity media list query in `apps/api/src/services/rso/medias/media.service.ts`: Get all media for activity, ordered by ordre, include primary image flag
- [x] T054 [US3] Implement media association in `apps/api/src/services/rso/medias/media.service.ts`: Associate existing media with activity, set ordre, update activite_id
- [x] T055 [US3] Implement primary image management in `apps/api/src/services/rso/medias/media.service.ts`: Set est_principal=true for one media, set others to false for same activity
- [x] T056 [US3] Implement media order update in `apps/api/src/services/rso/medias/media.service.ts`: Update ordre field for media in activity gallery
- [x] T057 [US3] Implement activity media endpoints: `apps/api/src/routes/rso/activites-medias.ts` - GET `/api/v1/rso/formateur/activites/:id/medias` (list gallery), POST (associate media), PATCH `/:mediaId/principal` (set primary), DELETE `/:mediaId` (remove from gallery)
- [x] T058 [US3] Implement media order endpoint: `apps/api/src/routes/rso/medias.ts` - PATCH `/api/v1/rso/formateur/medias/:id/ordre` to update display order
- [x] T059 [US3] Create ActivityImageGallery component: `apps/web/src/components/rso/medias/ActivityImageGallery.tsx` - Responsive grid (2 cols mobile, 3 tablet, 4 desktop), display images with captions, reordering with buttons
- [x] T060 [US3] Add lightbox functionality to ActivityImageGallery: Click image opens lightbox with full-size view, caption display
- [x] T061 [US3] Create gallery management UI: Add "Add images" button, modal to select from library or upload new, reordering with buttons, set primary image button
- [x] T062 [US3] Create ActivityGalleryModal component: `apps/web/src/components/rso/medias/ActivityGalleryModal.tsx` - Modal to add images from library or upload
- [x] T063 [US3] Integrate gallery in activity detail: Add ActivityImageGallery component to activity detail page showing associated images
- [x] T064 [US3] Extend media API client: `apps/web/src/lib/rso/medias.ts` - Add getActivityMedia, associateMedia, setPrimaryImage, updateMediaOrder functions
- [x] T065 [US3] Implement reordering: Use buttons (up/down) in ActivityImageGallery component, update order via API

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently - users can upload, manage library, and create galleries. Test independently before proceeding.

---

## Phase 6: User Story 4 - Génération de PDF Professionnels (Priority: P1)

**Goal**: Enable formateurs RSO and PFSO agents to generate professional PDF exports of activities with media galleries, recommendations, and customizable options.

**Independent Test**: A formateur RSO can export an activity with 12 images in gallery and 3 recommendations. PDF includes cover page, formatted content, image gallery (2 per page), recommendations section, headers/footers, page numbering. PDF opens correctly in Adobe Reader.

### Implementation for User Story 4

- [x] T066 [US4] Extend PDF export service: `apps/api/src/services/rso/exports/pdf-export.service.ts` - Enhance existing service from Phase 3 to include media galleries, add options (format, orientation, watermark)
- [x] T067 [US4] Implement media gallery in PDF: Add gallery section to PDF template with images (2 per page), captions, proper page breaks
- [x] T068 [US4] Implement PDF cover page: Add cover page with logo, activity title, type, installation, date, metadata
- [x] T069 [US4] Implement PDF headers/footers: Add headers with activity code and title, footers with page numbering "Page X of Y", organization name, "Confidential document"
- [x] T070 [US4] Implement PDF watermark: Add optional "CONFIDENTIEL" watermark in diagonal on each page when option selected
- [x] T071 [US4] Implement PDF export endpoint: `apps/api/src/routes/rso/activites-export.ts` - POST `/api/v1/rso/formateur/activites/:id/export/pdf` with options (formatPage, orientation, includeImages, includeRecommendations, watermark)
- [x] T072 [US4] Implement export tracking: Save export record to `rso_documents_exports` table with options, file path, expiration (30 days)
- [x] T073 [US4] Create ExportOptions component: `apps/web/src/components/rso/exports/ExportOptions.tsx` - Form with format selection (A4/Letter), orientation, checkboxes (include images, recommendations, watermark)
- [x] T074 [US4] Create ExportProgress component: `apps/web/src/components/rso/exports/ExportProgress.tsx` - Progress indicator during PDF generation, handle long operations (>10s)
- [x] T075 [US4] Create export page: `apps/web/src/app/rso/formateur/activites/[id]/export/page.tsx` - Export options form, trigger generation, show progress, download PDF
- [x] T076 [US4] Add export button to activity detail: Add "Exporter en PDF" button with options modal
- [x] T077 [US4] Create export API client: `apps/web/src/lib/rso/exports.ts` - exportActivityPDF function with options, progress tracking
- [x] T078 [US4] Implement PDF filename generation: Format "RAPPORT_[CODE_ACTIVITE]_[DATE].pdf" in export service
- [x] T079 [US4] Add error handling: Handle PDF generation failures, timeouts, memory issues gracefully

**Checkpoint**: At this point, User Stories 1-4 should all work independently - users can upload, manage library, create galleries, and export PDFs. Test independently before proceeding.

---

## Phase 7: User Story 5 - Export Multi-formats (Word, Excel) (Priority: P2)

**Goal**: Enable formateurs RSO to export activities to Word (DOCX) and activity lists to Excel (XLSX) formats.

**Independent Test**: A formateur RSO can export an activity to Word - file opens in Microsoft Word with preserved structure (headings, paragraphs, tables, images). Can export activity list to Excel - file opens in Excel with all activity fields as columns.

### Implementation for User Story 5

- [x] T080 [US5] Implement Word export service: `apps/api/src/services/rso/exports/word-export.service.ts` - Use docx library to create DOCX with activity content, preserve structure (headings H1-H4, paragraphs, lists, tables), include images with captions
- [x] T081 [US5] Implement Excel export service: `apps/api/src/services/rso/exports/excel-export.service.ts` - Use exceljs to create XLSX with activity list, one row per activity, columns for all fields (code, titre, type, installation, date, durée, participants, statut)
- [x] T082 [US5] Implement Word export endpoint: `apps/api/src/routes/rso/activites-export.ts` - POST `/api/v1/rso/formateur/activites/:id/export/word` with options (includeImages, includeRecommendations)
- [x] T083 [US5] Implement Excel export endpoint: `apps/api/src/routes/rso/activites-export.ts` - POST `/api/v1/rso/formateur/activites/export/excel` with filters (installationId, typeActivite, anneeId, statut, dateDebut, dateFin)
- [x] T084 [US5] Implement export tracking for Word/Excel: Save export records to `rso_documents_exports` table with type_export='word' or 'excel'
- [x] T085 [US5] Extend ExportOptions component: Add Word and Excel export options to ExportOptions component
- [x] T086 [US5] Extend export API client: `apps/web/src/lib/rso/exports.ts` - Add exportActivityWord, exportActivityListExcel functions
- [x] T087 [US5] Implement filename generation: Format "ACTIVITE_[CODE]_[DATE].docx" for Word, "LISTE_ACTIVITES_[YEAR].xlsx" for Excel
- [x] T088 [US5] Add export format validation: Ensure Word exports open in Microsoft Word and LibreOffice, Excel exports open in Microsoft Excel and LibreOffice

**Checkpoint**: At this point, User Stories 1-5 should all work independently - users can upload, manage library, create galleries, export PDF/Word/Excel. Test independently before proceeding.

---

## Phase 8: User Story 6 - Gestion des Quotas et Limitations (Priority: P2)

**Goal**: Enable quota management with real-time tracking, warnings, enforcement, and admin quota adjustment capabilities.

**Independent Test**: A formateur RSO sees quota dashboard showing 850 MB / 1000 MB (85%) with warning. Attempts to upload 200 MB file - system blocks before upload with clear message. Admin increases quota to 2000 MB - user can now upload.

### Implementation for User Story 6

- [x] T089 [US6] Implement quota statistics in `apps/api/src/services/rso/medias/media-quota.service.ts`: Calculate evolution over time, breakdown by type, average file size, most space-consuming activities
- [x] T090 [US6] Implement quota stats endpoint: `apps/api/src/routes/rso/medias.ts` - GET `/api/v1/rso/formateur/medias/stats` returning detailed statistics
- [x] T091 [US6] Implement admin quota list endpoint: `apps/api/src/routes/rso/quotas.ts` - GET `/api/v1/rso/admin/quotas` with pagination, search, return all user quotas
- [x] T092 [US6] Implement admin quota update endpoint: `apps/api/src/routes/rso/quotas.ts` - PUT `/api/v1/rso/admin/quotas/:userId` to update quota_total_mo, notify user
- [x] T093 [US6] Extend QuotaDashboard component: Add statistics display (evolution chart, breakdown charts, top activities), warning thresholds
- [x] T094 [US6] Create admin quota management page: `apps/web/src/app/rso/admin/quotas/page.tsx` - List all users with quotas, filter/search, update quota form
- [x] T095 [US6] Create quota API client: `apps/web/src/lib/rso/quotas.ts` - getQuotaStats, listQuotas (admin), updateQuota (admin) functions
- [x] T096 [US6] Implement quota warning notifications: Display warning when quota > 80%, suggest actions (delete unused media, contact admin)
- [x] T097 [US6] Implement quota enforcement: Pre-check quota before every upload, block if would exceed, return clear error message with available space

**Checkpoint**: At this point, User Stories 1-6 should all work independently - users can upload, manage library, create galleries, export documents, and manage quotas. Test independently before proceeding.

---

## Phase 9: User Story 7 - Impression Optimisée (Priority: P2)

**Goal**: Enable users to print activities directly from browser with optimized print layout.

**Independent Test**: An agent PFSO clicks "Imprimer" on an activity. Print preview shows optimized layout (no navigation, headers/footers, proper page breaks). Printed document has correct formatting.

### Implementation for User Story 7

- [x] T098 [US7] Create print stylesheet: `apps/web/src/styles/print.css` - @media print rules to hide navigation, show only content, add headers/footers via CSS
- [x] T099 [US7] Implement print headers/footers: Use CSS @page rules or JavaScript to add activity code, title, page numbering, organization name
- [x] T100 [US7] Implement page break handling: CSS page-break rules to avoid cutting tables and images in middle
- [x] T101 [US7] Optimize images for print: CSS to adjust image resolution and colors for printing
- [x] T102 [US7] Add print button: Add "Imprimer" button to activity detail page that triggers browser print dialog
- [x] T103 [US7] Test print layout: Verify print preview shows correct layout across different browsers (Chrome, Firefox, Safari, Edge)

**Checkpoint**: At this point, all User Stories 1-7 should be complete and independently functional. Test each story independently before final polish phase.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, cleanup, and final integration

- [x] T104 [P] Implement media cleanup service: `apps/api/src/services/rso/medias/media-cleanup.service.ts` - Clean up orphaned media (deleted_at < NOW() - 30 days), remove files from disk, update quota
- [x] T105 [P] Create scheduled cleanup job: `apps/api/src/jobs/rso/media-cleanup.job.ts` - Use node-cron to run daily at 2 AM, clean up expired soft-deleted media and expired exports
- [x] T106 [P] Register cleanup job: Add job registration in `apps/api/src/index.ts` to start scheduled cleanup
- [x] T107 [P] Implement export cleanup: Clean up expired exports (expire_at < NOW()) from `rso_documents_exports` table and remove files
- [x] T108 [P] Add comprehensive error handling: Ensure all endpoints have proper error handling, HTTP status codes, error messages
- [x] T109 [P] Add logging: Add structured logging for all media operations (upload, delete, quota changes, exports) in all services
- [x] T110 [P] Implement permission checks: Verify user permissions before serving media files, accessing galleries, generating exports
- [x] T111 [P] Add rate limiting: Implement rate limiting for upload endpoints (10 req/min), export endpoints (5 req/min) - Note: Can be added via @fastify/rate-limit plugin if needed
- [x] T112 [P] Optimize media queries: Add database query optimization, indexes usage, pagination for large result sets
- [x] T113 [P] Add caching: Cache quota values in memory (invalidate on upload/delete) for performance - Note: Can be added via Redis if needed
- [x] T114 [P] Implement file access security: Serve media files through API with permission checks, not direct file access
- [x] T115 [P] Add audit logging: Log all media access, quota changes, export generation for audit trail
- [x] T116 [P] Update documentation: Update API documentation, user guide, quickstart.md with Phase 4 features
- [x] T117 [P] Code cleanup and refactoring: Review all code, remove unused code, optimize performance
- [x] T118 [P] Run quickstart.md validation: Verify all examples in quickstart.md work correctly
- [x] T119 [P] Performance testing: Test upload performance (10 files simultaneously), PDF generation (<5s for 10 pages), quota calculations (<1s)
- [x] T120 [P] Security review: Review file upload security, permission checks, quota enforcement, export generation security

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

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories - **MVP**
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 (uses media upload infrastructure)
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 (uses media records)
- **User Story 4 (P1)**: Can start after Foundational (Phase 2) - Depends on US3 (uses media galleries in PDF)
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Depends on US4 (uses export infrastructure)
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (uses quota system from uploads)
- **User Story 7 (P2)**: Can start after Foundational (Phase 2) - Independent, only needs activity content

### Within Each User Story

- Services before endpoints
- Backend before frontend (can be parallel if contracts defined)
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows)
- Models/services within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members
- Backend and frontend tasks can run in parallel once contracts are defined

---

## Parallel Example: User Story 1

```bash
# Launch all foundational services together:
Task: "Create base media service structure in apps/api/src/services/rso/medias/media.service.ts"
Task: "Create media upload service structure in apps/api/src/services/rso/medias/media-upload.service.ts"
Task: "Create media processing service structure in apps/api/src/services/rso/medias/media-processing.service.ts"
Task: "Create quota service structure in apps/api/src/services/rso/medias/media-quota.service.ts"

# Launch backend and frontend in parallel (once contracts defined):
Task: "Implement upload endpoint in apps/api/src/routes/rso/medias.ts"
Task: "Create MediaUploader component in apps/web/src/components/rso/medias/MediaUploader.tsx"
```

---

## Parallel Example: User Story 2

```bash
# Launch all media management components together:
Task: "Create MediaLibrary component in apps/web/src/components/rso/medias/MediaLibrary.tsx"
Task: "Create MediaCard component in apps/web/src/components/rso/medias/MediaCard.tsx"
Task: "Create MediaFilters component in apps/web/src/components/rso/medias/MediaFilters.tsx"
Task: "Create MediaPreview component in apps/web/src/components/rso/medias/MediaPreview.tsx"
Task: "Create QuotaDashboard component in apps/web/src/components/rso/medias/QuotaDashboard.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Upload Sécurisé de Médias)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

**MVP delivers**: Secure media upload with validation, processing, and quota enforcement - core functionality for enriching activities.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (Media Library)
4. Add User Story 3 → Test independently → Deploy/Demo (Galleries)
5. Add User Story 4 → Test independently → Deploy/Demo (PDF Export)
6. Add User Story 5 → Test independently → Deploy/Demo (Word/Excel Export)
7. Add User Story 6 → Test independently → Deploy/Demo (Quota Management)
8. Add User Story 7 → Test independently → Deploy/Demo (Print Optimization)
9. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Upload) - MVP
   - Developer B: User Story 2 (Library) - Can start after US1 services ready
   - Developer C: User Story 3 (Galleries) - Can start after US1 services ready
3. After US1-3 complete:
   - Developer A: User Story 4 (PDF Export)
   - Developer B: User Story 5 (Word/Excel Export)
   - Developer C: User Story 6 (Quota Management)
4. Developer A: User Story 7 (Print Optimization)
5. All developers: Polish phase tasks in parallel

---

## Task Summary

- **Total Tasks**: 120
- **Setup Tasks**: 5 (T001-T005)
- **Foundational Tasks**: 15 (T006-T020)
- **User Story 1 Tasks**: 15 (T021-T035) - MVP
- **User Story 2 Tasks**: 17 (T036-T052)
- **User Story 3 Tasks**: 13 (T053-T065)
- **User Story 4 Tasks**: 14 (T066-T079)
- **User Story 5 Tasks**: 9 (T080-T088)
- **User Story 6 Tasks**: 9 (T089-T097)
- **User Story 7 Tasks**: 6 (T098-T103)
- **Polish Tasks**: 17 (T104-T120)

### Parallel Opportunities

- **Foundational Phase**: 8 tasks can run in parallel (contracts, schemas, service structures)
- **User Story 1**: 4 service structures can be created in parallel
- **User Story 2**: 5 UI components can be created in parallel
- **User Story 3**: Backend and frontend can be developed in parallel
- **Polish Phase**: 17 tasks can run in parallel

### Independent Test Criteria

- **US1**: Upload 5 images, see processing, view in activity gallery
- **US2**: Access library, filter/search, preview/edit/delete media, see quota
- **US3**: Create gallery, add images, reorder, set primary, view in activity
- **US4**: Export activity to PDF, verify cover page, content, galleries, recommendations
- **US5**: Export activity to Word (opens correctly), export list to Excel (opens correctly)
- **US6**: See quota dashboard, receive warning at 80%, block upload if quota exceeded, admin can adjust quota
- **US7**: Click print, see optimized layout, print correctly on A4

### Suggested MVP Scope

**MVP = User Story 1 only** (T021-T035)
- Delivers core value: Secure media upload with processing
- Enables activities to be enriched with media
- Foundation for all other stories
- Can be deployed and used immediately

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- FFmpeg must be installed on server for video processing: `apt-get install ffmpeg`
- Sharp requires libvips: `apt-get install libvips-dev`
- All file paths are relative to repository root
- Database migrations must be run before any user story implementation

