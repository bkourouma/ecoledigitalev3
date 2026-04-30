# Implementation Plan: Trainer Space (Espace Formateurs) - Imhotep Data

**Branch**: `019-espace-formateurs-imhotep` | **Date**: 2025-11-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-espace-formateurs-imhotep/spec.md`

## Summary

This feature implements a comprehensive trainer space (Espace Formateurs) for professional training instructors in the Imhotep Data module. The system enables trainers to manage their assigned sessions, track learner attendance, upload and manage course materials, communicate with learners, and maintain their professional profiles.

**Primary Requirement**: Provide trainers with a dedicated interface to manage their training activities, including dashboard overview, schedule management, session details, attendance tracking, course material management, and learner communication.

**Technical Approach**: RESTful API endpoints following existing patterns, React-based frontend with dashboard, calendar, and management interfaces, file upload service for course materials, and integration with existing email/SMS services for group messaging.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 18+  
**Primary Dependencies**: Fastify (backend), Next.js 15 (frontend), React, TanStack Query, PostgreSQL 14+, FullCalendar (for trainer schedule)  
**Storage**: PostgreSQL with Row Level Security (RLS) for multi-tenant isolation, local file system for course materials/photos/CVs  
**Testing**: Jest/Vitest for unit tests, Playwright for E2E tests, API contract tests  
**Target Platform**: Web application (Next.js frontend + Fastify backend), deployed on shared VPS  
**Project Type**: Web application (monorepo with apps/api and apps/web)  
**Performance Goals**: 
- Dashboard loads in < 3 seconds with all statistics
- Calendar view loads in < 2 seconds for any month/week
- File uploads complete in < 2 minutes for files under 50MB
- Attendance marking supports 50+ learners without lag
- Support 50+ concurrent sessions per trainer without performance degradation
**Constraints**: 
- Must maintain multi-tenant isolation (Imhotep Data tenant)
- Must restrict trainer access to only their assigned sessions
- File uploads limited to 100MB for course materials, 5MB for photos, 10MB for CVs
- Course materials must support common formats (PDF, PPT, DOC, ZIP, Video)
- All trainer actions must be logged for audit purposes
**Scale/Scope**: 
- Support trainers managing up to 50 concurrent sessions
- Handle course material uploads up to 100MB per file
- Support attendance tracking for sessions with 50+ enrolled learners
- Group messaging to up to 100 learners per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 1. Multi-Tenant Isolation (CRITICAL - NON-NEGOTIABLE)
- ✅ **PASS**: All database queries must include tenant_id filtering via RLS policies
- ✅ **PASS**: Trainer routes must verify tenant context from request
- ✅ **PASS**: Trainer access must be scoped to their tenant and assigned sessions only
- **Action Required**: Verify RLS policies exist for `formateurs`, `session_formateurs`, and new tables (supports_cours, trainer_unavailability, session_notes, trainer_notifications)

### 2. Type Safety & Validation (MANDATORY)
- ✅ **PASS**: All API contracts must be defined in `packages/contracts/src/formateurs/`
- ✅ **PASS**: Zod schemas required for all request/response validation
- ✅ **PASS**: TypeScript strict mode enforced
- **Action Required**: Create Zod schemas for dashboard data, schedule, session details, attendance, course materials, notes, messages, and profile updates

### 3. Security-First Design (NON-NEGOTIABLE)
- ✅ **PASS**: Trainer endpoints require authentication and trainer role verification
- ✅ **PASS**: Access control ensures trainers can only access their assigned sessions
- ✅ **PASS**: Input validation on all endpoints (file uploads, attendance, messages)
- ✅ **PASS**: File upload validation (type, size) before processing
- **Action Required**: Implement trainer authentication middleware, session access verification, and file upload security checks

### 4. API-First Architecture (MANDATORY)
- ✅ **PASS**: Business logic lives in backend services (`apps/api/src/services/`)
- ✅ **PASS**: Frontend consumes REST APIs via TanStack Query
- ✅ **PASS**: API versioning: `/api/v1/formateur/` for trainer endpoints
- **Action Required**: Create service layer for trainer dashboard, schedule management, attendance tracking, course material management, and messaging

### 5. Monorepo Standards (REQUIRED)
- ✅ **PASS**: Shared contracts in `packages/contracts/src/formateurs/`
- ✅ **PASS**: Shared UI components in `packages/ui/` if reusable
- ✅ **PASS**: API routes in `apps/api/src/routes/formateur.ts`
- ✅ **PASS**: Frontend pages in `apps/web/src/app/formateur/`
- **Action Required**: Ensure contracts are exported from packages/contracts index

### 6. Production-Ready Code (MANDATORY)
- ✅ **PASS**: Error handling with proper HTTP status codes
- ✅ **PASS**: Database transactions for attendance updates and file operations
- ✅ **PASS**: Logging for trainer actions (audit trail)
- ✅ **PASS**: File upload error handling and cleanup on failure
- **Action Required**: Implement proper error handling, transaction management, and audit logging

**Overall Status**: ✅ **PASS** - All constitution principles satisfied with documented action items

## Project Structure

### Documentation (this feature)

```
specs/019-espace-formateurs-imhotep/
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
│       │   └── formateur.ts          # Trainer API routes
│       └── services/
│           ├── formateur.service.ts   # Trainer dashboard, schedule, sessions
│           ├── attendance.service.ts  # Attendance tracking
│           ├── supports-cours.service.ts  # Course material management
│           └── formateur-messaging.service.ts  # Group messaging
│
└── web/
    └── src/
        └── app/
            └── formateur/
                ├── dashboard/
                │   └── page.tsx       # Trainer dashboard
                ├── planning/
                │   └── page.tsx       # Schedule calendar
                ├── sessions/
                │   ├── page.tsx       # Session list
                │   └── [id]/
                │       ├── details/
                │       │   └── page.tsx  # Session details
                │       └── inscrits/
                │           └── page.tsx  # Enrolled learners
                ├── supports/
                │   ├── page.tsx       # Course materials list
                │   ├── upload/
                │   │   └── page.tsx    # Upload material
                │   └── [id]/
                │       └── edit/
                │           └── page.tsx  # Edit material
                └── profil/
                    └── page.tsx       # Trainer profile

packages/
├── contracts/
│   └── src/
│       └── formateurs/
│           ├── index.ts              # Contract exports
│           ├── dashboard.schema.ts    # Dashboard data schemas
│           ├── schedule.schema.ts    # Schedule and unavailability schemas
│           ├── sessions.schema.ts     # Session list and details schemas
│           ├── attendance.schema.ts   # Attendance schemas
│           ├── supports.schema.ts    # Course material schemas
│           ├── messaging.schema.ts    # Group messaging schemas
│           └── profil.schema.ts      # Profile schemas
└── ui/
    └── src/
        └── components/
            └── formateur/            # Reusable trainer UI components
                ├── DashboardStats.tsx
                ├── SessionCard.tsx
                ├── AttendanceTable.tsx
                └── MaterialUpload.tsx
```

**Structure Decision**: Web application structure with separate backend API routes and frontend pages. Shared contracts in packages/contracts for type safety. Reusable UI components in packages/ui for consistency across trainer interface.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No violations - all constitution principles satisfied.

