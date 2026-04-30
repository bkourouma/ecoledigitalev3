# Implementation Plan: Catalogue de Formations Professionnelles - Module Imhotep Data

**Branch**: `016-catalogue-formations-pro` | **Date**: 2025-11-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-catalogue-formations-pro/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Create a complete professional training catalog interface for Imhotep Data with search, filtering, detailed training information pages, recommendations, and PDF generation. The catalog enables prospective learners to discover, evaluate, and download information about professional training programs. The implementation follows existing application patterns with Fastify API endpoints, Next.js frontend pages, and PostgreSQL database queries leveraging the Phase 1 database schema.

**Technical Approach**: Implement RESTful API endpoints in Fastify following existing route patterns, create Next.js pages with Tailwind CSS and Radix UI components, implement full-text search using PostgreSQL, add PDF generation service, and ensure multi-tenant isolation throughout.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 18+)  
**Primary Dependencies**: Fastify 4.x, Next.js 15, React 18, Tailwind CSS, Radix UI, TanStack Query, PostgreSQL 14+, Zod 3.x, Puppeteer 21.x  
**Storage**: PostgreSQL 14+ with Row Level Security (RLS), existing `formations_professionnelles` and `sessions_professionnelles` tables from Phase 1  
**Testing**: Jest, Supertest for API tests, Playwright for E2E (optional)  
**Target Platform**: Web application (Next.js frontend on port 3000, Fastify API on port 8011)  
**Project Type**: Web application (frontend + backend in monorepo)  
**Performance Goals**: Search results in <2s, filter updates in <2s, detail page load in <3s, PDF generation in <5s, support 500+ active trainings  
**Constraints**: Must maintain tenant isolation via RLS, must follow existing API patterns, must be responsive (mobile 320px+), must handle 500+ trainings without degradation  
**Scale/Scope**: 500+ professional training programs, multiple concurrent users browsing catalog, PDF generation on-demand

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)

**Status**: ✅ COMPLIANT

**Verification**:
- All API endpoints will use existing tenant context plugin (`tenantContextPlugin`)
- Database queries will use RLS policies already established in Phase 1 schema
- All queries will filter by `tenant_id` using `set_config('app.tenant_id', ...)`
- Frontend routes will respect tenant context from existing authentication system
- No cross-tenant data access possible

**Evidence**: Phase 1 schema (Feature 015) already includes RLS policies for `formations_professionnelles` and `sessions_professionnelles` tables. Existing API routes follow tenant isolation patterns.

### ✅ 2. Type Safety & Validation (MANDATORY)

**Status**: ✅ COMPLIANT

**Verification**:
- All API contracts will be defined in `packages/contracts` using Zod schemas
- Request/response validation using Fastify schema validation
- TypeScript strict mode enforced
- Input sanitization for search queries and filter parameters
- URL parameter validation for slugs and IDs

**Evidence**: Existing codebase uses Zod schemas in `packages/contracts`, Fastify schema validation patterns established in other routes.

### ✅ 3. Security-First Design (NON-NEGOTIABLE)

**Status**: ✅ COMPLIANT

**Verification**:
- Catalog viewing is public (no authentication required) - training information is non-sensitive
- PDF generation endpoint will have rate limiting to prevent abuse
- SQL injection prevention via parameterized queries (existing pattern)
- XSS prevention via React's built-in escaping and sanitization
- PDF generation will not expose sensitive data
- Only active trainings are displayed

**Evidence**: Existing authentication middleware and security patterns in place. Research phase determined public catalog access is appropriate.

### ✅ 4. API-First Architecture (MANDATORY)

**Status**: ✅ COMPLIANT

**Verification**:
- Backend API endpoints in `apps/api/src/routes/formations-pro.ts`
- Frontend consumes APIs via TanStack Query hooks
- Business logic in backend services
- API versioning via `/api/v1/` prefix (existing pattern)
- Clear separation: frontend (Next.js) ↔ backend (Fastify)

**Evidence**: Existing architecture follows API-first pattern with separate frontend/backend apps.

### ✅ 5. Monorepo Standards (REQUIRED)

**Status**: ✅ COMPLIANT

**Verification**:
- API contracts in `packages/contracts/src/formations-pro.ts`
- Shared types and utilities in packages
- Route handlers in `apps/api/src/routes/`
- Frontend pages in `apps/web/src/app/`
- New dependency (Puppeteer) justified for PDF generation requirement

**Evidence**: Existing monorepo structure with `apps/` and `packages/` organization.

### ✅ 6. Production-Ready Code (MANDATORY)

**Status**: ✅ COMPLIANT

**Verification**:
- Error handling with user-friendly messages
- Loading states and skeleton loaders
- Graceful degradation for PDF generation failures
- Health check endpoints (existing infrastructure)
- Proper logging for debugging
- No breaking changes to existing functionality
- VPS deployment considerations (port 8011, shared server)

