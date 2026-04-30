# Implementation Plan: Parent Profile & Settings

**Branch**: `011-parent-settings` | **Date**: 2025-01-27 | **Spec**: `specs/011-parent-settings/spec.md`
**Input**: Feature specification from `specs/011-parent-settings/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view and manage their profile, contact information, emergency contacts, notification preferences, and relationship management through a dedicated settings interface. The feature provides parents with full control over their account information and preferences, with proper data access control ensuring parents can only view and edit their own information.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent settings  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Profile information loads within 1 second, settings updates save within 2 seconds, password changes complete within 3 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see and edit their own information, validation must be enforced for all updates  
**Scale/Scope**: Parent users accessing their own profile and settings; typical parent has 1-5 children linked, 1-3 emergency contacts, multiple notification preferences

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent settings endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/011-parent-settings/
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
│       │   └── parent-settings.ts    # new: parent settings endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── settings/
        │       │   └── page.tsx            # settings main page
        │       └── components/
        │           └── settings/
        │               ├── ParentProfile.tsx
        │               ├── ContactInformation.tsx
        │               ├── EmergencyContacts.tsx
        │               ├── NotificationPreferences.tsx
        │               ├── RelationshipManagement.tsx
        │               └── ChangePassword.tsx
        └── lib/
            └── hooks/
                └── use-parent-settings.ts   # parent settings data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent settings (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent settings
├── integration/ # E2E Playwright scenarios for parent settings views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-settings` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/settings/`, parent components under `apps/web/src/app/parent/components/settings/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
