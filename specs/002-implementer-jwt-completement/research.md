# Research: JWT Authentication Implementation

**Feature**: Complete JWT Authentication Implementation  
**Phase**: 0 (Research & Decision Documentation)  
**Date**: 2025-10-12

## Overview

This document consolidates research findings and architectural decisions for replacing the X-Dev-Auth bypass with proper JWT authentication in the EcoleDigitale platform.

## Research Areas

### 1. JWT Library Selection for Node.js/TypeScript

**Decision**: `jsonwebtoken` (npm package)

**Rationale**:
- Industry standard with 22M+ weekly downloads
- Mature library (10+ years), well-maintained
- TypeScript types available (`@types/jsonwebtoken`)
- Supports HS256, RS256, and other algorithms
- Simple API: `jwt.sign()`, `jwt.verify()`, `jwt.decode()`
- Automatic expiration validation
- Used successfully in millions of production applications

**Alternatives Considered**:
- **jose**: Modern, spec-compliant, but less battle-tested than jsonwebtoken
- **paseto**: More secure token format, but not industry standard (would break JWT compatibility)
- **jsonwebtoken** vs **jose**: jsonwebtoken chosen for ecosystem maturity and team familiarity

**Implementation Notes**:
```typescript
import jwt from 'jsonwebtoken';

// Signing
const token = jwt.sign(payload, process.env.JWT_SECRET!, {
  expiresIn: '24h',
  issuer: 'ecoledigitale',
  audience: tenantSlug
});

// Verification
const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
  issuer: 'ecoledigitale',
  audience: tenantSlug
});
```

### 2. JWT Signing Algorithm

**Decision**: HS256 (HMAC with SHA-256)

**Rationale**:
- Symmetric signing (same secret for sign + verify) - simpler for monolithic backend
- Fast performance (<1ms per operation)
- 256-bit security strength meets requirements
- No need for public/private key infrastructure
- Adequate security for 24-hour token lifetime
- All backend instances share same secret (no key distribution complexity)

**Alternatives Considered**:
- **RS256** (RSA asymmetric): More complex, requires key pair management, overkill for internal authentication
- **ES256** (ECDSA): Faster than RSA but still more complex than needed
- **HS512**: Stronger but HS256 is sufficient and more widely supported

**Security Notes**:
- JWT_SECRET must be 256+ bits (32+ characters) strong random string
- Secret stored in environment variable only, never committed
- Secret rotation requires all tokens to be invalidated (acceptable for 24h lifetime)

### 3. Token Blacklist Implementation Strategy

**Decision**: Hybrid - PostgreSQL table with optional Redis cache

**Rationale**:
- **Database table** ensures persistence across restarts (critical for token revocation)
- **Optional Redis cache** provides <10ms lookup performance for high-traffic scenarios
- Token blacklist grows slowly (only on role changes, account deletion, forced logout)
- Automatic cleanup: cron job removes expired tokens daily (tokens with `exp < NOW()`)
- Tenant-scoped queries + RLS ensure isolation

**Alternatives Considered**:
- **In-memory only**: Fast but loses revocations on restart (REJECTED - security risk)
- **Redis only**: Fast but requires Redis infrastructure (DEFERRED - start with PostgreSQL, add Redis if needed)
- **PostgreSQL only**: Adequate performance for MVP (<100ms acceptable per spec), simpler infrastructure

**Schema Design**:
```sql
CREATE TABLE token_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  token_jti VARCHAR(64) NOT NULL,  -- JWT ID claim (hash of token)
  revoked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,    -- Copy of token exp for cleanup
  reason VARCHAR(50),               -- 'role_change', 'account_deleted', 'forced_logout'
  UNIQUE(tenant_id, token_jti)
);

CREATE INDEX idx_blacklist_lookup ON token_blacklist(tenant_id, token_jti, expires_at);
-- Cleanup query: DELETE FROM token_blacklist WHERE expires_at < NOW();
```

**Blacklist Check Logic**:
1. Verify JWT signature (fast, no DB)
2. Check expiration (fast, no DB)
3. If sensitive operation → query blacklist table
4. If read operation → skip blacklist check (clarified in spec)

### 4. Token Storage: localStorage vs httpOnly Cookies

**Decision**: localStorage (clarified by user in spec session)

**Rationale**:
- **Persistence**: Must survive browser restart for 24-hour token lifetime
- **Simplicity**: Frontend fully controls token (no cookie domain issues)
- **XSS Vulnerability**: Acknowledged and accepted (mitigated by Content Security Policy)
- **No CSRF risk**: Tokens in Authorization header, not cookies
- **Cross-subdomain**: Works seamlessly with subdomain tenant routing

**Alternatives Considered**:
- **httpOnly cookies**: More secure (XSS-immune) but requires backend cookie handling changes, CSRF protection needed
- **sessionStorage**: Lost on browser restart, doesn't meet 24h persistence requirement
- **Memory only**: Lost on page refresh, poor UX

**localStorage Implementation**:
```typescript
// Storage key
const TOKEN_KEY = 'ecoledigitale_jwt_token';

// Save
localStorage.setItem(TOKEN_KEY, token);

// Retrieve
const token = localStorage.getItem(TOKEN_KEY);

// Remove (logout)
localStorage.removeItem(TOKEN_KEY);

// Decode expiration (client-side, for refresh trigger)
const decoded = jwt_decode(token);  // Use jwt-decode library (no verification, just parsing)
const expiresAt = decoded.exp * 1000;  // Convert to milliseconds
```

