# Feature Specification: Complete JWT Authentication Implementation

**Feature Branch**: `002-implementer-jwt-completement`  
**Created**: 2025-10-12  
**Status**: Draft  
**Input**: User description: "Implementer JWT completement pour remplacer le systeme d'authentification temporaire X-Dev-Auth"

## Clarifications

### Session 2025-10-12

- Q: Where should the frontend store JWT tokens? → A: localStorage (persists across browser restarts to support 24-hour token lifetime, vulnerable to XSS but matches persistence requirements)
- Q: How should the system handle valid JWT tokens for deleted/disabled user accounts? → A: Hybrid approach - trust token for read operations, verify account status in database for sensitive operations (write/delete/role changes) to balance security with performance
- Q: When/how should token refresh be triggered? → A: Automatic frontend check - frontend decodes token expiry before each request and automatically calls refresh endpoint if within 5 minutes of expiration, ensuring seamless user experience
- Q: How should the system handle the transition from NextAuth sessions to JWT tokens? → A: Hard cutover - deploy JWT implementation and invalidate all existing NextAuth sessions, requiring all users to re-login (simplest implementation, immediate security benefit, temporary UX disruption acceptable for security fix)
- Q: How should the system handle role changes when users have active JWT tokens? → A: Force re-login on role change - when admin modifies user roles, system invalidates existing JWT token (via blacklist), user receives 401 on next request and must re-authenticate to receive token with updated roles (secure, immediate enforcement)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Secure Login with JWT Token Generation (Priority: P1)

When a user (student, teacher, or admin) logs into the EcoleDigitale platform, the system authenticates their credentials and issues a cryptographically signed JWT token that proves their identity for subsequent requests.

**Why this priority**: This is the foundation of the entire authentication system. Without secure token generation on login, no other JWT functionality can work. This represents the core value proposition: replacing the insecure X-Dev-Auth bypass with industry-standard authentication.

**Independent Test**: Can be fully tested by logging in with valid credentials and verifying that a JWT token is returned in the response. The token should decode to show user ID, tenant ID, and roles. This delivers immediate security value by eliminating the development bypass on login.

**Acceptance Scenarios**:

1. **Given** a valid user account exists, **When** the user submits correct email and password, **Then** the backend returns a JWT token containing user ID, tenant ID, tenant slug, and roles
2. **Given** an invalid email or password is submitted, **When** the user attempts to login, **Then** the system returns an authentication error without issuing a token
3. **Given** a user from tenant A tries to login, **When** authentication succeeds, **Then** the JWT token includes tenant A's ID and ensures tenant isolation
4. **Given** a JWT token is issued, **When** the token is decoded, **Then** it contains a signature that can be verified using the secret key and includes an expiration time

---

### User Story 2 - Authenticated API Requests with JWT Validation (Priority: P1)

When an authenticated user makes API requests to access their data (courses, assignments, attendance, etc.), the system validates their JWT token on every request to ensure the user is who they claim to be and has not been logged out.

**Why this priority**: This is equally critical as token generation because it enforces security on all protected endpoints. Without this, issuing tokens would be meaningless. This delivers the core security benefit of proper authentication.

**Independent Test**: Can be fully tested by making any authenticated API request (e.g., GET /api/v1/student/courses) with a valid JWT token in the Authorization header and verifying that the request succeeds with correct user context. Making the same request without a token or with an invalid token should return 401 Unauthorized. This can be tested immediately after P1 is implemented.

**Acceptance Scenarios**:

1. **Given** a user has a valid JWT token, **When** they make an API request with "Authorization: Bearer {token}" header, **Then** the backend validates the token signature and processes the request with correct user context
2. **Given** a user has an expired JWT token, **When** they make an API request, **Then** the backend returns 401 Unauthorized with "Token expired" message
3. **Given** a user has a tampered JWT token (invalid signature), **When** they make an API request, **Then** the backend returns 401 Unauthorized with "Invalid token" message
4. **Given** a user makes an API request without an Authorization header, **When** the request reaches the backend, **Then** the backend returns 401 Unauthorized (no fallback to X-Dev-Auth)
5. **Given** a user with role "student" has a valid token, **When** they try to access a teacher-only endpoint, **Then** the backend returns 403 Forbidden based on roles extracted from the token
6. **Given** a user has a valid JWT token but their account has been disabled, **When** they attempt a sensitive operation (create/update/delete), **Then** the backend verifies account status in database and returns 401 Unauthorized with "Account disabled" message
7. **Given** a user has a valid JWT token but their account has been disabled, **When** they attempt a read-only operation, **Then** the request succeeds using token validation only (no database check) for performance
8. **Given** an admin modifies a user's roles, **When** the role change is saved, **Then** the system adds the user's current JWT token to the blacklist
9. **Given** a user's token has been blacklisted due to role change, **When** they make an API request with that token, **Then** the backend returns 401 Unauthorized with "Token revoked" message and the frontend redirects to login

