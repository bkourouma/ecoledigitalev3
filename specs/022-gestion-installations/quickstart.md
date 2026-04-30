# Quick Start Guide: Phase 2 - Gestion des Installations RSO-PFSO

**Feature**: Phase 2 - Gestion des Installations RSO-PFSO  
**Date**: 2025-01-27  
**Status**: Implementation Guide

## Prerequisites

- Phase 1 (Infrastructure et Authentification) must be complete
- Node.js 18+ and pnpm installed
- PostgreSQL 14+ running
- Existing RSO-PFSO tables from Phase 1
- ASPCI tenant already created

## Step 1: Database Migration

Run the database migration to create Phase 2 tables:

```bash
# From repository root
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0022_rso_phase2_installations.sql
psql "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale" -f infra/scripts/migrations/0022_rso_phase2_seed.sql
```

**Migration Scripts**:
- `infra/scripts/migrations/0022_rso_phase2_installations.sql` - Creates tables and constraints
- `infra/scripts/migrations/0022_rso_phase2_seed.sql` - Seeds 19 predefined installations and years (2004-current)

**What it creates**:
- `rso_installations` table
- `rso_annees` table
- `rso_installation_responsables` table
- Foreign key constraint on `rso_users.installation_id`
- Indexes and RLS policies
- Seed data (19 installations, years 2004-current)

## Step 2: Install Dependencies

Install required npm packages for exports and scheduled tasks:

```bash
# From repository root
pnpm add exceljs
pnpm add pdfkit @types/pdfkit
# OR for complex PDFs with charts
pnpm add puppeteer

# For scheduled tasks
pnpm add node-cron @types/node-cron
```

## Step 3: Backend Implementation

### 3.1 Create Installation Routes

Create `apps/api/src/routes/rso/installations.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { rsoAuthMiddleware } from "../../plugins/rso-auth-middleware";
import { installationService } from "../../services/rso/installation.service";

const createInstallationSchema = z.object({
  nomPort: z.string().min(3).max(150),
  codeInstallation: z.string().regex(/^[A-Z0-9_]{3,20}$/),
  typeInstallation: z.enum(['port_commerce', 'terminal_conteneurs', 'terminal_petrolier', 'terminal_mineranier', 'autre']),
  ville: z.enum(['Abidjan', 'San-Pedro']),
  statut: z.enum(['actif', 'inactif', 'en_maintenance']).default('actif'),
  adresse: z.string().optional(),
  contactNom: z.string().max(100).optional(),
  contactTelephone: z.string().regex(/^\+225\d{10}$/).optional(),
  contactEmail: z.string().email().optional(),
  commentaire: z.string().optional(),
});

export async function installationRoutes(fastify: FastifyInstance) {
  // Apply authentication middleware
  fastify.addHook('preHandler', rsoAuthMiddleware);

  // List installations
  fastify.get("/rso/installations", {
    handler: async (request, reply) => {
      const filters = request.query;
      const result = await installationService.list(filters);
      return result;
    },
  });

  // Create installation
  fastify.post("/rso/installations", {
    schema: { body: createInstallationSchema },
    handler: async (request, reply) => {
      const installation = await installationService.create(
        request.body,
        request.user.id
      );
      return reply.code(201).send(installation);
    },
  });

  // ... other routes (get by id, update, delete, restore, export, stats)
}
```

### 3.2 Create Year Routes

Create `apps/api/src/routes/rso/annees.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { anneeService } from "../../services/rso/annee.service";

export async function anneeRoutes(fastify: FastifyInstance) {
  // List all years
  fastify.get("/rso/annees", {
    handler: async (request, reply) => {
      const years = await anneeService.list();
      return years;
    },
  });

  // Get active year
  fastify.get("/rso/annees/active", {
    handler: async (request, reply) => {
      const activeYear = await anneeService.getActive();
      return activeYear;
    },
  });

  // ... other routes
}
```

### 3.3 Create Installation Service

Create `apps/api/src/services/rso/installation.service.ts`:

```typescript
import { db } from "../../db";
import { installationCodeGenerator } from "./installation-code-generator";

export const installationService = {
  async list(filters: InstallationFilters) {
    // Build query with filters, pagination, search
    // Return installations with pagination metadata
  },

  async create(data: CreateInstallationRequest, userId: number) {
    // Validate code uniqueness
    // Generate code if not provided
    // Create installation record
    // Log activity
    // Return created installation
  },

  async update(id: number, data: UpdateInstallationRequest, userId: number) {
    // Check permissions (RSO Formateur can only update their own)
    // Update installation
    // Log activity
    // Return updated installation
  },

  async delete(id: number, userId: number) {
    // Check if installation has assigned Agent PFSO users
    // Soft delete (set deleted_at)
    // Log activity
  },

  async restore(id: number, userId: number) {
    // Check code uniqueness before restore
    // Restore (set deleted_at = NULL)
    // Log activity
  },

  async exportExcel(filters: InstallationFilters) {
    // Use ExcelJS to generate Excel file
    // Return file buffer
  },

  async exportPDF(filters: InstallationFilters) {
    // Use PDFKit or Puppeteer to generate PDF
    // Return file buffer
  },

  async getStats(year?: number) {
    // Calculate global statistics
    // Return stats object
  },
};
```

