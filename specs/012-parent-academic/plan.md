# Implementation Plan: Parent Academic Information

**Branch**: `012-parent-academic` | **Date**: 2025-01-27 | **Spec**: `specs/012-parent-academic/spec.md`
**Input**: Feature specification from `specs/012-parent-academic/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view academic information for their children including enrolled courses, course materials, academic calendar, exam schedules, and academic year information. The feature provides parents with comprehensive visibility into their children's academic program, with proper data access control ensuring parents can only view information for their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent academic information  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Academic information loads within 2 seconds, filtering completes within 1 second, course materials download/view within 3 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see information for their own linked children, filtering must support multiple children  
**Scale/Scope**: Parent users accessing academic information for their linked children; typical parent has 1-5 children linked, each child enrolled in 5-10 courses, multiple course materials per course, multiple exam schedules per academic year

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent academic information endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/012-parent-academic/
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
│       │   └── parent-academic.ts    # new: parent academic information endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── academic/
        │       │   └── page.tsx            # academic main page
        │       └── components/
        │           └── academic/
        │               ├── EnrolledCourses.tsx
        │               ├── CourseMaterials.tsx
        │               ├── AcademicCalendar.tsx
        │               ├── ExamSchedules.tsx
        │               └── AcademicYearInfo.tsx
        └── lib/
            └── hooks/
                └── use-parent-academic.ts   # parent academic information data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent academic information (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent academic information
├── integration/ # E2E Playwright scenarios for parent academic information views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-academic` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/academic/`, parent components under `apps/web/src/app/parent/components/academic/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
