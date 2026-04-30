# Tasks: Parent Payments & Finances

**Input**: Design documents from `/specs/009-parent-payments/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included as per Constitution Check requirement (Test-First: Commit contract tests and E2E before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4, US5, US6)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create parent-payments route file structure in `apps/api/src/routes/parent-payments.ts`
- [X] T002 [P] Create parent payments TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `ParentPaymentTransaction`, `ParentPaymentHistory`, `TuitionInstallment`, `PaymentSchedule`, `OutstandingBalance`, `PaymentReceipt`, `PaymentMethod`, `PaymentFilter`
- [X] T003 [P] Create parent payments components directory structure `apps/web/src/app/parent/components/payments/`
- [X] T004 [P] Create parent payments pages directory structure `apps/web/src/app/parent/payments/`
- [X] T005 [P] Create parent payments hooks file `apps/web/src/lib/hooks/use-parent-payments.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentChildRelationshipForPayments` in `apps/api/src/routes/parent-payments.ts` that checks `student_parents` table and verifies child is linked to parent
- [X] T007 Register parent-payments routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/payments` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentPayments` in `apps/web/src/lib/hooks/use-parent-payments.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Payment History (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view all payment transactions for their children with detailed information

**Independent Test**: Log in as a parent user, navigate to `/parent/payments` route, and verify all payment transactions for linked children are displayed with transaction date, child name, fee type, amount, payment method, status, and receipt availability. Test with multiple children, single child, filtering by child/fee type/date range/status, and no payments scenarios.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/payments/history` in `tests/contract/parent-payments.test.ts` - test filtering by child, fee type, date range, status, pagination, access control
- [ ] T010 [P] [US1] Integration test for payment history filtering in `tests/integration/parent-payment-history.test.ts` - verify filter combinations, child relationship verification
- [ ] T011 [P] [US1] E2E test for payment history display in `tests/e2e/parent-payments.spec.ts` - test payment history page, filter application, child selection, pagination

### Implementation for User Story 1

- [X] T012 [US1] Implement `GET /api/v1/parent/payments/history` endpoint in `apps/api/src/routes/parent-payments.ts` - query `payment_transactions` joined with `student_profiles` and `users` for payment transactions for parent's children, filter by child_id, fee_type, date range, status, verify parent-child relationship, support pagination (page, limit)
- [X] T013 [P] [US1] Create `usePaymentHistory(childId, filters, page)` hook in `apps/web/src/lib/hooks/use-parent-payments.ts` - fetch payment history with filters, handle filter parameters (child_id, fee_type, startDate, endDate, status), handle pagination
- [X] T014 [P] [US1] Implement `PaymentHistory` component in `apps/web/src/app/parent/components/payments/PaymentHistory.tsx` - display list of payment transactions, show transaction date, child name, fee type, amount, payment method, status, receipt availability, add filter controls (child, fee type, date range, status), handle empty state, handle pagination
- [X] T015 [US1] Implement payments page in `apps/web/src/app/parent/payments/page.tsx` - use `PaymentHistory` component, add filter controls (child selector, fee type selector, date range picker, status selector), fetch data via hook

**Checkpoint**: Parents can now view payment history for their children

---

## Phase 4: User Story 2 - View Tuition Installments (Priority: P1)

**Goal**: Enable parents to view tuition installments for their children

**Independent Test**: Navigate to tuition installments view. Verify installments are displayed with installment number, installment label, due date, amount, status, amount paid, and late fees. Test filtering by child, sorting by due date, and no installments scenarios.

### Tests for User Story 2

- [ ] T016 [P] [US2] Contract test for `GET /api/v1/parent/payments/installments` in `tests/contract/parent-payments.test.ts` - test filtering by child, installment status, access control
- [ ] T017 [P] [US2] Integration test for tuition installments in `tests/integration/parent-tuition-installments.test.ts` - verify installment status calculation, late fee calculation
- [ ] T018 [P] [US2] E2E test for tuition installments display in `tests/e2e/parent-payments.spec.ts` - test tuition installments view, child filtering, due date sorting

### Implementation for User Story 2

- [X] T019 [US2] Implement `GET /api/v1/parent/payments/installments` endpoint in `apps/api/src/routes/parent-payments.ts` - query `student_tuition_installments` joined with `student_profiles` and `users` for installments for parent's children, filter by child_id, verify parent-child relationship, order by due_date ASC (soonest first)
- [X] T020 [P] [US2] Create `useTuitionInstallments(childId)` hook in `apps/web/src/lib/hooks/use-parent-payments.ts` - fetch tuition installments with optional child filter
- [X] T021 [P] [US2] Implement `TuitionInstallments` component in `apps/web/src/app/parent/components/payments/TuitionInstallments.tsx` - display list of tuition installments, show installment number, installment label, due date, amount, status, amount paid, late fees, add child filter control, handle empty state, sort by due date
- [X] T022 [US2] Add tuition installments section to payments page in `apps/web/src/app/parent/payments/page.tsx` - integrate `TuitionInstallments` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view tuition installments for their children

---

## Phase 5: User Story 3 - View Payment Schedules (Priority: P2)

**Goal**: Enable parents to view payment schedules for their children's tuition

**Independent Test**: Navigate to payment schedules view. Verify schedules are displayed with schedule name, academic year, total tuition amount, number of installments, installment amounts, and due dates. Test filtering by child and no schedules scenarios.

### Tests for User Story 3

- [ ] T023 [P] [US3] Contract test for `GET /api/v1/parent/payments/schedules` in `tests/contract/parent-payments.test.ts` - test filtering by child, access control
- [ ] T024 [P] [US3] Integration test for payment schedules in `tests/integration/parent-payment-schedules.test.ts` - verify schedule data accuracy
- [ ] T025 [P] [US3] E2E test for payment schedules display in `tests/e2e/parent-payments.spec.ts` - test payment schedules view, child filtering

### Implementation for User Story 3

- [X] T026 [US3] Implement `GET /api/v1/parent/payments/schedules` endpoint in `apps/api/src/routes/parent-payments.ts` - query `tuition_payment_schedules` joined with `student_profiles` and `users` for schedules for parent's children, filter by child_id, verify parent-child relationship, order by academic_year DESC (most recent first)
- [X] T027 [P] [US3] Create `usePaymentSchedules(childId)` hook in `apps/web/src/lib/hooks/use-parent-payments.ts` - fetch payment schedules with optional child filter
- [X] T028 [P] [US3] Implement `PaymentSchedules` component in `apps/web/src/app/parent/components/payments/PaymentSchedules.tsx` - display list of payment schedules, show schedule name, academic year, total tuition amount, number of installments, installment amounts, due dates, add child filter control, handle empty state
- [X] T029 [US3] Add payment schedules section to payments page in `apps/web/src/app/parent/payments/page.tsx` - integrate `PaymentSchedules` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view payment schedules for their children

---

## Phase 6: User Story 4 - View Outstanding Balances (Priority: P2)

**Goal**: Enable parents to view outstanding balances for their children

**Independent Test**: Navigate to outstanding balances view. Verify balances are displayed by fee type with total outstanding, amount paid, and amount due. Test filtering by child and fee type, and no balances scenarios.

### Tests for User Story 4

- [ ] T030 [P] [US4] Contract test for `GET /api/v1/parent/payments/balances` in `tests/contract/parent-payments.test.ts` - test filtering by child, fee type, balance calculation accuracy, access control
- [ ] T031 [P] [US4] Integration test for outstanding balances in `tests/integration/parent-outstanding-balances.test.ts` - verify balance calculation accuracy (outstanding, paid, due)
- [ ] T032 [P] [US4] E2E test for outstanding balances display in `tests/e2e/parent-payments.spec.ts` - test outstanding balances section, filter application, balance display

### Implementation for User Story 4

- [X] T033 [US4] Implement `GET /api/v1/parent/payments/balances` endpoint in `apps/api/src/routes/parent-payments.ts` - query `student_tuition_installments` and `payment_transactions` for outstanding balances, calculate outstanding balances by fee type (tuition, inscription, annexes, autres), calculate amount paid and amount due, filter by child_id, fee_type, verify parent-child relationship
- [X] T034 [P] [US4] Create `useOutstandingBalances(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-payments.ts` - fetch outstanding balances with filters (child_id, fee_type)
- [X] T035 [P] [US4] Implement `OutstandingBalances` component in `apps/web/src/app/parent/components/payments/OutstandingBalances.tsx` - display outstanding balances by fee type, show total outstanding, amount paid, amount due for each fee type, add filter controls (child, fee type), handle empty state
- [X] T036 [US4] Add outstanding balances section to payments page in `apps/web/src/app/parent/payments/page.tsx` - integrate `OutstandingBalances` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view outstanding balances for their children

---

## Phase 7: User Story 5 - View Receipts (Priority: P2)

**Goal**: Enable parents to view and download payment receipts for their children's payments

**Independent Test**: Navigate to receipts view. Verify receipts are displayed with receipt number, payment date, child name, fee type, amount, payment method, and download/view capability. Test filtering by child, fee type, date range, downloading receipts, and viewing receipts in browser.

### Tests for User Story 5

- [ ] T037 [P] [US5] Contract test for `GET /api/v1/parent/payments/receipts` in `tests/contract/parent-payments.test.ts` - test filtering by child, fee type, date range, pagination, access control
- [ ] T038 [P] [US5] Integration test for receipts in `tests/integration/parent-receipts.test.ts` - verify receipt data accuracy, receipt URL generation
- [ ] T039 [P] [US5] E2E test for receipts display in `tests/e2e/parent-payments.spec.ts` - test receipts section, filter application, receipt download/view

### Implementation for User Story 5

- [X] T040 [US5] Implement `GET /api/v1/parent/payments/receipts` endpoint in `apps/api/src/routes/parent-payments.ts` - query `payment_receipts` joined with `payment_transactions`, `student_profiles` and `users` for receipts for parent's children, filter by child_id, fee_type, date range, verify parent-child relationship, support pagination (page, limit)
- [X] T041 [P] [US5] Create `useReceipts(childId, filters, page)` hook in `apps/web/src/lib/hooks/use-parent-payments.ts` - fetch receipts with filters (child_id, fee_type, startDate, endDate), handle pagination
- [X] T042 [P] [US5] Implement `Receipts` component in `apps/web/src/app/parent/components/payments/Receipts.tsx` - display list of receipts, show receipt number, payment date, child name, fee type, amount, payment method, add filter controls (child, fee type, date range), add download/view buttons, handle empty state, handle pagination
- [X] T043 [US5] Add receipts section to payments page in `apps/web/src/app/parent/payments/page.tsx` - integrate `Receipts` component, fetch data via hook, add tab or section navigation
- [ ] T044 [US5] Implement receipt download/view functionality in `apps/web/src/app/parent/components/payments/Receipts.tsx` - add download button to download receipt as PDF, add view button to open receipt in browser

**Checkpoint**: Parents can now view and download receipts for their children's payments

---

## Phase 8: User Story 6 - View Payment Methods (Priority: P3)

**Goal**: Enable parents to view their saved payment methods

**Independent Test**: Navigate to payment methods view. Verify payment methods are displayed with method type, last 4 digits (for cards), expiration date (for cards), and default status. Test with no payment methods scenario.

### Tests for User Story 6

- [ ] T045 [P] [US6] Contract test for `GET /api/v1/parent/payments/methods` in `tests/contract/parent-payments.test.ts` - test access control
- [ ] T046 [P] [US6] Integration test for payment methods in `tests/integration/parent-payment-methods.test.ts` - verify payment method data accuracy
- [ ] T047 [P] [US6] E2E test for payment methods display in `tests/e2e/parent-payments.spec.ts` - test payment methods section

### Implementation for User Story 6

- [X] T048 [US6] Implement `GET /api/v1/parent/payments/methods` endpoint in `apps/api/src/routes/parent-payments.ts` - query payment methods from existing storage (if available) for authenticated parent, return method type, last 4 digits (for cards), expiration date (for cards), default status
- [X] T049 [P] [US6] Create `usePaymentMethods()` hook in `apps/web/src/lib/hooks/use-parent-payments.ts` - fetch payment methods for authenticated parent
- [X] T050 [P] [US6] Implement `PaymentMethods` component in `apps/web/src/app/parent/components/payments/PaymentMethods.tsx` - display list of payment methods, show method type, last 4 digits (for cards), expiration date (for cards), default status, handle empty state
- [X] T051 [US6] Add payment methods section to payments page in `apps/web/src/app/parent/payments/page.tsx` - integrate `PaymentMethods` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view their saved payment methods

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [X] T052 [P] Add error handling and error states to all payment components (network errors, empty states, loading states)
- [X] T053 [P] Add loading skeletons to all payment components for better UX
- [X] T054 [P] Add responsive design for payments page (mobile, tablet, desktop)
- [X] T055 [P] Add accessibility features (ARIA labels, keyboard navigation) to all payment components
- [X] T056 [P] Add unit tests for balance calculation utilities (outstanding, paid, due calculations)
- [X] T057 [P] Add performance optimizations (memoization, query optimization) for large payment datasets
- [X] T058 [P] Add logging and error tracking for payment API endpoints

**Checkpoint**: Feature complete and polished

---

## Dependencies & Execution Order

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 6 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- User Stories 1, 2, 3, 4, 5, and 6 can run in parallel (no dependencies between them)
- All Polish tasks marked [P] can run in parallel

---

## Notes

- All endpoints must verify parent-child relationship before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Outstanding balances must be calculated correctly from unpaid installments and fees
- Frontend components should support filtering by child (if parent has multiple children)
- Pagination should be implemented for large lists (20 items per page default)
- All date/time calculations should account for timezone
- Receipt download/view should handle errors gracefully
- Payment methods display is view-only (no add/modify functionality)

