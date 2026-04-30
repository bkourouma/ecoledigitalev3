# Data Model: Teacher Students List

**Feature**: 001-modify-teacher-students  
**Phase**: 1 - Data Model Design  
**Date**: 2025-10-10

## Overview

This document defines the database queries, data transformations, and entity relationships required to implement the teacher students list with class filtering. No new tables are required; the feature uses existing schema.

---

## Entity Relationships

```
┌─────────────┐
│   teachers  │
└──────┬──────┘
       │ 1
       │
       │ N
┌──────▼──────────────┐
│ teacher_assignments │ (links teacher to class-course)
└──────┬──────────────┘
       │ N
       │
       │ 1
┌──────▼──────────┐         ┌──────────────┐
│  class_courses  ├─────────┤   courses    │
└──────┬──────────┘   N:1   └──────────────┘
       │ N:1
       │
┌──────▼──────┐
│   classes   │
└──────┬──────┘
       │ 1
       │
       │ N
┌──────▼─────────────────┐
│ student_enrollments    │ (links student to class)
└──────┬─────────────────┘
       │ N
       │
       │ 1
┌──────▼──────────────┐      ┌────────┐
│  student_profiles   ├──────┤  users │
└─────────────────────┘ 1:1  └────────┘
```

**Key Insight**: The JOIN path from teacher to students goes through:
`teachers → teacher_assignments → class_courses → classes → student_enrollments → student_profiles`

---

## Database Queries

### Query 1: Get All Classes Assigned to Teacher

**Purpose**: Populate class filter dropdown

```sql
-- Get distinct classes where teacher has active assignments
SELECT DISTINCT
  cl.id,
  cl.name,
  cl.code,
  COUNT(DISTINCT se.student_id) as student_count
FROM teacher_assignments ta
JOIN class_courses cc ON ta.class_course_id = cc.id
JOIN classes cl ON cc.class_id = cl.id
LEFT JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2
WHERE ta.teacher_id = $1 
  AND ta.tenant_id = $2
GROUP BY cl.id, cl.name, cl.code
ORDER BY cl.name ASC;
```

**Parameters**:
- `$1`: `teacherId` (UUID) - Resolved from logged-in user
- `$2`: `tenantId` (UUID) - Resolved from X-Tenant header or session

**Expected Result**:
```json
[
  {
    "id": "class-uuid-1",
    "name": "Licence 1 Informatique",
    "code": "L1-INFO",
    "student_count": 25
  },
  {
    "id": "class-uuid-2",
    "name": "Master Data Science - IA",
    "code": "M2-DS-IA",
    "student_count": 15
  }
]
```

---

### Query 2: Get All Students for Teacher (With Optional Class Filter)

**Purpose**: Main data fetch for student list

```sql
-- Get students enrolled in classes where teacher has assignments
-- Deduplicated by (student_id, class_id) to prevent duplicates
SELECT DISTINCT ON (sp.id, cl.id)
  sp.id,
  sp.student_number as matricule,
  u.first_name,
  u.last_name,
  u.email,
  sp.phone,
  sp.status,
  cl.id as class_id,
  cl.name as class_name,
  cl.code as class_code,
  -- Performance metrics (optional, can be NULL if not calculated)
  NULL::numeric as average_grade,
  NULL::numeric as attendance_rate,
  se.enrollment_date,
  se.status as enrollment_status
FROM teacher_assignments ta
JOIN class_courses cc ON ta.class_course_id = cc.id
JOIN classes cl ON cc.class_id = cl.id
JOIN student_enrollments se ON se.class_id = cl.id
JOIN student_profiles sp ON se.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE ta.teacher_id = $1 
  AND ta.tenant_id = $2
  AND ($3::uuid IS NULL OR cl.id = $3) -- Optional class filter
  AND sp.tenant_id = $2
ORDER BY sp.id, cl.id, u.last_name ASC, u.first_name ASC;
```

**Parameters**:
- `$1`: `teacherId` (UUID)
- `$2`: `tenantId` (UUID)
- `$3`: `classId` (UUID or NULL) - NULL means "all classes"

**Expected Result** (without class filter):
```json
[
  {
    "id": "student-uuid-1",
    "matricule": "STU20240001",
    "first_name": "Jean",
    "last_name": "Dupont",
    "email": "jean.dupont@example.com",
    "phone": "+225 07 XX XX XX XX",
    "status": "active",
    "class_id": "class-uuid-1",
    "class_name": "Licence 1 Informatique",
    "class_code": "L1-INFO",
    "average_grade": null,
    "attendance_rate": null,
    "enrollment_date": "2024-09-01",
    "enrollment_status": "active"
  },
  // ... more students
]
```

