# Tasks: Parent Profile & Settings

**Input**: Design documents from `/specs/011-parent-settings/`
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

- [X] T001 Create parent-settings route file structure in `apps/api/src/routes/parent-settings.ts`
- [X] T002 [P] Create parent settings TypeScript contracts in `packages/contracts/src/parent.ts` with interfaces: `ParentProfile`, `ContactInformation`, `EmergencyContact`, `NotificationPreference`, `ParentChildRelationship`, `ProfileUpdate`, `ContactUpdate`, `EmergencyContactCreate`, `EmergencyContactUpdate`, `NotificationPreferencesUpdate`, `PasswordChange`
- [X] T003 [P] Create parent settings components directory structure `apps/web/src/app/parent/components/settings/`
- [X] T004 [P] Create parent settings pages directory structure `apps/web/src/app/parent/settings/`
- [X] T005 [P] Create parent settings hooks file `apps/web/src/lib/hooks/use-parent-settings.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create shared access control utility function `verifyParentUserAccess` in `apps/api/src/routes/parent-settings.ts` that checks authenticated user ID matches parent ID
- [X] T007 Register parent-settings routes in `apps/api/src/index.ts` with prefix `/api/v1/parent/settings` and ensure auth middleware is applied
- [X] T008 [P] Create base React hook `useParentSettings` in `apps/web/src/lib/hooks/use-parent-settings.ts` with TanStack Query setup for API calls

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View and Edit Parent Profile (Priority: P1) 🎯 MVP

**Goal**: Enable parents to view and edit their profile information

**Independent Test**: Log in as a parent user, navigate to `/parent/settings` route, and verify profile information is displayed with name, email, phone number, address, date of birth, and profile picture (if available). Test editing profile information, validation errors, saving changes, canceling changes, and no profile picture scenarios.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `GET /api/v1/parent/settings/profile` in `tests/contract/parent-settings.test.ts` - test access control, data retrieval
- [ ] T010 [P] [US1] Contract test for `PUT /api/v1/parent/settings/profile` in `tests/contract/parent-settings.test.ts` - test validation, access control, data updates
- [ ] T011 [P] [US1] Integration test for parent profile updates in `tests/integration/parent-profile.test.ts` - verify validation, data updates, access control
- [ ] T012 [P] [US1] E2E test for parent profile display and editing in `tests/e2e/parent-settings.spec.ts` - test profile viewing, editing, validation, saving, canceling

### Implementation for User Story 1

- [X] T013 [US1] Implement `GET /api/v1/parent/settings/profile` endpoint in `apps/api/src/routes/parent-settings.ts` - query `users` table for authenticated parent's profile information, verify parent access, return profile data
- [X] T014 [US1] Implement `PUT /api/v1/parent/settings/profile` endpoint in `apps/api/src/routes/parent-settings.ts` - update `users` table for authenticated parent's profile information, validate input (email format, phone format, address format), verify parent access, update profile data
- [X] T015 [P] [US1] Create `useParentProfile()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - fetch parent profile information
- [X] T016 [P] [US1] Create `useUpdateParentProfile()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - update parent profile information
- [X] T017 [P] [US1] Implement `ParentProfile` component in `apps/web/src/app/parent/components/settings/ParentProfile.tsx` - display parent profile information, show name, email, phone, address, date of birth, profile picture (if available), add edit button, handle edit mode, add form validation, handle save and cancel, handle empty states
- [X] T018 [US1] Add parent profile section to settings page in `apps/web/src/app/parent/settings/page.tsx` - integrate `ParentProfile` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view and edit their profile information

---

## Phase 4: User Story 2 - View and Edit Contact Information (Priority: P1)

**Goal**: Enable parents to view and edit their contact information

**Independent Test**: Navigate to contact information section in settings. Verify contact information is displayed with phone number, email address, and mailing address. Test editing contact information, validation errors, saving changes, and canceling changes.

### Tests for User Story 2

- [ ] T019 [P] [US2] Contract test for `GET /api/v1/parent/settings/contact` in `tests/contract/parent-settings.test.ts` - test access control, data retrieval
- [ ] T020 [P] [US2] Contract test for `PUT /api/v1/parent/settings/contact` in `tests/contract/parent-settings.test.ts` - test validation, access control, data updates
- [ ] T021 [P] [US2] Integration test for contact information updates in `tests/integration/parent-contact.test.ts` - verify validation, data updates, access control
- [ ] T022 [P] [US2] E2E test for contact information display and editing in `tests/e2e/parent-settings.spec.ts` - test contact viewing, editing, validation, saving, canceling

### Implementation for User Story 2

- [X] T023 [US2] Implement `GET /api/v1/parent/settings/contact` endpoint in `apps/api/src/routes/parent-settings.ts` - query `users` table for authenticated parent's contact information, verify parent access, return contact data
- [X] T024 [US2] Implement `PUT /api/v1/parent/settings/contact` endpoint in `apps/api/src/routes/parent-settings.ts` - update `users` table for authenticated parent's contact information, validate input (email format, phone format, address format), verify parent access, update contact data
- [X] T025 [P] [US2] Create `useContactInformation()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - fetch contact information
- [X] T026 [P] [US2] Create `useUpdateContactInformation()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - update contact information
- [X] T027 [P] [US2] Implement `ContactInformation` component in `apps/web/src/app/parent/components/settings/ContactInformation.tsx` - display contact information, show phone, email, address, add edit button, handle edit mode, add form validation, handle save and cancel, handle empty states
- [X] T028 [US2] Add contact information section to settings page in `apps/web/src/app/parent/settings/page.tsx` - integrate `ContactInformation` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view and edit their contact information

---

## Phase 5: User Story 3 - Manage Emergency Contacts (Priority: P2)

**Goal**: Enable parents to view, add, edit, and remove emergency contacts

**Independent Test**: Navigate to emergency contacts section in settings. Verify emergency contacts are displayed with contact name, relationship, phone number, and email address. Test adding new emergency contacts, editing existing contacts, removing contacts with confirmation, validation errors, and no emergency contacts scenarios.

### Tests for User Story 3

- [ ] T029 [P] [US3] Contract test for `GET /api/v1/parent/settings/emergency-contacts` in `tests/contract/parent-settings.test.ts` - test access control, data retrieval
- [ ] T030 [P] [US3] Contract test for `POST /api/v1/parent/settings/emergency-contacts` in `tests/contract/parent-settings.test.ts` - test validation, access control, data creation
- [ ] T031 [P] [US3] Contract test for `PUT /api/v1/parent/settings/emergency-contacts/:contactId` in `tests/contract/parent-settings.test.ts` - test validation, access control, data updates
- [ ] T032 [P] [US3] Contract test for `DELETE /api/v1/parent/settings/emergency-contacts/:contactId` in `tests/contract/parent-settings.test.ts` - test access control, data deletion
- [ ] T033 [P] [US3] Integration test for emergency contacts CRUD operations in `tests/integration/parent-emergency-contacts.test.ts` - verify validation, CRUD operations, access control
- [ ] T034 [P] [US3] E2E test for emergency contacts management in `tests/e2e/parent-settings.spec.ts` - test emergency contacts viewing, adding, editing, removing, validation, confirmation

### Implementation for User Story 3

- [X] T035 [US3] Implement `GET /api/v1/parent/settings/emergency-contacts` endpoint in `apps/api/src/routes/parent-settings.ts` - query `emergency_contacts` table for authenticated parent's emergency contacts, verify parent access, return contacts data
- [X] T036 [US3] Implement `POST /api/v1/parent/settings/emergency-contacts` endpoint in `apps/api/src/routes/parent-settings.ts` - create new emergency contact in `emergency_contacts` table, validate input (phone format, email format, contact name required), verify parent access, create contact
- [X] T037 [US3] Implement `PUT /api/v1/parent/settings/emergency-contacts/:contactId` endpoint in `apps/api/src/routes/parent-settings.ts` - update existing emergency contact in `emergency_contacts` table, validate input (phone format, email format, contact name required), verify parent access to contact, update contact
- [X] T038 [US3] Implement `DELETE /api/v1/parent/settings/emergency-contacts/:contactId` endpoint in `apps/api/src/routes/parent-settings.ts` - delete emergency contact from `emergency_contacts` table, verify parent access to contact, delete contact
- [X] T039 [P] [US3] Create `useEmergencyContacts()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - fetch emergency contacts
- [X] T040 [P] [US3] Create `useAddEmergencyContact()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - add emergency contact
- [X] T041 [P] [US3] Create `useUpdateEmergencyContact(contactId)` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - update emergency contact
- [X] T042 [P] [US3] Create `useRemoveEmergencyContact(contactId)` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - remove emergency contact
- [X] T043 [P] [US3] Implement `EmergencyContacts` component in `apps/web/src/app/parent/components/settings/EmergencyContacts.tsx` - display list of emergency contacts, show contact name, relationship, phone, email, add add/edit/remove buttons, handle add/edit forms, add form validation, handle confirmation for removal, handle empty state
- [X] T044 [US3] Add emergency contacts section to settings page in `apps/web/src/app/parent/settings/page.tsx` - integrate `EmergencyContacts` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now manage their emergency contacts

---

## Phase 6: User Story 4 - Manage Notification Preferences (Priority: P2)

**Goal**: Enable parents to view and configure their notification preferences

**Independent Test**: Navigate to notification preferences section in settings. Verify notification preferences are displayed organized by notification type with options to enable/disable notifications and choose delivery methods. Test updating preferences, saving changes, and preference persistence.

### Tests for User Story 4

- [ ] T045 [P] [US4] Contract test for `GET /api/v1/parent/settings/notification-preferences` in `tests/contract/parent-settings.test.ts` - test access control, data retrieval
- [ ] T046 [P] [US4] Contract test for `PUT /api/v1/parent/settings/notification-preferences` in `tests/contract/parent-settings.test.ts` - test validation, access control, data updates
- [ ] T047 [P] [US4] Integration test for notification preferences updates in `tests/integration/parent-notification-preferences.test.ts` - verify validation, data updates, access control
- [ ] T048 [P] [US4] E2E test for notification preferences display and editing in `tests/e2e/parent-settings.spec.ts` - test preferences viewing, editing, saving, persistence

### Implementation for User Story 4

- [X] T049 [US4] Implement `GET /api/v1/parent/settings/notification-preferences` endpoint in `apps/api/src/routes/parent-settings.ts` - query `notification_preferences` table for authenticated parent's preferences, verify parent access, return preferences data, create default preferences if none exist
- [X] T050 [US4] Implement `PUT /api/v1/parent/settings/notification-preferences` endpoint in `apps/api/src/routes/parent-settings.ts` - update `notification_preferences` table for authenticated parent's preferences, validate input (notification type, enabled status, delivery methods), verify parent access, update or create preferences
- [X] T051 [P] [US4] Create `useNotificationPreferences()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - fetch notification preferences
- [X] T052 [P] [US4] Create `useUpdateNotificationPreferences()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - update notification preferences
- [X] T053 [P] [US4] Implement `NotificationPreferences` component in `apps/web/src/app/parent/components/settings/NotificationPreferences.tsx` - display notification preferences organized by notification type, show enable/disable toggles, show delivery method options (email, in-app, SMS), add save button, handle form validation, handle empty states, handle default preferences
- [X] T054 [US4] Add notification preferences section to settings page in `apps/web/src/app/parent/settings/page.tsx` - integrate `NotificationPreferences` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now manage their notification preferences

---

## Phase 7: User Story 5 - View Relationship Management (Priority: P2)

**Goal**: Enable parents to view their linked children and relationship information

**Independent Test**: Navigate to relationship management section in settings. Verify relationship information is displayed with child name, relationship type, primary contact status, emergency contact status, and pickup authorization. Test viewing relationship details and no linked children scenarios.

### Tests for User Story 5

- [ ] T055 [P] [US5] Contract test for `GET /api/v1/parent/settings/relationships` in `tests/contract/parent-settings.test.ts` - test access control, data retrieval
- [ ] T056 [P] [US5] Integration test for relationship management in `tests/integration/parent-relationships.test.ts` - verify data retrieval, access control
- [ ] T057 [P] [US5] E2E test for relationship management display in `tests/e2e/parent-settings.spec.ts` - test relationship viewing, relationship details, empty state

### Implementation for User Story 5

- [X] T058 [US5] Implement `GET /api/v1/parent/settings/relationships` endpoint in `apps/api/src/routes/parent-settings.ts` - query `student_parents` table joined with `student_profiles` and `users` for authenticated parent's relationships, verify parent access, return relationships data
- [X] T059 [P] [US5] Create `useRelationships()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - fetch relationship management information
- [X] T060 [P] [US5] Implement `RelationshipManagement` component in `apps/web/src/app/parent/components/settings/RelationshipManagement.tsx` - display list of relationships, show child name, relationship type, primary contact status, emergency contact status, pickup authorization, add relationship details view, handle empty state, display message that relationship changes require administrative approval
- [X] T061 [US5] Add relationship management section to settings page in `apps/web/src/app/parent/settings/page.tsx` - integrate `RelationshipManagement` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now view their relationship management information

