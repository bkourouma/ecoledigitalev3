# Implementation Plan: Imhotep Data Database Schema

**Branch**: `015-imhotep-data-schema` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-imhotep-data-schema/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Create a complete database schema for the Imhotep Data professional training module by adding new PostgreSQL tables for professional training programs, sessions, trainers, company clients, enrollments, promotional codes, payments, and training materials. The schema must maintain complete data isolation from existing Imhotep Academy academic tables while following established multi-tenant patterns with Row Level Security (RLS), UUID primary keys, and audit trails.

**Technical Approach**: Create a new SQL migration file following existing migration patterns, defining 9 new tables with proper relationships, constraints, indexes, and RLS policies. All tables will use the existing multi-tenant architecture with `tenant_id` foreign keys and follow the established naming conventions.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 18+)  
**Primary Dependencies**: PostgreSQL 14+, pg (Node.js driver), existing migration system  
**Storage**: PostgreSQL 14+ with Row Level Security (RLS), multi-tenant architecture  
**Testing**: Manual SQL validation, migration rollback testing, RLS policy verification  
**Target Platform**: PostgreSQL database server (shared VPS deployment)  
**Project Type**: Database schema migration (backend infrastructure)  
**Performance Goals**: Migration executes in under 30 seconds, queries perform within 2 seconds for catalogs up to 1000 programs  
**Constraints**: Must not modify existing tables, must maintain backward compatibility, zero downtime migration, RLS policies required for all tables  
**Scale/Scope**: Support 100+ professional training programs, 500+ sessions/year, 50+ concurrent enrollments, 10+ payment methods

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)

**Status**: ✅ COMPLIANT

**Verification**:
- All new tables include `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- RLS policies will be created for all new tables using tenant-based filtering
- Foreign key relationships maintain tenant isolation
- No cross-tenant data access possible

**Evidence**: Schema design includes `tenant_id` in all 9 new tables, RLS policies specified in requirements

### ✅ 2. Type Safety & Validation (MANDATORY)

**Status**: ✅ COMPLIANT

**Verification**:
- Database-level constraints (NOT NULL, CHECK, UNIQUE, FOREIGN KEY) enforce data integrity
- ENUM types defined for status fields and delivery modes
- Validation rules specified in schema (e.g., date ranges, capacity calculations)
- Future API layer will use Zod schemas from `packages/contracts` (out of scope for this phase)

**Evidence**: Schema includes comprehensive constraints, ENUM types, and validation rules

### ✅ 3. Security-First Design (NON-NEGOTIABLE)

**Status**: ✅ COMPLIANT

**Verification**:
- RLS policies ensure data access is tenant-scoped
- Foreign key constraints prevent orphaned records
- Audit trails (`created_at`, `updated_at`) on all tables
- No sensitive data exposure (passwords, tokens) in this schema
- Payment data properly isolated with transaction references

**Evidence**: RLS policies required, audit fields included, security considerations documented

### ✅ 4. API-First Architecture (MANDATORY)

**Status**: ✅ COMPLIANT (N/A for schema-only feature)

**Verification**:
- Database schema is infrastructure layer, independent of API implementation
- Schema design supports future API endpoints (proper indexes, relationships)
- No API code in this phase (out of scope per spec)

**Evidence**: Schema designed to support future API layer, no API implementation required

### ✅ 5. Monorepo Standards (REQUIRED)

**Status**: ✅ COMPLIANT

**Verification**:
- Migration file follows existing pattern in `infra/scripts/migrations/`
- Naming convention matches existing migrations (sequential numbering)
- No new dependencies required (uses existing PostgreSQL infrastructure)

**Evidence**: Migration will be placed in `infra/scripts/migrations/` following existing patterns

### ✅ 6. Production-Ready Code (MANDATORY)

**Status**: ✅ COMPLIANT

**Verification**:
- Migration includes rollback capability (transaction-based)
- Error handling through PostgreSQL constraints
- No breaking changes to existing schema
- Migration can be applied with zero downtime
- Health checks possible through table existence verification

**Evidence**: Migration design includes transactions, constraints, and backward compatibility

**GATE RESULT**: ✅ ALL GATES PASSED - Proceed to Phase 0

### Post-Phase 1 Re-evaluation

**Status**: ✅ ALL GATES STILL PASSED

**Verification After Design**:
- ✅ Multi-tenant isolation: All 9 tables include `tenant_id` with RLS policies
- ✅ Type safety: Database constraints and ENUMs enforce data integrity
- ✅ Security: RLS policies implemented, audit trails included
- ✅ API-first: Schema designed to support future API layer
- ✅ Monorepo: Migration follows existing patterns in `infra/scripts/migrations/`
- ✅ Production-ready: Includes rollback capability, constraints, and error handling

**GATE RESULT**: ✅ ALL GATES PASSED - Ready for Phase 2 (Task Planning)

## Project Structure

### Documentation (this feature)

```
specs/015-imhotep-data-schema/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
infra/scripts/migrations/
└── 0037_imhotep_data_professional_training.sql  # New migration file

# Existing structure (unchanged)
apps/
├── api/          # Fastify API server (future API endpoints will be added here)
├── web/          # Next.js frontend (future UI will be added here)
└── worker/       # Background worker (planned)

packages/
├── contracts/    # Shared TypeScript types (future Zod schemas will be added here)
├── ui/           # Shared UI components
└── utils/        # Shared utilities
```

**Structure Decision**: This is a database schema-only feature. The migration file will be added to the existing `infra/scripts/migrations/` directory following the established sequential numbering pattern (next available: 0037). No new project structure required. Future API and frontend work (out of scope) will use existing `apps/api` and `apps/web` directories.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations - all constitution gates passed.
