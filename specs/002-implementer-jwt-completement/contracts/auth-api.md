# API Contracts: JWT Authentication

**Feature**: Complete JWT Authentication Implementation  
**Phase**: 1 (Design & Contracts)  
**Date**: 2025-10-12  
**API Version**: v1

## Overview

This document defines the HTTP API contracts for JWT authentication endpoints. All endpoints follow REST conventions and return structured JSON responses.

**Base URL**: `/api/v1/auth`

## Authentication Endpoints

### 1. Login (with JWT Generation)

**Endpoint**: `POST /api/v1/auth/login`

**Purpose**: Authenticate user credentials and issue JWT token

**Authentication**: None (public endpoint)

**Request**:
```typescript
{
  email: string;           // Valid email format
  password: string;        // Minimum 8 characters
}
```

**Request Example**:
```json
{
  "email": "student@imhotepacademy.fr",
  "password": "SecurePassword123!"
}
```

**Success Response** (200 OK):
```typescript
{
  user: {
    id: string;            // UUID
    email: string;
    tenantId: string;      // UUID
    tenantSlug: string;
    roles: string[];       // ["student"] | ["teacher"] | ["admin"] | ["parent"]
  };
  token: string;           // JWT token (valid for 24 hours)
  expiresAt: string;       // ISO 8601 timestamp
}
```

**Success Example**:
```json
{
  "user": {
    "id": "a82a680c-0888-4f0c-96cc-9531d0b95373",
    "email": "student@imhotepacademy.fr",
    "tenantId": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
    "tenantSlug": "imhotepacademy",
    "roles": ["student"]
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-10-13T12:00:00.000Z"
}
```

**Error Responses**:

| Status | Code | Message | Description |
|--------|------|---------|-------------|
| 400 | `INVALID_INPUT` | "Email and password are required" | Missing required fields |
| 400 | `INVALID_EMAIL` | "Invalid email format" | Email validation failed |
| 401 | `INVALID_CREDENTIALS` | "Invalid email or password" | Authentication failed |
| 500 | `INTERNAL_ERROR` | "Authentication failed" | Server error during auth |

**Error Example**:
```json
{
  "error": "Invalid Credentials",
  "message": "Invalid email or password",
  "code": "INVALID_CREDENTIALS"
}
```

**Headers**:
- Required: `Content-Type: application/json`, `X-Tenant: {tenant_slug}`
- Optional: None

**Rate Limiting**: 5 attempts per minute per IP (prevents brute force)

---

### 2. Refresh Token

**Endpoint**: `POST /api/v1/auth/refresh`

**Purpose**: Issue a new JWT with extended expiration for active users

**Authentication**: Required (valid JWT in Authorization header)

**Request**:
```typescript
{
  // Body can be empty - token extracted from Authorization header
}
```

**Request Example**:
```http
POST /api/v1/auth/refresh HTTP/1.1
Host: ecoledigitale.engage-360.net
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Tenant: imhotepacademy
Content-Type: application/json

{}
```

**Success Response** (200 OK):
```typescript
{
  token: string;           // New JWT token (valid for 24 hours)
  expiresAt: string;       // ISO 8601 timestamp
}
```

**Success Example**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.NEW_TOKEN...",
  "expiresAt": "2025-10-14T12:00:00.000Z"
}
```

**Error Responses**:

| Status | Code | Message | Description |
|--------|------|---------|-------------|
| 401 | `TOKEN_MISSING` | "Authentication required" | No Authorization header |
| 401 | `TOKEN_EXPIRED` | "Token expired" | Current token has expired |
| 401 | `TOKEN_INVALID` | "Invalid token signature" | JWT signature verification failed |
| 401 | `TOKEN_REVOKED` | "Token has been revoked" | Token found in blacklist |
| 500 | `INTERNAL_ERROR` | "Token refresh failed" | Server error during refresh |

**Error Example**:
```json
{
  "error": "Token Expired",
  "message": "Token expired",
  "code": "TOKEN_EXPIRED"
}
```

**Headers**:
- Required: `Authorization: Bearer {token}`, `X-Tenant: {tenant_slug}`

**Rate Limiting**: 60 requests per minute per user

**Business Logic**:
1. Extract current token from Authorization header
2. Verify token signature and expiration
3. Check if token is blacklisted (query token_blacklist table)
4. If all valid, generate new token with same claims but updated iat/exp
5. Return new token to client

**Note**: Old token remains valid until its original expiration. Client should replace immediately.

---

### 3. Logout

**Endpoint**: `POST /api/v1/auth/logout`

**Purpose**: Invalidate current JWT token (add to blacklist)

**Authentication**: Required (valid JWT in Authorization header)

**Request**:
```typescript
{
  // Body can be empty - token extracted from Authorization header
}
```

**Request Example**:
```http
POST /api/v1/auth/logout HTTP/1.1
Host: ecoledigitale.engage-360.net
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Tenant: imhotepacademy
Content-Type: application/json

