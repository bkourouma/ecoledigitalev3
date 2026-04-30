# Quickstart: JWT Authentication Testing & Development

**Feature**: Complete JWT Authentication Implementation  
**Phase**: 1 (Design & Contracts)  
**Date**: 2025-10-12

## Overview

This guide helps developers test the JWT authentication implementation locally and verify it works correctly before deploying to production.

## Prerequisites

1. **Environment Setup**:
   ```bash
   # Required environment variables
   JWT_SECRET="your-super-secret-256-bit-key-minimum-32-characters"
   DATABASE_URL="postgresql://user:pass@localhost:5432/dbecoledigitale"
   NEXTAUTH_SECRET="your-nextauth-secret"
   NEXTAUTH_URL="http://localhost:3000"
   NODE_ENV="development"  # But WITHOUT auth bypasses!
   ```

2. **Database Migration**:
   ```bash
   # Run the token blacklist migration
   psql $DATABASE_URL -f infra/scripts/migrations/012_create_token_blacklist_table.sql
   
   # Verify table created
   psql $DATABASE_URL -c "\d token_blacklist"
   ```

3. **Dependencies Installed**:
   ```bash
   # Backend
   cd apps/api
   pnpm add jsonwebtoken @types/jsonwebtoken
   
   # Frontend (for jwt-decode utility)
   cd apps/web
   pnpm add jwt-decode
   ```

## Quick Start (5 Minutes)

### Step 1: Start Backend & Frontend

```bash
# Terminal 1: Backend API
cd apps/api
pnpm dev  # Runs on port 4000

# Terminal 2: Frontend
cd apps/web
pnpm dev  # Runs on port 3000
```

### Step 2: Test Login (Get JWT Token)

```bash
# Login as student
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{
    "email": "student@imhotepacademy.fr",
    "password": "your-password"
  }'

# Expected output:
# {
#   "user": { "id": "...", "email": "...", "roles": ["student"] },
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "expiresAt": "2025-10-13T12:00:00.000Z"
# }

# Save the token for next steps
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Step 3: Test Authenticated Request

```bash
# Make authenticated API call
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "X-Tenant: imhotepacademy"

# Expected: 200 OK with courses data
```

### Step 4: Verify in Browser

1. Open http://localhost:3000/login
2. Login with credentials
3. Open DevTools → Application → Local Storage
4. Verify `ecoledigitale_jwt_token` is stored
5. Navigate to dashboard - should stay logged in
6. Refresh page - should remain authenticated

## Testing Checklist

### ✅ Core Authentication Flow

- [ ] **Login generates JWT**: POST /auth/login returns valid token
- [ ] **Token stored in localStorage**: Check DevTools after login
- [ ] **Token auto-injected in requests**: Network tab shows Authorization header
- [ ] **Authenticated requests succeed**: Can access protected endpoints
- [ ] **Unauthenticated requests fail**: 401 without token

### ✅ Token Validation

- [ ] **Valid token accepted**: Requests with valid JWT return 200
- [ ] **Invalid signature rejected**: Tampered token returns 401 "Invalid signature"
- [ ] **Expired token rejected**: Expired JWT returns 401 "Token expired"
- [ ] **Missing token rejected**: No Authorization header returns 401 "Authentication required"
- [ ] **Wrong tenant rejected**: JWT for tenant A cannot access tenant B resources

### ✅ Token Refresh

- [ ] **Auto-refresh near expiry**: Token refreshes within 5 minutes of expiration
- [ ] **New token stored**: localStorage updated with new token
- [ ] **Concurrent requests wait**: Multiple simultaneous requests use same refresh
- [ ] **Refresh failure redirects**: Failed refresh sends user to login

### ✅ Token Blacklist

- [ ] **Logout adds to blacklist**: POST /auth/logout adds token to database
- [ ] **Blacklisted token rejected**: Using blacklisted token returns 401 "Token revoked"
- [ ] **Role change blacklists token**: Admin changing user role invalidates their token
- [ ] **Deleted account blacklisted**: Deleting user account blacklists active tokens

### ✅ No Dev Bypasses

- [ ] **X-Dev-Auth removed from frontend**: Search codebase, zero matches
- [ ] **X-Dev-Auth removed from backend**: Search codebase, zero matches
- [ ] **No hardcoded user IDs**: No fallback to default users
- [ ] **No mock data**: All data from database
- [ ] **No auth skips in development**: Development requires JWT same as production

## Testing Scenarios

### Scenario 1: Happy Path (User Login to API Call)

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password"}' \
  | jq -r '.token')

echo "JWT Token: $TOKEN"

# 2. Decode token (verify contents)
echo $TOKEN | jwt decode -

# Expected output shows:
# - userId, tenantId, tenantSlug, roles
# - iat, exp timestamps
# - iss: "ecoledigitale"
# - aud: "imhotepacademy"

# 3. Make authenticated request
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: imhotepacademy"

# Expected: 200 OK with courses
```

