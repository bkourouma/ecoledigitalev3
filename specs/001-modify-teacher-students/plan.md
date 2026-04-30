# Implementation Plan: Teacher Students List with Class Filtering

**Branch**: `001-modify-teacher-students` | **Date**: 2025-10-10 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-modify-teacher-students/spec.md`

## Summary

Modify the `/teacher/students` page to display all students enrolled in classes where the logged-in teacher has active teaching assignments. Students are currently filtered by course assignments but need to be grouped and filtered by class instead. The implementation will add a class-based filter dropdown and consolidate students from multiple courses within the same class, removing duplicates.

**Technical approach**: 
1. Create new backend API endpoint `/api/v1/teacher/students` that consolidates students across all teacher assignments
2. Modify frontend to fetch from new endpoint instead of current assignment-based approach
3. Transform course filter to class filter using class data from teacher assignments
4. Add class grouping logic to prevent duplicate students

## Technical Context

**Language/Version**: TypeScript 5.x (Next.js 15, Node.js 18+)  
**Primary Dependencies**: Next.js 15, Fastify, PostgreSQL 14+, TanStack Query, Zod, NextAuth.js  
**Storage**: PostgreSQL with Row Level Security (RLS) for multi-tenant isolation  
**Testing**: Playwright (E2E), Jest (unit tests), Postman/curl (API contract tests)  
**Target Platform**: Linux VPS (shared server - port 8011, subdomain: ecoledigitale.engage-360.net)  
**Project Type**: Web application (monorepo: separate frontend/backend)  
**Performance Goals**: 
- Page load < 2 seconds for up to 100 students
- Class filter response < 500ms
- Support 1000+ students per tenant without degradation  

**Constraints**: 
- Must maintain tenant isolation (RLS enforced)
- No impact on shared VPS applications (engage-360.net, agents.engage-360.net, etc.)
- Must work with existing authentication system (NextAuth.js with teacher role check)
- Must preserve existing search functionality

**Scale/Scope**: 
- 50-200 students per teacher typical
- 5-15 classes per teacher
- Multiple courses per class possible

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Critical Principles (MUST verify for every feature)

- [x] **Multi-Tenant Isolation**: Does this feature access tenant-specific data? **YES**
  - [x] All database queries use tenant-scoped filters (`WHERE tenant_id = $1`)
  - [x] RLS policies already exist on student_profiles, student_enrollments, teachers, teacher_assignments, classes
  - [x] Tenant isolation tests planned (verify teacher cannot see students from other tenants)
  
- [x] **Type Safety & Validation**: 
  - [x] All API contracts defined in `packages/contracts` with Zod schemas (create TeacherStudentsResponse schema)
  - [x] All external inputs validated (tenant ID, teacher ID from headers)
  - [x] Types shared between frontend/backend (use existing Student type, extend if needed)
  
- [x] **Security-First Design**:
  - [x] Authentication required? **YES** - NextAuth.js integration (teacher role check in page component)
  - [x] Role-based access control defined - teacher role required
  - [x] File uploads? **NO**
  - [x] Security events logged - Log unauthorized access attempts to teacher students endpoint
  
- [x] **API-First Architecture**:
  - [x] Business logic in backend (`apps/api/src/routes/teacher-students.ts` - new file)
  - [x] API endpoints versioned (`/api/v1/teacher/students`)
  - [x] Structured error responses (400 Bad Request, 401 Unauthorized, 403 Forbidden, 500 Internal Server Error)
  
- [x] **Monorepo Standards**:
  - [x] Shared code in `packages/` - use existing `@ecoledigitale/contracts` package
  - [x] Dependencies declared in correct workspace (React Query already in apps/web, pg in apps/api)
  
- [x] **Production-Ready Code**:
  - [x] Error handling implemented (try/catch in API, error states in frontend)
  - [x] Database migrations planned - **NO** (uses existing tables: student_profiles, student_enrollments, teacher_assignments, classes)
  - [x] No impact on shared VPS apps - Uses existing port 8011, no Nginx config changes needed
  - [x] Health checks updated if needed - **NO** (feature doesn't affect health endpoints)

### Technology Stack Compliance

- [x] Using approved stack (Next.js 15, Fastify, PostgreSQL, TypeScript)
- [x] No new major dependencies - Using existing TanStack Query, Zod, pg, NextAuth.js
- [x] Environment variables for configuration - Use existing `NEXT_PUBLIC_API_URL`, `DATABASE_URL`

## Project Structure

### Documentation (this feature)

```
specs/001-modify-teacher-students/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output - Technical research and decisions
├── data-model.md        # Phase 1 output - Data model and database queries
├── quickstart.md        # Phase 1 output - Implementation guide
├── contracts/           # Phase 1 output - API contracts
│   └── teacher-students.ts
├── checklists/
│   └── requirements.md  # Specification quality validation
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```
apps/
├── api/                 # Backend (Fastify)
│   └── src/
│       ├── routes/
│       │   ├── teacher-students.ts      # NEW: Consolidated students endpoint
│       │   ├── teacher-assignments.ts   # EXISTING: Used for reference
│       │   └── index.ts                 # MODIFY: Register new route
│       └── types/                       # Shared backend types
│
└── web/                 # Frontend (Next.js 15)
    └── src/
        ├── app/
        │   └── teacher/
        │       └── students/
        │           └── page.tsx         # MODIFY: Update to use new endpoint
        └── lib/
            └── hooks/
                └── use-teachers.ts      # MODIFY: Add useTeacherStudentsByClass hook

packages/
└── contracts/           # Shared TypeScript types and Zod schemas
    └── src/
        └── teacher-students.ts          # NEW: API contract for teacher students

infra/
└── scripts/
    └── migrations/      # Database migrations (none needed for this feature)
```