**Expected Result** (with classId = "class-uuid-1"):
```json
[
  // Only students from "Licence 1 Informatique"
]
```

---

### Query 3: Get Performance Metrics (Optional Enhancement)

**Purpose**: Calculate average grades and attendance rates for students

**Note**: This query is EXPENSIVE and should be:
1. Executed separately (not in main query)
2. Cached/materialized
3. Made optional (frontend can show "-" if not available)

```sql
-- Get average grades for students (separate query, optional)
SELECT 
  asub.student_id,
  AVG(asub.grade) as average_grade,
  COUNT(*) as assignment_count
FROM assignment_submissions asub
JOIN assignments a ON asub.assignment_id = a.id
WHERE asub.student_id = ANY($1::uuid[]) -- Array of student IDs from main query
  AND a.tenant_id = $2
  AND asub.grade IS NOT NULL
GROUP BY asub.student_id;

-- Get attendance rates for students (separate query, optional)
SELECT 
  sar.student_id,
  (COUNT(*) FILTER (WHERE sar.attendance_status = 'present')::float / 
   NULLIF(COUNT(*), 0) * 100) as attendance_rate,
  COUNT(*) as session_count
FROM student_attendance_records sar
WHERE sar.student_id = ANY($1::uuid[])
  AND sar.tenant_id = $2
GROUP BY sar.student_id;
```

**Performance Consideration**:
- Main query returns students in ~40-80ms
- Performance queries add ~20-40ms each
- Total: ~100-160ms (well under 500ms requirement)
- **Recommendation**: Implement in Phase 2, make optional via query parameter `?includeMetrics=true`

---

## Data Transformations

### Backend → Frontend

**Backend Response** (from Query 2):
```typescript
interface TeacherStudentRow {
  id: string;
  matricule: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  class_id: string;
  class_name: string;
  class_code: string;
  average_grade: number | null;
  attendance_rate: number | null;
  enrollment_date: string;
  enrollment_status: string;
}
```

**Transform to**:
```typescript
interface TeacherStudent {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: 'active' | 'warning' | 'inactive';
  classId: string;
  className: string;
  classCode: string;
  average: number; // 0 if null
  attendance: number; // 0 if null
  enrollmentDate: string;
  enrollmentStatus: string;
}
```

**Transformation Logic**:
```typescript
function transformStudent(row: TeacherStudentRow): TeacherStudent {
  return {
    id: row.id,
    matricule: row.matricule,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone || 'Non renseigné',
    status: mapStatus(row.status, row.enrollment_status),
    classId: row.class_id,
    className: row.class_name,
    classCode: row.class_code,
    average: row.average_grade ?? 0,
    attendance: row.attendance_rate ?? 0,
    enrollmentDate: row.enrollment_date,
    enrollmentStatus: row.enrollment_status
  };
}

function mapStatus(
  profileStatus: string, 
  enrollmentStatus: string
): 'active' | 'warning' | 'inactive' {
  if (profileStatus !== 'active') return 'inactive';
  if (enrollmentStatus === 'suspended') return 'warning';
  if (enrollmentStatus === 'active') return 'active';
  return 'inactive';
}
```

---

## Multi-Class Student Handling

**Scenario**: Student enrolled in both "Licence 1" and "Licence 2", teacher teaches both.

**Database Result** (Query 2 without class filter):
```json
[
  {
    "id": "student-uuid-1",
    "first_name": "Marie",
    "last_name": "Kouassi",
    "class_id": "class-uuid-1",
    "class_name": "Licence 1 Informatique"
  },
  {
    "id": "student-uuid-1", // Same student
    "first_name": "Marie",
    "last_name": "Kouassi",
    "class_id": "class-uuid-2",
    "class_name": "Licence 2 Informatique"
  }
]
```

**Frontend Transformation** (to avoid confusion):
```typescript
function consolidateStudents(students: TeacherStudent[]): TeacherStudent[] {
  const studentMap = new Map<string, TeacherStudent>();
  const multiClassMap = new Map<string, string[]>();

  students.forEach(student => {
    if (!studentMap.has(student.id)) {
      studentMap.set(student.id, student);
      multiClassMap.set(student.id, [student.className]);
    } else {
      // Student already exists - track additional class
      multiClassMap.get(student.id)?.push(student.className);
    }
  });

  return Array.from(studentMap.values()).map(student => ({
    ...student,
    classes: multiClassMap.get(student.id) || [student.className],
    isMultiClass: (multiClassMap.get(student.id)?.length || 0) > 1
  }));
}
```