### 3.4 Create Year Service

Create `apps/api/src/services/rso/annee.service.ts`:

```typescript
export const anneeService = {
  async list() {
    // Return all years ordered by year DESC
  },

  async getActive() {
    // Return current active year
  },

  async increment() {
    // Archive previous year
    // Add new year with status 'active'
    // Log activity
  },
};
```

### 3.5 Create Scheduled Task for Year Increment

Create `apps/api/src/jobs/rso/year-increment.job.ts`:

```typescript
import cron from "node-cron";
import { anneeService } from "../../services/rso/annee.service";

// Run on January 1st at 01:00
export function startYearIncrementJob() {
  cron.schedule("0 1 1 1 *", async () => {
    try {
      await anneeService.increment();
      console.log(`Year increment completed: ${new Date().getFullYear()}`);
    } catch (error) {
      console.error("Year increment failed:", error);
      // Send notification to administrators
    }
  });
}
```

Register the job in `apps/api/src/index.ts`:

```typescript
import { startYearIncrementJob } from "./jobs/rso/year-increment.job";

async function build() {
  const fastify = Fastify({ /* ... */ });

  // ... existing code

  // Start scheduled tasks
  startYearIncrementJob();

  return fastify;
}
```

### 3.6 Register Routes

In `apps/api/src/index.ts`, register Phase 2 routes:

```typescript
import { installationRoutes } from "./routes/rso/installations";
import { anneeRoutes } from "./routes/rso/annees";
import { installationResponsableRoutes } from "./routes/rso/installation-responsables";

async function build() {
  const fastify = Fastify({ /* ... */ });

  // ... existing Phase 1 routes

  // Register Phase 2 routes
  await fastify.register(installationRoutes);
  await fastify.register(anneeRoutes);
  await fastify.register(installationResponsableRoutes);

  return fastify;
}
```

## Step 4: Frontend Implementation

### 4.1 Create Year Selector Component

Create `apps/web/src/components/rso/annees/YearSelector.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function YearSelector() {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const queryClient = useQueryClient();

  // Load available years
  const { data: years } = useQuery({
    queryKey: ["rso", "annees"],
    queryFn: async () => {
      const response = await fetch("/api/rso/annees");
      return response.json();
    },
  });

  // Load selected year from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("rso_selected_year");
    if (stored) {
      setSelectedYear(parseInt(stored));
    } else if (years?.activeYear) {
      setSelectedYear(years.activeYear);
    }
  }, [years]);

  // Save selected year
  const updateYear = useMutation({
    mutationFn: async (year: number) => {
      sessionStorage.setItem("rso_selected_year", year.toString());
      return year;
    },
    onSuccess: (year) => {
      setSelectedYear(year);
      queryClient.invalidateQueries({ queryKey: ["rso"] });
    },
  });

  return (
    <select
      value={selectedYear || ""}
      onChange={(e) => updateYear.mutate(parseInt(e.target.value))}
    >
      {years?.annees.map((year: RSOAnnee) => (
        <option key={year.id} value={year.annee}>
          {year.annee}
        </option>
      ))}
    </select>
  );
}
```

### 4.2 Create Installation List Page

Create `apps/web/src/app/rso/admin/installations/page.tsx`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { InstallationList } from "@/components/rso/installations/InstallationList";
import { InstallationFilters } from "@/components/rso/installations/InstallationFilters";

export default function InstallationsPage() {
  const [filters, setFilters] = useState<InstallationFilters>({
    page: 1,
    limit: 20,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["rso", "installations", filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters as any);
      const response = await fetch(`/api/rso/installations?${params}`);
      return response.json();
    },
  });

  return (
    <div>
      <h1>Gestion des Installations</h1>
      <InstallationFilters filters={filters} onFiltersChange={setFilters} />
      <InstallationList installations={data?.installations} loading={isLoading} />
    </div>
  );
}
```

### 4.3 Create Installation Components

Create component files:
- `apps/web/src/components/rso/installations/InstallationList.tsx` - Table/card view
- `apps/web/src/components/rso/installations/InstallationForm.tsx` - Create/Edit form
- `apps/web/src/components/rso/installations/InstallationDetail.tsx` - Detail modal
- `apps/web/src/components/rso/installations/InstallationFilters.tsx` - Filter controls
- `apps/web/src/components/rso/installations/InstallationStats.tsx` - Statistics display

### 4.4 Create Installation API Client

Create `apps/web/src/lib/rso/installations.ts`:

```typescript
import { InstallationFilters, RSOInstallation } from "@packages/contracts/src/rso/installation.contracts";