**XSS Mitigation**:
- Implement Content Security Policy headers
- Sanitize all user-generated content before rendering
- Use framework XSS protections (Next.js auto-escaping)
- Regular dependency security audits

### 5. Token Refresh Mechanism

**Decision**: Automatic frontend check before each request (5-minute window)

**Rationale**:
- **Seamless UX**: Users never interrupted for re-login during active use
- **Performance**: Token decode is cheap (<1ms), no backend call unless refresh needed
- **Race condition handling**: Single refresh promise, all concurrent requests wait
- **5-minute window**: Balance between too-frequent refreshes and user interruption

**Implementation Pattern**:
```typescript
// In fetch interceptor
let refreshPromise: Promise<string> | null = null;

async function getValidToken(): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  
  const decoded = jwt_decode(token);
  const expiresAt = decoded.exp * 1000;
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  
  // If expires in less than 5 minutes, refresh
  if (expiresAt - now < fiveMinutes) {
    if (!refreshPromise) {
      refreshPromise = refreshToken(token).finally(() => {
        refreshPromise = null;
      });
    }
    return await refreshPromise;
  }
  
  return token;
}
```

**Refresh Endpoint**:
- `POST /api/v1/auth/refresh`
- Input: Valid non-expired JWT
- Output: New JWT with extended expiration
- Validation: Must verify old token is not blacklisted before issuing new one

### 6. Integration with Existing NextAuth.js

**Decision**: Extend NextAuth login flow to return JWT in response

**Rationale**:
- **Minimal disruption**: Keep NextAuth for login UI and credential validation
- **JWT generation**: Add JWT generation step after successful authentication
- **Hard cutover**: On deployment, all existing NextAuth sessions invalidated
- **Backward compatibility**: Not required (hard cutover strategy accepted)

**Integration Points**:
```typescript
// apps/web/src/app/api/auth/[...nextauth]/route.ts

export const authOptions: NextAuthOptions = {
  // ... existing config ...
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Generate JWT on login
        const jwtToken = jwt.sign(
          {
            userId: user.id,
            tenantId: user.tenantId,
            tenantSlug: user.tenantSlug,
            roles: user.roles,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)  // 24 hours
          },
          process.env.JWT_SECRET!
        );
        
        // Store JWT in token object
        (token as any).jwtToken = jwtToken;
      }
      return token;
    },
    
    async session({ session, token }) {
      // Include JWT in session response
      (session as any).jwtToken = (token as any).jwtToken;
      return session;
    }
  }
};
```

**Frontend receives JWT**:
```typescript
// After login
const session = await getSession();
if (session?.jwtToken) {
  localStorage.setItem(TOKEN_KEY, session.jwtToken);
}
```

### 7. Tenant Isolation Through JWT Claims

**Decision**: Validate tenantId in JWT matches X-Tenant header on every request

**Rationale**:
- **Defense in depth**: Even if JWT signature valid, ensure tenant context matches
- **Prevents token reuse**: User cannot use token from tenant A to access tenant B
- **Early failure**: Reject at middleware level before business logic
- **Constitution compliance**: Enforces Principle I (Multi-Tenant Isolation)

**Validation Logic**:
```typescript
// In auth middleware
const token = extractToken(request.headers.authorization);
const decoded = jwt.verify(token, JWT_SECRET);

const requestTenant = request.headers['x-tenant'];
if (decoded.tenantId !== getTenantIdFromSlug(requestTenant)) {
  throw new Error('Token tenant mismatch');
}
```

### 8. Error Handling and User Experience

**Decision**: Structured error responses with automatic frontend redirect

**Rationale**:
- **Clear error messages**: "Token expired", "Invalid signature", "Token revoked" help debugging
- **Automatic redirect**: Frontend detects 401, clears localStorage, redirects to /login
- **Graceful degradation**: If refresh fails, fall back to requiring re-login
- **Logging**: All auth failures logged for security monitoring

**Error Response Format**:
```typescript
// 401 Unauthorized responses
{
  error: "Authentication Required",
  message: "Token expired",  // or "Invalid signature", "Token revoked", etc.
  code: "TOKEN_EXPIRED"
}
```

## Recommended Reading

- [RFC 7519: JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519)
- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [JWT.io - Industry resource for JWT libraries and debugging](https://jwt.io/)
- [jsonwebtoken npm package documentation](https://www.npmjs.com/package/jsonwebtoken)
- [localStorage XSS Considerations](https://www.rdegges.com/2018/please-stop-using-local-storage/)

## Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| XSS attack steals token from localStorage | Medium | High | CSP headers, content sanitization, dependency audits |
| Token blacklist query performance degrades | Low | Medium | Add PostgreSQL index, consider Redis cache if needed |
| Hard cutover forces all users to re-login simultaneously | High | Low | Expected behavior, communicate to users, monitor login spike |
| JWT secret leaked | Low | Critical | Environment variable only, rotate immediately if compromised, invalidates all tokens |
| Clock skew between servers causes token validation issues | Low | Medium | NTP synchronization at infrastructure level, add 30s leeway in validation |

## Success Metrics

- Zero X-Dev-Auth code remains in codebase (grep verification)
- 100% of authenticated requests use JWT validation
- Token generation <100ms per login (measured via backend logs)
- Token validation <10ms per request (measured via middleware timing)
- Blacklist check <100ms (measured via query logging)
- Zero authentication bypass code in production

## Next Steps

Proceed to **Phase 1: Design & Contracts**
- Create data model for token blacklist table
- Define API contracts for login, refresh, logout
- Generate quickstart guide for testing JWT flow













