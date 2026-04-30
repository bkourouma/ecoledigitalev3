# Tasks: Phase 6 - Gestion Administrative & Documents

**Input**: Design documents from `/specs/020-phase/`  
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT included as they were not explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create contracts directory structure in `packages/contracts/src/documents/`, `packages/contracts/src/entreprises/`, `packages/contracts/src/exports/`, `packages/contracts/src/reporting/`
- [X] T002 [P] Copy contract schemas from `specs/020-phase/contracts/` to `packages/contracts/src/` (document, entreprise, export, reporting)
- [X] T003 [P] Update `packages/contracts/src/index.ts` to export all new contracts (documents, entreprises, exports, reporting)
- [X] T004 [P] Create API routes directory structure in `apps/api/src/routes/` for documents.ts, entreprises.ts, exports.ts, reporting.ts
- [X] T005 [P] Create services directory structure in `apps/api/src/services/` for document-generation.service.ts, entreprise-cliente.service.ts, export.service.ts, reporting.service.ts
- [X] T006 [P] Create frontend pages directory structure in `apps/web/src/app/formations-professionnelles/admin/` (documents/, entreprises/, exports/, reporting/)
- [X] T007 [P] Create frontend components directory structure in `apps/web/src/components/admin/` (documents/, entreprises/, exports/, reporting/)
- [X] T008 [P] Create frontend hooks file in `apps/web/src/lib/hooks/` for use-documents.ts, use-entreprises.ts, use-exports.ts, use-reporting.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T009 Create database migration file `infra/scripts/migrations/0041_documents_export_jobs.sql` with document_type ENUM, documents table, export_type/job_status ENUMs, export_jobs table, all constraints, indexes, and RLS policies
- [X] T010 [P] Verify PDFKit library is available in `apps/api/package.json` (should already exist from invoice.service.ts)
- [X] T011 [P] Verify ExcelJS library is available in `apps/api/package.json` (should already exist from session-pro.service.ts)
- [X] T012 [P] Verify FileStorageService exists and supports tenant-isolated file storage in `apps/api/src/services/fileStorage.ts`
- [X] T013 Create base API route structure in `apps/api/src/routes/documents.ts` with Fastify route registration and tenant context extraction
- [X] T014 [P] Create base API route structure in `apps/api/src/routes/entreprises.ts` with Fastify route registration and tenant context extraction
- [X] T015 [P] Create base API route structure in `apps/api/src/routes/exports.ts` with Fastify route registration and tenant context extraction
- [X] T016 [P] Create base API route structure in `apps/api/src/routes/reporting.ts` with Fastify route registration and tenant context extraction
- [X] T017 Create DocumentGenerationService class skeleton in `apps/api/src/services/document-generation.service.ts` with tenant isolation and constructor accepting database pool
- [X] T018 [P] Create EntrepriseClienteService class skeleton in `apps/api/src/services/entreprise-cliente.service.ts` with tenant isolation
- [X] T019 [P] Create ExportService class skeleton in `apps/api/src/services/export.service.ts` with tenant isolation
- [X] T020 [P] Create ReportingService class skeleton in `apps/api/src/services/reporting.service.ts` with tenant isolation
- [X] T021 Register all new routes in `apps/api/src/index.ts` with prefix `/api/v1/admin/documents`, `/api/v1/admin/entreprises`, `/api/v1/admin/exports`, `/api/v1/admin/reporting`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Génération de Documents Administratifs (Priority: P1) 🎯 MVP

**Goal**: Enable administrators to generate all administrative documents (conventions, attestations, quotes) automatically with unique numbering, PDF generation, batch processing, and document management.

**Independent Test**: Access the admin documents interface, generate a convention for an existing enrollment, download the PDF, then generate batch attestations for a completed session. Verify each document has a unique number and contains all required information.

### Implementation for User Story 1