export async function listInstallations(
  filters: InstallationFilters
): Promise<InstallationListResponse> {
  const params = new URLSearchParams(filters as any);
  const response = await fetch(`/api/rso/installations?${params}`);
  if (!response.ok) throw new Error("Failed to fetch installations");
  return response.json();
}

export async function createInstallation(
  data: CreateInstallationRequest
): Promise<RSOInstallation> {
  const response = await fetch("/api/rso/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("Failed to create installation");
  return response.json();
}

// ... other API functions
```

## Step 5: Update User Creation Form (Phase 1 Integration)

Modify `apps/web/src/components/rso/admin/CreateUserForm.tsx` to include installation selection for Agent PFSO:

```typescript
// Add installation selection when role is 'agent_pfso'
{formData.role === 'agent_pfso' && (
  <select
    name="installationId"
    required
    value={formData.installationId || ""}
    onChange={handleChange}
  >
    <option value="">Sélectionner une installation</option>
    {installations?.map((inst) => (
      <option key={inst.id} value={inst.id}>
        {inst.nomPort} ({inst.codeInstallation})
      </option>
    ))}
  </select>
)}
```

## Step 6: Verify Migration

Check that data was seeded correctly:

```sql
-- Check installations
SELECT COUNT(*) FROM rso_installations; -- Should be 19

-- Check years
SELECT COUNT(*) FROM rso_annees; -- Should be years from 2004 to current

-- Check active year
SELECT * FROM rso_annees WHERE statut = 'active'; -- Should be current year

-- Check foreign key constraint
SELECT constraint_name 
FROM information_schema.table_constraints 
WHERE table_name = 'rso_users' 
AND constraint_name LIKE '%installation%';
```

## Step 7: Test Functionality

### 7.1 Test Installation CRUD

1. Navigate to `/rso/admin/installations`
2. Verify 19 predefined installations are displayed
3. Create a new installation
4. Edit an installation
5. Archive (soft delete) an installation
6. Restore an archived installation

### 7.2 Test Year Selector

1. Verify year selector appears in header/sidebar
2. Select a different year
3. Navigate to another page
4. Verify selected year persists

### 7.3 Test Filters and Search

1. Filter by city (Abidjan, San-Pedro)
2. Filter by type
3. Filter by status
4. Search by name or code
5. Combine multiple filters

### 7.4 Test Exports

1. Export installations to Excel
2. Verify Excel file opens correctly
3. Export installations to PDF
4. Verify PDF displays correctly

### 7.5 Test Responsible Assignment

1. Navigate to installation details
2. Add a responsible person (PFSO Principal)
3. Verify only one active PFSO Principal allowed
4. Add multiple PFSO Adjoints
5. End a responsible assignment

### 7.6 Test Statistics

1. Navigate to installation statistics dashboard
2. Verify global statistics display
3. Select an installation and view its statistics
4. Change year and verify statistics update

## Step 8: Test Scheduled Task

Manually trigger year increment to test:

```bash
# Via API (admin only)
curl -X POST http://localhost:4000/api/rso/annees/increment \
  -H "Authorization: Bearer <admin-token>"
```

Or test in code:

```typescript
// In development, you can manually trigger
import { anneeService } from "./services/rso/annee.service";
await anneeService.increment();
```

## Troubleshooting

### Migration Issues

```bash
# Check if tables exist
psql -U postgres -d dbecoledigitale -c "\dt rso_*"

# Check foreign key constraint
psql -U postgres -d dbecoledigitale -c "
SELECT conname, conrelid::regclass, confrelid::regclass
FROM pg_constraint
WHERE conname LIKE '%installation%';
"
```

### Code Uniqueness Validation Not Working

- Verify endpoint `/api/rso/installations/check-code/:code` is accessible
- Check CORS settings if calling from frontend
- Verify debounce is working (500ms delay)

### Year Selector Not Persisting

- Check sessionStorage is enabled in browser
- Verify YearSelector component is mounted on all RSO pages
- Check for JavaScript errors in console

### Export Files Not Generating

- Verify ExcelJS/PDFKit libraries are installed
- Check file permissions for temporary directory
- Verify response headers (Content-Type, Content-Disposition)

### Scheduled Task Not Running

- Verify node-cron is installed
- Check job is registered in `apps/api/src/index.ts`
- Verify cron expression is correct: `"0 1 1 1 *"` (January 1st at 01:00)
- Check server logs for errors

## Next Steps

After Phase 2 is complete:

1. **Phase 3**: Gestion des activités (RSO activities) - depends on installations and years
2. **Phase 4**: Gestion des incidents (incident management)
3. **Phase 5**: Gestion des médias (file uploads)
4. **Phase 6**: Gestion SMS (SMS notifications)

## Support

For issues or questions:
- Check activity logs: `/rso/admin/activity-logs`
- Review API documentation: `/api/rso/docs` (if Swagger UI enabled)
- Check database logs for SQL errors
- Verify RLS policies are correctly applied