**Evidence**: Existing error handling patterns, health check infrastructure in place.

**GATE RESULT**: ✅ ALL GATES PASSED - Proceed to Phase 0

### Post-Phase 1 Re-evaluation

**Status**: ✅ ALL GATES STILL PASSED

**Verification After Design**:
- ✅ Multi-tenant isolation: All queries use RLS policies from Phase 1, tenant context plugin used
- ✅ Type safety: Zod schemas defined in `packages/contracts/src/formations-pro.ts`, Fastify validation
- ✅ Security: Public catalog access appropriate, rate limiting for PDF, parameterized queries
- ✅ API-first: RESTful endpoints defined, frontend consumes via TanStack Query
- ✅ Monorepo: Contracts in packages, routes in apps/api, pages in apps/web
- ✅ Production-ready: Error handling, loading states, graceful degradation, logging

**GATE RESULT**: ✅ ALL GATES PASSED - Ready for Phase 2 (Task Planning)

## Project Structure

### Documentation (this feature)

```
specs/016-catalogue-formations-pro/
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
│       │   └── formations-pro.ts          # new: professional training catalog API endpoints
│       └── services/
│           ├── formation-pro.service.ts    # new: search, filtering, recommendations logic
│           └── pdf-generation.service.ts   # new: PDF generation for training programs
│
└── web/
    └── src/
        ├── app/
        │   └── formations-professionnelles/
        │       ├── catalogue/
        │       │   ├── page.tsx            # new: main catalog page with search/filters
        │       │   └── [slug]/
        │       │       └── page.tsx        # new: training detail page
        │       └── sessions/
        │           ├── page.tsx            # new: sessions calendar (future)
        │           └── [id]/
        │               └── page.tsx         # new: session detail (future)
        │
        ├── components/
        │   └── formations-pro/
        │       ├── CatalogueFormationsPro.tsx    # new: main catalog component
        │       ├── SearchBar.tsx                  # new: search input with debounce
        │       ├── FiltersSidebar.tsx            # new: filter panel
        │       ├── FormationCard.tsx             # new: training card component
        │       ├── FormationDetail.tsx            # new: detail page component
        │       ├── SimilarFormations.tsx          # new: recommendations component
        │       └── SessionCardMini.tsx            # new: session preview card
        │
        └── lib/
            └── hooks/
                └── use-formations-pro.ts   # new: TanStack Query hooks for API calls

packages/
└── contracts/
    └── src/
        └── formations-pro.ts               # new: Zod schemas for API contracts
```

**Structure Decision**: Web application structure (Option 2) - Frontend (Next.js) + Backend (Fastify API) in monorepo. Follows existing patterns with routes in `apps/api/src/routes/`, pages in `apps/web/src/app/`, components in `apps/web/src/components/`, and contracts in `packages/contracts/src/`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations - all constitution principles are satisfied.

---

## Phase 0: Research & Technical Decisions

**Status**: ✅ COMPLETE

**Output**: `research.md`

**Key Decisions**:
1. **PDF Generation**: Puppeteer (server-side HTML-to-PDF)
2. **Full-Text Search**: PostgreSQL FTS with GIN indexes
3. **Catalog Access**: Public (no authentication required)
4. **Recommendations**: Rule-based similarity scoring algorithm
5. **Filter State**: URL parameters + session storage hybrid
6. **Performance**: Pagination, caching, debouncing strategies

See `research.md` for complete details.

---

## Phase 1: Design & Contracts

**Status**: ✅ COMPLETE

**Outputs**:
- `data-model.md` - Entity definitions and query patterns
- `contracts/formations-pro-api.md` - API documentation
- `contracts/formations-pro.ts` - Zod schema definitions
- `quickstart.md` - API usage examples

**API Endpoints Defined**:
1. `GET /api/v1/formations-pro` - List with search/filter/sort/pagination
2. `GET /api/v1/formations-pro/:slug` - Training detail
3. `GET /api/v1/formations-pro/:id/sessions` - Training sessions
4. `GET /api/v1/formations-pro/:id/similaires` - Similar trainings
5. `GET /api/v1/formations-pro/:id/programme-pdf` - PDF download
6. `GET /api/v1/formations-pro/themes` - Available themes
7. `GET /api/v1/formations-pro/stats` - Filter statistics

**Data Model**: Uses existing `formations_professionnelles` and `sessions_professionnelles` tables from Phase 1 (Feature 015).

---

## Next Steps

**Phase 2**: Run `/speckit.tasks` to generate implementation tasks, or proceed directly to implementation using:
- `plan.md` - Implementation approach
- `research.md` - Technical decisions
- `data-model.md` - Database structure
- `contracts/` - API contracts
- `quickstart.md` - Usage examples

**Agent Context**: Updated Cursor IDE context file with new technology stack information.

---

**Planning Status**: ✅ COMPLETE - All phases finished, ready for task planning or implementation