- [X] T022 [US1] Implement generateNumeroDocument method in `apps/api/src/services/document-generation.service.ts` generating format PREFIX-YYYY-NNNN (CONV, ATTP, ATTR, DEV) with sequential numbering per type/year and uniqueness check
- [X] T023 [US1] Implement genererConvention method in `apps/api/src/services/document-generation.service.ts` fetching enrollment with session/formation/apprenant/entreprise/paiements, checking for existing document, generating number, creating PDF, saving to FileStorageService, and storing metadata in documents table
- [X] T024 [US1] Implement createConventionPDF method in `apps/api/src/services/document-generation.service.ts` using PDFKit to generate professional convention PDF with Imhotep Data branding, all required sections (parties, objet, caractéristiques, coût, modalités paiement, obligations, signatures), and French locale formatting
- [X] T025 [US1] Implement genererAttestationPresence method in `apps/api/src/services/document-generation.service.ts` validating session is completed, checking participant presence, generating number, creating PDF, and storing metadata
- [X] T026 [US1] Implement createAttestationPresencePDF method in `apps/api/src/services/document-generation.service.ts` using PDFKit to generate professional attendance certificate with participant name, formation details, dates, duration, trainers, and signature section
- [X] T027 [US1] Implement genererAttestationReussite method in `apps/api/src/services/document-generation.service.ts` validating session completed and participant present, accepting optional note parameter, generating number, creating PDF with success mention, and storing metadata
- [X] T028 [US1] Implement createAttestationReussitePDF method in `apps/api/src/services/document-generation.service.ts` similar to presence attestation but with "RÉUSSITE" title and optional note display
- [X] T029 [US1] Implement genererDevis method in `apps/api/src/services/document-generation.service.ts` fetching session with formation, generating number, creating PDF with client info and validity date (default 30 days), and storing metadata with client data
- [X] T030 [US1] Implement createDevisPDF method in `apps/api/src/services/document-generation.service.ts` using PDFKit to generate professional quote PDF with session details, pricing HT/TTC, payment conditions, validity date, and enrollment modalities
- [X] T031 [US1] Implement generateBatchAttestations method in `apps/api/src/services/document-generation.service.ts` fetching completed session with present participants, generating documents for each participant, handling errors per document, and returning summary with success/failure counts
- [X] T032 [US1] Implement getDocumentsList method in `apps/api/src/services/document-generation.service.ts` with filtering (type, session_id, inscription_id, date range, search), pagination, and includes (apprenant name, session code) for display
- [X] T033 [US1] Implement resendDocument method in `apps/api/src/services/document-generation.service.ts` sending document via email using existing email service
- [X] T034 [US1] Implement deleteDocument method in `apps/api/src/services/document-generation.service.ts` with validation (check if referenced), deleting file from FileStorageService, and removing database record
- [X] T035 [US1] Implement POST /api/v1/admin/documents/convention/generer endpoint in `apps/api/src/routes/documents.ts` with admin authentication, RBAC check, request validation using GenerateConventionRequestSchema, calling service method, and returning DocumentResponse
- [X] T036 [US1] Implement POST /api/v1/admin/documents/attestation-presence/generer endpoint in `apps/api/src/routes/documents.ts` with validation and service call
- [X] T037 [US1] Implement POST /api/v1/admin/documents/attestation-reussite/generer endpoint in `apps/api/src/routes/documents.ts` with validation and service call
- [X] T038 [US1] Implement POST /api/v1/admin/documents/devis/generer endpoint in `apps/api/src/routes/documents.ts` with validation and service call
- [X] T039 [US1] Implement POST /api/v1/admin/documents/batch-generate endpoint in `apps/api/src/routes/documents.ts` with validation, async job creation, and returning job_id for polling
- [X] T040 [US1] Implement GET /api/v1/admin/documents endpoint in `apps/api/src/routes/documents.ts` with query parameter validation using DocumentListQuerySchema, filtering, pagination, and returning DocumentListResponse
- [X] T041 [US1] Implement GET /api/v1/admin/documents/:id endpoint in `apps/api/src/routes/documents.ts` for downloading document PDF with tenant and permission verification
- [X] T042 [US1] Implement POST /api/v1/admin/documents/:id/resend endpoint in `apps/api/src/routes/documents.ts` with email validation and service call
- [X] T043 [US1] Implement DELETE /api/v1/admin/documents/:id endpoint in `apps/api/src/routes/documents.ts` with permission check and service call
- [X] T044 [US1] Create AdminDocuments component in `apps/web/src/components/admin/documents/AdminDocuments.tsx` with tabs for document types, filters, search, and document list table
- [X] T045 [US1] Create DocumentGenerationModal component in `apps/web/src/components/admin/documents/DocumentGenerationModal.tsx` with document type selection, enrollment/session selection, and generation form
- [X] T046 [US1] Create BatchGenerationModal component in `apps/web/src/components/admin/documents/BatchGenerationModal.tsx` with session selection, type selection (presence/reussite), progress display, and results list
- [X] T047 [US1] Create DocumentsTable component in `apps/web/src/components/admin/documents/DocumentsTable.tsx` displaying document list with columns (type, number, date, participant, session, actions), filters, pagination, and action buttons (download, resend, delete)
- [X] T048 [US1] Create useDocuments hook in `apps/web/src/lib/hooks/use-documents.ts` using TanStack Query for document list fetching, generation mutations, batch generation with polling, and document actions (resend, delete)
- [X] T049 [US1] Create admin documents page in `apps/web/src/app/formations-professionnelles/admin/documents/page.tsx` integrating AdminDocuments component with header, tabs, and document management interface
- [X] T050 [US1] Create document type-specific pages in `apps/web/src/app/formations-professionnelles/admin/documents/conventions/page.tsx`, `attestations/page.tsx`, `devis/page.tsx` with filtered views
- [X] T051 [US1] Integrate automatic convention generation in payment confirmation webhook handler (Phase 4) by calling DocumentGenerationService.genererConvention after payment validation

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Administrators can generate all document types, manage documents, and view document lists.

