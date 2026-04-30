# Quick Start Guide: Phase 1 - Infrastructure et Authentification RSO-PFSO

**Feature**: Phase 1 - Infrastructure et Authentification RSO-PFSO  
**Date**: 2024-12-19  
**Status**: Implementation Guide

## Prerequisites

- Node.js 18+ and pnpm installed
- PostgreSQL 14+ running
- Existing EcoleDigitale database (`dbecoledigitale`)
- ASPCI tenant already created in `tenants` table

## Step 1: Database Migration

Run the database migration to create RSO-PFSO tables:

```bash
# From repository root
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0021_rso_phase1.sql
```

**Migration Script Location**: `infra/scripts/migrations/0021_rso_phase1.sql`

**What it creates**:
- `rso_users` table
- `rso_user_sessions` table
- `rso_activity_logs` table
- `rso_permissions` table
- Indexes and RLS policies
- Seed data (default permissions, test users)

## Step 2: Install Dependencies

Install required npm packages:

```bash
# From repository root
pnpm install

# Additional packages needed for RSO module
pnpm add nodemailer @types/nodemailer
pnpm add @hcaptcha/react-hcaptcha  # or react-google-recaptcha
```

## Step 3: Environment Configuration

Add RSO-specific environment variables to `apps/api/.env`:

```env
# RSO-PFSO Module Configuration

# JWT Configuration (reuse existing or set RSO-specific)
JWT_SECRET=your-jwt-secret-key-here
JWT_EXPIRES_IN=8h
JWT_REMEMBER_ME_EXPIRES_IN=30d

# Email Configuration (for password reset and welcome emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@aspci.ci

# Or use SendGrid
# SENDGRID_API_KEY=your-sendgrid-api-key

# CAPTCHA Configuration (for brute force protection)
HCAPTCHA_SITE_KEY=your-hcaptcha-site-key
HCAPTCHA_SECRET_KEY=your-hcaptcha-secret-key

# Or use Google reCAPTCHA
# RECAPTCHA_SITE_KEY=your-recaptcha-site-key
# RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key

# Rate Limiting (optional, defaults shown)
RATE_LIMIT_LOGIN_ATTEMPTS=5
RATE_LIMIT_WINDOW_MINUTES=15
RATE_LIMIT_CAPTCHA_THRESHOLD=3
```

## Step 4: Backend Implementation

### 4.1 Create RSO Routes

Create `apps/api/src/routes/rso/auth.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { generateToken } from "../../services/jwt.service";
import { rsoAuthService } from "../../services/rso/auth.service";
import { rsoActivityLogService } from "../../services/rso/activity-log.service";

const loginSchema = z.object({
  identifier: z.string().min(1), // username or email
  password: z.string().min(1),
  rememberMe: z.boolean().default(false),
});

export async function rsoAuthRoutes(fastify: FastifyInstance) {
  fastify.post("/rso/auth/login", {
    schema: {
      body: loginSchema,
      // ... response schemas
    },
    handler: async (request, reply) => {
      // Implementation: validate credentials, generate JWT, log activity
    },
  });

  // ... other auth routes
}
```

### 4.2 Create RSO Services

Create service files:
- `apps/api/src/services/rso/auth.service.ts` - Authentication logic
- `apps/api/src/services/rso/user.service.ts` - User CRUD operations
- `apps/api/src/services/rso/permission.service.ts` - Permission checks
- `apps/api/src/services/rso/activity-log.service.ts` - Activity logging

### 4.3 Create RSO Middleware

Create `apps/api/src/plugins/rso-auth-middleware.ts`:

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { decodeToken } from "../services/jwt.service";
import { rsoUserService } from "../services/rso/user.service";

export async function rsoAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Extract JWT token from Authorization header
  // Validate token
  // Load user from rso_users table
  // Attach user to request object
  // Check permissions if needed
}
```

### 4.4 Register Routes

In `apps/api/src/index.ts`, register RSO routes:

```typescript
import { rsoAuthRoutes } from "./routes/rso/auth";
import { rsoUserRoutes } from "./routes/rso/users";
import { rsoActivityLogRoutes } from "./routes/rso/activity-logs";

// ... existing code

async function build() {
  const fastify = Fastify({ /* ... */ });

  // ... existing routes

  // Register RSO routes
  await fastify.register(rsoAuthRoutes);
  await fastify.register(rsoUserRoutes);
  await fastify.register(rsoActivityLogRoutes);

  return fastify;
}
```

## Step 5: Frontend Implementation

### 5.1 Create RSO Auth Client

Create `apps/web/src/lib/rso/auth.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface LoginCredentials {
  identifier: string; // username or email
  password: string;
  rememberMe?: boolean;
}

