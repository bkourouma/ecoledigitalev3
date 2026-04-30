# Data Model: JWT Authentication

**Feature**: Complete JWT Authentication Implementation  
**Phase**: 1 (Design & Contracts)  
**Date**: 2025-10-12

## Overview

This document defines the data structures for JWT authentication, including the JWT payload format, token blacklist table schema, and related entities.

## 1. JWT Payload Structure

### JWT Claims (Payload)

```typescript
interface JWTPayload {
  // Standard JWT claims
  iss: string;          // Issuer: "ecoledigitale"
  aud: string;          // Audience: tenant slug (e.g., "imhotepacademy")
  sub: string;          // Subject: user ID (UUID)
  iat: number;          // Issued at: Unix timestamp
  exp: number;          // Expiration: Unix timestamp (iat + 24 hours)
  jti: string;          // JWT ID: Unique token identifier (UUID or hash)
  
  // Custom claims (EcoleDigitale-specific)
  userId: string;       // User ID (UUID) - duplicates sub for clarity
  tenantId: string;     // Tenant ID (UUID)
  tenantSlug: string;   // Tenant slug (string) - duplicates aud for clarity
  roles: string[];      // User roles: ["student"] | ["teacher"] | ["admin"] | ["parent"]
}
```

**Field Descriptions**:
- **iss** (issuer): Always "ecoledigitale" - prevents tokens from other systems being accepted
- **aud** (audience): Tenant slug - enables multi-tenant token validation
- **sub** (subject): Standard JWT user identifier
- **iat** (issued at): Token creation timestamp - for audit logging
- **exp** (expiration): Token expiry timestamp - enforced on every validation
- **jti** (JWT ID): Unique identifier for blacklisting (hash of token or UUID generated at creation)
- **userId**: Explicit user ID for application logic (same as sub)
- **tenantId**: UUID reference to tenants table - validated against X-Tenant header
- **tenantSlug**: Human-readable tenant identifier - for subdomain routing
- **roles**: Array of role strings - used for RBAC without database query

**Example JWT Payload**:
```json
{
  "iss": "ecoledigitale",
  "aud": "imhotepacademy",
  "sub": "a82a680c-0888-4f0c-96cc-9531d0b95373",
  "iat": 1697097600,
  "exp": 1697184000,
  "jti": "f7c3a8b2-4d1e-4f5a-9b2c-6e8d7f3a1c4b",
  "userId": "a82a680c-0888-4f0c-96cc-9531d0b95373",
  "tenantId": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
  "tenantSlug": "imhotepacademy",
  "roles": ["student"]
}
```

**Security Notes**:
- Payload is **NOT encrypted** (anyone can decode) - never include passwords, SSNs, or sensitive personal data
- Payload **IS signed** - tampering invalidates signature
- Payload size impacts header size - keep minimal (roles array, not full user object)

## 2. Token Blacklist Table

### Database Schema

```sql
-- Migration: 012_create_token_blacklist_table.sql

CREATE TABLE IF NOT EXISTS token_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tenant isolation (CRITICAL)
  tenant_id UUID NOT NULL,
  
  -- Token identification
  token_jti VARCHAR(64) NOT NULL,           -- JWT ID claim (from JWT payload)
  user_id UUID NOT NULL,                    -- User who owned the token
  
  -- Revocation metadata
  revoked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,             -- Copy of token exp (for cleanup)
  reason VARCHAR(50),                        -- 'role_change', 'account_deleted', 'forced_logout', 'admin_revoked'
  revoked_by UUID,                           -- Admin user who revoked (if applicable)
  
  -- Constraints
  CONSTRAINT fk_token_blacklist_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_token_blacklist_user FOREIGN KEY (user_id) 
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT unique_tenant_token UNIQUE(tenant_id, token_jti)
);

-- Indexes for performance
CREATE INDEX idx_blacklist_lookup ON token_blacklist(tenant_id, token_jti, expires_at) 
  WHERE expires_at > NOW();  -- Partial index: only non-expired tokens

CREATE INDEX idx_blacklist_user ON token_blacklist(tenant_id, user_id);

CREATE INDEX idx_blacklist_cleanup ON token_blacklist(expires_at) 
  WHERE expires_at <= NOW();  -- For cleanup cron job

-- Row Level Security (RLS) for tenant isolation
ALTER TABLE token_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON token_blacklist
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Comments for documentation
COMMENT ON TABLE token_blacklist IS 'Stores revoked JWT tokens that remain valid by signature but must be rejected. Used for immediate role change enforcement and forced logout.';
COMMENT ON COLUMN token_blacklist.token_jti IS 'JWT ID claim from token payload - used for O(1) lookup during validation';
COMMENT ON COLUMN token_blacklist.expires_at IS 'Copied from token exp claim - enables automatic cleanup of expired entries';
COMMENT ON COLUMN token_blacklist.reason IS 'Why token was revoked: role_change | account_deleted | forced_logout | admin_revoked';
```