---

## Phase 4: User Story 2 - Gestion des Entreprises Clientes B2B (Priority: P1)

**Goal**: Enable administrators to manage B2B enterprise clients with CRUD operations, statistics display, and grouped invoice generation for multiple enrollments.

**Independent Test**: Create a new enterprise with SIRET validation, view enterprise list with filters and sorting, access enterprise details with statistics, and generate a grouped invoice for multiple enrollments from the same enterprise.

### Implementation for User Story 2

- [X] T052 [US2] Implement getEntreprises method in `apps/api/src/services/entreprise-cliente.service.ts` with filtering (search, secteur, actif), sorting (nb_inscriptions, ca_total, raison_sociale), pagination, and statistics calculation (nb_inscriptions, ca_total) per enterprise
- [X] T053 [US2] Implement getEntrepriseDetails method in `apps/api/src/services/entreprise-cliente.service.ts` fetching enterprise with all enrollments, calculating statistics (nb_inscriptions, nb_apprenants, ca_total, formations_suivies), and returning enriched data
- [X] T054 [US2] Implement createEntreprise method in `apps/api/src/services/entreprise-cliente.service.ts` with SIRET format validation (14 digits), uniqueness check per tenant, and database insertion with transaction
- [X] T055 [US2] Implement updateEntreprise method in `apps/api/src/services/entreprise-cliente.service.ts` with SIRET validation if changed, uniqueness check, and partial update support
- [X] T056 [US2] Implement deleteEntreprise method in `apps/api/src/services/entreprise-cliente.service.ts` with validation (check for active enrollments), soft delete by setting actif=false, and returning error if enrollments exist
- [X] T057 [US2] Implement generateFacturationGroupee method in `apps/api/src/services/entreprise-cliente.service.ts` fetching selected enrollments, validating they belong to enterprise, generating grouped invoice PDF, and storing document with type 'facture_groupee'
- [X] T058 [US2] Implement createFactureGroupeePDF method in `apps/api/src/services/document-generation.service.ts` using PDFKit to generate invoice PDF with multiple enrollment lines, subtotals, totals HT/TTC, and payment terms
- [X] T059 [US2] Implement exportEntreprisesToExcel method in `apps/api/src/services/entreprise-cliente.service.ts` using ExcelJS to generate Excel file with enterprise data and statistics
- [X] T060 [US2] Implement GET /api/v1/admin/entreprises endpoint in `apps/api/src/routes/entreprises.ts` with query validation using EntrepriseListQuerySchema, filtering, sorting, pagination, and returning EntrepriseListResponse
- [X] T061 [US2] Implement GET /api/v1/admin/entreprises/:id endpoint in `apps/api/src/routes/entreprises.ts` returning EntrepriseDetailResponse with statistics
- [X] T062 [US2] Implement POST /api/v1/admin/entreprises endpoint in `apps/api/src/routes/entreprises.ts` with admin authentication, request validation using CreateEntrepriseRequestSchema, SIRET validation, and service call
- [X] T063 [US2] Implement PUT /api/v1/admin/entreprises/:id endpoint in `apps/api/src/routes/entreprises.ts` with validation and service call
- [X] T064 [US2] Implement DELETE /api/v1/admin/entreprises/:id endpoint in `apps/api/src/routes/entreprises.ts` with validation and service call
- [X] T065 [US2] Implement POST /api/v1/admin/entreprises/:id/facturation-groupee endpoint in `apps/api/src/routes/entreprises.ts` with validation using GenerateFacturationGroupeeRequestSchema and service call
- [X] T066 [US2] Implement GET /api/v1/admin/entreprises/export endpoint in `apps/api/src/routes/entreprises.ts` generating Excel file and returning as download
- [X] T067 [US2] Create AdminEntreprises component in `apps/web/src/components/admin/entreprises/AdminEntreprises.tsx` with header (create button, export button), filters, sorting controls, and enterprise grid/list
- [X] T068 [US2] Create EntrepriseCard component in `apps/web/src/components/admin/entreprises/EntrepriseCard.tsx` displaying enterprise info (raison sociale, SIRET, contact), statistics (inscriptions, CA), and action buttons
- [X] T069 [US2] Create EntrepriseFormModal component in `apps/web/src/components/admin/entreprises/EntrepriseFormModal.tsx` with form fields (all enterprise fields), SIRET validation with real-time feedback, and create/update modes
- [X] T070 [US2] Create EntrepriseDetailPage component in `apps/web/src/components/admin/entreprises/EntrepriseDetailPage.tsx` with tabs (Informations, Inscriptions, Factures), enterprise details, statistics display, and enrollment history
- [X] T071 [US2] Create FacturationGroupeeModal component in `apps/web/src/components/admin/entreprises/FacturationGroupeeModal.tsx` with enrollment selection (checkboxes), total calculation, due date selection, and generation button
- [X] T072 [US2] Create useEntreprises hook in `apps/web/src/lib/hooks/use-entreprises.ts` using TanStack Query for enterprise list, detail fetching, CRUD mutations, grouped invoice generation, and export
- [X] T073 [US2] Create admin enterprises list page in `apps/web/src/app/formations-professionnelles/admin/entreprises/page.tsx` integrating AdminEntreprises component
- [X] T074 [US2] Create admin enterprise detail page in `apps/web/src/app/formations-professionnelles/admin/entreprises/[id]/details/page.tsx` integrating EntrepriseDetailPage component
- [X] T075 [US2] Create admin enterprise create page in `apps/web/src/app/formations-professionnelles/admin/entreprises/ajouter/page.tsx` with form
- [X] T076 [US2] Create admin enterprise edit page in `apps/web/src/app/formations-professionnelles/admin/entreprises/[id]/modifier/page.tsx` with pre-filled form

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Administrators can manage documents and enterprises with full CRUD operations.