export interface LoginResponse {
  user: RSOUser;
  token: string;
  expiresAt: string;
}

export async function rsoLogin(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await fetch("/api/v1/rso/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw new Error("Login failed");
  }

  const data = await response.json();
  
  // Store token (httpOnly cookie or localStorage)
  if (data.token) {
    localStorage.setItem("rso_token", data.token);
  }

  return data;
}

// ... logout, refresh token functions
```

### 5.2 Create RSO Pages

Create Next.js pages:
- `apps/web/src/app/rso/login/page.tsx` - Login page
- `apps/web/src/app/rso/forgot-password/page.tsx` - Password reset request
- `apps/web/src/app/rso/reset-password/[token]/page.tsx` - Password reset form
- `apps/web/src/app/rso/admin/dashboard/page.tsx` - Admin dashboard
- `apps/web/src/app/rso/formateur/dashboard/page.tsx` - Formateur dashboard
- `apps/web/src/app/rso/pfso/consultation/page.tsx` - PFSO consultation page

### 5.3 Create RSO Components

Create component directories:
- `apps/web/src/components/rso/auth/` - Login, password reset components
- `apps/web/src/components/rso/admin/` - Admin dashboard components
- `apps/web/src/components/rso/formateur/` - Formateur dashboard components
- `apps/web/src/components/rso/pfso/` - PFSO consultation components

## Step 6: Seed Test Data

Run seed script to create test users:

```bash
# From repository root
tsx infra/scripts/seed-rso-phase1.ts
```

**Test Users Created**:
- **Administrateur**: `admin_rso` / `Admin@2024!`
- **RSO Formateur**: `formateur_rso1` / `Formateur@2024!`
- **Agent PFSO**: `pfso_abidjan` / `Pfso@2024!`
- **Agent Sûreté**: `agent_surete1` / `Agent@2024!`

## Step 7: Start Development Servers

```bash
# Start backend (port 4000)
pnpm dev:api

# Start frontend (port 3000)
pnpm dev:web
```

## Step 8: Test Authentication

### 8.1 Test Login

Navigate to `http://localhost:3000/rso/login` and test with:

- **Admin**: `admin_rso` / `Admin@2024!`
- **Formateur**: `formateur_rso1` / `Formateur@2024!`
- **Agent PFSO**: `pfso_abidjan` / `Pfso@2024!`

### 8.2 Test Role-Based Access

- Admin should see admin dashboard with user management
- Formateur should see formateur dashboard with year selector
- Agent PFSO should see consultation page with filters

### 8.3 Test Password Reset

1. Go to `/rso/forgot-password`
2. Enter email: `admin@aspci.ci`
3. Check email for reset link
4. Click link and reset password

## Step 9: Verify Activity Logging

Check that activities are logged:

```sql
-- Query activity logs
SELECT * FROM rso_activity_logs 
ORDER BY created_at DESC 
LIMIT 10;
```

You should see:
- Login events
- User creation events
- Password reset events
- Permission checks

## Step 10: Run Tests

```bash
# Unit tests
pnpm test:unit

# Integration tests
pnpm test:integration

# E2E tests (Playwright)
pnpm test:e2e
```

## Troubleshooting

### Database Connection Issues

```bash
# Verify PostgreSQL is running
psql -U postgres -d dbecoledigitale -c "SELECT 1;"

# Check tenant exists
psql -U postgres -d dbecoledigitale -c "SELECT * FROM tenants WHERE slug = 'aspci';"
```

### JWT Token Issues

- Verify `JWT_SECRET` is set in environment
- Check token expiration time
- Verify token is being sent in Authorization header

### Email Not Sending

- Verify SMTP credentials
- Check firewall/network restrictions
- Test with Gmail App Password (if using Gmail)
- Check spam folder

### Permission Errors

- Verify user role in database
- Check `rso_permissions` table has correct entries
- Verify middleware is checking permissions correctly

## Next Steps

After Phase 1 is complete:

1. **Phase 2**: Gestion des installations (port facilities)
2. **Phase 3**: Gestion des activités (RSO activities)
3. **Phase 4**: Gestion des médias (file uploads)
5. **Phase 5**: Gestion SMS (SMS notifications)
6. **Phase 6**: Gestion des incidents (incident management)

## Support

For issues or questions:
- Check activity logs: `/rso/admin/activity-logs`
- Review API documentation: `/api/v1/rso/docs` (if Swagger UI enabled)
- Check database logs for SQL errors