---

## Phase 8: User Story 6 - Change Password (Priority: P3)

**Goal**: Enable parents to change their account password

**Independent Test**: Navigate to password change section in settings. Verify password change form is displayed with fields for current password, new password, and confirm new password. Test changing password with correct current password, incorrect current password, invalid new password, password mismatch, and successful password change.

### Tests for User Story 6

- [ ] T062 [P] [US6] Contract test for `POST /api/v1/parent/settings/change-password` in `tests/contract/parent-settings.test.ts` - test validation, access control, password change
- [ ] T063 [P] [US6] Integration test for password change in `tests/integration/parent-password-change.test.ts` - verify current password verification, password validation, password hashing, access control
- [ ] T064 [P] [US6] E2E test for password change in `tests/e2e/parent-settings.spec.ts` - test password change form, validation, successful password change, incorrect current password

### Implementation for User Story 6

- [X] T065 [US6] Implement `POST /api/v1/parent/settings/change-password` endpoint in `apps/api/src/routes/parent-settings.ts` - verify current password is correct, validate new password meets security requirements (minimum length, complexity), validate new password and confirm password match, hash new password, update `users` table password_hash, verify parent access
- [X] T066 [P] [US6] Create `useChangePassword()` hook in `apps/web/src/lib/hooks/use-parent-settings.ts` - change password
- [X] T067 [P] [US6] Implement `ChangePassword` component in `apps/web/src/app/parent/components/settings/ChangePassword.tsx` - display password change form, show fields for current password, new password, confirm new password, add form validation, handle password requirements display, handle validation errors, handle successful password change, handle incorrect current password error
- [X] T068 [US6] Add password change section to settings page in `apps/web/src/app/parent/settings/page.tsx` - integrate `ChangePassword` component, fetch data via hook, add tab or section navigation