---

## Phase 5: User Story 3 - Exports de Données Personnalisables (Priority: P2)

**Goal**: Enable administrators to export data (enrollments, payments, attendance) in Excel/CSV formats with customizable filters, column selection, and grouping options.

**Independent Test**: Configure an enrollment export with date filters and column selection, generate Excel file, then export payments with grouping by payment method. Verify files are correctly formatted and contain expected data.

### Implementation for User Story 3

- [X] T077 [US3] Implement exportInscriptions method in `apps/api/src/services/export.service.ts` with filters (date range, formation, session, statut), column selection, format choice (Excel/CSV), using ExcelJS for Excel or CSV generation, and returning file buffer
- [X] T078 [US3] Implement exportPaiements method in `apps/api/src/services/export.service.ts` with filters, optional grouping (methode, jour, formation), Excel generation with multiple sheets (detailed + grouped), and returning file buffer
- [X] T079 [US3] Implement exportPresences method in `apps/api/src/services/export.service.ts` fetching session with attendance records, generating Excel with participant list, presence status, and statistics (present/absent counts, rate)
- [X] T080 [US3] Implement exportCAFormation method in `apps/api/src/services/export.service.ts` calculating revenue by formation for year, generating Excel with data table and charts (pie, bar), and returning file buffer
- [X] T081 [US3] Implement exportPersonnalise method in `apps/api/src/services/export.service.ts` with query builder support (tables, columns, filters, groupings), dynamic SQL generation with tenant isolation, and file generation
- [X] T082 [US3] Implement createExportJob method in `apps/api/src/services/export.service.ts` creating job record in export_jobs table with status 'pending' and config JSONB
- [X] T083 [US3] Implement processExportJob method in `apps/api/src/services/export.service.ts` updating status to 'processing', calling appropriate export method, updating progress, saving file to FileStorageService, and updating job with file URL and 'completed' status
- [X] T084 [US3] Implement getExportJobStatus method in `apps/api/src/services/export.service.ts` fetching job by ID with tenant verification and returning status, progress, file URL
- [X] T085 [US3] Implement POST /api/v1/admin/exports/inscriptions endpoint in `apps/api/src/routes/exports.ts` with validation using ExportInscriptionsRequestSchema, creating export job for large datasets (>1000 records) or synchronous for small datasets, and returning job_id or file directly
- [X] T086 [US3] Implement POST /api/v1/admin/exports/paiements endpoint in `apps/api/src/routes/exports.ts` with validation and job creation/processing
- [X] T087 [US3] Implement POST /api/v1/admin/exports/presences endpoint in `apps/api/src/routes/exports.ts` with validation and service call
- [X] T088 [US3] Implement POST /api/v1/admin/exports/ca-formation endpoint in `apps/api/src/routes/exports.ts` with validation and service call
- [X] T089 [US3] Implement POST /api/v1/admin/exports/personnalise endpoint in `apps/api/src/routes/exports.ts` with validation and service call
- [X] T090 [US3] Implement GET /api/v1/admin/exports/jobs/:id endpoint in `apps/api/src/routes/exports.ts` returning ExportJobResponse with status and progress
- [X] T091 [US3] Implement GET /api/v1/admin/exports/jobs/:id/download endpoint in `apps/api/src/routes/exports.ts` for downloading completed export file
- [X] T092 [US3] Create AdminExports component in `apps/web/src/components/admin/exports/AdminExports.tsx` with export type cards and navigation to specific export pages
- [X] T093 [US3] Create ExportInscriptionsCard component in `apps/web/src/components/admin/exports/ExportInscriptionsCard.tsx` with filters (date range, formation, session, statut), column selection (checkboxes), format selection, and export button
- [X] T094 [US3] Create ExportPaiementsCard component in `apps/web/src/components/admin/exports/ExportPaiementsCard.tsx` with filters, grouping option selection, format selection, and export button
- [X] T095 [US3] Create ExportPresencesCard component in `apps/web/src/components/admin/exports/ExportPresencesCard.tsx` with session selection and export button
- [X] T096 [US3] Create ExportCAFormationCard component in `apps/web/src/components/admin/exports/ExportCAFormationCard.tsx` with year selection, format selection, and export button
- [X] T097 [US3] Create ExportJobStatusModal component in `apps/web/src/components/admin/exports/ExportJobStatusModal.tsx` displaying job progress, polling status, and download link when completed
- [X] T098 [US3] Create useExports hook in `apps/web/src/lib/hooks/use-exports.ts` using TanStack Query for export job creation, status polling, and file download
- [X] T099 [US3] Create admin exports page in `apps/web/src/app/formations-professionnelles/admin/exports/page.tsx` integrating AdminExports component with export type cards
- [X] T100 [US3] Create specific export pages in `apps/web/src/app/formations-professionnelles/admin/exports/inscriptions/page.tsx`, `paiements/page.tsx`, `presences/page.tsx` with respective export cards

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should work independently. Administrators can generate documents, manage enterprises, and export data in various formats.

