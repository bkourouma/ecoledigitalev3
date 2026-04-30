# Quickstart: Teacher Students Implementation Guide

**Feature**: 001-modify-teacher-students  
**Date**: 2025-10-10  
**Estimated Time**: 4-6 hours

## Overview

This guide provides step-by-step instructions for implementing the teacher students list with class filtering feature. Follow these steps in order to ensure proper implementation.

---

## Prerequisites

- [x] Feature specification reviewed ([spec.md](./spec.md))
- [x] Research decisions understood ([research.md](./research.md))
- [x] Data model reviewed ([data-model.md](./data-model.md))
- [x] API contracts reviewed ([contracts/teacher-students.ts](./contracts/teacher-students.ts))
- [x] Development environment running (ports 3000 and 4000)
- [x] Database accessible (dbecoledigitale on localhost:5432)

---

## Implementation Steps

### Step 1: Backend API Endpoint (2-3 hours)

#### 1.1 Create Route File

**File**: `apps/api/src/routes/teacher-students.ts`

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// Zod schemas (copy from contracts/teacher-students.ts)
const TeacherStudentsQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  includeMetrics: z.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

interface TeacherStudentsRequest extends FastifyRequest {
  query: {
    classId?: string;
    includeMetrics?: boolean;
    page?: number;
    limit?: number;
  };
  tenantId?: string;
}

export async function teacherStudentsRoutes(fastify: FastifyInstance) {
  
  // GET /api/v1/teacher/students
  fastify.get('/', {
    schema: {
      description: 'Get all students from classes assigned to the teacher',
      tags: ['Teacher Students'],
      querystring: {
        type: 'object',
        properties: {
          classId: { type: 'string', format: 'uuid' },
          includeMetrics: { type: 'boolean', default: false },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 }
        }
      },
      headers: {
        type: 'object',
        properties: {
          'x-user-id': { type: 'string', format: 'uuid' },
          'x-tenant': { type: 'string' }
        },
        required: ['x-user-id', 'x-tenant']
      }
    }
  }, async (request: TeacherStudentsRequest, reply: FastifyReply) => {
    // Step 1: Validate tenant context
    if (!request.tenantId) {
      return reply.status(400).send({
        error: 'Tenant Required',
        message: 'This endpoint requires tenant context'
      });
    }

    // Step 2: Validate query parameters
    const queryValidation = TeacherStudentsQuerySchema.safeParse(request.query);
    if (!queryValidation.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: queryValidation.error.message
      });
    }

    const { classId, includeMetrics, page, limit } = queryValidation.data;

    // Step 3: Extract and validate teacher ID
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required. X-User-Id header missing.'
      });
    }

    try {
      // Step 4: Get teacher ID from user ID
      const teacherQuery = await fastify.pg.query(`
        SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
      `, [userId, request.tenantId]);

      if (teacherQuery.rows.length === 0) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Access denied. Teacher role required.'
        });
      }

      const teacherId = teacherQuery.rows[0].id;

      // Step 5: Get teacher's classes (for filter dropdown)
      const classesQuery = await fastify.pg.query(`
        SELECT DISTINCT
          cl.id,
          cl.name,
          cl.code,
          COUNT(DISTINCT se.student_id) as student_count
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        LEFT JOIN student_enrollments se ON se.class_id = cl.id AND se.tenant_id = $2
        WHERE ta.teacher_id = $1 AND ta.tenant_id = $2
        GROUP BY cl.id, cl.name, cl.code
        ORDER BY cl.name ASC
      `, [teacherId, request.tenantId]);

      const classes = classesQuery.rows.map(row => ({
        id: row.id,
        name: row.name,
        code: row.code,
        studentCount: parseInt(row.student_count, 10)
      }));

      // Step 6: Get students (with optional class filter)
      const offset = (page - 1) * limit;
      
      const studentsQuery = await fastify.pg.query(`
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
          AND ($3::uuid IS NULL OR cl.id = $3)
          AND sp.tenant_id = $2
        ORDER BY sp.id, cl.id, u.last_name ASC, u.first_name ASC
        LIMIT $4 OFFSET $5
      `, [teacherId, request.tenantId, classId || null, limit, offset]);

      // Step 7: Count total students (for pagination)
      const countQuery = await fastify.pg.query(`
        SELECT COUNT(DISTINCT sp.id) as total
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN student_enrollments se ON se.class_id = cl.id
        JOIN student_profiles sp ON se.student_id = sp.id
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          AND ($3::uuid IS NULL OR cl.id = $3)
          AND sp.tenant_id = $2
      `, [teacherId, request.tenantId, classId || null]);

      const total = parseInt(countQuery.rows[0]?.total || '0', 10);

      // Step 8: Transform students data
      const students = studentsQuery.rows.map(row => ({
        id: row.id,
        matricule: row.matricule,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone || null,
        status: mapStatus(row.status, row.enrollment_status),
        classId: row.class_id,
        className: row.class_name,
        classCode: row.class_code,
        average: null, // TODO: Implement in Phase 2 if includeMetrics=true
        attendance: null, // TODO: Implement in Phase 2 if includeMetrics=true
        enrollmentDate: row.enrollment_date,
        enrollmentStatus: row.enrollment_status
      }));

      // Step 9: Return response
      return reply.send({
        classes,
        students,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      fastify.log.error(`Teacher students error: ${error}`);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch teacher students'
      });
    }
  });
}

