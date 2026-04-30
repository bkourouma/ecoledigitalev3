# Tasks: Parent Reports & Documents

**Input**: Design documents from `/specs/013-parent-documents/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included as per Constitution Check requirement (Test-First: Commit contract tests and E2E before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create parent-documents route file structure in `apps/api/src/routes/parent-documents.ts`
- [X] T002 [P] Create parent documents TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `ReportCard`, `Transcript`, `AttendanceReport`, `PaymentReceipt`, `ReportCardFilter`, `TranscriptFilter`, `AttendanceReportFilter`, `PaymentReceiptFilter`
- [X] T003 [P] Create parent documents components directory structure `apps/web/src/app/parent/components/documents/`
- [X] T004 [P] Create parent documents pages directory structure `apps/web/src/app/parent/documents/`
- [X] T005 [P] Create parent documents hooks file `apps/web/src/lib/hooks/use-parent-documents.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentChildAccess` in `apps/api/src/routes/parent-documents.ts` that checks authenticated user ID matches parent ID through `student_parents` relationship
- [X] T007 Register parent-documents routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/documents` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentDocuments` in `apps/web/src/lib/hooks/use-parent-documents.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Report Cards (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view report cards for their children

**Independent Test**: Log in as a parent user, navigate to `/parent/documents` route, and verify report cards are displayed with child name, academic year, semester, report date, overall grade, and download/view capability. Test filtering by child, academic year, and semester.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/documents/report-cards` in `tests/contract/parent-documents.test.ts` - test access control, data retrieval, filtering
- [ ] T010 [P] [US1] Integration test for report cards filtering in `tests/integration/parent-report-cards.test.ts` - verify filtering, access control, data retrieval
- [ ] T011 [P] [US1] E2E test for report cards display in `tests/e2e/parent-documents.spec.ts` - test report cards viewing, filtering, download/view capability, empty state

### Implementation for User Story 1

- [X] T012 [US1] Implement `GET /api/v1/parent/documents/report-cards` endpoint in `apps/api/src/routes/parent-documents.ts` - query `report_cards` table (or generate from `assignment_submissions`) joined with `student_profiles`, `student_parents`, and `academic_years` for authenticated parent's children's report cards, verify parent-child relationship, support filtering by child, academic year, semester, return report cards data
- [X] T013 [P] [US1] Create `useReportCards(childId?, academicYearId?, semester?)` hook in `apps/web/src/lib/hooks/use-parent-documents.ts` - fetch report cards with filtering support
- [X] T014 [P] [US1] Implement `ReportCards` component in `apps/web/src/app/parent/components/documents/ReportCards.tsx` - display list of report cards, show child name, academic year, semester, report date, overall grade, download/view buttons, add filtering by child, academic year, semester, handle download/view capability, handle empty state
- [X] T015 [US1] Add report cards section to documents page in `apps/web/src/app/parent/documents/page.tsx` - integrate `ReportCards` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view report cards for their children

---

## Phase 4: User Story 2 - View Transcripts (Priority: P1)

**Goal**: Enable parents to view transcripts for their children

**Independent Test**: Navigate to transcripts section in documents. Verify transcripts are displayed with child name, academic year, transcript date, total credits, GPA, and download/view capability. Test filtering by child and academic year.

### Tests for User Story 2

- [ ] T016 [P] [US2] Contract test for `GET /api/v1/parent/documents/transcripts` in `tests/contract/parent-documents.test.ts` - test access control, data retrieval, filtering
- [ ] T017 [P] [US2] Integration test for transcripts filtering in `tests/integration/parent-transcripts.test.ts` - verify filtering, access control, data retrieval
- [ ] T018 [P] [US2] E2E test for transcripts display in `tests/e2e/parent-documents.spec.ts` - test transcripts viewing, filtering, download/view capability, empty state

### Implementation for User Story 2

- [X] T019 [US2] Implement `GET /api/v1/parent/documents/transcripts` endpoint in `apps/api/src/routes/parent-documents.ts` - query `transcripts` table (or generate from completed courses and grades) joined with `student_profiles`, `student_parents`, and `academic_years` for authenticated parent's children's transcripts, verify parent-child relationship, support filtering by child, academic year, return transcripts data
- [X] T020 [P] [US2] Create `useTranscripts(childId?, academicYearId?)` hook in `apps/web/src/lib/hooks/use-parent-documents.ts` - fetch transcripts with filtering support
- [X] T021 [P] [US2] Implement `Transcripts` component in `apps/web/src/app/parent/components/documents/Transcripts.tsx` - display list of transcripts, show child name, academic year, transcript date, total credits, GPA, download/view buttons, add filtering by child, academic year, handle download/view capability, handle empty state
- [X] T022 [US2] Add transcripts section to documents page in `apps/web/src/app/parent/documents/page.tsx` - integrate `Transcripts` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view transcripts for their children

---

## Phase 5: User Story 3 - View Attendance Reports (Priority: P2)

**Goal**: Enable parents to view attendance reports for their children

**Independent Test**: Navigate to attendance reports section in documents. Verify attendance reports are displayed with child name, academic year, report period, report date, attendance rate, total days, present days, absent days, and download/view capability. Test filtering by child, academic year, and date range.

### Tests for User Story 3

- [ ] T023 [P] [US3] Contract test for `GET /api/v1/parent/documents/attendance-reports` in `tests/contract/parent-documents.test.ts` - test access control, data retrieval, filtering
- [ ] T024 [P] [US3] Integration test for attendance reports filtering in `tests/integration/parent-attendance-reports.test.ts` - verify filtering, access control, data retrieval
- [ ] T025 [P] [US3] E2E test for attendance reports display in `tests/e2e/parent-documents.spec.ts` - test attendance reports viewing, filtering, download/view capability, empty state

### Implementation for User Story 3

- [X] T026 [US3] Implement `GET /api/v1/parent/documents/attendance-reports` endpoint in `apps/api/src/routes/parent-documents.ts` - query `attendance_reports` table (or generate from `attendance_records`) joined with `student_profiles`, `student_parents`, and `academic_years` for authenticated parent's children's attendance reports, verify parent-child relationship, support filtering by child, academic year, date range, return attendance reports data
- [X] T027 [P] [US3] Create `useAttendanceReports(childId?, academicYearId?, startDate?, endDate?)` hook in `apps/web/src/lib/hooks/use-parent-documents.ts` - fetch attendance reports with filtering support
- [X] T028 [P] [US3] Implement `AttendanceReports` component in `apps/web/src/app/parent/components/documents/AttendanceReports.tsx` - display list of attendance reports, show child name, academic year, report period, report date, attendance rate, total days, present days, absent days, download/view buttons, add filtering by child, academic year, date range, handle download/view capability, handle empty state
- [X] T029 [US3] Add attendance reports section to documents page in `apps/web/src/app/parent/documents/page.tsx` - integrate `AttendanceReports` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view attendance reports for their children

---

## Phase 6: User Story 4 - View Payment Receipts (Priority: P2)

**Goal**: Enable parents to view payment receipts for their children's payments

**Independent Test**: Navigate to payment receipts section in documents. Verify payment receipts are displayed with child name, receipt number, payment date, amount, payment method, fee type, academic year, and download/view capability. Test filtering by child, academic year, and date range.

### Tests for User Story 4

- [ ] T030 [P] [US4] Contract test for `GET /api/v1/parent/documents/payment-receipts` in `tests/contract/parent-documents.test.ts` - test access control, data retrieval, filtering
- [ ] T031 [P] [US4] Integration test for payment receipts filtering in `tests/integration/parent-payment-receipts.test.ts` - verify filtering, access control, data retrieval
- [ ] T032 [P] [US4] E2E test for payment receipts display in `tests/e2e/parent-documents.spec.ts` - test payment receipts viewing, filtering, download/view capability, empty state

### Implementation for User Story 4

- [X] T033 [US4] Implement `GET /api/v1/parent/documents/payment-receipts` endpoint in `apps/api/src/routes/parent-documents.ts` - query `payment_receipts` table joined with `payment_transactions`, `student_profiles`, `student_parents`, and `academic_years` for authenticated parent's children's payment receipts, verify parent-child relationship, support filtering by child, academic year, date range, return payment receipts data
- [X] T034 [P] [US4] Create `usePaymentReceipts(childId?, academicYearId?, startDate?, endDate?)` hook in `apps/web/src/lib/hooks/use-parent-documents.ts` - fetch payment receipts with filtering support
- [X] T035 [P] [US4] Implement `PaymentReceipts` component in `apps/web/src/app/parent/components/documents/PaymentReceipts.tsx` - display list of payment receipts, show child name, receipt number, payment date, amount, payment method, fee type, academic year, download/view buttons, add filtering by child, academic year, date range, handle download/view capability, handle empty state
- [X] T036 [US4] Add payment receipts section to documents page in `apps/web/src/app/parent/documents/page.tsx` - integrate `PaymentReceipts` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view payment receipts for their children's payments

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [X] T037 [P] Add error handling and error states to all documents components (network errors, empty states, loading states)
- [X] T038 [P] Add loading skeletons to all documents components for better UX
- [X] T039 [P] Add responsive design for documents page (mobile, tablet, desktop)
- [X] T040 [P] Add accessibility features (ARIA labels, keyboard navigation) to all documents components
- [ ] T041 [P] Add unit tests for filtering utilities (date range, child filter, academic year filter, etc.)
- [X] T042 [P] Add performance optimizations (memoization, query optimization) for documents data
- [X] T043 [P] Add logging and error tracking for documents API endpoints
- [ ] T044 [P] Add PDF viewer component for document viewing (if not using existing library)
- [ ] T045 [P] Add report generation service for on-demand report generation (if needed)

**Checkpoint**: Feature complete and polished

---

## Dependencies & Execution Order

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- User Stories 1, 2, 3, and 4 can run in parallel (no dependencies between them)
- All Polish tasks marked [P] can run in parallel

---

## Notes

- All endpoints must verify authenticated user ID matches parent ID through `student_parents` relationship before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Report cards may be stored in `report_cards` table or generated on-demand from `assignment_submissions` and grades data
- Transcripts may be stored in `transcripts` table or generated on-demand from completed courses and grades data
- Attendance reports may be stored in `attendance_reports` table or generated on-demand from `attendance_records` data
- Payment receipts already exist in `payment_receipts` table, just need to query them
- Reports should be downloadable as PDF and viewable in browser
- Report generation service may need to be created or extended for on-demand generation
- Frontend components should support filtering with real-time updates
- All date/time calculations should account for timezone
- Report download/view capability should support different formats (PDF, HTML, etc.)
- Reports should be sorted by date (most recent first)