---

## Phase 6: User Story 4 - Dashboard et Reporting (Priority: P2)

**Goal**: Provide administrators with reporting dashboard showing key metrics, revenue forecasting, conversion rates, and detailed statistics for decision-making.

**Independent Test**: Access the reporting dashboard, view metrics for selected period with evolution percentages, check CA prévisionnel for a year, view conversion rates, and explore detailed statistics by type.

### Implementation for User Story 4

- [X] T101 [US4] Implement getDashboardMetrics method in `apps/api/src/services/reporting.service.ts` calculating inscriptions (total, evolution vs previous period), CA (total, evolution), sessions (total, average fill rate), top 5 formations, top 5 enterprises for selected period (jour, semaine, mois, annee)
- [X] T102 [US4] Implement getCAPrevisionnel method in `apps/api/src/services/reporting.service.ts` calculating CA réalisé (past sessions, paid enrollments), CA prévisionnel (future sessions, confirmed paid enrollments), CA potentiel (pending enrollments), with breakdown by month and by formation
- [X] T103 [US4] Implement getTauxConversion method in `apps/api/src/services/reporting.service.ts` calculating global conversion rate (enrollments → payments), rates by formation, rates by payment method, and monthly trends over 12 months
- [X] T104 [US4] Implement getStatistics method in `apps/api/src/services/reporting.service.ts` with type parameter (inscriptions, formations, formateurs, entreprises) and date range, returning aggregated data specific to type (status distribution, temporal evolution, fill rates, etc.)
- [X] T105 [US4] Implement GET /api/v1/admin/reporting/dashboard endpoint in `apps/api/src/routes/reporting.ts` with query validation using DashboardMetricsQuerySchema and returning DashboardMetricsResponse
- [X] T106 [US4] Implement GET /api/v1/admin/reporting/ca-previsionnel endpoint in `apps/api/src/routes/reporting.ts` with query validation using CAPrevisionnelQuerySchema and returning CAPrevisionnelResponse
- [X] T107 [US4] Implement GET /api/v1/admin/reporting/taux-conversion endpoint in `apps/api/src/routes/reporting.ts` returning TauxConversionResponse
- [X] T108 [US4] Implement GET /api/v1/admin/reporting/statistiques endpoint in `apps/api/src/routes/reporting.ts` with query validation using StatisticsQuerySchema and returning StatisticsResponse
- [X] T109 [US4] Create ReportingDashboard component in `apps/web/src/components/admin/reporting/ReportingDashboard.tsx` with period selector, metrics cards, charts area, and top lists
- [X] T110 [US4] Create MetricsCards component in `apps/web/src/components/admin/reporting/MetricsCards.tsx` displaying key metrics (inscriptions, CA, sessions) with evolution indicators and trend arrows
- [X] T111 [US4] Create CAPrevisionnel component in `apps/web/src/components/admin/reporting/CAPrevisionnel.tsx` with year/quarter selector, revenue breakdown display (realized, forecasted, potential), monthly chart, and formation table
- [X] T112 [US4] Create TauxConversion component in `apps/web/src/components/admin/reporting/TauxConversion.tsx` displaying global rate, breakdown by formation, by payment method, and monthly trend chart
- [X] T113 [US4] Create StatisticsView component in `apps/web/src/components/admin/reporting/StatisticsView.tsx` with type selector, date range picker, and dynamic statistics display based on selected type
- [X] T114 [US4] Create useReporting hook in `apps/web/src/lib/hooks/use-reporting.ts` using TanStack Query for dashboard metrics, CA prévisionnel, conversion rates, and statistics fetching
- [X] T115 [US4] Create admin reporting dashboard page in `apps/web/src/app/formations-professionnelles/admin/reporting/dashboard/page.tsx` integrating ReportingDashboard component
- [X] T116 [US4] Create admin CA prévisionnel page in `apps/web/src/app/formations-professionnelles/admin/reporting/ca-previsionnel/page.tsx` integrating CAPrevisionnel component
- [X] T117 [US4] Create admin statistics page in `apps/web/src/app/formations-professionnelles/admin/reporting/statistiques/page.tsx` integrating StatisticsView component