---

### User Story 3 - Frontend Token Storage and Automatic Injection (Priority: P2)

When a user successfully logs in, the frontend securely stores the JWT token and automatically includes it in all API requests without requiring manual intervention. When the token expires, the user is prompted to log in again.

**Why this priority**: This enables the seamless user experience that makes P1 and P2 functional from the user's perspective. While P1/P2 handle the security mechanics, this handles the user-facing integration. It's P2 because the token mechanics must work first before we can integrate them into the UI flow.

**Independent Test**: Can be fully tested by logging in and verifying that the token is stored in localStorage, then navigating to different pages and observing that API requests automatically include the Authorization header. Can also test by manually expiring the token and verifying the user is redirected to login. This delivers full end-to-end authentication flow.

**Acceptance Scenarios**:

1. **Given** a user successfully logs in, **When** the JWT token is received, **Then** the frontend stores it in localStorage with a defined key (e.g., "jwt_token")
2. **Given** a stored JWT token exists, **When** the user makes any API request through the fetch interceptor, **Then** the Authorization header is automatically added with "Bearer {token}"
3. **Given** a user has a valid token, **When** they refresh the page, **Then** the token persists and they remain authenticated
4. **Given** a user's token expires, **When** they try to make an API request, **Then** the frontend detects the 401 response and redirects to the login page
5. **Given** a user clicks logout, **When** the logout action completes, **Then** the JWT token is removed from storage and subsequent requests are unauthenticated

---

### User Story 4 - Token Refresh for Extended Sessions (Priority: P3)

When a user is actively using the application and their JWT token is close to expiring, the system automatically refreshes the token to extend their session without interrupting their work or requiring them to log in again.

**Why this priority**: This improves user experience by preventing unnecessary login interruptions during active use. It's P3 because the core authentication works without it (users can just log in again), but it's important for production quality. This is a common pattern in JWT implementations.

**Independent Test**: Can be fully tested by logging in, waiting until the token is near expiration (or manually setting a short expiration for testing), making an API request, and verifying that a new token is issued and stored. The user should remain authenticated throughout. This delivers enhanced UX for long sessions.

**Acceptance Scenarios**:

1. **Given** a user has a JWT token that will expire in less than 5 minutes, **When** they make an API request, **Then** the frontend fetch interceptor decodes the token expiration, automatically calls the refresh endpoint, receives a new token, stores it in localStorage, and proceeds with the original request
2. **Given** a user has been inactive for the entire token lifetime, **When** the token expires, **Then** no automatic refresh occurs (refresh only triggers within 5 minutes of expiry) and the user must log in again
3. **Given** a token refresh is in progress, **When** multiple API requests are made simultaneously, **Then** all requests wait for the refresh to complete and use the new token
4. **Given** a user's token is refreshed successfully, **When** the new token is received, **Then** the frontend replaces the old token in localStorage and subsequent requests use the new token

---

### User Story 5 - Complete Removal of Development Bypasses (Priority: P1)

The system operates without any authentication bypasses in development or production. All requests must use valid JWT tokens, ensuring that security is tested and enforced from the earliest development stages.

**Why this priority**: This is P1 because it's the entire reason for this feature - removing the security vulnerability introduced by X-Dev-Auth. Without this, implementing JWT would be pointless if the bypasses remain. This must be part of the initial implementation.

**Independent Test**: Can be fully tested by searching the codebase for "X-Dev-Auth" and "dev-bypass" patterns and verifying none exist. Then attempt to make authenticated API requests without JWT tokens and confirm all return 401. This can be validated immediately after P1/P2 implementation.

**Acceptance Scenarios**:

1. **Given** any API endpoint that requires authentication, **When** a request is made with X-Dev-Auth header but no JWT token, **Then** the backend returns 401 Unauthorized
2. **Given** the backend auth middleware, **When** examining the code, **Then** no development bypass logic exists (no checks for NODE_ENV === 'development' that skip authentication)
3. **Given** the frontend fetch interceptor, **When** examining the code, **Then** no X-Dev-Auth header is added to requests and no development bypass warnings appear in logs
4. **Given** a developer runs the application locally, **When** they test authenticated features, **Then** they must use valid login credentials and JWT tokens (same as production)
5. **Given** JWT authentication is deployed to production, **When** users with existing NextAuth sessions try to access the application, **Then** their sessions are invalidated, they are redirected to the login page, and must re-authenticate to receive JWT tokens

---

### Edge Cases

- What happens when a JWT token is valid but the user account has been deleted or disabled? → **Resolution**: System uses hybrid validation - read operations proceed with token validation only; sensitive operations (write/delete/role changes) trigger real-time database check of account status
- What happens when a user's roles change (e.g., promoted from student to teacher) but they still have an old JWT token with outdated roles? → **Resolution**: System adds user's current token to blacklist when roles are modified by admin. On next API request, user receives 401 Unauthorized, is redirected to login, and receives new token with updated roles upon re-authentication.
- What happens when the JWT secret key is rotated (security best practice) - do all existing tokens become invalid?
- What happens when a user has tokens issued from multiple devices/browsers?
- What happens when system time is incorrect (clock skew) and token expiration validation fails incorrectly?
- What happens when a user attempts to use a token intended for tenant A to access resources in tenant B?
- What happens during the transition period - are there users with active NextAuth sessions but no JWT tokens? → **Resolution**: Hard cutover approach - all existing NextAuth sessions are invalidated upon deployment, users are redirected to login page and must re-authenticate to receive JWT tokens. No parallel authentication support or migration period.
- What happens if malicious JavaScript (XSS attack) gains access to localStorage - can it steal the JWT token? (Note: localStorage is vulnerable to XSS; system must implement XSS protection via Content Security Policy and input sanitization)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate a cryptographically signed JWT token upon successful user authentication containing user ID, tenant ID, tenant slug, and roles array
- **FR-002**: System MUST set JWT token expiration to 24 hours from issuance time
- **FR-003**: System MUST use a secure cryptographic signing algorithm for JWT tokens with at least 256-bit key strength
- **FR-004**: Backend authentication middleware MUST validate JWT token signature on every authenticated API request
- **FR-005**: Backend MUST extract user context (ID, tenant, roles) from validated JWT tokens and attach to request object
- **FR-006**: Backend MUST return 401 Unauthorized with descriptive error message when JWT token is missing, expired, or invalid
- **FR-007**: Frontend MUST store JWT token in localStorage after successful login to persist authentication across page refreshes and browser restarts
- **FR-008**: Frontend fetch interceptor MUST decode JWT token expiration, trigger automatic refresh if within 5 minutes of expiration, and add "Authorization: Bearer {token}" header to all API requests (except login endpoint)
- **FR-009**: Frontend MUST detect 401 responses and redirect user to login page, clearing stored token
- **FR-010**: System MUST remove all X-Dev-Auth header checks and development authentication bypasses from both frontend and backend
- **FR-011**: Backend MUST validate that the tenant ID in the JWT token matches the X-Tenant header to enforce tenant isolation
- **FR-012**: System MUST provide a token refresh endpoint that issues a new JWT token when provided with a valid non-expired token
- **FR-013**: System MUST log authentication failures (invalid/expired tokens) for security monitoring
- **FR-014**: Backend MUST reject requests with valid JWT signature but expired timestamp with specific "Token expired" error
- **FR-015**: Frontend MUST handle logout by removing stored JWT token and clearing any authentication state
- **FR-016**: Backend MUST verify account status (not deleted/disabled) in database for sensitive operations (create, update, delete, role-based actions) while accepting valid tokens for read-only operations to balance security with performance
- **FR-017**: System MUST invalidate all existing NextAuth sessions upon JWT deployment, requiring users to re-login to obtain JWT tokens (hard cutover strategy)
- **FR-018**: System MUST maintain a token blacklist (in-memory cache or database) containing invalidated JWT tokens to enforce immediate revocation
- **FR-019**: Backend MUST check token blacklist during validation and return 401 Unauthorized if token is blacklisted, even if signature and expiration are valid
- **FR-020**: System MUST automatically add user's current JWT token to blacklist when admin modifies user roles, forcing re-login to obtain token with updated roles

