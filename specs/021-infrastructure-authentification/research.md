# Research: Phase 1 - Infrastructure et Authentification RSO-PFSO

**Feature**: Phase 1 - Infrastructure et Authentification RSO-PFSO  
**Date**: 2024-12-19  
**Status**: Complete

## Research Questions & Decisions

### 1. Authentication Architecture: Separate vs Integrated System

**Question**: Should RSO-PFSO use the existing EcoleDigitale authentication system or have a separate authentication system?

**Decision**: Implement a separate authentication system for RSO-PFSO module with its own user table (`rso_users`) and authentication routes, but reuse existing JWT infrastructure and patterns.

**Rationale**:
- **Business Domain Separation**: RSO-PFSO is a distinct security domain (port facility security) with different roles and requirements than educational management
- **Regulatory Compliance**: ISPS code requires separate audit trails and user management for security operations
- **Data Model Differences**: RSO users have different attributes (installations, ISPS-specific fields) than EcoleDigitale users
- **Role Incompatibility**: RSO roles (Administrateur, RSO Formateur, Agent PFSO, Agent Sûreté) are fundamentally different from educational roles (admin, teacher, student, parent)
- **Infrastructure Reuse**: Can still leverage existing JWT service, database connection pooling, and validation patterns

**Alternatives Considered**:
1. **Single unified users table with role flags**: Rejected because it would mix educational and security domains, complicating permissions and violating separation of concerns
2. **Fully separate application**: Rejected because it would duplicate infrastructure and increase maintenance burden
3. **Current approach (separate tables, shared infrastructure)**: Selected as optimal balance between separation and code reuse

**Implementation Notes**:
- Use existing `jwt.service.ts` for token generation/validation
- Create new `rso-auth-middleware.ts` that validates against `rso_users` table
- Reuse existing database connection and transaction patterns
- Maintain tenant isolation (ASPCI tenant only)

---

### 2. Session Management: JWT Storage Strategy

**Question**: Should JWT tokens be stored in httpOnly cookies or localStorage?

**Decision**: Support both httpOnly cookies (default, more secure) and localStorage (fallback for compatibility), with configuration option.

**Rationale**:
- **Security Best Practice**: httpOnly cookies prevent XSS attacks from accessing tokens
- **Flexibility**: Some deployment scenarios may require localStorage (e.g., cross-domain issues)
- **Existing Pattern**: Current EcoleDigitale system uses localStorage, but RSO module can adopt more secure default
- **User Experience**: httpOnly cookies work seamlessly with browser security features

**Alternatives Considered**:
1. **httpOnly cookies only**: Rejected because some deployment scenarios may have cookie restrictions
2. **localStorage only**: Rejected because it's less secure (vulnerable to XSS)
3. **Configurable (httpOnly default)**: Selected for security with flexibility

**Implementation Notes**:
- Default to httpOnly cookies with `SameSite=Strict` and `Secure` flags in production
- Provide environment variable to switch to localStorage if needed
- Implement token refresh mechanism that works with both storage methods

---

### 3. Password Hashing: Algorithm and Cost Factor

**Question**: Which password hashing algorithm and cost factor should be used?

**Decision**: Use bcryptjs with cost factor 12 (same as existing EcoleDigitale system).

**Rationale**:
- **Consistency**: Matches existing codebase standard (bcryptjs is already used)
- **Security**: Cost factor 12 provides strong security (2^12 = 4096 iterations) with acceptable performance
- **Industry Standard**: bcrypt is widely recognized and battle-tested
- **Performance**: Cost factor 12 takes ~300ms per hash, acceptable for authentication operations

**Alternatives Considered**:
1. **Argon2**: More modern and secure, but not currently used in codebase, would require new dependency
2. **bcrypt with cost factor 10**: Faster but less secure
3. **bcrypt with cost factor 14**: More secure but slower, may impact user experience
4. **bcryptjs cost factor 12**: Selected for balance of security, performance, and consistency

**Implementation Notes**:
- Use existing `bcryptjs` package (already in dependencies)
- Cost factor 12: `bcrypt.hash(password, 12)`
- Password validation: minimum 8 characters, 1 uppercase, 1 lowercase, 1 digit, 1 special character

---

### 4. Brute Force Protection: Rate Limiting Strategy

**Question**: How should brute force protection be implemented?

**Decision**: Implement IP-based rate limiting with in-memory store (Redis optional for distributed systems), with progressive CAPTCHA and temporary IP blocking.

**Rationale**:
- **IP-Based**: Simpler to implement and effective against most attacks
- **Progressive Response**: CAPTCHA after 3 attempts, block after 5 attempts (15-minute window)
- **In-Memory Store**: Sufficient for single-server deployment, can upgrade to Redis later
- **User-Friendly**: Legitimate users rarely hit limits, and 15-minute block is reasonable