### Scenario 2: Token Expiration

```bash
# 1. Create short-lived token (for testing)
# Modify JWT_EXPIRES_IN temporarily to "10s" in code
# Login and get token

# 2. Wait 11 seconds

# 3. Try to use expired token
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $EXPIRED_TOKEN" \
  -H "X-Tenant: imhotepacademy"

# Expected: 401 Unauthorized
# {
#   "error": "Token Expired",
#   "message": "Token expired",
#   "code": "TOKEN_EXPIRED"
# }
```

### Scenario 3: Token Refresh

```bash
# 1. Login and get token that expires in 5 minutes
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password"}' \
  | jq -r '.token')

# 2. Wait until 4 minutes have passed (or modify token manually for testing)

# 3. Refresh token
NEW_TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: imhotepacademy" \
  | jq -r '.token')

echo "Old Token: $TOKEN"
echo "New Token: $NEW_TOKEN"

# 4. Verify new token works
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "X-Tenant: imhotepacademy"

# Expected: 200 OK with courses
```

### Scenario 4: Logout and Blacklist

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password"}' \
  | jq -r '.token')

# 2. Use token successfully
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: imhotepacademy"
# Expected: 200 OK

# 3. Logout (adds token to blacklist)
curl -X POST http://localhost:4000/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: imhotepacademy"
# Expected: 200 OK {"message":"Logged out successfully"}

# 4. Try to use same token again
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: imhotepacademy"
# Expected: 401 Unauthorized {"error":"Token Revoked","code":"TOKEN_REVOKED"}

# 5. Verify token in blacklist table
psql $DATABASE_URL -c "SELECT token_jti, reason FROM token_blacklist LIMIT 5;"
```

### Scenario 5: Cross-Tenant Validation

```bash
# 1. Login to tenant A (imhotepacademy)
TOKEN_A=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password"}' \
  | jq -r '.token')

# 2. Try to use tenant A token for tenant B (imhotepdata)
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "X-Tenant: imhotepdata"

# Expected: 401 Unauthorized
# {
#   "error": "Tenant Mismatch",
#   "message": "Token tenant does not match request context",
#   "code": "TENANT_MISMATCH"
# }
```

### Scenario 6: Role Change Blacklisting

```bash
# 1. Login as student
STUDENT_TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password"}' \
  | jq -r '.token')

# 2. Verify student can access student endpoints
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "X-Tenant: imhotepacademy"
# Expected: 200 OK

# 3. Admin changes student's role to teacher (simulated)
# This should trigger token blacklisting via admin interface or direct DB update
psql $DATABASE_URL -c "
  INSERT INTO token_blacklist (tenant_id, token_jti, user_id, expires_at, reason)
  SELECT 
    '6eb9c106-b650-4398-b6fa-091b6828c4ba'::UUID,
    'jti-from-student-token',  -- Extract from token
    'a82a680c-0888-4f0c-96cc-9531d0b95373'::UUID,
    NOW() + INTERVAL '24 hours',
    'role_change'
  WHERE NOT EXISTS (
    SELECT 1 FROM token_blacklist WHERE token_jti = 'jti-from-student-token'
  );
"

# 4. Try to use old student token
curl http://localhost:4000/api/v1/student/courses \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "X-Tenant: imhotepacademy"
# Expected: 401 Unauthorized {"error":"Token Revoked","code":"TOKEN_REVOKED"}

# 5. Student must re-login to get token with updated roles
```

## Browser Testing

### Manual Test Flow

1. **Clean State**:
   - Clear localStorage: DevTools → Application → Local Storage → Clear
   - Clear cookies if any
   - Close all browser tabs

2. **Login**:
   - Navigate to http://localhost:3000/login
   - Enter credentials
   - Click "Sign In"
   - Should redirect to dashboard

3. **Verify Token Storage**:
   - Open DevTools → Application → Local Storage
   - Look for key: `ecoledigitale_jwt_token`
   - Value should be JWT string (starts with "eyJ...")

4. **Verify Auto-Injection**:
   - DevTools → Network tab
   - Navigate to different pages (courses, assignments, etc.)
   - Check API requests (e.g., /api/v1/student/courses)
   - Headers should include: `Authorization: Bearer eyJ...`

5. **Test Token Persistence**:
   - Refresh page (F5)
   - Should remain logged in (no redirect to login)
   - Token should still be in localStorage

6. **Test Logout**:
   - Click logout button
   - Should redirect to /login
   - localStorage should be cleared (token removed)
   - Navigating back to /dashboard should redirect to /login

7. **Test Expired Token**:
   - Login normally
   - Manually edit localStorage token to an expired one (or wait for expiration)
   - Try to navigate to protected page
   - Should automatically redirect to /login

## Debugging Tips

### Check JWT Token Contents

```bash
# Install jwt-cli tool
npm install -g jwt-cli