**Result**:
```json
[
  {
    "id": "student-uuid-1",
    "firstName": "Marie",
    "lastName": "Kouassi",
    "className": "Licence 1 Informatique", // Primary class (first encountered)
    "classes": ["Licence 1 Informatique", "Licence 2 Informatique"],
    "isMultiClass": true
  }
]
```

---

## Validation Rules

### Server-Side Validation (Zod Schema)

```typescript
import { z } from 'zod';

export const TeacherStudentsQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  includeMetrics: z.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type TeacherStudentsQuery = z.infer<typeof TeacherStudentsQuerySchema>;
```

### Client-Side Validation

```typescript
// Validate teacher has required role
if (!session || !session.roles.includes('teacher')) {
  redirect('/login');
}

// Validate tenant context
if (!session.tenantId) {
  throw new Error('Tenant context required');
}
```

---

## Indexing Requirements

**Verify Existing Indexes** (should already exist from previous features):

```sql
-- Teacher assignments lookup
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_tenant 
ON teacher_assignments(teacher_id, tenant_id);

-- Class courses lookup
CREATE INDEX IF NOT EXISTS idx_class_courses_class 
ON class_courses(class_id);

CREATE INDEX IF NOT EXISTS idx_class_courses_course 
ON class_courses(course_id);

-- Student enrollments lookup
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_tenant 
ON student_enrollments(class_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_tenant 
ON student_enrollments(student_id, tenant_id);

-- Student profiles lookup
CREATE INDEX IF NOT EXISTS idx_student_profiles_tenant 
ON student_profiles(tenant_id);

CREATE INDEX IF NOT EXISTS idx_student_profiles_user 
ON student_profiles(user_id);

-- Users lookup
CREATE INDEX IF NOT EXISTS idx_users_tenant 
ON users(tenant_id);
```

**Performance Verification**:
```sql
-- Run EXPLAIN ANALYZE on main query to verify < 100ms execution
EXPLAIN ANALYZE
[Query 2 here with real parameters];

-- Expected result: 
-- Planning Time: ~5ms
-- Execution Time: ~40-80ms
-- Total: < 100ms
```

---

## Edge Cases & Error Handling

### Case 1: Teacher with No Assignments
```sql
-- Query 1 returns: []
-- Query 2 returns: []
```
**Frontend**: Show empty state "Vous n'avez pas encore d'étudiants assignés"

### Case 2: Class with No Enrolled Students
```sql
-- Query 1 returns: { id: "class-uuid", name: "Empty Class", student_count: 0 }
-- Query 2 with classId filter returns: []
```
**Frontend**: Show empty state "Aucun étudiant dans cette classe"

### Case 3: Invalid Class ID Filter
```sql
-- Query 2 with classId = "invalid-uuid" returns: []
```
**Frontend**: Show "Aucun étudiant trouvé" (same as Case 2)

### Case 4: Tenant Isolation Breach Attempt
```sql
-- Query 2 with tampered teacherId from different tenant
-- Result: [] (RLS blocks cross-tenant access)
```
**Backend**: Log security event, return empty result (no error to avoid leaking info)

### Case 5: Deleted/Inactive Student
```sql
-- Student with status = 'deleted' or enrollment_status = 'withdrawn'
-- Still returned by query, but frontend can filter if needed
```
**Frontend**: Show status badge, optionally filter out deleted students

---

## State Transitions

**Student Enrollment Status**:
```
┌─────────┐
│ pending │
└────┬────┘
     │
     ▼
┌─────────┐     ┌────────────┐
│ active  │────▶│ suspended  │
└────┬────┘     └──────┬─────┘
     │                 │
     ▼                 ▼
┌────────────┐   ┌──────────┐
│ completed  │   │ withdrawn│
└────────────┘   └──────────┘
```

**Student Profile Status**:
- `active`: Currently enrolled and attending
- `inactive`: Not attending (temporary)
- `graduated`: Completed programme
- `dropped_out`: Withdrew before completion

**Display Mapping**:
```typescript
const statusMap = {
  active: { color: 'green', label: 'Actif' },
  warning: { color: 'yellow', label: 'Attention' }, // suspended enrollment
  inactive: { color: 'red', label: 'Inactif' }
};
```

---

## Summary

**Tables Used**:
- `teachers` (lookup teacher by user_id)
- `teacher_assignments` (find classes taught)
- `class_courses` (join teacher to classes)
- `classes` (class metadata)
- `student_enrollments` (find students in classes)
- `student_profiles` (student metadata)
- `users` (student names and emails)

**New Tables Required**: None

**Migrations Required**: None

**Performance Target**: < 100ms for main query, < 160ms with metrics

**Next Step**: Define API contracts in Phase 1