**Checkpoint**: At this point, all user stories should work independently. Administrators have full document management, enterprise management, export capabilities, and reporting dashboard.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Automation, error handling, and improvements affecting multiple user stories

- [X] T118 [P] Create cron job file `apps/api/src/jobs/document-automation.job.ts` for automatic attestation generation after session completion (runs daily at 2 AM, checks sessions completed yesterday, generates attestations for present participants)
- [X] T119 [P] Create cron job for quote expiration reminders in `apps/api/src/jobs/document-automation.job.ts` (runs daily at 9 AM, checks quotes expiring within 3 days, sends email reminders)
- [X] T120 [P] Integrate cron jobs into application startup in `apps/api/src/index.ts` using node-cron or similar library
- [X] T121 [P] Add comprehensive error handling in all document generation methods with proper logging, user-friendly error messages, and graceful degradation
- [X] T122 [P] Add error handling in export service for large dataset processing with timeout handling and job failure management
- [X] T123 [P] Add loading states and error boundaries in all frontend components (AdminDocuments, AdminEntreprises, AdminExports, ReportingDashboard)
- [X] T124 [P] Add breadcrumb navigation in all admin pages for better navigation
- [X] T125 [P] Add document storage cleanup job (remove temporary export files older than 7 days) in `apps/api/src/jobs/document-automation.job.ts`
- [X] T126 [P] Add validation for document generation edge cases (duplicate generation detection, session status validation, participant presence validation)
- [X] T127 [P] Add email notification templates for document generation completion and quote expiration reminders
- [X] T128 [P] Add performance optimization for document list queries with proper indexing and pagination
- [X] T129 [P] Add performance optimization for reporting metrics calculation with query optimization and optional caching
- [X] T130 [P] Run quickstart.md validation to ensure all examples work correctly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories (uses existing entreprises_clientes table)
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories (uses existing inscriptions, paiements tables)
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories (uses existing data for calculations)

