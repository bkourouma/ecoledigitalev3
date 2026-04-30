# Tasks: Teacher Schedule Calendar Upgrade

**Input**: Design documents from `/specs/003-teacher-schedule-calendar/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested; include minimal E2E checks as part of manual verification.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3, US4
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare environment and baseline structures

- [ ] T001 [P] Setup dev environment: `pnpm install`, ensure DB reachable
- [ ] T002 [P] Create feature folders: `apps/api/src/routes/sessions/`, `apps/web/src/components/schedule/`
- [ ] T003 [P] Scaffold contracts package entries in `packages/contracts` for sessions types

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core prerequisites required by all stories

- [ ] T004 Define DB schema updates for `Session` if needed in `infra/scripts/migrations/` (start/end, notes)
- [ ] T005 Implement base session model/service in `apps/api/src/services/sessionsService.ts`
- [ ] T006 Setup sessions API router in `apps/api/src/routes/sessions/index.ts`
- [ ] T007 Create client service in `apps/web/src/services/schedule.ts` (list/create/update/delete)
- [ ] T008 Add shared types from `specs/003-teacher-schedule-calendar/contracts/openapi.yaml` to `packages/contracts`

**Checkpoint**: Foundation ready

---

## Phase 3: User Story 1 - Reschedule by drag-and-drop (Priority: P1) 🎯 MVP

**Goal**: Drag a session to a new date/time; validate and save if no conflicts
**Independent Test**: Move a session from 10:00 to 13:00 and see persisted change; overlap attempts are blocked

### Implementation for User Story 1

- [ ] T009 [P] [US1] API: `GET /sessions?start&end` in `apps/api/src/routes/sessions/list.ts`
- [ ] T010 [US1] API: `PATCH /sessions/:id` move start/end with conflict validation in `apps/api/src/routes/sessions/update.ts`
- [ ] T011 [US1] Service: conflict check (teacher and class) in `apps/api/src/services/sessionsService.ts`
- [ ] T012 [P] [US1] Web: Calendar widget with drag-and-drop in `apps/web/src/components/schedule/Calendar.tsx`
- [ ] T013 [US1] Web: Wire drag end to call PATCH and refresh in `apps/web/src/pages/teacher/schedule.tsx`

**Checkpoint**: US1 independently functional

---

## Phase 4: User Story 2 - Resize session duration (Priority: P1)

**Goal**: Resize edges to adjust duration; validate and save
**Independent Test**: Extend a 60-min session to 90-min; overlap blocked

### Implementation for User Story 2

- [ ] T014 [US2] API: Extend PATCH handler to accept end time changes (`update.ts`)
- [ ] T015 [P] [US2] Web: Enable resize handles; compute new end time `Calendar.tsx`
- [ ] T016 [US2] Web: Error feedback and revert on conflict `Calendar.tsx`

**Checkpoint**: US2 independently functional

---

## Phase 5: User Story 3 - Add session with cascading class → course (Priority: P1)

**Goal**: Add session using class restricted to teacher assignments and course filtered by class
**Independent Test**: Class dropdown shows only assigned classes; course dropdown filters by class; saving shows session on calendar

### Implementation for User Story 3

- [ ] T017 [P] [US3] API: `POST /sessions` create with validation in `apps/api/src/routes/sessions/create.ts`
- [ ] T018 [P] [US3] API: `GET /teachers/me/classes` in `apps/api/src/routes/teachers/classes.ts`
- [ ] T019 [P] [US3] API: `GET /classes/:id/courses` in `apps/api/src/routes/classes/courses.ts`
- [ ] T020 [US3] Web: AddSessionDialog with class→course cascade in `apps/web/src/components/schedule/AddSessionDialog.tsx`
- [ ] T021 [US3] Web: Hook dialog into page actions and refresh in `apps/web/src/pages/teacher/schedule.tsx`

**Checkpoint**: US3 independently functional

---

## Phase 6: User Story 4 - Edit/Delete session (Priority: P2)

**Goal**: Edit metadata; delete with confirmation
**Independent Test**: Edit notes and persist; delete removes item

### Implementation for User Story 4

- [ ] T022 [US4] API: Support notes update in `update.ts`
- [ ] T023 [US4] API: `DELETE /sessions/:id` in `apps/api/src/routes/sessions/delete.ts`
- [ ] T024 [P] [US4] Web: Edit/Delete actions in `apps/web/src/components/schedule/SessionDetails.tsx`
- [ ] T025 [US4] Web: Confirmation flow and refresh handling in `apps/web/src/components/schedule/SessionDetails.tsx`

**Checkpoint**: US4 independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T026 [P] Accessibility: keyboard flows for open, move, resize in `Calendar.tsx`
- [ ] T027 Telemetry: basic logging for saves/errors in API routes
- [ ] T028 [P] Docs: Update `specs/003-teacher-schedule-calendar/quickstart.md`
- [ ] T029 Performance: ensure smooth drag/resize and fast refresh

---

## Dependencies & Execution Order

- Story order: US1 (P1) → US2 (P1) → US3 (P1) → US4 (P2)
- Foundational (T004–T008) blocks all stories
- Parallel opportunities: T001–T003; within stories tasks marked [P]

## Parallel Examples

- US1: Implement `list.ts` [P] and `Calendar.tsx` [P] in parallel; `update.ts` depends on service
- US3: `POST /sessions`, `GET classes`, and `GET courses` can be built in parallel [P]

## Implementation Strategy

- MVP: Complete US1
- Then US2 for duration control
- Add US3 for create flow
- Finish US4 for edit/delete
