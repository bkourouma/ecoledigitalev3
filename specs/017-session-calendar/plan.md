# Implementation Plan: Session Management & Calendar - Imhotep Data

**Branch**: `017-session-calendar` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-session-calendar/spec.md`

## Summary

This feature implements a comprehensive session management and calendar system for professional training sessions in the Imhotep Data module. The system enables public users to browse and view training sessions through an interactive calendar, while administrators can create, manage, and monitor sessions with trainer availability validation, real-time capacity tracking, and participant management.

**Primary Requirement**: Enable session discovery for learners and comprehensive session management for administrators, with automatic validation of trainer availability and real-time availability updates.

**Technical Approach**: RESTful API endpoints following existing patterns, calendar UI component for public viewing, admin interface for session CRUD operations, and real-time availability updates via polling or WebSocket mechanisms.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 18+  
**Primary Dependencies**: Fastify (backend), Next.js 15 (frontend), React, TanStack Query, PostgreSQL 14+  
**Storage**: PostgreSQL with Row Level Security (RLS) for multi-tenant isolation  
**Testing**: Jest/Vitest for unit tests, Playwright for E2E tests, API contract tests  
**Target Platform**: Web application (Next.js frontend + Fastify backend), deployed on shared VPS  
**Project Type**: Web application (monorepo with apps/api and apps/web)  
**Performance Goals**: 
- Calendar view loads in < 2 seconds for 100+ sessions
- Session availability updates within 30 seconds of enrollment changes
- API endpoints respond in < 200ms p95 for standard queries
- Support 100+ concurrent sessions without performance degradation
**Constraints**: 
- Must maintain multi-tenant isolation (Imhotep Data tenant)
- Must validate trainer availability before session creation/updates
- Must prevent capacity reduction below existing enrollments
- Real-time updates must not impact page load performance
**Scale/Scope**: 
- Support 100+ concurrent training sessions
- Handle 500+ enrollments per session
- Calendar view supports month/week/list views
- Admin interface supports bulk operations on multiple sessions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)
- ✅ **PASS**: All database queries must include tenant_id filtering via RLS policies
- ✅ **PASS**: Session routes must verify tenant context from request
- ✅ **PASS**: Trainer availability checks must be tenant-scoped
- **Action Required**: Verify RLS policies exist for `sessions_professionnelles` table (from Phase 1 migration)

### 2. Type Safety & Validation (MANDATORY)
- ✅ **PASS**: All API contracts must be defined in `packages/contracts/src/sessions-pro/`
- ✅ **PASS**: Zod schemas required for all request/response validation
- ✅ **PASS**: TypeScript strict mode enforced
- **Action Required**: Create Zod schemas for session creation, updates, filters, and calendar events

### 3. Security-First Design (NON-NEGOTIABLE)
- ✅ **PASS**: Public calendar endpoints are read-only (GET only)
- ✅ **PASS**: Admin endpoints require authentication and admin role verification
- ✅ **PASS**: Input validation on all admin endpoints (dates, capacity, trainer IDs)
- ✅ **PASS**: Prevent unauthorized access to enrollment details (admin only)
- **Action Required**: Implement RBAC checks in admin session routes

### 4. API-First Architecture (MANDATORY)
- ✅ **PASS**: Business logic lives in backend services (`apps/api/src/services/`)
- ✅ **PASS**: Frontend consumes REST APIs via TanStack Query
- ✅ **PASS**: API versioning: `/api/v1/sessions-pro` for public, `/api/v1/admin/sessions-pro` for admin
- **Action Required**: Create service layer for session management, trainer availability checks, and capacity calculations

### 5. Monorepo Standards (REQUIRED)
- ✅ **PASS**: Shared contracts in `packages/contracts/src/sessions-pro/`
- ✅ **PASS**: Shared UI components in `packages/ui/` if reusable
- ✅ **PASS**: API routes in `apps/api/src/routes/sessions-pro.ts`
- ✅ **PASS**: Frontend pages in `apps/web/src/app/formations-professionnelles/sessions/`
- **Action Required**: Ensure contracts are exported from packages/contracts index

### 6. Production-Ready Code (MANDATORY)
- ✅ **PASS**: Error handling with proper HTTP status codes
- ✅ **PASS**: Database transactions for session creation/updates
- ✅ **PASS**: Logging for session operations and trainer conflicts
- ✅ **PASS**: Health checks for session-related database queries
- **Action Required**: Implement proper error handling and transaction management

**Overall Status**: ✅ **PASS** - All constitution principles satisfied with documented action items

## Project Structure

### Documentation (this feature)

```
specs/017-session-calendar/
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
│       │   └── sessions-pro.ts          # new: public and admin session endpoints
│       ├── services/
│       │   ├── session-pro.service.ts   # new: session business logic
│       │   └── formateur-availability.service.ts  # new: trainer availability checks
│       └── models/
│           └── (database models via Prisma/raw SQL)
│
└── web/
    └── src/
        ├── app/
        │   ├── formations-professionnelles/
        │   │   ├── sessions/
        │   │   │   ├── page.tsx                    # public calendar view
        │   │   │   └── [id]/
        │   │   │       └── page.tsx                # public session detail
        │   │   └── admin/
        │   │       └── sessions/
        │   │           ├── page.tsx                # admin session list
        │   │           ├── creer/
        │   │           │   └── page.tsx            # create session form
        │   │           └── [id]/
        │   │               ├── modifier/
        │   │               │   └── page.tsx         # edit session form
        │   │               └── details/
        │   │                   └── page.tsx         # admin session detail
        │   └── api/
        │       └── v1/
        │           └── sessions-pro/
        │               └── route.ts                 # Next.js API route proxy
        │
        ├── components/
        │   └── sessions-pro/
        │       ├── CalendarComponent.tsx            # calendar view component
        │       ├── CalendarToolbar.tsx              # filters and view switcher
        │       ├── SessionEventCard.tsx             # session card in calendar
        │       ├── SessionDetailModal.tsx           # modal for session details
        │       ├── SessionDetailPage.tsx             # full session detail page
        │       ├── SessionInscriptionSidebar.tsx    # enrollment sidebar
        │       ├── AdminSessionsList.tsx             # admin session table
        │       ├── AdminSessionsFilters.tsx         # admin filters
        │       ├── SessionFormWizard.tsx            # multi-step session form
        │       └── AdminSessionDetail.tsx           # admin detail view
        │
        └── lib/
            └── hooks/
                └── use-sessions-pro.ts              # session data hooks

packages/
├── contracts/
│   └── src/
│       └── sessions-pro/
│           ├── index.ts                             # exports
│           ├── session.schema.ts                    # session Zod schemas
│           ├── session-api.schema.ts                # API request/response schemas
│           ├── calendar.schema.ts                  # calendar event schemas
│           └── types.ts                              # TypeScript types
│
└── ui/
    └── (reusable calendar components if needed)
```

**Structure Decision**: Following existing monorepo pattern with API routes in `apps/api/src/routes/`, frontend pages in `apps/web/src/app/`, and shared contracts in `packages/contracts/`. Calendar UI will use a calendar library (to be determined in research phase) integrated into React components. Admin interface follows existing admin route patterns (`/admin/*`).

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations - all constitution principles are satisfied.
