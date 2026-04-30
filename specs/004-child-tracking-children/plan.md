# Implementation Plan: Child Tracking

**Branch**: `004-child-tracking-children` | **Date**: 2025-01-27 | **Spec**: `specs/004-child-tracking-children/spec.md`
**Input**: Feature specification from `specs/004-child-tracking-children/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view and track their children's academic information through a dedicated child tracking interface. The feature provides parents with access to their linked children's grades summary (all-time), weekly schedules, upcoming classes, attendance records, and absence history. All data is accessible regardless of child status (active, suspended, dropped, transfer), with proper data access control ensuring parents can only view information for their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent child tracking  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Children list loads within 2 seconds, grades summary within 1 second, attendance filtering returns results within 2 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see their linked children, pagination for large datasets (20 records per page)  
**Scale/Scope**: Parent users accessing their children's data; typical parent has 1-5 children, typical child may have 100+ attendance records, multiple grades per semester

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent child tracking endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/004-child-tracking-children/
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
│       │   └── parent-children.ts    # new: parent child tracking endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── children/
        │       │   ├── page.tsx            # children list page
        │       │   ├── [childId]/
        │       │   │   ├── page.tsx        # child detail page
        │       │   │   └── schedule/
        │       │   │       └── page.tsx    # schedule page
        │       └── components/
        │           ├── ChildrenList.tsx
        │           ├── ChildGradesSummary.tsx
        │           ├── ChildSchedule.tsx
        │           ├── UpcomingClasses.tsx
        │           ├── AttendanceRecords.tsx
        │           └── AbsenceHistory.tsx
        └── lib/
            └── hooks/
                └── use-parent-children.ts   # parent children data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent child tracking
└── utils/

tests/
├── contract/    # API contract tests for parent child tracking
├── integration/ # E2E Playwright scenarios for parent views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-children` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/children/`, parent components under `apps/web/src/app/parent/components/`, and contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
