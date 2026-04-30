# Implementation Plan: Parent Reports & Documents

**Branch**: `013-parent-documents` | **Date**: 2025-01-27 | **Spec**: `specs/013-parent-documents/spec.md`
**Input**: Feature specification from `specs/013-parent-documents/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view and download reports and documents for their children including report cards, transcripts, attendance reports, and payment receipts. The feature provides parents with comprehensive access to their children's academic and financial documentation, with proper data access control ensuring parents can only view reports for their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent documents  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Reports and documents load within 2 seconds, filtering completes within 1 second, report download/view within 3 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see reports for their own linked children, filtering must support multiple children, reports must be downloadable as PDF  
**Scale/Scope**: Parent users accessing reports and documents for their linked children; typical parent has 1-5 children linked, multiple report cards per child per academic year, multiple transcripts per child, multiple attendance reports per child, multiple payment receipts per child

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent documents endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/013-parent-documents/
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
│       │   └── parent-documents.ts    # new: parent documents endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── documents/
        │       │   └── page.tsx            # documents main page
        │       └── components/
        │           └── documents/
        │               ├── ReportCards.tsx
        │               ├── Transcripts.tsx
        │               ├── AttendanceReports.tsx
        │               └── PaymentReceipts.tsx
        └── lib/
            └── hooks/
                └── use-parent-documents.ts   # parent documents data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent documents (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent documents
├── integration/ # E2E Playwright scenarios for parent documents views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-documents` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/documents/`, parent components under `apps/web/src/app/parent/components/documents/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