### TypeScript Entity

```typescript
// packages/contracts/src/entities/token-blacklist.ts

import { z } from 'zod';

export const TokenBlacklistEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tokenJti: z.string().max(64),
  userId: z.string().uuid(),
  revokedAt: z.date(),
  expiresAt: z.date(),
  reason: z.enum(['role_change', 'account_deleted', 'forced_logout', 'admin_revoked']).optional(),
  revokedBy: z.string().uuid().optional()
});

export type TokenBlacklistEntry = z.infer<typeof TokenBlacklistEntrySchema>;

// For insert operations (auto-generated fields excluded)
export const CreateTokenBlacklistEntrySchema = TokenBlacklistEntrySchema.omit({
  id: true,
  revokedAt: true
});

export type CreateTokenBlacklistEntry = z.infer<typeof CreateTokenBlacklistEntrySchema>;
```

### Blacklist Operations

**1. Add Token to Blacklist**
```sql
-- When role changes or account deleted
INSERT INTO token_blacklist (tenant_id, token_jti, user_id, expires_at, reason, revoked_by)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (tenant_id, token_jti) DO NOTHING;
```

**2. Check if Token is Blacklisted**
```sql
-- During auth middleware validation
SELECT EXISTS(
  SELECT 1 FROM token_blacklist
  WHERE tenant_id = $1 
    AND token_jti = $2 
    AND expires_at > NOW()
) AS is_blacklisted;
```

**3. Cleanup Expired Tokens** (Cron job - daily)
```sql
-- Remove tokens that have already expired
DELETE FROM token_blacklist
WHERE expires_at < NOW();
```

**4. Revoke All User Tokens** (When account deleted)
```sql
-- Get all active JTIs for user, add to blacklist
-- This requires tracking issued tokens (future enhancement) OR
-- Simply delete user account and let next validation fail on user lookup
```

### Query Performance Estimates

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| Blacklist check | <10ms | Indexed lookup on (tenant_id, token_jti) |
| Add to blacklist | <5ms | Simple INSERT |
| Cleanup cron | <100ms | Bulk DELETE with index on expires_at |
| User token revocation | <50ms | Index scan on (tenant_id, user_id) |

**Performance Optimization**:
- Partial indexes exclude expired tokens from lookup
- RLS policies use tenant_id which is part of primary index
- Cleanup cron runs daily off-peak (removes ~1-5% of rows typically)

## 3. Related Entities

### User Entity (Existing - No Modifications)

```typescript
// Reference: packages/contracts/src/entities/user.ts
interface User {
  id: string;           // UUID - included in JWT as sub/userId
  email: string;
  tenantId: string;     // UUID - included in JWT
  tenantSlug: string;   // String - included in JWT as aud
  roles: string[];      // Array - included in JWT
  // ... other fields not included in JWT
}
```

**No changes required to users table schema.**

### Tenant Entity (Existing - No Modifications)

```typescript
// Reference: packages/contracts/src/entities/tenant.ts
interface Tenant {
  id: string;           // UUID - referenced by JWT tenantId
  slug: string;         // String - referenced by JWT aud/tenantSlug
  // ... other fields
}
```

**No changes required to tenants table schema.**

## 4. State Transitions

### Token Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     TOKEN LIFECYCLE                              │
└─────────────────────────────────────────────────────────────────┘

[User Login]
     │
     ├─ Generate JWT with 24h expiration
     │
     v
[Active Token]
     │
     ├─────────────────────────────────────────────────────────────┐
     │                                                              │
     │  User makes API requests                                    │
     │  Token validated on each request                            │
     │                                                              │
     │  Within 5 min of expiry?                                    │
     │    ├─ YES → Automatic refresh (new token issued)           │
     │    └─ NO  → Continue with current token                    │
     │                                                              │
     └─────────────────────────────────────────────────────────────┘
     │
     ├─ Role Change? ──────────> [Add to Blacklist] ─> [Revoked]
     │                                                        │
     ├─ Account Deleted? ──────> [Add to Blacklist] ─> [Revoked]
     │                                                        │
     ├─ Forced Logout? ────────> [Add to Blacklist] ─> [Revoked]
     │                                                        │
     ├─ 24h Expires? ──────────> [Expired - Auto-rejected]
     │
     └─ User Logout? ──────────> [Removed from localStorage] ─> [Inactive]
