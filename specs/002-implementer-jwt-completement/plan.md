# Implementation Plan: Complete JWT Authentication Implementation

**Branch**: `002-implementer-jwt-completement` | **Date**: 2025-10-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-implementer-jwt-completement/spec.md`

## Summary

Replace the temporary X-Dev-Auth bypass system with industry-standard JWT (JSON Web Token) authentication throughout the EcoleDigitale platform. This implementation will:
- Generate cryptographically signed JWT tokens on user login containing user ID, tenant ID, tenant slug, and roles
- Validate JWT signatures on every authenticated API request in backend middleware
- Automatically inject Authorization headers in frontend fetch interceptor
- Store tokens in localStorage for 24-hour persistence across browser restarts
- Implement token refresh mechanism (5-minute window before expiration)
- Maintain token blacklist for immediate revocation on role changes or account deletion
- Remove all X-Dev-Auth bypass code from frontend and backend
- Force hard cutover (invalidate existing NextAuth sessions, require re-login)

**Primary Security Benefits**:
- Eliminates critical security vulnerability (dev bypasses in production code)
- Enforces proper authentication from development through production
- Immediate role change enforcement via token blacklist
- Tenant isolation validation through JWT claims

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: 
- Backend: Fastify, jsonwebtoken (JWT signing/validation), bcrypt (password hashing)
- Frontend: Next.js 15, NextAuth.js (extended for JWT), TanStack Query (API calls)
**Storage**: 
- PostgreSQL 14+ (user data, token blacklist table)
- localStorage (frontend JWT token storage)
- In-memory cache (optional: token blacklist for performance)
**Testing**: 
- Playwright (E2E authentication flows)
- Fastify test framework (backend auth middleware)
- Jest/Vitest (frontend token management)
**Target Platform**: 
- Backend: Linux server (shared VPS, port 8011)
- Frontend: Next.js SSR/CSR hybrid
- Deployment: Docker containers + Nginx reverse proxy with SSL
**Project Type**: Web application (separated frontend/backend)
**Performance Goals**:
- Token generation: <100ms per login
- Token validation: <10ms per request
- Blacklist check: <100ms per sensitive operation
- Support 1000 concurrent authenticated users
**Constraints**:
- Must not break existing authentication for active users (hard cutover acceptable)
- Must work with existing NextAuth.js session structure
- Must maintain tenant isolation through JWT claims validation
- localStorage XSS vulnerability acceptable (mitigated by CSP)
- 24-hour token expiration (no sliding window except via refresh)
**Scale/Scope**:
- ~10 files modified (auth middleware, fetch interceptor, login routes)
- ~500 lines of new code (token generation, validation, blacklist, refresh)
- All API endpoints affected (must validate JWT)
- All authenticated pages affected (must store/inject tokens)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify compliance with EcoleDigitale Constitution (`.specify/memory/constitution.md`):

### Critical Principles (MUST verify for every feature)

- [x] **Multi-Tenant Isolation**: Does this feature access tenant-specific data? **YES**
  - [x] All database queries use tenant-scoped filters (blacklist queries must include tenant_id)
  - [x] RLS policies defined/updated if new tables (token_blacklist table requires RLS)
  - [x] Tenant isolation tests planned (verify JWT tenant claim matches X-Tenant header)
  - [x] JWT payload includes tenantId, validated against X-Tenant header on every request
  - [x] Blacklist queries must filter by tenant_id to prevent cross-tenant token visibility
  
- [x] **Type Safety & Validation**: 
  - [x] All API contracts defined in `packages/contracts` with Zod schemas (JWTPayload, TokenRefreshRequest, TokenBlacklistEntry)
  - [x] All external inputs validated (Authorization header format, token expiration, signature)
  - [x] Types shared between frontend/backend (JWT payload structure, token storage interface)
  
- [x] **Security-First Design**:
  - [x] Authentication required? **YES** - JWT validation mandatory on all protected routes
  - [x] Role-based access control defined (roles extracted from JWT claims, validated against endpoint permissions)
  - [x] File uploads? **N/A** for this feature
  - [x] Security events logged (token generation, validation failures, blacklist additions, refresh operations)
  - [x] Token secret stored in environment variable (JWT_SECRET)
  - [x] HTTPS enforced in production (already configured in nginx)
  - [x] localStorage XSS vulnerability documented, CSP to be enforced
  
- [x] **API-First Architecture**:
  - [x] Business logic in backend (`apps/api`) - token generation, validation, blacklist management in backend only
  - [x] API endpoints versioned (`/api/v1/auth/login`, `/api/v1/auth/refresh`)
  - [x] Structured error responses (401 with "Token expired", "Invalid signature", "Token revoked" messages)
  
- [x] **Monorepo Standards**:
  - [x] Shared code in `packages/` not `apps/` - JWT types in `packages/contracts`
  - [x] Dependencies declared in correct workspace (jsonwebtoken in apps/api, JWT decode utility in apps/web)
  
- [x] **Production-Ready Code**:
  - [x] Error handling implemented (graceful 401 redirects, token refresh retry logic)
  - [x] Database migrations planned (001_create_token_blacklist_table.sql with RLS)
  - [x] No impact on shared VPS apps (port 8011, separate Nginx config) - authentication change internal only
  - [x] Health checks updated if needed - health endpoint remains unauthenticated

- [x] **NO TEMPORARY WORKAROUNDS** (Constitution Principle VII - CRITICAL):
  - [x] COMPLETE REMOVAL of all X-Dev-Auth bypass code
  - [x] COMPLETE REMOVAL of all dev-bypass checks in auth middleware
  - [x] COMPLETE REMOVAL of all hardcoded user IDs and mock data
  - [x] COMPLETE REMOVAL of all fallback authentication mechanisms
  - [x] NO environment-based auth bypasses (no `if NODE_ENV === 'development'` auth skips)
  - [x] Proper JWT authentication enforced in development and production identically

### Technology Stack Compliance

- [x] Using approved stack (Next.js 15, Fastify, PostgreSQL, TypeScript)
- [x] Any new major dependencies justified and documented:
  - **jsonwebtoken**: Industry-standard JWT library for Node.js, required for token signing/validation
  - **@types/jsonwebtoken**: TypeScript types for jsonwebtoken
- [x] Environment variables for configuration (JWT_SECRET, never hardcoded)

### Constitution Compliance Summary

**Status**: ✅ FULLY COMPLIANT

**Key Compliance Points**:
1. **Tenant Isolation**: JWT tenant claim validation + blacklist RLS policies enforce complete isolation
2. **Security-First**: Replaces insecure bypass with cryptographic authentication, implements token revocation
3. **No Workarounds**: Primary goal is eliminating X-Dev-Auth bypass, complete removal guaranteed
4. **Production-Ready**: Hard cutover strategy, comprehensive error handling, migration scripts included

**No Violations**: All requirements align with constitution principles. No complexity justifications needed.

## Project Structure

### Documentation (this feature)

```
specs/002-implementer-jwt-completement/
├── spec.md              # Feature specification (completed)
├── plan.md              # This file (implementation plan)
├── research.md          # Phase 0 output (JWT best practices, blacklist strategies)
├── data-model.md        # Phase 1 output (token blacklist schema, JWT payload structure)
├── quickstart.md        # Phase 1 output (testing guide, deployment instructions)
├── contracts/           # Phase 1 output (API contracts)
│   ├── auth.schema.ts   # Login, refresh, logout schemas
│   └── jwt.types.ts     # JWT payload, blacklist entry types
└── tasks.md             # Phase 2 output (NOT created by this command)
```

### Source Code (repository root)

```
# Web application structure (frontend + backend)

