# Implementation Plan: Parent Communications & Messages

**Branch**: `010-parent-messages` | **Date**: 2025-01-27 | **Spec**: `specs/010-parent-messages/spec.md`
**Input**: Feature specification from `specs/010-parent-messages/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view and manage their communications with teachers and school through a dedicated messages interface. The feature provides parents with access to messages from teachers, school announcements, parent-teacher conversation threads, notifications, and event invitations. All data is accessible for children linked to the authenticated parent, with proper data access control ensuring parents can only view information for their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent messages  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Message history loads within 2 seconds, notifications load within 2 seconds, conversation threads load within 3 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see their linked children's communications, pagination for large datasets (20 records per page), read/unread status must be accurately tracked  
**Scale/Scope**: Parent users accessing their children's communication data; typical parent has 1-5 children, typical child may have 10-50 messages per academic year, multiple conversations per teacher

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent messages endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/010-parent-messages/
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
│       │   └── parent-messages.ts    # new: parent messages endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── messages/
        │       │   └── page.tsx            # messages main page
        │       └── components/
        │           └── messages/
        │               ├── TeacherMessages.tsx
        │               ├── SchoolAnnouncements.tsx
        │               ├── ParentTeacherMessages.tsx
        │               ├── Notifications.tsx
        │               └── EventInvitations.tsx
        └── lib/
            └── hooks/
                └── use-parent-messages.ts   # parent messages data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent messages (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent messages
├── integration/ # E2E Playwright scenarios for parent messages views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-messages` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/messages/`, parent components under `apps/web/src/app/parent/components/messages/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