### Within Each User Story

- Database schema/migration before services
- Services before endpoints
- Endpoints before frontend components
- Components before pages
- Core implementation before integration

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows)
- Services within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members
- Frontend and backend work for the same story can be parallelized

---

## Parallel Example: User Story 1

```bash
# Launch all service methods together (different methods, no dependencies):
Task: "Implement genererConvention method in document-generation.service.ts"
Task: "Implement genererAttestationPresence method in document-generation.service.ts"
Task: "Implement genererDevis method in document-generation.service.ts"

# Launch all PDF creation methods together:
Task: "Implement createConventionPDF method in document-generation.service.ts"
Task: "Implement createAttestationPresencePDF method in document-generation.service.ts"
Task: "Implement createDevisPDF method in document-generation.service.ts"

# Launch all frontend components together:
Task: "Create AdminDocuments component in AdminDocuments.tsx"
Task: "Create DocumentGenerationModal component in DocumentGenerationModal.tsx"
Task: "Create BatchGenerationModal component in BatchGenerationModal.tsx"
Task: "Create DocumentsTable component in DocumentsTable.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Document Generation)
4. Complete Phase 4: User Story 2 (Enterprise Management)
5. **STOP and VALIDATE**: Test User Stories 1 & 2 independently
6. Deploy/demo if ready

**MVP Value**: Administrators can generate all administrative documents and manage enterprise clients, delivering core administrative functionality.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (Document Generation MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (Enterprise Management)
4. Add User Story 3 → Test independently → Deploy/Demo (Data Exports)
5. Add User Story 4 → Test independently → Deploy/Demo (Reporting Dashboard)
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Document Generation)
   - Developer B: User Story 2 (Enterprise Management)
3. After User Stories 1 & 2 complete:
   - Developer A: User Story 3 (Exports)
   - Developer B: User Story 4 (Reporting)
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Database schema already exists for entreprises_clientes from Phase 1 - no schema changes needed
- Document numbering uniqueness enforced at application level with database constraint
- All queries must include tenant_id filtering via RLS
- Batch operations use async job pattern with progress tracking
- Large exports (>1000 records) use async jobs, small exports are synchronous

---

## Summary

- **Total Tasks**: 130 tasks
- **User Story 1 (P1)**: 30 tasks - Document generation and management
- **User Story 2 (P1)**: 25 tasks - Enterprise client management
- **User Story 3 (P2)**: 24 tasks - Data exports
- **User Story 4 (P2)**: 17 tasks - Reporting dashboard
- **Setup**: 8 tasks
- **Foundational**: 13 tasks
- **Polish**: 13 tasks

**Suggested MVP Scope**: User Stories 1 & 2 (Document generation and Enterprise management) - 55 tasks total after Setup and Foundational phases.