# Decode token to see payload
jwt decode $TOKEN

# Or use online tool: https://jwt.io/
# Paste token, see decoded payload
```

### Check Backend Logs

```bash
# Backend should log:
# - "🔐 JWT token generated for user: {userId}"
# - "✅ JWT token validated for user: {userId}"
# - "❌ JWT validation failed: {reason}"
# - "🗑️ Token added to blacklist: {jti}"
```

### Check Database State

```bash
# View blacklist entries
psql $DATABASE_URL -c "SELECT * FROM token_blacklist ORDER BY revoked_at DESC LIMIT 10;"

# Count active blacklisted tokens
psql $DATABASE_URL -c "SELECT COUNT(*) FROM token_blacklist WHERE expires_at > NOW();"

# View tokens by user
psql $DATABASE_URL -c "SELECT user_id, reason, revoked_at FROM token_blacklist WHERE user_id = 'USER_UUID';"
```

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| "Invalid signature" | 401 on valid-looking token | Check JWT_SECRET matches between backend instances |
| "Tenant mismatch" | 401 on correct token | Verify X-Tenant header matches JWT tenant claim |
| Token not persisting | Logged out on refresh | Check localStorage is enabled, not in incognito |
| Auto-refresh not working | Logged out after 24h | Verify fetch interceptor checks token expiry |
| Blacklist check slow | >100ms per request | Add database index, consider Redis cache |

## Automated Testing

### Backend Unit Tests

```bash
cd apps/api
pnpm test auth-middleware.test.ts  # JWT validation tests
pnpm test jwt-service.test.ts      # Token generation tests
pnpm test blacklist-service.test.ts # Blacklist CRUD tests
```

### Frontend Unit Tests

```bash
cd apps/web
pnpm test jwt-storage.test.ts      # localStorage management tests
pnpm test fetch-interceptor.test.ts # Token injection tests
```

### E2E Tests (Playwright)

```bash
# Run full authentication flow test
pnpm test:e2e auth-flow.spec.ts

# Tests:
# - Login generates and stores token
# - Protected pages require token
# - Logout clears token
# - Expired token redirects to login
```

## Performance Benchmarks

Run these to verify performance meets success criteria:

```bash
# Token generation speed (<100ms)
time curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepacademy" \
  -d '{"email":"student@imhotepacademy.fr","password":"password"}'

# Token validation speed (<10ms)
# Use Apache Bench or wrk for load testing
ab -n 1000 -c 10 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: imhotepacademy" \
  http://localhost:4000/api/v1/student/courses

# Blacklist check speed (<100ms)
# Query database directly
time psql $DATABASE_URL -c "SELECT EXISTS(SELECT 1 FROM token_blacklist WHERE token_jti = 'test-jti');"
```

## Deployment Checklist

Before deploying to production:

- [ ] JWT_SECRET is strong random 32+ character string
- [ ] JWT_SECRET is set in production environment (never in code)
- [ ] Database migration 012 applied to production database
- [ ] All X-Dev-Auth code removed (grep verification)
- [ ] Token blacklist cleanup cron job scheduled (daily 2 AM)
- [ ] HTTPS enforced (nginx configuration verified)
- [ ] CSP headers configured to mitigate XSS
- [ ] Rate limiting enabled on login endpoint (5 req/min)
- [ ] Monitoring alerts set for 401 spike (indicates mass logout)
- [ ] Communication sent to users about forced re-login

## Next Steps

After verifying all tests pass:
1. Run `/speckit.tasks` to generate implementation task list
2. Begin implementation following task order
3. Test each task completion against this quickstart guide
4. Deploy to staging for final verification
5. Deploy to production with monitoring

## Support

**Documentation**:
- Specification: [spec.md](./spec.md)
- Implementation Plan: [plan.md](./plan.md)
- Data Model: [data-model.md](./data-model.md)
- API Contracts: [contracts/auth-api.md](./contracts/auth-api.md)

**Tools**:
- JWT Decoder: https://jwt.io/
- Postman Collection: [Postman_Collection_JWT_Auth.json](../../../Postman_Collection.json)













