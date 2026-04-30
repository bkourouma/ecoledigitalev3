# Implementation Plan: Phase 6 - Gestion Administrative & Documents

**Branch**: `020-phase` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-phase/spec.md`

## Summary

This feature implements a comprehensive administrative document management system for professional training, including automated PDF generation (conventions, attestations, quotes, invoices), B2B enterprise client management, customizable data exports, and reporting dashboards. The system automates document generation workflows, provides enterprise-level client management, and delivers actionable business intelligence through exports and reporting.

**Primary Requirement**: Automate all administrative document generation, manage B2B enterprise clients with grouped invoicing, provide flexible data exports, and deliver comprehensive reporting dashboards for business decision-making.

**Technical Approach**: PDF generation using existing Puppeteer/PDFKit infrastructure, Excel exports using ExcelJS, document storage via FileStorageService, RESTful API endpoints for document management, enterprise CRUD operations, export configuration, and reporting metrics calculation.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 18+  
**Primary Dependencies**: Fastify (backend), Next.js 15 (frontend), React, TanStack Query, PostgreSQL 14+, Puppeteer/PDFKit (PDF generation), ExcelJS (Excel exports)  
**Storage**: PostgreSQL with Row Level Security (RLS) for multi-tenant isolation, FileStorageService for PDF document storage  
**Testing**: Jest/Vitest for unit tests, Playwright for E2E tests, API contract tests  
**Target Platform**: Web application (Next.js frontend + Fastify backend), deployed on shared VPS  
**Project Type**: Web application (monorepo with apps/api and apps/web)  
**Performance Goals**: 
- Document generation completes in < 5 seconds for single documents
- Batch generation of 50 documents completes in < 2 minutes
- Document list page loads in < 2 seconds for 1,000 documents
- Excel exports of 5,000 records complete in < 30 seconds
- Reporting dashboard loads all metrics in < 3 seconds
- CA prévisionnel calculation completes in < 5 seconds for full year
**Constraints**: 
- Must maintain multi-tenant isolation (Imhotep Data tenant)
- Document numbering must be unique and sequential per type/year
- PDF generation must handle errors gracefully with proper logging
- Large exports must be asynchronous with progress indication
- Document storage must be organized by type (conventions/, attestations/, devis/, factures/)
**Scale/Scope**: 
- Support generation of 200+ documents per hour
- Handle enterprise clients with 100+ enrollments
- Export datasets of 10,000+ records
- Reporting dashboard supports multiple time periods and aggregations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)
- ✅ **PASS**: All database queries must include tenant_id filtering via RLS policies
- ✅ **PASS**: Document routes must verify tenant context from request
- ✅ **PASS**: Enterprise client operations must be tenant-scoped
- ✅ **PASS**: Document storage paths must include tenant_id
- **Action Required**: Verify RLS policies exist for new `documents` table (if created) or use existing FileStorageService with tenant isolation

### 2. Type Safety & Validation (MANDATORY)
- ✅ **PASS**: All API contracts must be defined in `packages/contracts/src/documents/` or `packages/contracts/src/admin/`
- ✅ **PASS**: Zod schemas required for all request/response validation
- ✅ **PASS**: TypeScript strict mode enforced
- **Action Required**: Create Zod schemas for document generation requests, enterprise CRUD, export configurations, and reporting queries

### 3. Security-First Design (NON-NEGOTIABLE)
- ✅ **PASS**: All document and enterprise endpoints require admin authentication and RBAC verification
- ✅ **PASS**: Document downloads must verify tenant and user permissions
- ✅ **PASS**: Export endpoints must validate filters and prevent data leakage
- ✅ **PASS**: SIRET validation must prevent duplicates per tenant
- **Action Required**: Implement RBAC checks in all admin document and enterprise routes

### 4. API-First Architecture (MANDATORY)
- ✅ **PASS**: Business logic lives in backend services (`apps/api/src/services/`)
- ✅ **PASS**: Frontend consumes REST APIs via TanStack Query
- ✅ **PASS**: API versioning: `/api/v1/admin/documents`, `/api/v1/admin/entreprises`, `/api/v1/admin/exports`, `/api/v1/admin/reporting`
- **Action Required**: Create service layer for document generation, enterprise management, export generation, and reporting calculations

### 5. Monorepo Standards (REQUIRED)
- ✅ **PASS**: Shared contracts in `packages/contracts/src/`
- ✅ **PASS**: Shared UI components in `packages/ui/` if reusable
- ✅ **PASS**: API routes in `apps/api/src/routes/`
- ✅ **PASS**: Frontend pages in `apps/web/src/app/formations-professionnelles/admin/`
- **Action Required**: Ensure contracts are exported from packages/contracts index

### 6. Production-Ready Code (MANDATORY)
- ✅ **PASS**: Error handling with proper HTTP status codes
- ✅ **PASS**: Database transactions for document generation and enterprise operations
- ✅ **PASS**: Logging for document generation, export operations, and errors
- ✅ **PASS**: Asynchronous processing for batch operations with progress tracking
- **Action Required**: Implement proper error handling, transaction management, and async job processing

**Overall Status**: ✅ **PASS** - All constitution principles satisfied with documented action items

## Project Structure

### Documentation (this feature)

```
specs/020-phase/
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
│       │   ├── documents.ts              # new: document generation and management endpoints
│       │   ├── entreprises.ts            # new: enterprise client CRUD endpoints
│       │   ├── exports.ts                # new: data export endpoints
│       │   └── reporting.ts             # new: reporting and metrics endpoints
│       ├── services/
│       │   ├── document-generation.service.ts    # new: PDF generation for all document types
│       │   ├── entreprise-cliente.service.ts     # new: enterprise client business logic
│       │   ├── export.service.ts                # new: Excel/CSV export generation
│       │   └── reporting.service.ts            # new: metrics calculation and aggregation
│       └── jobs/
│           └── document-automation.job.ts       # new: cron jobs for automatic document generation
│
└── web/
    └── src/
        ├── app/
        │   └── formations-professionnelles/
        │       └── admin/
        │           ├── documents/
        │           │   ├── page.tsx                    # document list and management
        │           │   ├── conventions/
        │           │   │   └── page.tsx               # conventions list
        │           │   ├── attestations/
        │           │   │   └── page.tsx               # attestations list
        │           │   └── devis/
        │           │       └── page.tsx                # quotes list
        │           ├── entreprises/
        │           │   ├── page.tsx                    # enterprise list
        │           │   ├── ajouter/
        │           │   │   └── page.tsx                # create enterprise form
        │           │   └── [id]/
        │           │       ├── details/
        │           │       │   └── page.tsx            # enterprise detail page
        │           │       └── modifier/
        │           │           └── page.tsx            # edit enterprise form
        │           ├── exports/
        │           │   ├── page.tsx                    # export tools page
        │           │   ├── inscriptions/
        │           │   │   └── page.tsx               # enrollment export
        │           │   ├── paiements/
        │           │   │   └── page.tsx                # payment export
        │           │   └── presences/
        │           │       └── page.tsx                # attendance export
        │           └── reporting/
        │               ├── dashboard/
        │               │   └── page.tsx                # main reporting dashboard
        │               ├── statistiques/
        │               │   └── page.tsx                # detailed statistics
        │               └── ca-previsionnel/
        │                   └── page.tsx                 # revenue forecasting
        │
        ├── components/
        │   └── admin/
        │       ├── documents/
        │       │   ├── AdminDocuments.tsx              # document management interface
        │       │   ├── DocumentGenerationModal.tsx     # generate document modal
        │       │   ├── BatchGenerationModal.tsx        # batch generation modal
        │       │   └── DocumentsTable.tsx              # document list table
        │       ├── entreprises/
        │       │   ├── AdminEntreprises.tsx            # enterprise list interface
        │       │   ├── EntrepriseCard.tsx              # enterprise card component
        │       │   ├── EntrepriseDetailPage.tsx         # enterprise detail view
        │       │   ├── EntrepriseFormModal.tsx          # create/edit enterprise form
        │       │   └── FacturationGroupeeModal.tsx    # grouped invoice generation
        │       ├── exports/
        │       │   ├── AdminExports.tsx                 # export tools interface
        │       │   ├── ExportInscriptionsCard.tsx      # enrollment export card
        │       │   ├── ExportPaiementsCard.tsx         # payment export card
        │       │   └── ExportPresencesCard.tsx         # attendance export card
        │       └── reporting/
        │           ├── ReportingDashboard.tsx          # main dashboard component
        │           ├── MetricsCards.tsx                  # key metrics display
        │           ├── CAPrevisionnel.tsx               # revenue forecasting view
        │           └── TauxConversion.tsx                # conversion rate analysis
        │
        └── lib/
            └── hooks/
                ├── use-documents.ts                     # document data hooks
                ├── use-entreprises.ts                  # enterprise data hooks
                ├── use-exports.ts                      # export generation hooks
                └── use-reporting.ts                    # reporting data hooks

packages/
└── contracts/
    └── src/
        ├── documents/                                   # new: document contracts
        │   ├── document.schema.ts                      # document generation schemas
        │   ├── document.types.ts                       # document type definitions
        │   └── index.ts
        ├── entreprises/                                 # new: enterprise contracts
        │   ├── entreprise.schema.ts                     # enterprise CRUD schemas
        │   ├── entreprise.types.ts                      # enterprise type definitions
        │   └── index.ts
        ├── exports/                                     # new: export contracts
        │   ├── export.schema.ts                        # export configuration schemas
        │   ├── export.types.ts                         # export type definitions
        │   └── index.ts
        └── reporting/                                   # new: reporting contracts
            ├── reporting.schema.ts                      # reporting query schemas
            ├── reporting.types.ts                      # reporting type definitions
            └── index.ts
```

**Structure Decision**: Monorepo structure with separate API routes for each feature area (documents, entreprises, exports, reporting), service layer for business logic, shared contracts in packages/contracts, and admin UI components organized by feature in apps/web.

## Complexity Tracking

*No violations identified - all complexity is justified by feature requirements*
