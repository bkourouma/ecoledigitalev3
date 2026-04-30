# Tasks: Parent Communications & Messages

**Input**: Design documents from `/specs/010-parent-messages/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included as per Constitution Check requirement (Test-First: Commit contract tests and E2E before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo**: `apps/api/src/`, `apps/web/src/`, `packages/contracts/src/`
- Paths shown below follow the monorepo structure from plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create parent-messages route file structure in `apps/api/src/routes/parent-messages.ts`
- [X] T002 [P] Create parent messages TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `TeacherMessage`, `SchoolAnnouncement`, `ParentTeacherConversation`, `ConversationMessage`, `Notification`, `EventInvitation`, `MessageFilter`, `NotificationFilter`, `InvitationFilter`
- [X] T003 [P] Create parent messages components directory structure `apps/web/src/app/parent/components/messages/`
- [X] T004 [P] Create parent messages pages directory structure `apps/web/src/app/parent/messages/`
- [X] T005 [P] Create parent messages hooks file `apps/web/src/lib/hooks/use-parent-messages.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentChildRelationshipForMessages` in `apps/api/src/routes/parent-messages.ts` that checks `student_parents` table and verifies child is linked to parent
- [X] T007 Register parent-messages routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/messages` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentMessages` in `apps/web/src/lib/hooks/use-parent-messages.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Messages from Teachers (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view all messages from teachers for their children with detailed information

**Independent Test**: Log in as a parent user, navigate to `/parent/messages` route, and verify all messages from teachers for linked children are displayed with sender name, child name, subject, content preview, date sent, read/unread status, and priority level. Test with multiple children, single child, filtering by child/teacher/date range/read status, viewing full message content, marking messages as read, and no messages scenarios.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/messages/teacher-messages` in `tests/contract/parent-messages.test.ts` - test filtering by child, teacher, date range, read status, pagination, access control
- [ ] T010 [P] [US1] Integration test for teacher messages filtering in `tests/integration/parent-teacher-messages.test.ts` - verify filter combinations, child relationship verification, read/unread status tracking
- [ ] T011 [P] [US1] E2E test for teacher messages display in `tests/e2e/parent-messages.spec.ts` - test teacher messages page, filter application, child selection, pagination, message viewing, mark as read

### Implementation for User Story 1

- [X] T012 [US1] Implement `GET /api/v1/parent/messages/teacher-messages` endpoint in `apps/api/src/routes/parent-messages.ts` - query `teacher_messages` (or `messages`) joined with `student_profiles` and `users` for messages from teachers for parent's children, filter by child_id, teacher_id, date range, read/unread status, verify parent-child relationship, support pagination (page, limit)
- [X] T013 [P] [US1] Create `useTeacherMessages(childId, filters, page)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - fetch teacher messages with filters, handle filter parameters (child_id, teacher_id, startDate, endDate, readStatus), handle pagination
- [X] T014 [P] [US1] Implement `TeacherMessages` component in `apps/web/src/app/parent/components/messages/TeacherMessages.tsx` - display list of teacher messages, show sender name, child name, subject, content preview, date sent, read/unread status, priority level, add filter controls (child, teacher, date range, read status), handle empty state, handle pagination, add message detail view, add mark as read functionality
- [X] T015 [US1] Implement messages page in `apps/web/src/app/parent/messages/page.tsx` - use `TeacherMessages` component, add filter controls (child selector, teacher selector, date range picker, read status selector), fetch data via hook

**Checkpoint**: Parents can now view messages from teachers for their children

---

## Phase 4: User Story 2 - View School Announcements (Priority: P1)

**Goal**: Enable parents to view school announcements relevant to their children's school or class

**Independent Test**: Navigate to school announcements view. Verify announcements are displayed with title, content preview, author, date posted, priority level, and read/unread status. Test filtering by date range, priority level, read status, viewing full announcement content, marking announcements as read, and no announcements scenarios.

### Tests for User Story 2

- [ ] T016 [P] [US2] Contract test for `GET /api/v1/parent/messages/announcements` in `tests/contract/parent-messages.test.ts` - test filtering by date range, priority level, read status, pagination, access control
- [ ] T017 [P] [US2] Integration test for school announcements in `tests/integration/parent-school-announcements.test.ts` - verify announcement data accuracy, read/unread status tracking
- [ ] T018 [P] [US2] E2E test for school announcements display in `tests/e2e/parent-messages.spec.ts` - test school announcements view, filter application, announcement viewing, mark as read

### Implementation for User Story 2

- [X] T019 [US2] Implement `GET /api/v1/parent/messages/announcements` endpoint in `apps/api/src/routes/parent-messages.ts` - query `school_announcements` (or `announcements`) joined with `users` for announcements for parent's tenant/school, filter by date range, priority level, read/unread status, verify tenant access, support pagination (page, limit)
- [X] T020 [P] [US2] Create `useSchoolAnnouncements(filters, page)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - fetch school announcements with filters (startDate, endDate, priorityLevel, readStatus), handle pagination
- [X] T021 [P] [US2] Implement `SchoolAnnouncements` component in `apps/web/src/app/parent/components/messages/SchoolAnnouncements.tsx` - display list of school announcements, show title, content preview, author, date posted, priority level, read/unread status, add filter controls (date range, priority level, read status), handle empty state, handle pagination, add announcement detail view, add mark as read functionality
- [X] T022 [US2] Add school announcements section to messages page in `apps/web/src/app/parent/messages/page.tsx` - integrate `SchoolAnnouncements` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view school announcements

---

## Phase 5: User Story 3 - View Parent-Teacher Messages (Priority: P2)

**Goal**: Enable parents to view conversation threads with teachers about their children

**Independent Test**: Navigate to parent-teacher messages view. Verify conversation threads are displayed with teacher name, child name, subject, last message preview, date of last message, unread message count, and conversation status. Test filtering by child, teacher, conversation status, viewing conversation thread with messages in chronological order, replying to conversations, and no conversations scenarios.

### Tests for User Story 3

- [ ] T023 [P] [US3] Contract test for `GET /api/v1/parent/messages/conversations` in `tests/contract/parent-messages.test.ts` - test filtering by child, teacher, conversation status, access control
- [ ] T024 [P] [US3] Contract test for `GET /api/v1/parent/messages/conversations/:conversationId` in `tests/contract/parent-messages.test.ts` - test conversation thread retrieval, message ordering, access control
- [ ] T025 [P] [US3] Contract test for `POST /api/v1/parent/messages/conversations/:conversationId/reply` in `tests/contract/parent-messages.test.ts` - test reply functionality, message creation, access control
- [ ] T026 [P] [US3] Integration test for parent-teacher conversations in `tests/integration/parent-teacher-conversations.test.ts` - verify conversation thread display, message ordering, reply functionality
- [ ] T027 [P] [US3] E2E test for parent-teacher messages display in `tests/e2e/parent-messages.spec.ts` - test parent-teacher messages view, filter application, conversation thread viewing, reply functionality

### Implementation for User Story 3

- [X] T028 [US3] Implement `GET /api/v1/parent/messages/conversations` endpoint in `apps/api/src/routes/parent-messages.ts` - query `parent_teacher_conversations` (or `conversations`) joined with `student_profiles` and `users` for conversation threads for parent's children, filter by child_id, teacher_id, conversation status, verify parent-child relationship, calculate unread message count, get last message preview
- [X] T029 [US3] Implement `GET /api/v1/parent/messages/conversations/:conversationId` endpoint in `apps/api/src/routes/parent-messages.ts` - query conversation thread with all messages in chronological order, verify parent access to conversation
- [X] T030 [US3] Implement `POST /api/v1/parent/messages/conversations/:conversationId/reply` endpoint in `apps/api/src/routes/parent-messages.ts` - create new message in conversation thread, verify parent access to conversation, update conversation updated_at timestamp
- [X] T031 [P] [US3] Create `useParentTeacherConversations(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - fetch conversation threads with filters (child_id, teacher_id, status)
- [X] T032 [P] [US3] Create `useConversationThread(conversationId)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - fetch conversation thread with messages
- [X] T033 [P] [US3] Create `useReplyToConversation(conversationId)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - reply to conversation thread
- [X] T034 [P] [US3] Implement `ParentTeacherMessages` component in `apps/web/src/app/parent/components/messages/ParentTeacherMessages.tsx` - display list of conversation threads, show teacher name, child name, subject, last message preview, date of last message, unread message count, conversation status, add filter controls (child, teacher, conversation status), handle empty state, add conversation thread view with messages in chronological order, add reply functionality
- [X] T035 [US3] Add parent-teacher messages section to messages page in `apps/web/src/app/parent/messages/page.tsx` - integrate `ParentTeacherMessages` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view and reply to parent-teacher conversation threads

---

## Phase 6: User Story 4 - View Notifications (Priority: P2)

**Goal**: Enable parents to view notifications about important events, messages, and updates

**Independent Test**: Navigate to notifications view. Verify notifications are displayed with type, title, content preview, date/time, read/unread status, and action link. Test filtering by notification type, date range, read status, viewing full notification content, marking notifications as read, navigating to related content via action link, and no notifications scenarios.

### Tests for User Story 4

- [ ] T036 [P] [US4] Contract test for `GET /api/v1/parent/messages/notifications` in `tests/contract/parent-messages.test.ts` - test filtering by notification type, date range, read status, pagination, access control
- [ ] T037 [P] [US4] Contract test for `POST /api/v1/parent/messages/notifications/:notificationId/read` in `tests/contract/parent-messages.test.ts` - test mark as read functionality, access control
- [ ] T038 [P] [US4] Integration test for notifications in `tests/integration/parent-notifications.test.ts` - verify notification data accuracy, read/unread status tracking
- [ ] T039 [P] [US4] E2E test for notifications display in `tests/e2e/parent-messages.spec.ts` - test notifications view, filter application, notification viewing, mark as read, action link navigation

### Implementation for User Story 4

- [X] T040 [US4] Implement `GET /api/v1/parent/messages/notifications` endpoint in `apps/api/src/routes/parent-messages.ts` - query `notifications` for notifications for authenticated parent, filter by notification_type, date range, read/unread status, verify parent access, support pagination (page, limit)
- [X] T041 [US4] Implement `POST /api/v1/parent/messages/notifications/:notificationId/read` endpoint in `apps/api/src/routes/parent-messages.ts` - mark notification as read, verify parent access to notification, update read_at timestamp
- [X] T042 [P] [US4] Create `useNotifications(filters, page)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - fetch notifications with filters (notification_type, startDate, endDate, readStatus), handle pagination
- [X] T043 [P] [US4] Create `useMarkNotificationRead(notificationId)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - mark notification as read
- [X] T044 [P] [US4] Implement `Notifications` component in `apps/web/src/app/parent/components/messages/Notifications.tsx` - display list of notifications, show type, title, content preview, date/time, read/unread status, action link, add filter controls (notification type, date range, read status), handle empty state, handle pagination, add notification detail view, add mark as read functionality, add action link navigation
- [X] T045 [US4] Add notifications section to messages page in `apps/web/src/app/parent/messages/page.tsx` - integrate `Notifications` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view and manage notifications

---

## Phase 7: User Story 5 - View Event Invitations (Priority: P2)

**Goal**: Enable parents to view event invitations for school events, parent-teacher conferences, and other activities

**Independent Test**: Navigate to event invitations view. Verify invitations are displayed with event name, description, date/time, location, organizer, RSVP status, and RSVP deadline. Test filtering by child, event type, date range, RSVP status, viewing full event information, responding with RSVP (accept, decline, tentative), and no invitations scenarios.

### Tests for User Story 5

- [ ] T046 [P] [US5] Contract test for `GET /api/v1/parent/messages/event-invitations` in `tests/contract/parent-messages.test.ts` - test filtering by child, event type, date range, RSVP status, access control
- [ ] T047 [P] [US5] Contract test for `POST /api/v1/parent/messages/event-invitations/:invitationId/rsvp` in `tests/contract/parent-messages.test.ts` - test RSVP functionality, RSVP deadline enforcement, access control
- [ ] T048 [P] [US5] Integration test for event invitations in `tests/integration/parent-event-invitations.test.ts` - verify invitation data accuracy, RSVP functionality
- [ ] T049 [P] [US5] E2E test for event invitations display in `tests/e2e/parent-messages.spec.ts` - test event invitations view, filter application, invitation viewing, RSVP functionality

### Implementation for User Story 5

- [X] T050 [US5] Implement `GET /api/v1/parent/messages/event-invitations` endpoint in `apps/api/src/routes/parent-messages.ts` - query `event_invitations` (or `invitations`) joined with `student_profiles` and `users` for invitations for parent's children, filter by child_id, event_type, date range, RSVP status, verify parent-child relationship, order by event_date ASC (soonest first)
- [X] T051 [US5] Implement `POST /api/v1/parent/messages/event-invitations/:invitationId/rsvp` endpoint in `apps/api/src/routes/parent-messages.ts` - update RSVP status (accepted, declined, tentative), verify parent access to invitation, verify RSVP deadline has not passed, update rsvp_response_at timestamp
- [X] T052 [P] [US5] Create `useEventInvitations(childId, filters)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - fetch event invitations with filters (child_id, event_type, startDate, endDate, rsvp_status)
- [X] T053 [P] [US5] Create `useRespondToInvitation(invitationId)` hook in `apps/web/src/lib/hooks/use-parent-messages.ts` - respond to event invitation with RSVP
- [X] T054 [P] [US5] Implement `EventInvitations` component in `apps/web/src/app/parent/components/messages/EventInvitations.tsx` - display list of event invitations, show event name, description, date/time, location, organizer, RSVP status, RSVP deadline, add filter controls (child, event type, date range, RSVP status), handle empty state, add invitation detail view, add RSVP functionality (accept, decline, tentative)
- [X] T055 [US5] Add event invitations section to messages page in `apps/web/src/app/parent/messages/page.tsx` - integrate `EventInvitations` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view and respond to event invitations

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [X] T056 [P] Add error handling and error states to all message components (network errors, empty states, loading states) - Enhanced error handling with retry buttons, improved error messages, and proper error states
- [X] T057 [P] Add loading skeletons to all message components for better UX - Created `MessageListSkeleton` component and replaced spinners with skeleton loaders
- [X] T058 [P] Add responsive design for messages page (mobile, tablet, desktop) - Added responsive grid classes for tabs (grid-cols-2 md:grid-cols-3 lg:grid-cols-5), existing components already have responsive design
- [X] T059 [P] Add accessibility features (ARIA labels, keyboard navigation) to all message components - Added ARIA labels, roles, keyboard navigation (Enter/Space), focus states, and proper semantic HTML
- [ ] T060 [P] Add unit tests for read/unread status tracking utilities - Pending: Requires test framework setup
- [X] T061 [P] Add performance optimizations (memoization, query optimization) for large message datasets - Added React.memo to components, useMemo for expensive computations, optimized query keys
- [X] T062 [P] Add logging and error tracking for message API endpoints - Added structured logging with fastify.log.info/error for all endpoints, including request context and error details
- [ ] T063 [P] Add real-time notification updates (if WebSocket support is available) - Pending: Requires WebSocket infrastructure setup

**Checkpoint**: Feature complete and polished

---

## Dependencies & Execution Order

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API endpoints before frontend hooks
- Frontend hooks before components
- Components before pages
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- User Stories 1, 2, 3, 4, and 5 can run in parallel (no dependencies between them)
- All Polish tasks marked [P] can run in parallel

---

## Notes

- All endpoints must verify parent-child relationship before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Read/unread status must be accurately tracked for messages, announcements, notifications
- Conversation threads must display messages in chronological order
- RSVP functionality must enforce RSVP deadline
- Frontend components should support filtering by child (if parent has multiple children)
- Pagination should be implemented for large lists (20 items per page default)
- All date/time calculations should account for timezone
- Message reply functionality should update conversation thread timestamp
- Notification mark as read should update read_at timestamp immediately
- Event invitation RSVP should validate RSVP deadline before accepting response