**Checkpoint**: Parents can now change their password

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, error handling, and polish

- [X] T069 [P] Add error handling and error states to all settings components (network errors, empty states, loading states)
- [X] T070 [P] Add loading skeletons to all settings components for better UX
- [X] T071 [P] Add responsive design for settings page (mobile, tablet, desktop)
- [X] T072 [P] Add accessibility features (ARIA labels, keyboard navigation) to all settings components
- [ ] T073 [P] Add unit tests for validation utilities (email format, phone format, password requirements)
- [ ] T074 [P] Add performance optimizations (memoization, query optimization) for settings data
- [X] T075 [P] Add logging and error tracking for settings API endpoints
- [X] T076 [P] Add form validation feedback (real-time validation, error messages)

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

- All endpoints must verify authenticated user ID matches parent ID before returning data
- All endpoints must respect tenant isolation (RLS)
- All endpoints must check parent role in authentication
- Profile and settings updates must be validated before saving
- Password changes must verify current password before allowing change
- Emergency contacts must be validated before saving
- Notification preferences must be validated before saving
- Relationship management is view-only (no add/remove functionality)
- Frontend components should support form validation with real-time feedback
- All date/time calculations should account for timezone
- Profile and settings updates should update updated_at timestamp
- Password changes should hash new password before storing
- Emergency contact removal should require confirmation
- Notification preferences should create default preferences if none exist