**Alternatives Considered**:
1. **Account-based rate limiting**: More complex, requires database queries, may lock out legitimate users
2. **Redis-based distributed rate limiting**: Better for multi-server, but adds infrastructure complexity
3. **In-memory with IP-based (current)**: Selected for simplicity and effectiveness

**Implementation Notes**:
- Use Map/object to track IP attempts in memory (reset on server restart)
- Track: `{ ip: { attempts: number, firstAttempt: timestamp, blockedUntil: timestamp } }`
- CAPTCHA: Use existing CAPTCHA library (e.g., `react-google-recaptcha` or `hcaptcha`)
- Block duration: 15 minutes (configurable)

---

### 5. Email Service: SMTP Provider Selection

**Question**: Which email service should be used for password reset and welcome emails?

**Decision**: Use Nodemailer with SMTP configuration (support multiple providers: Gmail, SendGrid, custom SMTP).

**Rationale**:
- **Flexibility**: Nodemailer supports multiple SMTP providers
- **No Vendor Lock-in**: Can switch providers via configuration
- **Existing Pattern**: Common Node.js email solution
- **Cost-Effective**: Can use free tier (Gmail) or paid (SendGrid) based on needs

**Alternatives Considered**:
1. **SendGrid API directly**: Simpler but vendor lock-in
2. **AWS SES**: Good for AWS deployments, but adds AWS dependency
3. **Nodemailer with SMTP**: Selected for flexibility and provider independence

**Implementation Notes**:
- Use `nodemailer` package
- Support environment variables for SMTP configuration:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - Or provider-specific: `SENDGRID_API_KEY`, `GMAIL_APP_PASSWORD`
- HTML email templates for welcome and password reset
- Token expiration: 1 hour for password reset links

---

### 6. Activity Logging: Storage and Query Strategy

**Question**: How should activity logs be stored and queried for performance?

**Decision**: Store in PostgreSQL `rso_activity_logs` table with indexed columns (user_id, action, created_at) and optional archival strategy for old logs.

**Rationale**:
- **ISPS Compliance**: All logs must be retained for audit purposes
- **PostgreSQL Performance**: Proper indexing allows fast queries (< 5 seconds for 10k entries)
- **Simplicity**: Single database, no need for separate log aggregation system
- **Query Flexibility**: SQL allows complex filtering and export

**Alternatives Considered**:
1. **Separate logging service (ELK, Splunk)**: Overkill for Phase 1, adds infrastructure complexity
2. **File-based logging**: Harder to query and filter
3. **PostgreSQL with indexing**: Selected for simplicity and performance

**Implementation Notes**:
- Indexes: `(user_id, created_at)`, `(action, created_at)`, `(created_at DESC)`
- Pagination: Limit 100 logs per page for UI, unlimited for CSV export
- Archival: Optional strategy to move logs older than 1 year to archive table (future enhancement)

---

### 7. Permission System: Implementation Pattern

**Question**: How should role-based permissions be implemented and checked?

**Decision**: Use database-driven permission table (`rso_permissions`) with in-memory cache, and middleware-based permission checks.

**Rationale**:
- **Flexibility**: Permissions stored in database can be modified without code changes
- **Performance**: In-memory cache (refreshed on permission changes) provides fast checks
- **Maintainability**: Clear separation between permission definition and enforcement
- **Auditability**: Permission changes can be logged

**Alternatives Considered**:
1. **Hardcoded permissions in code**: Less flexible, requires code changes for permission updates
2. **Fully database-driven (no cache)**: Slower, database queries on every permission check
3. **Database with cache**: Selected for balance of flexibility and performance

**Implementation Notes**:
- Permission structure: `{ role, module, can_create, can_read, can_update, can_delete }`
- Cache: Load all permissions on server start, refresh on permission table updates
- Middleware: `checkPermission(module, action)` function used in route handlers
- Default permissions: Administrateur has all permissions, others have restricted access

---

### 8. Frontend Authentication: NextAuth.js vs Custom Implementation

**Question**: Should RSO-PFSO use NextAuth.js or custom authentication implementation?

**Decision**: Use custom authentication implementation for RSO module (separate from main NextAuth.js setup) with TanStack Query for API calls.

**Rationale**:
- **Separation**: RSO module has different authentication flow (different user table, different routes)
- **Flexibility**: Custom implementation allows full control over RSO-specific features
- **Simplicity**: Avoids complexity of extending NextAuth.js for separate user system
- **Consistency**: TanStack Query is already used in codebase for API calls

**Alternatives Considered**:
1. **Extend existing NextAuth.js**: Would require complex provider configuration and mixing two user systems
2. **Custom implementation**: Selected for clarity and separation

