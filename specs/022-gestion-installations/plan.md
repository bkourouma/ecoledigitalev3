# Implementation Plan: Phase 2 - Gestion des Installations RSO-PFSO

**Branch**: `022-phase` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-phase/spec.md`

## Summary

Implement comprehensive port facility installation management system for the RSO-PFSO module, building on Phase 1 infrastructure. This phase enables:

- **Complete CRUD operations** for port facility installations with 19 predefined installations
- **Year management system** (2004 to current year) with automatic increment on January 1st
- **Installation-User associations** linking Agent PFSO users to specific installations
- **Responsible person management** tracking PFSO Principals, Adjoints, and RSO Referents per installation
- **Search, filter, and export capabilities** for installation data
- **Statistics dashboard** with global and per-installation metrics
- **Role-based access control** extending Phase 1 permissions

**Primary Requirements**:
- 19 predefined installations must be pre-loaded during database migration
- Year selector component must be globally accessible and persist across navigation
- Installation codes must be unique and validated in real-time
- Soft delete (archiving) for installations with restoration capability
- Integration with Phase 1 user management for Agent PFSO assignment

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify 4.x, zod (validation), exceljs (Excel export), pdfkit or puppeteer (PDF export), node-cron (scheduled tasks)
- Frontend: Next.js 15, React 18, TanStack Query, Tailwind CSS, Radix UI, react-select or shadcn/ui Select
- Database: PostgreSQL 14+ with Row Level Security (RLS) for multi-tenant isolation
**Storage**: 
- PostgreSQL 14+ (rso_installations, rso_annees, rso_installation_responsables tables)
- Modification of existing rso_users table (add installation_id foreign key)
- Session storage for selected year (localStorage or sessionStorage)
**Testing**: 
- Playwright (E2E installation management flows, year selector persistence)
- Vitest/Jest (unit tests for installation validation, code generation, year management)
- Fastify test framework (backend API endpoint tests)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011) - same as main EcoleDigitale app
- Frontend: Next.js 15 (port 3000) - integrated into existing web app
- Database: PostgreSQL 14+ (shared database with tenant isolation)
**Project Type**: Web application (monorepo with frontend + backend)  
**Performance Goals**: 
- Installation list loading < 2 seconds (SC-001, SC-005)
- Installation creation < 30 seconds (SC-002)
- Code uniqueness validation < 500ms (SC-003)
- Search/filter operations < 1 second (SC-004)
- Excel export < 10 seconds, PDF export < 15 seconds (SC-006, SC-007)
- Year selector loading < 500ms (SC-008)
- Support 50-100 installations with smooth performance
**Constraints**: 
- Must integrate with existing Phase 1 RSO-PFSO infrastructure
- Must maintain tenant isolation (ASPCI tenant only)
- Must comply with ISPS code requirements (audit trails, activity logging)
- Installation codes must be unique across entire system
- Year management must be reliable (automatic increment on January 1st)
- Must prevent deletion of installations with assigned Agent PFSO users
**Scale/Scope**: 
- 3 new database tables (rso_installations, rso_annees, rso_installation_responsables)
- 1 table modification (rso_users.installation_id)
- 19 predefined installations to seed
- 20+ years (2004 to current) to pre-load
- 50+ functional requirements
- 6 user stories (P1-P2 priorities)
- New route prefix: `/rso/installations/*`, `/rso/annees/*`
- Global year selector component for all RSO pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Multi-Tenant Isolation
- ✅ **PASS**: Installations will be isolated within ASPCI tenant using existing RLS infrastructure
- ✅ **PASS**: New `rso_installations`, `rso_annees`, `rso_installation_responsables` tables with tenant_id foreign key
- ✅ **PASS**: All installation routes will validate tenant context (ASPCI only)
- ✅ **PASS**: Year management is global but tenant-scoped (each tenant has their own years)

### Security Requirements
- ✅ **PASS**: Input validation and sanitization (Zod schemas, XSS/SQL injection prevention)
- ✅ **PASS**: Comprehensive activity logging for all installation management actions (ISPS compliance)
- ✅ **PASS**: Role-based access control extending Phase 1 permissions
- ✅ **PASS**: Soft delete prevents accidental data loss

### Code Organization
- ✅ **PASS**: New routes follow existing monorepo structure (apps/api/src/routes/rso/installations)
- ✅ **PASS**: Separate routes under `/rso/installations/*` and `/rso/annees/*` prefixes
- ✅ **PASS**: Shared contracts package for TypeScript types
- ✅ **PASS**: Reuse existing validation, logging, and authentication patterns from Phase 1

### Data Integrity
- ✅ **PASS**: Foreign key constraints ensure referential integrity (installations → users, responsible assignments)
- ✅ **PASS**: Unique constraints on installation codes prevent duplicates
- ✅ **PASS**: Check constraints validate installation types, statuses, and year statuses
- ⚠️ **NOTE**: Scheduled task for year increment must be reliable (cron job or equivalent)

## Project Structure

### Documentation (this feature)

```
specs/022-phase/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── installations-api.md
│   └── installations.contracts.ts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
apps/
├── api/
│   └── src/
│       ├── routes/
│       │   └── rso/
│       │       ├── installations.ts        # NEW: Installation CRUD routes
│       │       ├── annees.ts               # NEW: Year management routes
│       │       └── installation-responsables.ts  # NEW: Responsible assignment routes
│       ├── services/
│       │   └── rso/
│       │       ├── installation.service.ts  # NEW: Installation business logic
│       │       ├── annee.service.ts      # NEW: Year management logic
│       │       └── installation-code-generator.ts  # NEW: Code generation utility
│       ├── jobs/
│       │   └── rso/
│       │       └── year-increment.job.ts  # NEW: Scheduled task for year increment
│       └── schemas/
│           └── rso/
│               ├── installation.schema.ts  # NEW: Installation validation schemas
│               └── annee.schema.ts        # NEW: Year validation schemas
├── web/
│   └── src/
│       ├── app/
│       │   └── rso/
│       │       ├── admin/
│       │       │   └── installations/      # NEW: Admin installation pages
│       │       │       ├── page.tsx        # List view
│       │       │       ├── [id]/
│       │       │       │   └── page.tsx    # Detail view
│       │       │       └── archives/
│       │       │           └── page.tsx    # Archived installations
│       │       ├── formateur/
│       │       │   └── installations/      # NEW: Formateur installation pages
│       │       │       └── page.tsx        # Formateur list view
│       │       └── annees/
│       │           └── page.tsx            # NEW: Year management page
│       ├── components/
│       │   └── rso/
│       │       ├── installations/           # NEW: Installation components
│       │       │   ├── InstallationList.tsx
│       │       │   ├── InstallationForm.tsx
│       │       │   ├── InstallationDetail.tsx
│       │       │   ├── InstallationFilters.tsx
│       │       │   └── InstallationStats.tsx
│       │       ├── annees/
│       │       │   └── YearSelector.tsx    # NEW: Global year selector
│       │       └── shared/
│       │           └── ExportButtons.tsx   # NEW: Export functionality
│       └── lib/
│           └── rso/
│               ├── installations.ts        # NEW: Installation API client
│               └── annees.ts               # NEW: Year API client
└── packages/
    └── contracts/
        └── src/
            └── rso/
                ├── installation.contracts.ts  # NEW: Installation types
                └── annee.contracts.ts        # NEW: Year types
└── infra/
    └── scripts/
        └── migrations/
            ├── 0022_rso_phase2_installations.sql  # NEW: Installations schema
            └── 0022_rso_phase2_seed.sql           # NEW: 19 predefined installations + years
```

**Structure Decision**: 
- **Monorepo integration**: Phase 2 extends existing RSO-PFSO module structure from Phase 1
- **Route organization**: Installation routes under `/rso/installations/*`, year routes under `/rso/annees/*`
- **Service layer**: Business logic separated into service files (installation.service.ts, annee.service.ts)
- **Scheduled tasks**: Year increment job in `apps/api/src/jobs/rso/` using node-cron
- **Shared components**: Year selector is a global component accessible from all RSO pages
- **Export functionality**: Reusable export components for Excel and PDF generation
- **Database migrations**: Separate migration files for schema creation and data seeding

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations identified. All design decisions align with existing architecture and constitution principles.
