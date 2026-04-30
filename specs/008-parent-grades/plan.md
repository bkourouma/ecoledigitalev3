# Implementation Plan: Parent Grades & Evaluations

**Branch**: `008-parent-grades` | **Date**: 2025-01-27 | **Spec**: `specs/008-parent-grades/spec.md`
**Input**: Feature specification from `specs/008-parent-grades/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view and track their children's grades and academic performance through a dedicated grades interface. The feature provides parents with access to assignment grades, grades organized by course, overall averages and statistics, and grade trends over time. All data is accessible for children linked to the authenticated parent, with proper data access control ensuring parents can only view information for their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand, Chart.js or Recharts for grade trends; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent grades  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Assignment grades list loads within 2 seconds, overall averages calculation within 2 seconds, grade trends chart renders within 3 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see their linked children's grades, pagination for large datasets (20 records per page), grade calculations must be accurate  
**Scale/Scope**: Parent users accessing their children's grade data; typical parent has 1-5 children, typical child may have 50-200 graded assignments per academic year, multiple courses per child

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. May add charting library (Chart.js or Recharts) for grade trends visualization. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent grades endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/008-parent-grades/
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
│       │   └── parent-grades.ts    # new: parent grades endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── grades/
        │       │   └── page.tsx            # grades main page
        │       └── components/
        │           └── grades/
        │               ├── AssignmentGrades.tsx
        │               ├── GradesByCourse.tsx
        │               ├── OverallAverages.tsx
        │               └── GradeTrends.tsx
        └── lib/
            └── hooks/
                └── use-parent-grades.ts   # parent grades data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent grades (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent grades
├── integration/ # E2E Playwright scenarios for parent grades views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-grades` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/grades/`, parent components under `apps/web/src/app/parent/components/grades/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