// Helper function to map status
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

#### 1.2 Register Route

**File**: `apps/api/src/index.ts`

Find the section where routes are registered and add:

```typescript
import { teacherStudentsRoutes } from './routes/teacher-students';

// ... existing code ...

// Register routes
await fastify.register(teacherStudentsRoutes, { prefix: '/api/v1/teacher/students' });
```

#### 1.3 Test Backend Endpoint

```bash
# Test 1: Get all students
curl -X GET "http://localhost:4000/api/v1/teacher/students" \
  -H "X-Tenant: imhotepacademy" \
  -H "X-User-Id: d7ea2980-d464-480b-b84c-13ed7df031bb" \
  -H "X-Dev-Auth: 1"

# Test 2: Filter by class
curl -X GET "http://localhost:4000/api/v1/teacher/students?classId=YOUR_CLASS_ID" \
  -H "X-Tenant: imhotepacademy" \
  -H "X-User-Id: d7ea2980-d464-480b-b84c-13ed7df031bb" \
  -H "X-Dev-Auth: 1"

# Test 3: Unauthorized (no X-User-Id)
curl -X GET "http://localhost:4000/api/v1/teacher/students" \
  -H "X-Tenant: imhotepacademy"
# Expected: 401 Unauthorized
```

---

### Step 2: Frontend Hook Update (1 hour)

#### 2.1 Update use-teachers.ts

**File**: `apps/web/src/lib/hooks/use-teachers.ts`

Add new hook at the end of the file:

```typescript
// New hook for teacher students with class filtering
export function useTeacherStudentsByClass(classId?: string, includeMetrics?: boolean) {
  return useQuery({
    queryKey: ["teacher-students", classId, includeMetrics],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (classId && classId !== 'all') params.append('classId', classId);
      if (includeMetrics) params.append('includeMetrics', 'true');

      const response = await fetch(
        `${API_BASE_URL}/api/v1/teacher/students?${params}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Tenant": "imhotepacademy",
            "X-Dev-Auth": "1",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch teacher students");
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
```

**Note**: Replace hardcoded X-User-Id with actual session user ID in production.

---

### Step 3: Frontend Page Update (1-2 hours)

#### 3.1 Update Teacher Students Page

**File**: `apps/web/src/app/teacher/students/page.tsx`

Replace the existing implementation with:

```typescript
"use client";

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Users,
  Search,
  Filter,
  Mail,
  Phone,
  BookOpen,
  Award,
  TrendingUp,
  MessageSquare,
  Eye,
  Download,
  Loader2
} from 'lucide-react';
import { useTeacherStudentsByClass } from '@/lib/hooks/use-teachers';

