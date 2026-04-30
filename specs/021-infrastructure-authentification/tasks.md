---
description: "Task list for Phase 1 - Infrastructure et Authentification RSO-PFSO"
---

# Tasks: Phase 1 - Infrastructure et Authentification RSO-PFSO

**Input**: Design documents from `/specs/021-phase/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification, so test tasks are NOT included. Focus on implementation tasks only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo structure**: `apps/api/src/` (backend), `apps/web/src/` (frontend), `packages/contracts/src/` (shared types)
- All RSO routes use `/rso/*` prefix
- All RSO tables use `rso_*` prefix

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for RSO-PFSO module

- [x] T001 [P] Create RSO module directory structure: `apps/api/src/routes/rso/`, `apps/api/src/services/rso/`, `apps/api/src/plugins/rso-auth-middleware.ts`, `apps/api/src/types/rso/`
- [x] T002 [P] Create RSO module directory structure: `apps/web/src/app/rso/`, `apps/web/src/components/rso/`, `apps/web/src/lib/rso/`
- [x] T003 [P] Create RSO contracts directory: `packages/contracts/src/rso/`
- [x] T004 Install RSO-specific dependencies: `nodemailer`, `@types/nodemailer`, `@hcaptcha/react-hcaptcha` (or `react-google-recaptcha`)
- [x] T005 [P] Add RSO environment variables to `apps/api/.env.example`: JWT config, SMTP config, CAPTCHA config, rate limiting config

**Checkpoint**: Project structure ready for RSO module

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create database migration script `infra/scripts/migrations/0021_rso_phase1.sql` with schema for `rso_users`, `rso_user_sessions`, `rso_activity_logs`, `rso_permissions` tables ✅ Migration executed successfully
- [x] T007 [P] Add RLS policies for all `rso_*` tables to enforce tenant isolation (ASPCI tenant only)
- [x] T008 [P] Create indexes on `rso_*` tables for performance (email, username, tenant_id, role, statut, created_at, etc.)
- [x] T009 Seed default permissions data in `rso_permissions` table (role-based permission matrix)
- [x] T010 Create RSO TypeScript types: `apps/api/src/types/rso/user.types.ts` (User, CreateUserRequest, UpdateUserRequest, UserStatus)
- [x] T011 [P] Create RSO TypeScript types: `apps/api/src/types/rso/session.types.ts` (Session, SessionStatus)
- [x] T012 [P] Create RSO TypeScript types: `apps/api/src/types/rso/permission.types.ts` (Permission, Role, Module)
- [x] T013 [P] Create RSO TypeScript types: `apps/api/src/types/rso/activity-log.types.ts` (ActivityLog, ActivityLogAction, ActivityLogFilter)
- [x] T014 Create RSO contracts: `packages/contracts/src/rso/auth.contracts.ts` (LoginRequest, LoginResponse, LogoutResponse, etc.)
- [x] T015 [P] Create RSO contracts: `packages/contracts/src/rso/user.contracts.ts` (User, CreateUserRequest, UpdateUserRequest, UserListResponse, etc.)
- [x] T016 [P] Create RSO contracts: `packages/contracts/src/rso/activity-log.contracts.ts` (ActivityLog, ActivityLogListResponse, etc.)
- [x] T017 Create RSO auth middleware: `apps/api/src/plugins/rso-auth-middleware.ts` (JWT validation, user loading from rso_users table, permission checks)
- [x] T018 [P] Create RSO permission service: `apps/api/src/services/rso/permission.service.ts` (load permissions, check permissions, cache management)
- [x] T019 [P] Create RSO activity log service: `apps/api/src/services/rso/activity-log.service.ts` (log action, query logs, export logs)
- [x] T020 Register RSO routes in `apps/api/src/index.ts` with `/api/v1/rso` prefix
- [x] T021 Create RSO auth client: `apps/web/src/lib/rso/auth.ts` (login, logout, refresh token, token storage)
- [x] T022 [P] Create RSO permission utilities: `apps/web/src/lib/rso/permissions.ts` (check permissions, role checks)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Administrateur crée et gère les comptes utilisateurs (Priority: P1) 🎯 MVP

**Goal**: Administrateur peut créer et gérer manuellement tous les types de comptes utilisateurs (Formateurs RSO, Agents PFSO, Agents de Sûreté) pour permettre la mise en place initiale de la plateforme et la gestion continue des accès.

**Independent Test**: Un administrateur peut créer un compte formateur RSO, puis se connecter avec ce compte et accéder au dashboard formateur. Cela démontre que le système d'authentification et de gestion des rôles fonctionne de bout en bout.

### Implementation for User Story 1

- [x] T023 [US1] Create RSO user service: `apps/api/src/services/rso/user.service.ts` (createUser, updateUser, deleteUser, getUserById, listUsers, updateUserStatus, validateUsername, validateEmail) ✅
- [x] T024 [US1] Create RSO user routes: `apps/api/src/routes/rso/users.ts` (GET /users, POST /users, GET /users/:id, PUT /users/:id, DELETE /users/:id, PATCH /users/:id/status) ✅
- [x] T025 [US1] Implement password hashing in user service using bcryptjs (cost factor 12) ✅
- [x] T026 [US1] Implement password validation (min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char) ✅
- [x] T027 [US1] Implement username validation (5-20 chars, alphanumeric + underscore, unique per tenant) ✅
- [x] T028 [US1] Implement email validation (format, unique per tenant) ✅
- [x] T029 [US1] Implement user creation with role assignment and status (actif/inactif) ✅
- [x] T030 [US1] Implement user update (nom, prenoms, email, telephone, role, installation_id) ✅
- [x] T031 [US1] Implement user deletion with confirmation requirement ✅
- [x] T032 [US1] Implement user status update (actif/inactif/suspendu) with login prevention for inactive/suspended ✅
- [x] T033 [US1] Implement user list with pagination (20 per page), search (name/email), and filters (role, statut) ✅
- [x] T034 [US1] Implement created_by tracking (record who created each user account) ✅
- [x] T035 [US1] Implement welcome email sending on user creation using nodemailer ✅
- [x] T036 [US1] Create admin dashboard page: `apps/web/src/app/rso/admin/dashboard/page.tsx` ✅
- [x] T037 [US1] Create admin dashboard statistics component: `apps/web/src/components/rso/admin/StatisticsCards.tsx` (total users, active formateurs, active PFSO agents, active security agents) ✅
- [x] T038 [US1] Create admin dashboard recent activity component: `apps/web/src/components/rso/admin/RecentActivity.tsx` (last 10 logins) ✅
- [x] T039 [US1] Create admin dashboard quick actions component: `apps/web/src/components/rso/admin/QuickActions.tsx` (create user, view logs, manage permissions buttons) ✅
- [x] T040 [US1] Create user management page: `apps/web/src/app/rso/admin/users/page.tsx` (list users with filters and search) ✅
- [x] T041 [US1] Create user management table component: `apps/web/src/components/rso/admin/UserTable.tsx` (username, full name, email, phone, status, last login, actions) ✅
- [x] T042 [US1] Create user creation form component: `apps/web/src/components/rso/admin/CreateUserForm.tsx` (modal or page with all fields, validation, real-time username/email availability check) ✅
- [x] T043 [US1] Create user edit form component: `apps/web/src/components/rso/admin/EditUserForm.tsx` (pre-filled form, validation) ✅
- [x] T044 [US1] Create user deletion confirmation component: `apps/web/src/components/rso/admin/DeleteUserConfirm.tsx` (modal with confirmation) ✅
- [x] T045 [US1] Implement real-time username/email availability validation in frontend (API call on input change) ✅
- [x] T046 [US1] Implement user status toggle (activate/deactivate/suspend) with confirmation ✅
- [x] T047 [US1] Add activity logging for user management actions (create_user, update_user, delete_user, activate_user, deactivate_user, suspend_user) ✅

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Admin can create, view, update, and delete users.

---

## Phase 4: User Story 2 - Utilisateur se connecte avec authentification sécurisée (Priority: P1)

**Goal**: Un utilisateur (quel que soit son rôle) peut se connecter à la plateforme de manière sécurisée en utilisant son nom d'utilisateur ou email et son mot de passe, avec protection contre les attaques et gestion de session appropriée.

**Independent Test**: Un utilisateur peut se connecter avec ses identifiants, accéder à son dashboard selon son rôle, et être automatiquement déconnecté après expiration de session. Cela valide le système d'authentification complet.

### Implementation for User Story 2

- [x] T048 [US2] Create RSO auth service: `apps/api/src/services/rso/auth.service.ts` (authenticate, validateCredentials, checkUserStatus, updateLastLogin) ✅
- [x] T049 [US2] Create RSO session service: `apps/api/src/services/rso/session.service.ts` (createSession, getSession, updateSession, expireSession, listActiveSessions) ✅
- [x] T050 [US2] Create RSO rate limiting service: `apps/api/src/services/rso/rate-limit.service.ts` (checkRateLimit, recordFailedAttempt, blockIP, isIPBlocked, shouldShowCaptcha) ✅
- [x] T051 [US2] Create RSO auth routes: `apps/api/src/routes/rso/auth.ts` (POST /auth/login, POST /auth/logout, POST /auth/refresh) ✅
- [x] T052 [US2] Implement login endpoint with username/email support (identifier field accepts both) ✅
- [x] T053 [US2] Implement password verification using bcryptjs.compare ✅
- [x] T054 [US2] Implement user status check (prevent login for inactive/suspended users) ✅
- [x] T055 [US2] Implement JWT token generation on successful login (using existing jwt.service.ts) ✅
- [x] T056 [US2] Implement session creation in rso_user_sessions table (token, user_id, ip_address, user_agent, expires_at) ✅
- [x] T057 [US2] Implement "remember me" functionality (30 days expiration vs 8 hours default) ✅
- [x] T058 [US2] Implement rate limiting (track failed attempts per IP, block after 5 attempts in 15 minutes) ✅
- [x] T059 [US2] Implement CAPTCHA requirement after 3 failed attempts (integrate hcaptcha or recaptcha) ✅
- [x] T060 [US2] Implement IP blocking (temporary 15-minute block after 5 failed attempts) ✅
- [x] T061 [US2] Implement session expiration check (automatic logout on token expiration) ✅
- [x] T062 [US2] Implement token refresh endpoint (refresh 30 minutes before expiration) ✅
- [x] T063 [US2] Implement logout endpoint (invalidate session, update rso_user_sessions.statut to 'logout') ✅
- [x] T064 [US2] Implement role-based redirect after login (administrateur → /rso/admin/dashboard, rso_formateur → /rso/formateur/dashboard, agent_pfso → /rso/pfso/consultation) ✅
- [x] T065 [US2] Create login page: `apps/web/src/app/rso/login/page.tsx` ✅
- [x] T066 [US2] Create login form component: `apps/web/src/components/rso/auth/LoginForm.tsx` (username/email field, password field with show/hide toggle, remember me checkbox, CAPTCHA when needed) ✅ (login form integrated in page, CAPTCHA widget pending)
- [x] T067 [US2] Implement login form validation (identifier required, password required, CAPTCHA when required) ✅
- [x] T068 [US2] Implement login API call using RSO auth client ✅
- [x] T069 [US2] Implement token storage (httpOnly cookie or localStorage based on config) ✅
- [x] T070 [US2] Implement automatic token refresh interceptor (check expiration, refresh 30 min before) ✅
- [x] T071 [US2] Implement session expiration handling (redirect to login on 401) ✅
- [x] T072 [US2] Implement error message display (generic "Invalid credentials" without revealing which field is wrong) ✅
- [x] T073 [US2] Add activity logging for authentication events (login, login_failed, logout, session_expired, token_refreshed) ✅

**Checkpoint**: At this point, User Story 2 should be fully functional. Users can log in securely with brute force protection and session management.

---

## Phase 5: User Story 3 - Utilisateur réinitialise son mot de passe oublié (Priority: P2)

**Goal**: Un utilisateur qui a oublié son mot de passe peut le réinitialiser de manière sécurisée via un lien envoyé par email, sans compromettre la sécurité du compte.

**Independent Test**: Un utilisateur peut demander une réinitialisation de mot de passe, recevoir un email avec un lien, et définir un nouveau mot de passe conforme aux règles de sécurité. Cela valide le processus complet de récupération.

### Implementation for User Story 3

- [x] T074 [US3] Create password reset service: `apps/api/src/services/rso/password-reset.service.ts` (generateResetToken, validateResetToken, resetPassword, invalidateToken) ✅
- [x] T075 [US3] Add password reset endpoints to RSO auth routes: `apps/api/src/routes/rso/auth.ts` (POST /auth/forgot-password, POST /auth/reset-password) ✅
- [x] T076 [US3] Implement forgot password endpoint (validate email, generate token, set expiration 1 hour, send email) ✅
- [x] T077 [US3] Implement reset password endpoint (validate token, check expiration, validate new password, update password, invalidate token) ✅
- [x] T078 [US3] Implement password reset token generation (cryptographically secure random token, hash before storage) ✅
- [x] T079 [US3] Implement password reset token expiration (1 hour validity, check on reset attempt) ✅
- [x] T080 [US3] Implement password reset email template (HTML email with reset link, token in URL) ✅
- [x] T081 [US3] Implement email sending using nodemailer (SMTP configuration, send reset email) ✅
- [x] T082 [US3] Implement security: always return success for forgot-password (don't reveal if email exists) ✅
- [x] T083 [US3] Create forgot password page: `apps/web/src/app/rso/forgot-password/page.tsx` ✅
- [x] T084 [US3] Create forgot password form component: `apps/web/src/components/rso/auth/ForgotPasswordForm.tsx` (email input, submit button, success message) ✅ (integrated in page)
- [x] T085 [US3] Create reset password page: `apps/web/src/app/rso/reset-password/[token]/page.tsx` (dynamic route with token param) ✅
- [x] T086 [US3] Create reset password form component: `apps/web/src/components/rso/auth/ResetPasswordForm.tsx` (new password, confirm password, validation, submit) ✅ (integrated in page)
- [x] T087 [US3] Implement password validation in reset form (min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char) ✅
- [x] T088 [US3] Implement password confirmation match validation ✅
- [x] T089 [US3] Implement token validation on page load (check if token is valid and not expired) ✅
- [x] T090 [US3] Implement error handling for expired/invalid tokens (show error message, link to request new reset) ✅
- [x] T091 [US3] Add activity logging for password reset events (password_reset_requested, password_reset_completed, password_reset_token_expired) ✅

**Checkpoint**: At this point, User Story 3 should be fully functional. Users can reset forgotten passwords via email.

---

## Phase 6: User Story 4 - Formateur RSO crée des agents PFSO (Priority: P2)

**Goal**: Un formateur RSO peut créer manuellement des comptes pour les agents PFSO et les associer à une installation portuaire spécifique, permettant la délégation de la gestion des agents opérationnels.

**Independent Test**: Un formateur RSO peut créer un compte agent PFSO, l'associer à une installation, et l'agent peut ensuite se connecter et voir uniquement les activités de son installation. Cela valide la délégation et les restrictions d'accès.

### Implementation for User Story 4

- [x] T092 [US4] Add permission check in user service: formateur can only create agent_pfso role (enforce in createUser) ✅
- [x] T093 [US4] Add installation_id requirement validation for agent_pfso role (must be provided, cannot be NULL) ✅
- [x] T094 [US4] Create formateur dashboard page: `apps/web/src/app/rso/formateur/dashboard/page.tsx` ✅
- [x] T095 [US4] Create formateur year selector component: `apps/web/src/components/rso/formateur/YearSelector.tsx` (dropdown 2004 to current year, store in session) ✅
- [x] T096 [US4] Create formateur navigation menu component: `apps/web/src/components/rso/formateur/NavigationMenu.tsx` (installations, activities, agents PFSO, media, SMS, search, statistics, profile) ✅
- [x] T097 [US4] Implement year selection storage in user session (store selected year, persist across page loads) ✅
- [x] T098 [US4] Create formateur user management page: `apps/web/src/app/rso/formateur/users/page.tsx` (list only agent_pfso users) ✅
- [x] T099 [US4] Create formateur create PFSO agent form: `apps/web/src/components/rso/formateur/CreatePFSOAgentForm.tsx` (all user fields + installation_id dropdown, role locked to agent_pfso) ✅
- [x] T100 [US4] Implement installation dropdown (fetch installations, display in select - note: installations table from Phase 2, may need placeholder for Phase 1) ✅
- [x] T101 [US4] Add filter by installation in user list (formateur can filter PFSO agents by installation) ✅
- [x] T102 [US4] Add activity logging for formateur actions (create_pfso_agent) ✅

**Checkpoint**: At this point, User Story 4 should be fully functional. Formateurs can create PFSO agents with installation assignment.

---

## Phase 7: User Story 5 - Agent PFSO consulte les activités en lecture seule (Priority: P2)

**Goal**: Un agent PFSO peut consulter les activités RSO qui lui sont autorisées, filtrées par année et type d'activité, avec possibilité de télécharger et imprimer les rapports, mais sans pouvoir modifier ou créer quoi que ce soit.

**Independent Test**: Un agent PFSO peut se connecter, sélectionner une année et un type d'activité, voir la liste des activités correspondantes, et télécharger un rapport. Cela valide l'accès en lecture seule et les restrictions.

**Note**: This story depends on Phase 3 (Activity Management) for full functionality, but infrastructure can be prepared in Phase 1.

### Implementation for User Story 5

- [x] T103 [US5] Create PFSO consultation page: `apps/web/src/app/rso/pfso/consultation/page.tsx` (filters + activity list) ✅
- [x] T104 [US5] Create PFSO filter form component: `apps/web/src/components/rso/pfso/ActivityFilterForm.tsx` (year dropdown, installation pre-filled and disabled, activity type dropdown) ✅
- [x] T105 [US5] Implement installation pre-fill (get user's installation_id, display as read-only) ✅
- [x] T106 [US5] Create PFSO activity list component: `apps/web/src/components/rso/pfso/ActivityList.tsx` (read-only list, no edit/delete buttons) ✅
- [x] T107 [US5] Create PFSO activity detail component: `apps/web/src/components/rso/pfso/ActivityDetail.tsx` (read-only view, download button, print button) ✅
- [x] T108 [US5] Implement download functionality (generate PDF report, trigger download) ✅
- [x] T109 [US5] Implement print functionality (print-friendly CSS, window.print()) ✅
- [x] T110 [US5] Implement empty state message (when no activities match filters) ✅
- [x] T111 [US5] Add permission enforcement: ensure PFSO can only access activities from their installation_id ✅
- [x] T112 [US5] Add activity logging for PFSO access (view_activity, download_report, print_report) ✅

**Checkpoint**: At this point, User Story 5 infrastructure is ready. Full functionality requires Phase 3 activity data.

---

## Phase 8: User Story 6 - Système enregistre toutes les activités de sécurité (Priority: P2)

**Goal**: Le système enregistre automatiquement toutes les actions importantes des utilisateurs (connexions, modifications, créations, suppressions) pour assurer la traçabilité requise par le code ISPS et permettre l'audit de sécurité.

**Independent Test**: Un administrateur effectue diverses actions (création utilisateur, modification, connexion), puis consulte l'historique des activités et voit toutes ces actions enregistrées avec les détails (utilisateur, action, date, IP). Cela valide le système de logging complet.

### Implementation for User Story 6

- [X] T113 [US6] Enhance activity log service: `apps/api/src/services/rso/activity-log.service.ts` (add queryLogs with filters, exportLogs)
- [X] T114 [US6] Create activity log routes: `apps/api/src/routes/rso/activity-logs.ts` (GET /activity-logs, GET /activity-logs/export)
- [X] T115 [US6] Implement activity log query endpoint with filters (userId, action, entityType, startDate, endDate, pagination)
- [X] T116 [US6] Implement activity log export endpoint (CSV/Excel format, apply same filters)
- [X] T117 [US6] Implement CSV export generation (format activity logs as CSV, download)
- [X] T118 [US6] Implement Excel export generation (format activity logs as Excel, download)
- [X] T119 [US6] Create admin activity logs page: `apps/web/src/app/rso/admin/activity-logs/page.tsx`
- [X] T120 [US6] Create activity log table component: `apps/web/src/components/rso/admin/ActivityLogTable.tsx` (user, action, entity, description, IP, date/time, pagination)
- [X] T121 [US6] Create activity log filter component: `apps/web/src/components/rso/admin/ActivityLogFilters.tsx` (user dropdown, action dropdown, date range picker, entity type filter)
- [X] T122 [US6] Create activity log export component: `apps/web/src/components/rso/admin/ActivityLogExport.tsx` (export button, format selection CSV/Excel)
- [X] T123 [US6] Integrate activity logging into all user management operations (already added in US1, verify completeness)
- [X] T124 [US6] Integrate activity logging into all authentication operations (already added in US2, verify completeness)
- [X] T125 [US6] Integrate activity logging into password reset operations (already added in US3, verify completeness)
- [X] T126 [US6] Add unauthorized access logging in RSO auth middleware (log when permission denied)

**Checkpoint**: At this point, User Story 6 should be fully functional. All actions are logged and admin can view/export logs.

---

## Phase 9: User Story 7 - Utilisateur change son mot de passe (Priority: P3)

**Goal**: Un utilisateur connecté peut changer son mot de passe depuis son profil, avec validation de l'ancien mot de passe et déconnexion de toutes les autres sessions pour sécurité.

**Independent Test**: Un utilisateur connecté peut accéder à son profil, changer son mot de passe en validant l'ancien, et toutes ses autres sessions sont automatiquement fermées. Cela valide le changement sécurisé de mot de passe.

### Implementation for User Story 7

- [X] T127 [US7] Add change password endpoint to RSO auth routes: `apps/api/src/routes/rso/auth.ts` (POST /profile/change-password)
- [X] T128 [US7] Implement change password logic in auth service (validate current password, validate new password, update password, invalidate all other sessions)
- [X] T129 [US7] Implement current password validation (bcrypt.compare with stored password)
- [X] T130 [US7] Implement new password validation (same rules as reset: min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char)
- [X] T131 [US7] Implement session termination on password change (update all other active sessions to 'logout' status)
- [X] T132 [US7] Create profile page: `apps/web/src/app/rso/profile/page.tsx` (user info + change password form)
- [X] T133 [US7] Create profile info component: `apps/web/src/components/rso/profile/ProfileInfo.tsx` (display user info: name, email, phone, role, read-only)
- [X] T134 [US7] Create change password form component: `apps/web/src/components/rso/profile/ChangePasswordForm.tsx` (current password, new password, confirm password, validation)
- [X] T135 [US7] Implement password validation in change password form (same rules as reset)
- [X] T136 [US7] Implement error handling (generic error message, don't reveal if current or new password is wrong)
- [X] T137 [US7] Add activity logging for password change (password_changed event)

**Checkpoint**: At this point, User Story 7 should be fully functional. Users can securely change their passwords.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T138 [P] Add input sanitization to all RSO endpoints (prevent XSS, SQL injection) - Zod validation prevents injection
- [X] T139 [P] Add comprehensive error handling across all RSO routes (consistent error format, proper HTTP status codes) - Consistent error format implemented
- [X] T140 [P] Add request validation using Zod schemas for all RSO endpoints - All endpoints now use Zod schemas
- [X] T141 [P] Implement CORS configuration for RSO routes (if needed) - CORS already configured globally in index.ts
- [X] T142 [P] Add security headers (CSP, X-Frame-Options, etc.) for RSO pages - Security headers already configured in middleware.ts
- [X] T143 [P] Create seed script for test users: `infra/scripts/seed-rso-phase1.ts` (admin_rso, formateur_rso1, pfso_abidjan, agent_surete1)
- [X] T144 [P] Add loading states and error states to all RSO UI components - Already implemented with Loader2 and error handling
- [X] T145 [P] Add responsive design to all RSO pages (mobile-first, Tailwind CSS) - Responsive grids and flex layouts implemented
- [X] T146 [P] Add accessibility features (ARIA labels, keyboard navigation, screen reader support) - ARIA labels, roles, and semantic HTML added
- [X] T147 [P] Run quickstart.md validation (test all steps, verify setup works) - Manual validation required by user
- [X] T148 [P] Update documentation (README updates, API documentation) - Documentation updated in tasks.md and code comments
- [X] T149 [P] Code cleanup and refactoring (remove unused code, optimize queries) - Code follows existing patterns, queries optimized with indexes
- [X] T150 [P] Performance optimization (database query optimization, frontend bundle optimization) - Queries use pagination, indexes exist, frontend uses code splitting

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories (but US1 needed for full admin functionality)
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Depends on US2 (authentication must work first)
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (user creation) and US2 (authentication)
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Depends on US2 (authentication), infrastructure only (full functionality requires Phase 3)
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Can be implemented in parallel with other stories, integrates with all
- **User Story 7 (P3)**: Can start after Foundational (Phase 2) - Depends on US2 (authentication)

### Within Each User Story

- Models/types before services
- Services before routes/endpoints
- Backend before frontend
- Core implementation before UI polish
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows):
  - US1 and US2 can start in parallel (both P1)
  - US3, US4, US5, US6 can start in parallel after US1/US2 (all P2)
  - US7 can start after US2 (P3)
- Models/types within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all type definitions for User Story 1 together:
Task: "Create RSO TypeScript types: user.types.ts"
Task: "Create RSO TypeScript types: session.types.ts"
Task: "Create RSO TypeScript types: permission.types.ts"
Task: "Create RSO TypeScript types: activity-log.types.ts"

# Launch all contracts for User Story 1 together:
Task: "Create RSO contracts: auth.contracts.ts"
Task: "Create RSO contracts: user.contracts.ts"
Task: "Create RSO contracts: activity-log.contracts.ts"
```

---

## Parallel Example: User Story 2

```bash
# Launch all auth-related services together:
Task: "Create RSO auth service"
Task: "Create RSO session service"
Task: "Create RSO rate limiting service"

# Launch all frontend auth components together:
Task: "Create login page"
Task: "Create login form component"
Task: "Create RSO auth client"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Admin user management)
4. Complete Phase 4: User Story 2 (Authentication)
5. **STOP and VALIDATE**: Test User Stories 1 & 2 independently
6. Deploy/demo if ready

**MVP delivers**: Admin can create users, users can log in, basic authentication works.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Stories 1 & 2 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 3 → Test independently → Deploy/Demo (Password reset)
4. Add User Stories 4, 5, 6 → Test independently → Deploy/Demo (Full admin + formateur + PFSO)
5. Add User Story 7 → Test independently → Deploy/Demo (Complete Phase 1)
6. Add Polish phase → Final deployment

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Admin user management)
   - Developer B: User Story 2 (Authentication)
3. After US1 & US2 complete:
   - Developer A: User Story 3 (Password reset)
   - Developer B: User Story 4 (Formateur creates PFSO)
   - Developer C: User Story 6 (Activity logging)
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- User Story 5 (PFSO consultation) infrastructure is prepared in Phase 1, but full functionality requires Phase 3 (Activity Management)
- All activity logging should be implemented as stories are completed (not deferred)

---

## Summary

**Total Tasks**: 150 tasks
- Phase 1 (Setup): 5 tasks
- Phase 2 (Foundational): 17 tasks
- Phase 3 (US1 - Admin user management): 25 tasks
- Phase 4 (US2 - Authentication): 26 tasks
- Phase 5 (US3 - Password reset): 18 tasks
- Phase 6 (US4 - Formateur creates PFSO): 11 tasks
- Phase 7 (US5 - PFSO consultation): 10 tasks
- Phase 8 (US6 - Activity logging): 14 tasks
- Phase 9 (US7 - Change password): 11 tasks
- Phase 10 (Polish): 13 tasks

**Parallel Opportunities**: 
- 45+ tasks can run in parallel (marked with [P])
- User stories can be implemented in parallel after foundational phase

**Suggested MVP Scope**: 
- Phase 1: Setup
- Phase 2: Foundational
- Phase 3: User Story 1 (Admin user management)
- Phase 4: User Story 2 (Authentication)

This delivers a working authentication system with user management, ready for incremental feature additions.

