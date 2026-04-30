# Quickstart: Child Tracking Feature

**Date**: 2025-01-27  
**Feature**: Child Tracking (`004-child-tracking-children`)

## Overview

This guide provides a quick start for implementing the parent child tracking feature. It covers the essential implementation steps and key files to create/modify.

## Implementation Steps

### 1. Backend API Routes

Create `apps/api/src/routes/parent-children.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { z } from "zod";

export async function parentChildrenRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/children - List all children
  fastify.get('/', {
    // schema, handler implementation
  });

  // GET /api/v1/parent/children/:childId - Get child details
  fastify.get('/:childId', {
    // schema, handler implementation
  });

  // GET /api/v1/parent/children/:childId/grades-summary
  fastify.get('/:childId/grades-summary', {
    // schema, handler implementation
  });

  // GET /api/v1/parent/children/:childId/schedule
  fastify.get('/:childId/schedule', {
    // schema, handler implementation
  });

  // GET /api/v1/parent/children/:childId/upcoming-classes
  fastify.get('/:childId/upcoming-classes', {
    // schema, handler implementation
  });

  // GET /api/v1/parent/children/:childId/attendance
  fastify.get('/:childId/attendance', {
    // schema, handler implementation
  });

  // GET /api/v1/parent/children/:childId/absence-history
  fastify.get('/:childId/absence-history', {
    // schema, handler implementation
  });
}
```

Register in `apps/api/src/index.ts`:
```typescript
import { parentChildrenRoutes } from "./routes/parent-children";
// ...
await fastify.register(parentChildrenRoutes, { prefix: "/api/v1/parent/children" });
```

### 2. TypeScript Contracts

Create `packages/contracts/src/parent.ts` with types defined in `contracts/parent-children-api.md`.

### 3. Frontend Pages

Create `apps/web/src/app/parent/children/page.tsx`:
- Children list page
- Uses `ChildrenList` component

Create `apps/web/src/app/parent/children/[childId]/page.tsx`:
- Child detail page with tabs for grades, schedule, attendance
- Uses `ChildGradesSummary`, `ChildSchedule`, `AttendanceRecords`, `AbsenceHistory` components

Create `apps/web/src/app/parent/children/[childId]/schedule/page.tsx`:
- Weekly schedule page
- Uses `ChildSchedule` component

### 4. Frontend Components

Create components in `apps/web/src/app/parent/components/`:
- `ChildrenList.tsx` - List of children with status indicators
- `ChildGradesSummary.tsx` - Grades summary display
- `ChildSchedule.tsx` - Weekly schedule view
- `UpcomingClasses.tsx` - Upcoming classes list
- `AttendanceRecords.tsx` - Attendance records with pagination
- `AbsenceHistory.tsx` - Absence history with filters

### 5. React Hooks

Create `apps/web/src/lib/hooks/use-parent-children.ts`:
- `useParentChildren()` - Fetch children list
- `useChildGradesSummary(childId)` - Fetch grades summary
- `useChildSchedule(childId, week)` - Fetch weekly schedule
- `useUpcomingClasses(childId)` - Fetch upcoming classes
- `useChildAttendance(childId, page)` - Fetch attendance records
- `useAbsenceHistory(childId, filters)` - Fetch absence history

## Key Implementation Patterns

### Access Control Pattern

```typescript
// Verify parent-child relationship exists
const relationshipCheck = await pool.query(
  `SELECT id FROM student_parents 
   WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
  [userId, childId, tenantId]
);

if (relationshipCheck.rows.length === 0) {
  return reply.status(403).send({
    success: false,
    error: 'Forbidden',
    message: 'Child not linked to parent'
  });
}
```

### Query Pattern for Children List

```typescript
const query = `
  SELECT 
    sp.id,
    sp.current_year,
    sp.status,
    sp.student_number,
    u.first_name,
    u.last_name,
    u.email
  FROM student_parents sp_rel
  JOIN student_profiles sp ON sp_rel.student_id = sp.id
  JOIN users u ON sp.user_id = u.id
  WHERE sp_rel.parent_id = $1
    AND sp_rel.tenant_id = $2
  ORDER BY u.last_name, u.first_name
`;
```

### Pagination Pattern for Attendance

```typescript
const limit = 20;
const offset = (page - 1) * limit;

const query = `
  SELECT sa.*, ...
  FROM student_attendance sa
  WHERE sa.student_id = $1
    AND sa.tenant_id = $2
  ORDER BY sa.marked_at DESC
  LIMIT $3 OFFSET $4
`;
```

## Testing Checklist

- [ ] API contract tests for all endpoints
- [ ] Access control tests (403 for unlinked children)
- [ ] Pagination tests for attendance records
- [ ] Filtering tests for absence history
- [ ] E2E tests for parent navigation flow
- [ ] E2E tests for viewing child data
- [ ] E2E tests for schedule navigation

## Next Steps

1. Implement backend API routes following patterns above
2. Create TypeScript contracts in `packages/contracts`
3. Build frontend pages and components
4. Add React hooks for data fetching
5. Write tests (contract, integration, E2E)
6. Update agent context with new technology (if any)

## References

- Specification: `specs/004-child-tracking-children/spec.md`
- Data Model: `specs/004-child-tracking-children/data-model.md`
- API Contracts: `specs/004-child-tracking-children/contracts/parent-children-api.md`
- Research: `specs/004-child-tracking-children/research.md`