**Implementation Notes**:
- Create `lib/rso/auth.ts` with login/logout functions
- Use TanStack Query mutations for authentication
- Store JWT token in httpOnly cookie or localStorage (configurable)
- Implement token refresh interceptor in API client

---

### 9. Database Schema: Separate Tables vs Extensions

**Question**: Should RSO tables be completely separate or extend existing user/role tables?

**Decision**: Create completely separate `rso_*` tables with foreign key to `tenants` table for tenant isolation.

**Rationale**:
- **Domain Separation**: RSO is distinct business domain (port security) from education
- **Data Model Differences**: RSO users have different fields (installations, ISPS-specific data)
- **Regulatory Compliance**: ISPS code requires separate audit trails
- **Maintainability**: Clear separation makes code easier to understand and maintain

**Alternatives Considered**:
1. **Extend users table with rso_* columns**: Would mix domains and complicate queries
2. **Separate tables with tenant FK**: Selected for clear separation while maintaining tenant isolation

**Implementation Notes**:
- Tables: `rso_users`, `rso_user_sessions`, `rso_activity_logs`, `rso_permissions`
- Foreign key: `rso_users.tenant_id` → `tenants.id` (ASPCI tenant only)
- RLS policies: Ensure RSO tables respect tenant isolation

---

### 10. Token Refresh Strategy

**Question**: How should JWT token refresh be implemented?

**Decision**: Implement automatic token refresh 30 minutes before expiration, with refresh endpoint that validates current token and issues new token.

**Rationale**:
- **User Experience**: Seamless token refresh without user intervention
- **Security**: Refresh tokens can be invalidated if compromised
- **Performance**: Refresh before expiration avoids failed requests
- **Standard Pattern**: Common JWT refresh strategy

**Alternatives Considered**:
1. **No refresh, require re-login**: Poor user experience
2. **Refresh on every request**: Unnecessary overhead
3. **Refresh 30 minutes before expiration**: Selected for balance

**Implementation Notes**:
- Check token expiration on each API request
- If expires within 30 minutes, automatically call refresh endpoint
- Refresh endpoint validates current token and issues new token with extended expiration
- Store refresh token in httpOnly cookie (separate from access token)

---

## Summary of Technical Decisions

| Decision Area | Selected Approach | Key Rationale |
|---------------|-------------------|--------------|
| Authentication | Separate RSO auth system with shared JWT infrastructure | Domain separation, ISPS compliance |
| Session Storage | httpOnly cookies (default) with localStorage fallback | Security with flexibility |
| Password Hashing | bcryptjs cost factor 12 | Consistency with existing system |
| Brute Force Protection | IP-based rate limiting with progressive CAPTCHA/blocking | Simplicity and effectiveness |
| Email Service | Nodemailer with SMTP (multi-provider support) | Flexibility, no vendor lock-in |
| Activity Logging | PostgreSQL with proper indexing | ISPS compliance, query performance |
| Permissions | Database-driven with in-memory cache | Flexibility and performance |
| Frontend Auth | Custom implementation (separate from NextAuth.js) | Clear separation, full control |
| Database Schema | Separate rso_* tables with tenant FK | Domain separation, maintainability |
| Token Refresh | Automatic refresh 30 min before expiration | User experience and security |

## Dependencies Identified

### External Dependencies
- **nodemailer**: Email sending (password reset, welcome emails)
- **bcryptjs**: Password hashing (already in dependencies)
- **jsonwebtoken**: JWT token generation/validation (already in use)
- **zod**: Input validation (already in use)
- **@hcaptcha/react-hcaptcha** or **react-google-recaptcha**: CAPTCHA implementation

### Internal Dependencies
- Existing JWT service (`apps/api/src/services/jwt.service.ts`)
- Existing database connection and transaction patterns
- Existing tenant resolution middleware
- TanStack Query for frontend API calls

## Integration Points

1. **Database**: New `rso_*` tables in existing PostgreSQL database, leveraging RLS for tenant isolation
2. **JWT Service**: Reuse existing `jwt.service.ts` for token generation/validation
3. **Frontend**: New `/rso/*` route group in Next.js app, separate from main app routes
4. **Backend**: New `/api/v1/rso/*` routes in Fastify API, separate from existing routes
5. **Tenant System**: RSO module isolated to ASPCI tenant only

## Open Questions Resolved

All technical questions have been resolved. No remaining [NEEDS CLARIFICATION] markers.

## Next Steps

Proceed to Phase 1: Design & Contracts
- Generate data-model.md with complete database schema
- Generate API contracts (OpenAPI/Swagger)
- Generate quickstart.md with setup instructions