{}
```

**Success Response** (200 OK):
```typescript
{
  message: string;         // Confirmation message
}
```

**Success Example**:
```json
{
  "message": "Logged out successfully"
}
```

**Error Responses**:

| Status | Code | Message | Description |
|--------|------|---------|-------------|
| 401 | `TOKEN_MISSING` | "Authentication required" | No Authorization header |
| 401 | `TOKEN_INVALID` | "Invalid token" | JWT verification failed |
| 500 | `INTERNAL_ERROR` | "Logout failed" | Server error during logout |

**Error Example**:
```json
{
  "error": "Internal Error",
  "message": "Logout failed",
  "code": "INTERNAL_ERROR"
}
```

**Headers**:
- Required: `Authorization: Bearer {token}`, `X-Tenant: {tenant_slug}`

**Rate Limiting**: 10 requests per minute per user

**Business Logic**:
1. Extract token from Authorization header
2. Decode token to get jti (JWT ID) and exp (expiration)
3. Add token to blacklist table:
   - tenant_id: from JWT claim
   - token_jti: from JWT claim
   - user_id: from JWT claim
   - expires_at: from JWT claim
   - reason: 'forced_logout'
4. Frontend must remove token from localStorage

---

## Middleware Validation (All Protected Endpoints)

**All endpoints except `/auth/login` require JWT validation**

**Validation Steps**:
1. Extract token from `Authorization: Bearer {token}` header
2. Verify JWT signature using JWT_SECRET
3. Check token expiration (exp claim)
4. Validate issuer = "ecoledigitale"
5. Validate audience (aud) matches X-Tenant header
6. Validate tenantId in JWT matches tenant from X-Tenant header
7. For sensitive operations (write/delete), check token blacklist
8. Attach user context to request: `request.user = { id, tenantId, roles }`

**Common Validation Errors**:

| Status | Code | Message | Trigger |
|--------|------|---------|---------|
| 401 | `TOKEN_MISSING` | "Authentication required" | No Authorization header |
| 401 | `TOKEN_INVALID` | "Invalid token format" | Not "Bearer {token}" format |
| 401 | `TOKEN_INVALID` | "Invalid signature" | Signature verification failed |
| 401 | `TOKEN_EXPIRED` | "Token expired" | exp claim < NOW |
| 401 | `TOKEN_REVOKED` | "Token revoked" | Found in blacklist |
| 401 | `INVALID_ISSUER` | "Invalid token issuer" | iss !== "ecoledigitale" |
| 401 | `INVALID_AUDIENCE` | "Invalid token audience" | aud !== X-Tenant |
| 401 | `TENANT_MISMATCH` | "Token tenant mismatch" | JWT tenantId !== X-Tenant tenant ID |

---

## TypeScript Schemas (Zod)

### Login Request Schema

```typescript
// packages/contracts/src/auth/login.schema.ts

import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    tenantId: z.string().uuid(),
    tenantSlug: z.string(),
    roles: z.array(z.enum(['student', 'teacher', 'admin', 'parent']))
  }),
  token: z.string(),
  expiresAt: z.string().datetime()
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

### Token Refresh Schema

```typescript
// packages/contracts/src/auth/refresh.schema.ts

import { z } from 'zod';

export const TokenRefreshResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime()
});

export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>;
```

### Logout Schema

```typescript
// packages/contracts/src/auth/logout.schema.ts

import { z } from 'zod';

export const LogoutResponseSchema = z.object({
  message: z.string()
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
```

### JWT Payload Schema

```typescript
// packages/contracts/src/auth/jwt-payload.schema.ts

import { z } from 'zod';

export const JWTPayloadSchema = z.object({
  // Standard claims
  iss: z.literal('ecoledigitale'),
  aud: z.string(),
  sub: z.string().uuid(),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().uuid(),
  
  // Custom claims
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  roles: z.array(z.enum(['student', 'teacher', 'admin', 'parent'])).min(1)
});

export type JWTPayload = z.infer<typeof JWTPayloadSchema>;
```