apps/api/  # Backend (Fastify on port 4000/8011)
├── src/
│   ├── plugins/
│   │   └── auth-middleware.ts       # [MODIFY] Remove X-Dev-Auth, add JWT validation + blacklist check
│   ├── routes/
│   │   └── auth.ts                  # [MODIFY] Add JWT generation to login, add /refresh endpoint
│   ├── services/
│   │   ├── jwt.service.ts           # [NEW] Token generation, validation, signing
│   │   └── blacklist.service.ts     # [NEW] Token blacklist CRUD operations
│   └── types/
│       └── jwt.types.ts             # [NEW] JWT payload interface, blacklist entry type
└── tests/
    ├── auth-middleware.test.ts      # [NEW] JWT validation tests
    └── jwt-service.test.ts          # [NEW] Token generation/validation unit tests

apps/web/  # Frontend (Next.js on port 3000)
├── src/
│   ├── app/
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts     # [MODIFY] Extend to return JWT on login
│   ├── lib/
│   │   ├── fetch-interceptor.ts     # [MODIFY] Remove X-Dev-Auth, add JWT injection + auto-refresh
│   │   ├── jwt-storage.ts           # [NEW] localStorage wrapper for token management
│   │   └── api-utils.ts             # [MODIFY] Remove X-Dev-Auth header logic
│   └── hooks/
│       └── use-auth.ts              # [MODIFY] JWT-aware auth state management
└── tests/
    ├── jwt-storage.test.ts          # [NEW] localStorage token management tests
    └── fetch-interceptor.test.ts    # [MODIFY] Update to test JWT injection

packages/contracts/  # Shared types and schemas
└── src/
    ├── auth/
    │   ├── jwt-payload.ts           # [NEW] Zod schema for JWT payload structure
    │   ├── token-refresh.ts         # [NEW] Zod schema for refresh endpoint
    │   └── blacklist-entry.ts       # [NEW] Zod schema for blacklist table
    └── index.ts                     # [MODIFY] Export new JWT contracts

infra/scripts/migrations/  # Database migrations
└── 012_create_token_blacklist_table.sql  # [NEW] Token blacklist table with RLS

.env.example  # [MODIFY] Add JWT_SECRET documentation
```

**Structure Decision**: Standard web application structure (separated frontend/backend) used throughout EcoleDigitale. Backend handles all authentication logic, frontend manages token storage and injection. Shared contracts in `packages/contracts` ensure type safety across boundary.

**Key Files Modified**: 10 existing files + 9 new files = 19 files total
**Key Files Deleted**: None (all X-Dev-Auth code removed via modification, not deletion)

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

**No violations identified. No complexity justifications required.**

All implementation choices align with constitution principles:
- Token blacklist adds complexity but justified for immediate role change enforcement (security requirement)
- localStorage XSS vulnerability documented and accepted with CSP mitigation (clarified in spec)
- Hard cutover strategy chosen for simplicity over gradual migration (alignment with constitution anti-bypass principle)

---

**Next Steps**: Proceed to Phase 0 (Research) to resolve JWT implementation patterns and blacklist strategies.