```

### Blacklist Entry Lifecycle

```
[Role Change Event]
     │
     v
[Token Added to Blacklist]
     │
     ├─ User makes request with old token
     │    └─> 401 Unauthorized ("Token revoked")
     │         └─> Frontend redirects to login
     │              └─> User re-authenticates
     │                   └─> New token with updated roles issued
     │
     └─ Token exp reaches
          └─> Cleanup cron removes from blacklist
```

## 5. Validation Rules

### JWT Validation Checklist (Auth Middleware)

```typescript
// Validation order (fail fast)
1. Extract token from Authorization header
   - Header present? If NO → 401 "Authentication required"
   - Format "Bearer <token>"? If NO → 401 "Invalid authorization format"

2. Verify JWT signature
   - Signature valid? If NO → 401 "Invalid signature"
   - Uses JWT_SECRET from environment

3. Verify standard claims
   - Token expired (exp < NOW)? If YES → 401 "Token expired"
   - Issuer = "ecoledigitale"? If NO → 401 "Invalid issuer"
   - Audience matches tenant? If NO → 401 "Invalid audience"

4. Verify custom claims
   - tenantId matches X-Tenant header? If NO → 401 "Tenant mismatch"
   - roles array not empty? If NO → 401 "No roles assigned"

5. Check blacklist (if sensitive operation)
   - Token in blacklist? If YES → 401 "Token revoked"
   - Skip for read-only operations (performance optimization)

6. All checks passed
   - Attach user context to request object
   - Continue to route handler
```

### Tenant Isolation Validation

```typescript
// Ensure JWT tenant matches request context
function validateTenantIsolation(jwtPayload: JWTPayload, requestTenant: string): void {
  if (jwtPayload.tenantSlug !== requestTenant) {
    throw new UnauthorizedError('Token tenant does not match request context');
  }
  
  if (jwtPayload.aud !== requestTenant) {
    throw new UnauthorizedError('Token audience mismatch');
  }
}
```

## 6. Data Integrity

### Constraints

1. **Unique Token Blacklist Entries**: `UNIQUE(tenant_id, token_jti)` prevents duplicate blacklist entries
2. **Foreign Key Cascades**: Deleting tenant/user cascades to blacklist (cleanup)
3. **RLS Enforcement**: Row Level Security ensures tenant isolation at database level
4. **Non-Null Validation**: All critical fields (tenant_id, token_jti, expires_at) are NOT NULL

### Cleanup Strategy

**Daily Cron Job** (recommended: 2 AM UTC):
```bash
# Run cleanup query
psql $DATABASE_URL -c "DELETE FROM token_blacklist WHERE expires_at < NOW();"
```

**Expected Growth**:
- ~10 blacklist entries per day per 1000 users (assuming 1% role changes/forced logouts)
- With daily cleanup, steady state: ~10 active entries per 1000 users
- Storage impact: negligible (<1KB per entry, <10MB per million users)

## 7. Migration Strategy

### Deployment Steps

1. **Pre-deployment**:
   - Generate strong JWT_SECRET (32+ characters)
   - Add to environment variables on server
   - Test migration script on staging database

2. **Deployment**:
   - Run migration: `012_create_token_blacklist_table.sql`
   - Deploy backend with JWT validation
   - Deploy frontend with JWT storage
   - **Hard cutover**: All existing NextAuth sessions invalidated

3. **Post-deployment**:
   - Monitor authentication logs for failures
   - Verify blacklist table remains small (<1000 entries initially)
   - Set up daily cleanup cron job

### Rollback Plan

**If JWT implementation fails**:
1. Revert backend to previous version (restore X-Dev-Auth temporarily)
2. Revert frontend to previous version
3. Drop token_blacklist table
4. Investigate failure, fix, redeploy

**Data Loss Risk**: NONE - token blacklist is new table, no existing data affected

## Summary

**New Tables**: 1 (token_blacklist)  
**Modified Tables**: 0  
**New Indexes**: 3 (blacklist_lookup, blacklist_user, blacklist_cleanup)  
**RLS Policies**: 1 (tenant_isolation_policy)  
**Storage Impact**: <10MB per million users (with daily cleanup)  
**Performance Impact**: <10ms per authenticated request (blacklist check when needed)













