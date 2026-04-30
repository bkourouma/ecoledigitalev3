# Implementation Plan: Phase 1 - Infrastructure et Authentification RSO-PFSO

**Branch**: `021-phase` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-phase/spec.md`

## Summary

Implement secure authentication infrastructure and user management system for the RSO-PFSO (Responsable Sûreté de l'Organisation - Port Facility Security Officer) module within the ASPCI tenant. This module requires:

- **Separate user management system** with 4 distinct roles (Administrateur, RSO Formateur, Agent PFSO, Agent Sûreté)
- **Secure authentication** with JWT tokens, password hashing, session management, and brute force protection
- **Role-based access control** with granular permissions per role
- **Comprehensive activity logging** for ISPS code compliance and security auditing
- **Password reset and change functionality** with email notifications
- **Multi-dashboard interfaces** tailored to each role's responsibilities

**Primary Security Requirements**:
- ISPS code compliance (International Ship and Port Facility Security Code)
- Complete audit trail for all security-related actions
- Tenant isolation (RSO-PFSO module isolated within ASPCI tenant)
- Protection against brute force, XSS, SQL injection attacks

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify 4.x, jsonwebtoken (JWT), bcryptjs (password hashing), zod (validation), nodemailer (email)
- Frontend: Next.js 15, React 18, NextAuth.js (for main app), TanStack Query, Tailwind CSS, Radix UI
- Database: PostgreSQL 14+ with Row Level Security (RLS) for multi-tenant isolation
**Storage**: 
- PostgreSQL 14+ (rso_users, rso_user_sessions, rso_activity_logs, rso_permissions tables)
- Existing multi-tenant infrastructure (tenants table, RLS policies)
- JWT tokens stored in httpOnly cookies or localStorage (configurable)
**Testing**: 
- Playwright (E2E authentication flows, role-based access tests)
- Vitest/Jest (unit tests for auth middleware, password validation, permission checks)
- Fastify test framework (backend API endpoint tests)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011) - same as main EcoleDigitale app
- Frontend: Next.js 15 (port 3000) - integrated into existing web app
- Database: PostgreSQL 14+ (shared database with tenant isolation)
**Project Type**: Web application (monorepo with frontend + backend)  
**Performance Goals**: 
- Authentication response time < 3 seconds (SC-001)
- User account operations < 5 seconds (SC-010)
- Activity log search/filter < 5 seconds (SC-006)
- Support 100+ concurrent RSO-PFSO users
**Constraints**: 
- Must integrate with existing EcoleDigitale infrastructure
- Must maintain tenant isolation (ASPCI tenant only)
- Must comply with ISPS code requirements (audit trails, security logging)
- Must not interfere with existing authentication system
- HTTPS required in production
**Scale/Scope**: 
- 4 user roles with distinct permissions
- 50+ functional requirements
- 7 user stories (P1-P3 priorities)
- Separate database schema (rso_* tables) within existing PostgreSQL database
- New route prefix: `/rso/*` for all RSO-PFSO module routes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Multi-Tenant Isolation
- ✅ **PASS**: RSO-PFSO module will be isolated within ASPCI tenant using existing RLS infrastructure
- ✅ **PASS**: Separate `rso_*` tables with tenant_id foreign key to tenants table
- ✅ **PASS**: All RSO routes will validate tenant context (ASPCI only)

### Security Requirements
- ✅ **PASS**: Password hashing with bcryptjs (industry standard, cost factor 12)
- ✅ **PASS**: JWT token-based authentication (consistent with existing system)
- ✅ **PASS**: Input validation and sanitization (Zod schemas, XSS/SQL injection prevention)
- ✅ **PASS**: Comprehensive activity logging (ISPS compliance requirement)

### Code Organization
- ✅ **PASS**: New module follows existing monorepo structure (apps/api, apps/web)
- ✅ **PASS**: Separate routes under `/rso/*` prefix for clear module boundaries
- ✅ **PASS**: Shared contracts package for TypeScript types
- ⚠️ **NOTE**: May require separate authentication middleware for RSO module (different user table)

### Testing Requirements
- ✅ **PASS**: E2E tests for all authentication flows (Playwright)
- ✅ **PASS**: Unit tests for security-critical functions (password validation, permission checks)
- ✅ **PASS**: Integration tests for role-based access control

**Gate Status**: ✅ **PASSED** - All constitution checks pass. Proceed to Phase 0 research.

## Project Structure

### Documentation (this feature)

```
specs/021-phase/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
ecoledigitale-main/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts              # Existing auth (keep)
│   │   │   │   └── rso/                 # NEW: RSO module routes
│   │   │   │       ├── auth.ts          # RSO authentication (login, logout, password reset)
│   │   │   │       ├── users.ts         # User management (admin, formateur)
│   │   │   │       └── activity-logs.ts # Activity log viewing/export
│   │   │   ├── services/
│   │   │   │   ├── jwt.service.ts       # Existing (reuse)
│   │   │   │   ├── rso/                 # NEW: RSO-specific services
│   │   │   │       ├── auth.service.ts   # RSO authentication logic
│   │   │   │       ├── user.service.ts  # User CRUD operations
│   │   │   │       ├── permission.service.ts # Permission checks
│   │   │   │       └── activity-log.service.ts # Logging service
│   │   │   ├── plugins/
│   │   │   │   ├── auth-middleware.ts   # Existing (keep)
│   │   │   │   └── rso-auth-middleware.ts # NEW: RSO auth middleware
│   │   │   └── types/
│   │   │       └── rso/                 # NEW: RSO TypeScript types
│   │   │           ├── user.types.ts
│   │   │           ├── session.types.ts
│   │   │           └── permission.types.ts
│   │   └── tests/
│   │       └── rso/                    # NEW: RSO module tests
│   │           ├── auth.test.ts
│   │           ├── users.test.ts
│   │           └── permissions.test.ts
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/              # Existing auth pages (keep)
│       │   │   └── rso/                 # NEW: RSO module pages
│       │   │       ├── login/
│       │   │       ├── forgot-password/
│       │   │       ├── reset-password/
│       │   │       ├── admin/
│       │   │       │   └── dashboard/
│       │   │       ├── formateur/
│       │   │       │   └── dashboard/
│       │   │       └── pfso/
│       │   │           └── consultation/
│       │   ├── components/
│       │   │   └── rso/                 # NEW: RSO components
│       │   │       ├── auth/
│       │   │       ├── admin/
│       │   │       ├── formateur/
│       │   │       └── pfso/
│       │   └── lib/
│       │       └── rso/                # NEW: RSO utilities
│       │           ├── auth.ts           # RSO auth client
│       │           └── permissions.ts   # Permission checks
│       └── tests/
│           └── rso/                     # NEW: RSO E2E tests
│               ├── auth.spec.ts
│               └── roles.spec.ts
├── packages/
│   ├── contracts/
│   │   └── src/
│   │       └── rso/                    # NEW: RSO contracts
│   │           ├── auth.contracts.ts
│   │           ├── user.contracts.ts
│   │           └── activity-log.contracts.ts
│   └── ui/                              # Existing (may add RSO components)
└── infra/
    └── scripts/
        └── migrations/
            └── 0021_rso_phase1.sql      # NEW: RSO Phase 1 database schema
```

**Structure Decision**: 
- **Monorepo integration**: RSO-PFSO module integrates into existing EcoleDigitale monorepo structure
- **Route prefix**: All RSO routes use `/rso/*` prefix for clear module boundaries
- **Separate tables**: `rso_*` tables maintain separation from main `users` table while leveraging existing tenant infrastructure
- **Shared infrastructure**: Reuse JWT service, database connection, and validation patterns from existing codebase
- **Frontend integration**: RSO pages integrated into Next.js app under `/rso/*` route group

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Separate authentication system for RSO | RSO module requires different user table (rso_users) with different roles and permissions than main EcoleDigitale users | Cannot reuse existing users table because RSO roles (Administrateur, RSO Formateur, Agent PFSO, Agent Sûreté) are distinct from EcoleDigitale roles (admin, teacher, student, parent) and serve different business domain |
| Separate middleware (rso-auth-middleware.ts) | RSO authentication validates against rso_users table, not users table | Cannot reuse existing auth-middleware.ts because it validates against different user table and different permission structure |
| New database schema (rso_* tables) | ISPS compliance requires separate audit trail and user management for port security operations | Cannot use existing users/roles tables because RSO module has different data model (installations, activity logs, ISPS-specific fields) and must maintain regulatory compliance separation |
