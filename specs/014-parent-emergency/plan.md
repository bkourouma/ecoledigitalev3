# Implementation Plan: Parent Emergency Contacts & Authorization

**Branch**: `014-parent-emergency` | **Date**: 2025-01-27 | **Spec**: `specs/014-parent-emergency/spec.md`
**Input**: Feature specification from `specs/014-parent-emergency/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to manage emergency contacts for themselves and manage pickup authorization, relationship types, and view data access for their linked children. The feature provides parents with comprehensive control over emergency contact information and child relationship management, with proper data access control ensuring parents can only view and manage information for their own account and their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent emergency contacts  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Emergency contacts and relationships load within 1 second, updates save within 2 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see and manage their own information, validation must be enforced for all updates, relationship type and pickup authorization changes may require administrative approval  
**Scale/Scope**: Parent users accessing their own emergency contacts and child relationships; typical parent has 1-5 children linked, 1-3 emergency contacts, multiple relationship types per child

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent emergency contacts endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/014-parent-emergency/
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
│       │   └── parent-emergency.ts    # new: parent emergency contacts endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── emergency/
        │       │   └── page.tsx            # emergency main page
        │       └── components/
        │           └── emergency/
        │               ├── EmergencyContacts.tsx
        │               ├── PickupAuthorization.tsx
        │               ├── RelationshipTypes.tsx
        │               └── DataAccess.tsx
        └── lib/
            └── hooks/
                └── use-parent-emergency.ts   # parent emergency contacts data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent emergency contacts (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent emergency contacts
├── integration/ # E2E Playwright scenarios for parent emergency contacts views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-emergency` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/emergency/`, parent components under `apps/web/src/app/parent/components/emergency/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