### Security & Compliance Requirements (Constitution-Driven)

- **SR-001**: System MUST enforce tenant isolation by validating JWT tenant ID against request context (Constitution Principle I)
- **SR-002**: System MUST store JWT secret key in environment variables, never in source code (Constitution Principle VII)
- **SR-003**: System MUST use secure random string of at least 256 bits (32 characters) for JWT secret key
- **SR-004**: System MUST validate JWT token signature before trusting any claims contained within
- **SR-005**: System MUST include token expiration (exp claim) in every JWT and validate it on every request
- **SR-006**: System MUST NOT include sensitive data (passwords, full personal details) in JWT payload since it's readable by anyone
- **SR-007**: System MUST implement role-based access control using roles extracted from validated JWT tokens (Constitution Principle III)
- **SR-008**: System MUST use HTTPS in production to protect JWT tokens from interception during transmission (HTTPS already configured via nginx SSL on port 443)

### Key Entities *(include if feature involves data)*

- **JWT Token**: A cryptographically signed token containing claims about the authenticated user. Attributes: header (algorithm, type), payload (user ID, tenant ID, tenant slug, roles, issued at, expiration), signature
- **User Session**: Represents an authenticated user's session. Attributes: JWT token string, expiration time, associated user ID, tenant context
- **Authentication Secret**: The secret key used to sign and verify JWT tokens. Must be identical across all backend instances for distributed systems.
- **Token Blacklist**: Collection of revoked JWT tokens that remain valid by signature but must be rejected. Attributes: token identifier (jti claim or hash), revocation timestamp, expiration time (for cleanup). Used to enforce immediate token invalidation on role changes, account deletion, or forced logout.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can log in and receive a valid JWT token within 2 seconds of submitting credentials
- **SC-002**: All authenticated API requests validate JWT tokens, with 100% of requests without valid tokens returning 401 status
- **SC-003**: Zero instances of X-Dev-Auth or development bypass code exist in the codebase after implementation
- **SC-004**: Users remain authenticated across page refreshes and browser restarts for up to 24 hours without re-entering credentials
- **SC-005**: Token validation adds less than 10 milliseconds of latency to API request processing
- **SC-006**: Authentication failure rate for legitimate users remains below 0.1% (excluding intentional invalid credentials)
- **SC-007**: All role-based access control decisions use roles from JWT tokens, not from separate database queries
- **SC-008**: System can handle 1000 concurrent authenticated users without authentication bottlenecks
- **SC-009**: Expired tokens are rejected within 1 second of expiration time being reached
- **SC-010**: Manual security audit confirms no authentication bypasses remain and JWT implementation follows OWASP best practices
- **SC-011**: Token refresh executes automatically and transparently when user is active within 5 minutes of token expiration, with no user-visible interruption
- **SC-012**: Blacklisted tokens are rejected within 100 milliseconds of blacklist check, ensuring immediate enforcement of role changes and forced logouts

## Assumptions

- The backend has access to JWT cryptographic libraries for token signing and validation
- The frontend can securely store authentication tokens in the browser
- All backend instances in distributed deployments share the same signing secret
- The existing authentication system can be extended to issue signed tokens containing user claims
- The backend login endpoint currently returns user identity and authorization data suitable for token payload
- Token refresh functionality is considered nice-to-have (P3) and can be implemented after core authentication works
- HTTPS is configured for production deployment (verified in nginx configuration at infra/nginx/ecoledigitale.conf)
- Clock synchronization across servers is handled at infrastructure level for accurate token expiration validation

## Dependencies

- Existing NextAuth session management (may need modification or replacement)
- Backend authentication middleware (needs significant refactoring)
- Frontend fetch interceptor (needs refactoring to use JWT instead of X-Dev-Auth)
- Environment variable management for JWT secret storage
- Backend login endpoint that returns user authentication data
- Token blacklist infrastructure (in-memory cache or database table) for revoked token storage and fast lookup
- Admin interface for role management (must trigger token blacklist addition on role changes)