export default function TeacherStudentsPage() {
  const { data: session, status } = useSession();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');

  // Fetch data using new hook
  const { data, isLoading, error } = useTeacherStudentsByClass(selectedClass, false);

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    redirect('/');
  }

  const classes = data?.classes || [];
  const students = data?.students || [];

  // Filter students based on search
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      const matchesSearch =
        student.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.matricule.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.email.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch;
    });
  }, [students, searchTerm]);

  // Calculate statistics
  const totalStudents = filteredStudents.length;
  const activeStudents = filteredStudents.filter(s => s.status === 'active').length;
  const averageGrade = filteredStudents.length > 0
    ? filteredStudents.reduce((sum, s) => sum + (s.average || 0), 0) / filteredStudents.length
    : 0;
  const averageAttendance = filteredStudents.length > 0
    ? filteredStudents.reduce((sum, s) => sum + (s.attendance || 0), 0) / filteredStudents.length
    : 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'inactive':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Actif';
      case 'warning':
        return 'Attention';
      case 'inactive':
        return 'Inactif';
      default:
        return 'Inconnu';
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-pink-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Chargement des étudiants...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-pink-50">
        <div className="text-center">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <p className="font-bold">Erreur de chargement</p>
            <p>Impossible de charger les étudiants. Veuillez réessayer.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                Mes Étudiants
              </h1>
              <p className="text-gray-600 mt-2">
                Gestion et suivi de vos étudiants
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <button className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                <Download className="w-4 h-4" />
                <span>Exporter</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Étudiants</p>
                <p className="text-3xl font-bold text-purple-600">{totalStudents}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <Users className="w-8 h-8 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Moyenne Générale</p>
                <p className="text-3xl font-bold text-purple-600">{averageGrade.toFixed(1)}/20</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Award className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Présence Moyenne</p>
                <p className="text-3xl font-bold text-purple-600">{averageAttendance.toFixed(0)}%</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <TrendingUp className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Rechercher un étudiant..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">Toutes les classes</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} ({cls.studentCount} étudiants)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Students List */}
        <div className="bg-white rounded-xl shadow-sm border border-purple-100">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Liste des Étudiants</h2>
            <p className="text-gray-600 mt-1">{filteredStudents.length} étudiant(s) trouvé(s)</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Étudiant
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Classe
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Moyenne
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Présence
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Statut
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="text-gray-500">
                        <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="text-lg font-medium">Aucun étudiant trouvé</p>
                        <p className="text-sm">
                          {students.length === 0
                            ? "Vous n'avez pas encore d'étudiants assignés."
                            : "Aucun étudiant ne correspond à vos critères de recherche."
                          }
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {student.firstName} {student.lastName}
                        </div>
                        <div className="text-sm text-gray-500">{student.matricule}</div>
                        <div className="text-sm text-gray-500">{student.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{student.className}</div>
                      <div className="text-sm text-gray-500">{student.classCode}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {student.average ? `${student.average.toFixed(1)}/20` : '-/20'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {student.attendance ? `${student.attendance.toFixed(0)}%` : '-%'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(student.status)}`}>
                        {getStatusLabel(student.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button className="text-purple-600 hover:text-purple-900">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="text-blue-600 hover:text-blue-900">
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        <button className="text-green-600 hover:text-green-900">
                          <Mail className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### Step 4: Testing & Validation (1 hour)

#### 4.1 Manual Testing Checklist

- [ ] Backend endpoint returns correct data structure
- [ ] Class filter dropdown populated with teacher's classes
- [ ] Selecting "Toutes les classes" shows all students
- [ ] Selecting specific class filters students correctly
- [ ] Search functionality works across name, email, matricule
- [ ] Empty states show appropriate messages
- [ ] Statistics update based on filtered students
- [ ] No duplicate students appear in list
- [ ] Teacher cannot see students from other tenants
- [ ] Non-teacher users cannot access endpoint

#### 4.2 Performance Testing

```bash
# Test response time with curl
time curl -X GET "http://localhost:4000/api/v1/teacher/students" \
  -H "X-Tenant: imhotepacademy" \
  -H "X-User-Id: d7ea2980-d464-480b-b84c-13ed7df031bb" \
  -H "X-Dev-Auth: 1"

# Expected: < 500ms
```

#### 4.3 Security Testing

```bash
# Test 1: Cross-tenant access (should fail)
curl -X GET "http://localhost:4000/api/v1/teacher/students" \
  -H "X-Tenant: other-tenant" \
  -H "X-User-Id: d7ea2980-d464-480b-b84c-13ed7df031bb" \
  -H "X-Dev-Auth: 1"
# Expected: No students or error

# Test 2: Non-teacher access (should fail)
curl -X GET "http://localhost:4000/api/v1/teacher/students" \
  -H "X-Tenant: imhotepacademy" \
  -H "X-User-Id: STUDENT_USER_ID" \
  -H "X-Dev-Auth: 1"
# Expected: 403 Forbidden
```

---

## Common Issues & Solutions

### Issue 1: "Teacher not found" error

**Cause**: User ID doesn't have corresponding teacher profile

**Solution**:
```sql
-- Verify teacher exists
SELECT * FROM teachers WHERE user_id = 'd7ea2980-d464-480b-b84c-13ed7df031bb';

-- If missing, create teacher profile (see Actual_ReadMe.md for test accounts)
```

### Issue 2: Empty student list despite having assignments

**Cause**: Class has no enrolled students

**Solution**:
```sql
-- Check student enrollments
SELECT cl.name, COUNT(se.id) as enrollment_count
FROM classes cl
LEFT JOIN student_enrollments se ON cl.id = se.class_id
WHERE cl.id IN (
  SELECT DISTINCT cc.class_id
  FROM teacher_assignments ta
  JOIN class_courses cc ON ta.class_course_id = cc.id
  WHERE ta.teacher_id = 'YOUR_TEACHER_ID'
)
GROUP BY cl.id, cl.name;
```

### Issue 3: Slow query performance

**Cause**: Missing indexes

**Solution**:
```sql
-- Verify indexes exist (see data-model.md)
\d teacher_assignments
\d class_courses
\d student_enrollments
```

---

## Next Steps After Implementation

1. ✅ Complete backend endpoint
2. ✅ Update frontend hook
3. ✅ Update teacher students page
4. ✅ Test manually
5. ⏳ Write automated tests (E2E with Playwright)
6. ⏳ Add performance metrics feature (optional, Phase 2)
7. ⏳ Deploy to staging
8. ⏳ Deploy to production

---

## Estimated Timeline

| Task | Time Estimate | Complexity |
|------|---------------|------------|
| Backend API endpoint | 2-3 hours | Medium |
| Frontend hook update | 1 hour | Low |
| Frontend page update | 1-2 hours | Medium |
| Testing & validation | 1 hour | Low |
| **Total** | **5-7 hours** | **Medium** |

---

## Support & References

- **Spec**: [spec.md](./spec.md)
- **Research**: [research.md](./research.md)
- **Data Model**: [data-model.md](./data-model.md)
- **Contracts**: [contracts/teacher-students.ts](./contracts/teacher-students.ts)
- **Constitution**: `.specify/memory/constitution.md`
- **Test Accounts**: See `Actual_ReadMe.md` (Teacher: kouadio.assi@ecoledigitale.ci)

For questions or issues, refer to the spec documents or EcoleDigitale Constitution.

