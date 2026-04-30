# Tasks: Parent Emergency Contacts & Authorization

**Input**: Design documents from `/specs/014-parent-emergency/`
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

- [X] T001 Create parent-emergency route file structure in `apps/api/src/routes/parent-emergency.ts`
- [X] T002 [P] Create parent emergency TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `EmergencyContact`, `ParentChildRelationship`, `PickupAuthorization`, `RelationshipType`, `DataAccess`, `EmergencyContactCreate`, `EmergencyContactUpdate`, `PickupAuthorizationUpdate`, `RelationshipTypeUpdate`
- [X] T003 [P] Create parent emergency components directory structure `apps/web/src/app/parent/components/emergency/`
- [X] T004 [P] Create parent emergency pages directory structure `apps/web/src/app/parent/emergency/`
- [X] T005 [P] Create parent emergency hooks file `apps/web/src/lib/hooks/use-parent-emergency.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentUserAccess` in `apps/api/src/routes/parent-emergency.ts` that checks authenticated user ID matches parent ID
- [X] T007 Register parent-emergency routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/emergency` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentEmergency` in `apps/web/src/lib/hooks/use-parent-emergency.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Manage Emergency Contacts (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view, add, edit, and remove emergency contacts

**Independent Test**: Log in as a parent user, navigate to `/parent/emergency` route, and verify emergency contacts are displayed with contact name, relationship, phone number, and email address. Test adding, editing, and removing emergency contacts with validation.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/emergency/contacts` in `tests/contract/parent-emergency.test.ts` - test access control, data retrieval
- [ ] T010 [P] [US1] Contract test for `POST /api/v1/parent/emergency/contacts` in `tests/contract/parent-emergency.test.ts` - test validation, access control, data creation
- [ ] T011 [P] [US1] Contract test for `PUT /api/v1/parent/emergency/contacts/:contactId` in `tests/contract/parent-emergency.test.ts` - test validation, access control, data updates
- [ ] T012 [P] [US1] Contract test for `DELETE /api/v1/parent/emergency/contacts/:contactId` in `tests/contract/parent-emergency.test.ts` - test access control, data deletion
- [ ] T013 [P] [US1] Integration test for emergency contacts CRUD operations in `tests/integration/parent-emergency-contacts.test.ts` - verify validation, CRUD operations, access control
- [ ] T014 [P] [US1] E2E test for emergency contacts management in `tests/e2e/parent-emergency.spec.ts` - test emergency contacts viewing, adding, editing, removing, validation, confirmation

### Implementation for User Story 1

- [X] T015 [US1] Implement `GET /api/v1/parent/emergency/contacts` endpoint in `apps/api/src/routes/parent-emergency.ts` - query `emergency_contacts` table for authenticated parent's emergency contacts, verify parent access, return contacts data
- [X] T016 [US1] Implement `POST /api/v1/parent/emergency/contacts` endpoint in `apps/api/src/routes/parent-emergency.ts` - create new emergency contact in `emergency_contacts` table, validate input (phone format, email format, contact name required), verify parent access, create contact
- [X] T017 [US1] Implement `PUT /api/v1/parent/emergency/contacts/:contactId` endpoint in `apps/api/src/routes/parent-emergency.ts` - update existing emergency contact in `emergency_contacts` table, validate input (phone format, email format, contact name required), verify parent access to contact, update contact
- [X] T018 [US1] Implement `DELETE /api/v1/parent/emergency/contacts/:contactId` endpoint in `apps/api/src/routes/parent-emergency.ts` - delete emergency contact from `emergency_contacts` table, verify parent access to contact, delete contact
- [X] T019 [P] [US1] Create `useEmergencyContacts()` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - fetch emergency contacts
- [X] T020 [P] [US1] Create `useAddEmergencyContact()` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - add emergency contact
- [X] T021 [P] [US1] Create `useUpdateEmergencyContact(contactId)` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - update emergency contact
- [X] T022 [P] [US1] Create `useRemoveEmergencyContact(contactId)` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - remove emergency contact
- [X] T023 [P] [US1] Implement `EmergencyContacts` component in `apps/web/src/app/parent/components/emergency/EmergencyContacts.tsx` - display list of emergency contacts, show contact name, relationship, phone, email, add add/edit/remove buttons, handle add/edit forms, add form validation, handle confirmation for removal, handle empty state
- [X] T024 [US1] Add emergency contacts section to emergency page in `apps/web/src/app/parent/emergency/page.tsx` - integrate `EmergencyContacts` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now manage their emergency contacts