### Error Response Schema

```typescript
// packages/contracts/src/common/error.schema.ts

import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  code: z.string().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
```

---

## Frontend Integration

### localStorage Token Management

```typescript
// apps/web/src/lib/jwt-storage.ts

const TOKEN_KEY = 'ecoledigitale_jwt_token';

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isTokenExpiringSoon(token: string, minutesThreshold: number = 5): boolean {
  try {
    const decoded = jwt_decode<JWTPayload>(token);
    const expiresAt = decoded.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const threshold = minutesThreshold * 60 * 1000;
    
    return (expiresAt - now) < threshold;
  } catch {
    return true; // If decode fails, treat as expiring
  }
}
```

### Fetch Interceptor Integration

```typescript
// apps/web/src/lib/fetch-interceptor.ts (modified)

import { getToken, isTokenExpiringSoon, saveToken, removeToken } from './jwt-storage';

let refreshPromise: Promise<string> | null = null;

async function getValidToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  
  // Check if token is expiring soon (within 5 minutes)
  if (isTokenExpiringSoon(token, 5)) {
    // Ensure only one refresh happens at a time
    if (!refreshPromise) {
      refreshPromise = refreshToken(token)
        .then(newToken => {
          saveToken(newToken);
          return newToken;
        })
        .catch(error => {
          // Refresh failed, remove invalid token
          removeToken();
          window.location.href = '/login';
          throw error;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    return await refreshPromise;
  }
  
  return token;
}

async function refreshToken(currentToken: string): Promise<string> {
  const response = await originalFetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentToken}`,
      'X-Tenant': getTenantSlug(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  
  if (!response.ok) {
    throw new Error('Token refresh failed');
  }
  
  const data: TokenRefreshResponse = await response.json();
  return data.token;
}

// Intercept all API calls
window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // ... existing tenant logic ...
  
  // For API calls, add JWT token
  if (url.includes('/api/v1/') && !url.includes('/auth/login')) {
    const token = await getValidToken();
    
    if (!token) {
      // No valid token, redirect to login
      console.error('❌ No valid token - redirecting to login');
      window.location.href = '/login';
      throw new Error('Authentication required');
    }
    
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const response = await originalFetch(finalUrl, newInit);
  
  // Handle 401 responses
  if (response.status === 401 && !url.includes('/auth/')) {
    console.error('❌ 401 Unauthorized - token invalid or expired');
    removeToken();
    window.location.href = '/login';
  }
  
  return response;
};
```

---

## Testing Scenarios

### 1. Login Flow
```bash
# Test successful login
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password123"}'

# Expected: 200 OK with JWT token
```

### 2. Token Validation
```bash
# Test authenticated endpoint with valid token
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "X-Tenant: imhotepacademy"

# Expected: 200 OK with courses data
```

### 3. Token Refresh
```bash
# Test token refresh
curl -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "X-Tenant: imhotepacademy"

# Expected: 200 OK with new token
```

### 4. Invalid Token
```bash
# Test with invalid token
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer invalid_token" \
  -H "X-Tenant: imhotepacademy"

# Expected: 401 Unauthorized with "Invalid signature"
```

### 5. Expired Token
```bash
# Test with expired token (create token with exp in past)
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer expired_token" \
  -H "X-Tenant: imhotepacademy"

# Expected: 401 Unauthorized with "Token expired"
```

### 6. Logout
```bash
# Test logout
curl -X POST http://localhost:4000/api/v1/auth/logout \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "X-Tenant: imhotepacademy"

# Expected: 200 OK with "Logged out successfully"

# Verify token is blacklisted
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "X-Tenant: imhotepacademy"

# Expected: 401 Unauthorized with "Token revoked"
```

---

## Security Considerations

1. **Token Exposure**: Tokens in Authorization header visible in logs - ensure log sanitization
2. **HTTPS Required**: JWT tokens must only be transmitted over HTTPS in production
3. **XSS Vulnerability**: localStorage accessible to JavaScript - implement CSP headers
4. **Token Lifetime**: 24-hour tokens balance security with UX - acceptable for educational platform
5. **Secret Rotation**: Changing JWT_SECRET invalidates all tokens - plan for maintenance window
6. **Rate Limiting**: Prevents brute force on login, DoS on refresh
7. **Blacklist Growth**: Monitor blacklist table size, ensure daily cleanup runs













