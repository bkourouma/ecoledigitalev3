# Implementation Plan: Teacher Schedule Calendar Upgrade

**Branch**: `003-teacher-schedule-calendar` | **Date**: 2025-10-18 | **Spec**: `specs/003-teacher-schedule-calendar/spec.md`
**Input**: Feature specification from `specs/003-teacher-schedule-calendar/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Upgrade `/teacher/schedule` to a sophisticated calendar enabling drag-and-drop move, resize, add with cascading class→course selection, and edit/delete, with conflict prevention for teacher/class overlaps. Frontend updates in the web app; API endpoints for sessions with validation.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next 15  
**Primary Dependencies**: Frontend: Next, React, Radix UI, Ant Design; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for scheduling  
**Target Platform**: Web app (frontend) + Node server (backend)
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Drag/drop interactions feel instant (<100ms UI updates), saves under 1s  
**Constraints**: Prevent overlaps strictly; 15-min time grid; accessibility keyboard flows  
**Scale/Scope**: Single feature surface; typical teacher usage (<100 sessions per calendar view)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for conflicts and CRUD. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/003-teacher-schedule-calendar/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
apps/
├── api/
│   └── src/
│       ├── routes/           # new: sessions endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── pages/teacher/schedule.tsx   # calendar page updates
        ├── components/schedule/         # calendar widget, dialogs
        └── services/schedule.ts         # client calls

packages/
├── contracts/   # OpenAPI/TS types for sessions
└── utils/

tests/
├── contract/    # API contract tests for sessions
├── integration/ # E2E Playwright scenarios
└── unit/
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]
**Structure Decision**: Use existing monorepo structure. Add `sessions` routes under `apps/api/src/routes`, a `schedule` component folder under `apps/web/src/components`, and contract/types in `packages/contracts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