---

## Phase 4: User Story 2 - Manage Pickup Authorization (Priority: P1)

**Goal**: Enable parents to view and update pickup authorization for their linked children

**Independent Test**: Navigate to pickup authorization section in emergency contacts. Verify pickup authorization is displayed with child name, relationship type, and pickup authorization status. Test updating pickup authorization with confirmation.

### Tests for User Story 2

- [ ] T025 [P] [US2] Contract test for `GET /api/v1/parent/emergency/pickup-authorization` in `tests/contract/parent-emergency.test.ts` - test access control, data retrieval
- [ ] T026 [P] [US2] Contract test for `PUT /api/v1/parent/emergency/pickup-authorization/:relationshipId` in `tests/contract/parent-emergency.test.ts` - test validation, access control, data updates
- [ ] T027 [P] [US2] Integration test for pickup authorization updates in `tests/integration/parent-pickup-authorization.test.ts` - verify validation, data updates, access control
- [ ] T028 [P] [US2] E2E test for pickup authorization display and editing in `tests/e2e/parent-emergency.spec.ts` - test pickup authorization viewing, updating, confirmation, empty state

### Implementation for User Story 2

- [X] T029 [US2] Implement `GET /api/v1/parent/emergency/pickup-authorization` endpoint in `apps/api/src/routes/parent-emergency.ts` - query `student_parents` table joined with `student_profiles` and `users` for authenticated parent's children's pickup authorization, verify parent access, return relationships data
- [X] T030 [US2] Implement `PUT /api/v1/parent/emergency/pickup-authorization/:relationshipId` endpoint in `apps/api/src/routes/parent-emergency.ts` - update `can_pickup` field in `student_parents` table for authenticated parent's relationship, validate input (can_pickup boolean), verify parent access to relationship, update pickup authorization
- [X] T031 [P] [US2] Create `usePickupAuthorization()` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - fetch pickup authorization
- [X] T032 [P] [US2] Create `useUpdatePickupAuthorization(relationshipId)` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - update pickup authorization
- [X] T033 [P] [US2] Implement `PickupAuthorization` component in `apps/web/src/app/parent/components/emergency/PickupAuthorization.tsx` - display list of relationships with pickup authorization, show child name, relationship type, pickup authorization status, add update button, handle confirmation for disabling pickup authorization, handle empty state
- [X] T034 [US2] Add pickup authorization section to emergency page in `apps/web/src/app/parent/emergency/page.tsx` - integrate `PickupAuthorization` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now manage pickup authorization for their children

---

## Phase 5: User Story 3 - Manage Relationship Types (Priority: P2)

**Goal**: Enable parents to view and update relationship types for their linked children

**Independent Test**: Navigate to relationship types section in emergency contacts. Verify relationship types are displayed with child name and relationship type. Test updating relationship types with administrative approval notification.

### Tests for User Story 3

- [ ] T035 [P] [US3] Contract test for `GET /api/v1/parent/emergency/relationship-types` in `tests/contract/parent-emergency.test.ts` - test access control, data retrieval
- [ ] T036 [P] [US3] Contract test for `PUT /api/v1/parent/emergency/relationship-types/:relationshipId` in `tests/contract/parent-emergency.test.ts` - test validation, access control, data updates
- [ ] T037 [P] [US3] Integration test for relationship types updates in `tests/integration/parent-relationship-types.test.ts` - verify validation, data updates, access control
- [ ] T038 [P] [US3] E2E test for relationship types display and editing in `tests/e2e/parent-emergency.spec.ts` - test relationship types viewing, updating, administrative approval notification, empty state

### Implementation for User Story 3