**Structure Decision**: Web application structure (Option 2) is already in place. This feature modifies existing routes and pages without adding new applications or packages. The monorepo structure with `apps/` and `packages/` is followed per Constitution Principle V.

## Complexity Tracking

*No violations of Constitution principles. All requirements align with existing architecture.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A       | N/A        | N/A                                |

## Phase 0: Research & Technical Decisions

See [research.md](./research.md) for detailed findings.

### Key Research Areas

1. **Student Deduplication Strategy**: When a student is enrolled in Class A, and the teacher teaches 3 different courses in Class A, should the student appear once or three times?
   - **Decision**: Show once per class (deduplicate by student_id + class_id)
   - **Rationale**: Teacher wants to see "my students" not "my student-course pairs"

2. **Class Filter Population**: Should the filter show only classes with enrolled students, or all classes the teacher is assigned to?
   - **Decision**: Show all assigned classes (even if empty)
   - **Rationale**: Teacher may need to see which classes have no enrollments yet

3. **Performance Optimization**: With 200 students across 15 classes, what query strategy performs best?
   - **Decision**: Single query with JOINs and DISTINCT ON, not N+1 queries
   - **Rationale**: Database-level deduplication faster than application-level

4. **Default Filtering**: Should the page load with "All Classes" or filter to first class?
   - **Decision**: Default to "All Classes"
   - **Rationale**: Gives teacher full overview first, aligns with existing behavior

## Phase 1: Design & Contracts

See artifacts:
- [data-model.md](./data-model.md) - Database query design
- [contracts/teacher-students.ts](./contracts/teacher-students.ts) - API contract
- [quickstart.md](./quickstart.md) - Implementation walkthrough

### API Endpoints

**New Endpoint**:
- `GET /api/v1/teacher/students` - Get all students across teacher's assigned classes with optional class filter

**Modified Hooks**:
- `useTeacherStudents()` - Updated to use new endpoint instead of fetching per-assignment
- Frontend component updated to use class-based filtering

## Constitution Re-Check (Post-Design)

All principles verified in Phase 1 design:

✅ **Multi-Tenant Isolation**: All queries include `tenant_id` filters, RLS policies active  
✅ **Type Safety**: Zod schemas created in contracts package, TypeScript types generated  
✅ **Security**: Teacher authentication verified, role check enforced, tenant context required  
✅ **API-First**: Business logic in backend route, versioned endpoint, structured errors  
✅ **Monorepo**: Contracts in packages/, routes in apps/api, hooks in apps/web  
✅ **Production-Ready**: Error handling, logging, no breaking changes to VPS setup

## Next Steps

1. ✅ Run `/speckit.plan` (current command) - Generates this plan + research + data-model + contracts
2. ⏳ Run `/speckit.tasks` - Generate implementation tasks from this plan
3. ⏳ Execute tasks sequentially with testing at each checkpoint
4. ⏳ Deploy to staging, verify tenant isolation tests pass
5. ⏳ Deploy to production (VPS port 8011)

**Artifacts Generated**: plan.md, research.md, data-model.md, contracts/teacher-students.ts, quickstart.md
