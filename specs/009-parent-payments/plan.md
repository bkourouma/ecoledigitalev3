# Implementation Plan: Parent Payments & Finances

**Branch**: `009-parent-payments` | **Date**: 2025-01-27 | **Spec**: `specs/009-parent-payments/spec.md`
**Input**: Feature specification from `specs/009-parent-payments/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable parents to view and track their children's payment history, tuition installments, payment schedules, outstanding balances, receipts, and payment methods through a dedicated payments interface. The feature provides parents with access to all financial information for their linked children, with proper data access control ensuring parents can only view information for their own linked children.

## Technical Context

**Language/Version**: TypeScript (Node 20+/TS 5), React 18, Next.js 15  
**Primary Dependencies**: Frontend: Next.js, React, Radix UI, TanStack Query, Zustand; Backend: Fastify, pg, zod; Monorepo with pnpm workspaces  
**Storage**: PostgreSQL (existing `pg` usage with RLS)  
**Testing**: Playwright for E2E (existing), Jest for API; add focused tests for parent payments  
**Target Platform**: Web app (frontend) + Node server (backend)  
**Project Type**: Monorepo with `apps/web`, `apps/api`, shared `packages`  
**Performance Goals**: Payment history loads within 2 seconds, outstanding balances calculation within 2 seconds, receipts download within 3 seconds  
**Constraints**: Multi-tenant RLS enforcement, data access control must ensure parents only see their linked children's payments, pagination for large datasets (20 records per page), balance calculations must be accurate  
**Scale/Scope**: Parent users accessing their children's payment data; typical parent has 1-5 children, typical child may have 10-50 payment transactions per academic year, multiple installments per schedule

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Library-First: No new libraries required; changes within existing apps. PASS
- CLI Interface: Not applicable to UI; API keeps REST contracts. PASS
- Test-First: Commit contract tests and E2E before implementation. ACTION: ensure tests added. PASS WITH ACTION
- Integration Testing: Add API contract tests for parent payments endpoints. PASS
- Observability/Simplicity: Keep minimal endpoints, clear logging at API. PASS

## Project Structure

### Documentation (this feature)

```
specs/009-parent-payments/
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
│       │   └── parent-payments.ts    # new: parent payments endpoints
│       ├── services/
│       └── models/
└── web/
    └── src/
        ├── app/
        │   └── parent/
        │       ├── payments/
        │       │   └── page.tsx            # payments main page
        │       └── components/
        │           └── payments/
        │               ├── PaymentHistory.tsx
        │               ├── TuitionInstallments.tsx
        │               ├── PaymentSchedules.tsx
        │               ├── OutstandingBalances.tsx
        │               ├── Receipts.tsx
        │               └── PaymentMethods.tsx
        └── lib/
            └── hooks/
                └── use-parent-payments.ts   # parent payments data hooks

packages/
├── contracts/
│   └── src/
│       └── parent.ts              # TypeScript types for parent payments (extend existing)
└── utils/

tests/
├── contract/    # API contract tests for parent payments
├── integration/ # E2E Playwright scenarios for parent payments views
└── unit/
```

**Structure Decision**: Use existing monorepo structure. Add `parent-payments` routes under `apps/api/src/routes`, parent pages under `apps/web/src/app/parent/payments/`, parent components under `apps/web/src/app/parent/components/payments/`, and extend contract/types in `packages/contracts/src/parent.ts`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| | | |