- [X] T039 [US3] Implement `GET /api/v1/parent/emergency/relationship-types` endpoint in `apps/api/src/routes/parent-emergency.ts` - query `student_parents` table joined with `student_profiles` and `users` for authenticated parent's children's relationship types, verify parent access, return relationships data
- [X] T040 [US3] Implement `PUT /api/v1/parent/emergency/relationship-types/:relationshipId` endpoint in `apps/api/src/routes/parent-emergency.ts` - update `relationship_type` field in `student_parents` table for authenticated parent's relationship, validate input (relationship_type enum), verify parent access to relationship, update relationship type, return message that change may require administrative approval
- [X] T041 [P] [US3] Create `useRelationshipTypes()` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - fetch relationship types
- [X] T042 [P] [US3] Create `useUpdateRelationshipType(relationshipId)` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - update relationship type
- [X] T043 [P] [US3] Implement `RelationshipTypes` component in `apps/web/src/app/parent/components/emergency/RelationshipTypes.tsx` - display list of relationships with relationship types, show child name, relationship type, add update button, handle relationship type selection, display message that changes may require administrative approval, handle empty state
- [X] T044 [US3] Add relationship types section to emergency page in `apps/web/src/app/parent/emergency/page.tsx` - integrate `RelationshipTypes` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now manage relationship types for their children

---

## Phase 6: User Story 4 - View Data Access (Priority: P2)

**Goal**: Enable parents to view data access information for their linked children

**Independent Test**: Navigate to data access section in emergency contacts. Verify data access information is displayed with child name, relationship type, access level, and accessible data types. Test viewing data access details.

### Tests for User Story 4

- [ ] T045 [P] [US4] Contract test for `GET /api/v1/parent/emergency/data-access` in `tests/contract/parent-emergency.test.ts` - test access control, data retrieval
- [ ] T046 [P] [US4] Integration test for data access retrieval in `tests/integration/parent-data-access.test.ts` - verify data retrieval, access control
- [ ] T047 [P] [US4] E2E test for data access display in `tests/e2e/parent-emergency.spec.ts` - test data access viewing, data access details, empty state

### Implementation for User Story 4

- [X] T048 [US4] Implement `GET /api/v1/parent/emergency/data-access` endpoint in `apps/api/src/routes/parent-emergency.ts` - query `student_parents` table joined with `student_profiles` and `users` for authenticated parent's children's relationships, derive data access from relationship type, verify parent access, return data access information
- [X] T049 [P] [US4] Create `useDataAccess()` hook in `apps/web/src/lib/hooks/use-parent-emergency.ts` - fetch data access information
- [X] T050 [P] [US4] Implement `DataAccess` component in `apps/web/src/app/parent/components/emergency/DataAccess.tsx` - display list of relationships with data access information, show child name, relationship type, access level, accessible data types, add data access details view, display message that data access changes require relationship type or authorization changes, handle empty state
- [X] T051 [US4] Add data access section to emergency page in `apps/web/src/app/parent/emergency/page.tsx` - integrate `DataAccess` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view data access information for their children

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [X] T052 [P] Add error handling and error states to all emergency components (network errors, empty states, loading states)
- [X] T053 [P] Add loading skeletons to all emergency components for better UX
- [X] T054 [P] Add responsive design for emergency page (mobile, tablet, desktop)
- [X] T055 [P] Add accessibility features (ARIA labels, keyboard navigation) to all emergency components
- [ ] T056 [P] Add unit tests for validation utilities (phone format, email format, relationship type validation)
- [X] T057 [P] Add performance optimizations (memoization, query optimization) for emergency data
- [ ] T058 [P] Add logging and error tracking for emergency API endpoints
- [X] T059 [P] Add form validation feedback (real-time validation, error messages)
- [ ] T060 [P] Add audit logging for relationship type and pickup authorization changes

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

- All endpoints must verify authenticated user ID matches parent ID before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Emergency contacts must be validated before saving (phone format, email format, contact name required)
- Pickup authorization updates must verify authenticated user ID matches parent ID
- Relationship type updates must verify authenticated user ID matches parent ID
- Relationship type updates may require administrative approval
- Data access is derived from relationship type and authorization status (view-only)
- Frontend components should support form validation with real-time feedback
- All date/time calculations should account for timezone
- Emergency contact removal should require confirmation
- Pickup authorization disabling should require confirmation
- Relationship type changes should display message that changes may require administrative approval
- Data access changes require relationship type or authorization changes
- All relationship type and pickup authorization changes should be logged for audit purposes

