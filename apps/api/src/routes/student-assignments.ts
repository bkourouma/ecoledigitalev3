import { FastifyInstance } from "fastify";
import { z } from "zod";

const StudentAssignmentsQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'submitted', 'graded', 'all']).default('all'),
  course_id: z.string().uuid().optional(),
  priority: z.enum(['low', 'medium', 'high', 'all']).default('all'),
  limit: z.coerce.number().min(1).default(20),
  offset: z.coerce.number().min(0).default(0)
});

const StudentAssignmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  course: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string()
  }),
  instructor: z.object({
    id: z.string().uuid(),
    first_name: z.string(),
    last_name: z.string()
  }),
  due_date: z.string(),
  submitted_at: z.string().nullable(),
  status: z.enum(['pending', 'submitted', 'graded', 'expired']),
  priority: z.enum(['low', 'medium', 'high']),
  max_points: z.number(),
  grade: z.number().nullable(),
  submission_type: z.enum(['file', 'text', 'online', 'evaluation', 'homework']),
  feedback: z.string().nullable(),
  subject_document_url: z.string().nullable().optional(),
  subject_document_name: z.string().nullable().optional(),
  subject_content: z.string().nullable().optional(),
});

const StudentAssignmentsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(StudentAssignmentSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    has_more: z.boolean()
  })
});

export async function studentAssignmentsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/student/assignments - Liste des devoirs de l'étudiant
  fastify.get("/", async (request, reply) => {
    // Parse and validate query parameters with defaults
    const queryResult = StudentAssignmentsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        success: false,
        error: 'Paramètres de requête invalides',
        details: queryResult.error.errors
      });
    }
    
    const { student_id, status, course_id, priority, limit, offset } = queryResult.data;
    const tenantId = request.headers['x-tenant'] as string;
    const userIdHeader = request.headers['x-user-id'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

    if (!tenantId) {
      return reply.status(400).send({
        success: false,
        error: 'Tenant ID requis'
      });
    }

    // For development, we need to identify the student from the authenticated user
    if (!userIdHeader && !student_id) {
      return reply.status(400).send({
        success: false,
        error: 'User ID ou Student ID requis'
      });
    }

    try {
      // 1. Convert tenant name to UUID if needed
      let actualTenantId = tenantId;

      // If tenantId is not a UUID, look it up by name
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(tenantId)) {
        const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
        const tenantResult = await fastify.pg.query(tenantQuery, [tenantId]);

        if (tenantResult.rows.length === 0) {
          return {
            success: true,
            data: [],
            pagination: { total: 0, limit, offset, has_more: false }
          };
        }

        actualTenantId = tenantResult.rows[0].id;
      }

      // 2. Get student profile from user_id if provided
      let actualStudentId = student_id;
      if (userIdHeader && !student_id) {
        const studentQuery = `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`;
        const studentResult = await fastify.pg.query(studentQuery, [userIdHeader, actualTenantId]);

        if (studentResult.rows.length === 0) {
          // For development/testing: if no student profile found, return all assignments for the tenant
          console.log('No student profile found for user_id:', userIdHeader, 'showing all assignments for tenant');
          actualStudentId = null; // This will skip the student filtering
        } else {
          actualStudentId = studentResult.rows[0].id;
        }
      }

      // 3. Query assignments from database based on student enrollment
      console.log('🔍 Querying real assignments from database for student:', actualStudentId);
      
      // First, let's check if the student is enrolled in any class
      const enrollmentCheckQuery = `
        SELECT se.class_id, cl.name as class_name, se.status as enrollment_status
        FROM student_enrollments se
        JOIN classes cl ON se.class_id = cl.id
        WHERE se.student_id = $1 AND se.tenant_id = $2
      `;
      const enrollmentResult = await fastify.pg.query(enrollmentCheckQuery, [actualStudentId, actualTenantId]);
      console.log('📊 Student enrollments:', JSON.stringify(enrollmentResult.rows, null, 2));
      
      // Check if there are any assignment instances for the tenant
      const instancesCheckQuery = `
        SELECT ai.id, ai.assignment_id, ai.class_id, a.title, a.status as assignment_status
        FROM assignment_instances ai
        JOIN assignments a ON ai.assignment_id = a.id
        WHERE ai.tenant_id = $1
        LIMIT 5
      `;
      const instancesResult = await fastify.pg.query(instancesCheckQuery, [actualTenantId]);
      console.log('📊 Assignment instances in tenant:', JSON.stringify(instancesResult.rows, null, 2));
      
      let assignmentsQuery = '';
      let queryParams: any[] = [];
      
      if (actualStudentId) {
        // Query assignments for specific student based on their class enrollment
        assignmentsQuery = `
          SELECT DISTINCT
            ai.id as instance_id,
            a.id as assignment_id,
            a.title,
            a.description,
            a.type as submission_type,
            COALESCE(
              (
                SELECT SUM(eq.points)::double precision
                FROM evaluation_questions eq
                WHERE eq.assignment_id = a.id
                  AND eq.tenant_id = $2
              ),
              CASE WHEN a.type = 'evaluation' THEN 0 ELSE 100 END
            )::double precision as max_points,
            a.status as assignment_status,
            ai.starts_at,
            ai.ends_at as due_date,
            ai.status as instance_status,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            t.id as teacher_id,
            u.first_name as teacher_first_name,
            u.last_name as teacher_last_name,
            COALESCE(sa.submitted_at, NULL) as submitted_at,
            COALESCE(sa.final_score, sa.manual_score, NULL) as grade,
            COALESCE(sa.feedback, NULL) as feedback,
            a.subject_document_url,
            a.subject_content,
            a.max_file_size_mb,
            CASE 
              WHEN sa.submitted_at IS NOT NULL AND (sa.final_score IS NOT NULL OR sa.manual_score IS NOT NULL) THEN 'graded'
              WHEN sa.submitted_at IS NOT NULL THEN 'submitted'
              WHEN ai.ends_at < NOW() THEN 'expired'
              ELSE 'pending'
            END as status,
            CASE 
              WHEN ai.ends_at < NOW() + INTERVAL '1 day' THEN 'high'
              WHEN ai.ends_at < NOW() + INTERVAL '3 days' THEN 'medium'
              ELSE 'low'
            END as priority
           FROM assignment_instances ai
           JOIN assignments a ON ai.assignment_id = a.id
           JOIN classes cl ON ai.class_id = cl.id
           JOIN student_enrollments se ON cl.id = se.class_id
           JOIN courses c ON a.course_id = c.id
           LEFT JOIN teachers t ON ai.teacher_id = t.id
           LEFT JOIN users u ON t.user_id = u.id
           LEFT JOIN assignment_submissions sa ON a.id = sa.assignment_id AND se.student_id = sa.student_id
          WHERE se.student_id = $1 
            AND se.tenant_id = $2 
            AND se.status = 'active'
            AND ai.tenant_id = $2
            AND a.tenant_id = $2
            AND a.status = 'published'
            AND ($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)
        `;
        queryParams = [actualStudentId, actualTenantId, activeAcademicYearId || null];
      } else {
        // If no specific student, return all assignments for the tenant (fallback)
        assignmentsQuery = `
          SELECT DISTINCT
            ai.id as instance_id,
            a.id as assignment_id,
            a.title,
            a.description,
            a.type as submission_type,
            COALESCE(
              (
                SELECT SUM(eq.points)::double precision
                FROM evaluation_questions eq
                WHERE eq.assignment_id = a.id
                  AND eq.tenant_id = $1
              ),
              CASE WHEN a.type = 'evaluation' THEN 0 ELSE 100 END
            )::double precision as max_points,
            a.status as assignment_status,
            ai.starts_at,
            ai.ends_at as due_date,
            ai.status as instance_status,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            t.id as teacher_id,
            u.first_name as teacher_first_name,
            u.last_name as teacher_last_name,
            NULL as submitted_at,
            NULL as grade,
            NULL as feedback,
            a.subject_document_url,
            a.subject_content,
            a.max_file_size_mb,
            'pending' as status,
            'medium' as priority
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          LEFT JOIN teachers t ON ai.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE ai.tenant_id = $1
            AND a.tenant_id = $1
            AND a.status = 'published'
        `;
        queryParams = [actualTenantId];
      }

      // Add filters to the query
      const whereConditions: string[] = [];
      
      if (status && status !== 'all') {
        if (status === 'expired') {
          whereConditions.push('ai.ends_at < NOW()');
        } else if (status === 'pending') {
          whereConditions.push('(sa.submitted_at IS NULL AND ai.ends_at >= NOW())');
        } else if (status === 'submitted') {
          whereConditions.push('(sa.submitted_at IS NOT NULL AND sa.grade IS NULL)');
        } else if (status === 'graded') {
          whereConditions.push('(sa.submitted_at IS NOT NULL AND sa.grade IS NOT NULL)');
        }
      }

      if (course_id) {
        whereConditions.push('c.id = $' + (queryParams.length + 1));
        queryParams.push(course_id);
      }

      if (whereConditions.length > 0) {
        assignmentsQuery += ' AND ' + whereConditions.join(' AND ');
      }

      assignmentsQuery += ' ORDER BY ai.ends_at ASC';

      console.log('📊 Executing query:', assignmentsQuery);
      console.log('📊 Query params:', queryParams);

      const assignmentsResult = await fastify.pg.query(assignmentsQuery, queryParams);
      const rawAssignments = assignmentsResult.rows;

      console.log('📊 Raw assignments from DB:', rawAssignments.length);
      console.log('📊 Raw assignments data:', JSON.stringify(rawAssignments, null, 2));

      // Transform the data to match the expected format
      const assignments = rawAssignments.map(row => ({
        id: row.instance_id, // Use instance_id as the unique identifier
        assignment_id: row.assignment_id, // Keep assignment_id for reference
        title: row.title,
        description: row.description || '',
        course: {
          id: row.course_id,
          name: row.course_name,
          code: row.course_code
        },
        instructor: {
          id: row.teacher_id,
          first_name: row.teacher_first_name,
          last_name: row.teacher_last_name
        },
        due_date: row.due_date,
        submitted_at: row.submitted_at,
        status: row.status,
        priority: row.priority,
        max_points: Number(row.max_points ?? (row.submission_type === 'evaluation' ? 0 : 100)),
        grade: row.grade,
        submission_type: row.submission_type || 'online',
        feedback: row.feedback,
        subject_document_url: row.subject_document_url || null,
        subject_document_name: row.subject_document_url
          ? String(row.subject_document_url).split('/').pop() || null
          : null,
        subject_content: row.subject_content || null,
        max_file_size_mb: row.max_file_size_mb ?? undefined,
      }));

      console.log('📊 Transformed assignments:', assignments.length);

      // Apply filters to the real data
      let filteredAssignments = assignments;
      
      console.log('🔍 Filtering real data:');
      console.log('- Original assignments count:', assignments.length);
      console.log('- status:', status);
      console.log('- priority:', priority);
      console.log('- course_id:', course_id);

      // Filter by priority (additional client-side filtering)
      if (priority && priority !== 'all' && priority !== undefined) {
        console.log('Filtering by priority:', priority);
        filteredAssignments = filteredAssignments.filter(a => a.priority === priority);
        console.log('After priority filter:', filteredAssignments.length);
      }
      
      console.log('Final filtered assignments count:', filteredAssignments.length);

      // Apply pagination
      const total = filteredAssignments.length;
      const paginatedAssignments = filteredAssignments.slice(offset, offset + limit);

      return {
        success: true,
        data: paginatedAssignments,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total
        }
      };

    } catch (error) {
      fastify.log.error('Error in student assignments:', error);
      console.error('Student assignments error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des devoirs',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // GET /api/v1/student/assignments/:id - Détails d'un devoir (instance_id)
  fastify.get("/:id", async (request, reply) => {
    const { id: instanceId } = request.params as { id: string };
    const tenantId = request.headers['x-tenant'] as string;
    const userIdHeader = request.headers['x-user-id'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
    
    if (!tenantId) {
      return reply.status(400).send({
        success: false,
        error: 'Tenant ID requis'
      });
    }

    if (!userIdHeader) {
      return reply.status(400).send({
        success: false,
        error: 'User ID requis'
      });
    }
    
    try {
      console.log('🔍 GET /api/v1/student/assignments/:id - Détails du devoir');
      console.log('📋 Request params:', {
        instanceId,
        tenantId,
        userIdHeader,
        studentIdHeader: request.headers['x-student-id']
      });

      // Convert tenant name to UUID if needed
      let actualTenantId = tenantId;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(tenantId)) {
        console.log('🔄 Converting tenant name to UUID:', tenantId);
        const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
        const tenantResult = await fastify.pg.query(tenantQuery, [tenantId]);

        if (tenantResult.rows.length === 0) {
          console.error('❌ Tenant not found:', tenantId);
          return reply.status(404).send({
            success: false,
            error: 'Tenant non trouvé'
          });
        }
        actualTenantId = tenantResult.rows[0].id;
        console.log('✅ Tenant UUID:', actualTenantId);
      }

      // Find the student
      let studentId = request.headers['x-student-id'] as string;
      if (!studentId) {
        const userId = userIdHeader || '6d9dd979-1dfa-4c53-95b0-2b536094f429';
        console.log('🔍 Looking for student profile with user_id:', userId);

        const studentQuery = `
          SELECT sp.id as student_id, sp.user_id, u.email
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.tenant_id = $1 AND sp.user_id = $2
        `;
        const studentResult = await fastify.pg.query(studentQuery, [actualTenantId, userId]);

        console.log('📊 Student query result:', {
          rowCount: studentResult.rows.length,
          data: studentResult.rows
        });

        if (studentResult.rows.length === 0) {
          console.error('❌ Student profile not found for user_id:', userId);
          console.error('   Tenant ID:', actualTenantId);

          // Check if user exists
          const userCheck = await fastify.pg.query(
            'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
            [userId]
          );
          console.log('👤 User exists:', userCheck.rows);

          return reply.status(404).send({
            success: false,
            error: 'Étudiant non trouvé',
            details: {
              userId,
              tenantId: actualTenantId,
              userExists: userCheck.rows.length > 0,
              userEmail: userCheck.rows[0]?.email
            }
          });
        }
        studentId = studentResult.rows[0].student_id;
        console.log('✅ Student found:', {
          studentId,
          userId: studentResult.rows[0].user_id,
          email: studentResult.rows[0].email
        });
      }

      // Query the specific assignment instance
      const assignmentQuery = `
        SELECT DISTINCT
          ai.id as instance_id,
          a.id as assignment_id,
          a.title,
          a.description,
          a.type as submission_type,
          a.subject_content,
          a.subject_document_url,
          a.max_file_size_mb,
          a.max_attempts,
          a.duration_minutes,
          a.late_submission_allowed,
          COALESCE(
            (
              SELECT SUM(eq.points)::double precision
              FROM evaluation_questions eq
              WHERE eq.assignment_id = a.id
                AND eq.tenant_id = $3
            ),
            CASE WHEN a.type = 'evaluation' THEN 0 ELSE 100 END
          )::double precision as max_points,
          a.status as assignment_status,
          ai.starts_at,
          ai.ends_at as due_date,
          ai.status as instance_status,
          c.id as course_id,
          c.name as course_name,
          c.code as course_code,
          t.id as teacher_id,
          u.first_name as teacher_first_name,
          u.last_name as teacher_last_name,
          COALESCE(sa.submitted_at, NULL) as submitted_at,
          COALESCE(sa.final_score, sa.manual_score, NULL) as grade,
          COALESCE(sa.feedback, NULL) as feedback,
          COALESCE(
            (SELECT COUNT(*) FROM assignment_submissions 
             WHERE assignment_id = a.id AND student_id = se.student_id), 
            0
          ) as submission_count,
          CASE 
            WHEN sa.submitted_at IS NOT NULL AND (sa.final_score IS NOT NULL OR sa.manual_score IS NOT NULL) THEN 'graded'
            WHEN sa.submitted_at IS NOT NULL THEN 'submitted'
            WHEN ai.ends_at < NOW() THEN 'expired'
            ELSE 'pending'
          END as status,
          CASE 
            WHEN ai.ends_at < NOW() + INTERVAL '1 day' THEN 'high'
            WHEN ai.ends_at < NOW() + INTERVAL '3 days' THEN 'medium'
            ELSE 'low'
          END as priority
        FROM assignment_instances ai
        JOIN assignments a ON ai.assignment_id = a.id
        JOIN classes cl ON ai.class_id = cl.id
        JOIN student_enrollments se ON cl.id = se.class_id
        JOIN courses c ON a.course_id = c.id
        LEFT JOIN teachers t ON ai.teacher_id = t.id
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN assignment_submissions sa ON a.id = sa.assignment_id AND se.student_id = sa.student_id
        WHERE ai.id = $1 
          AND se.student_id = $2 
          AND se.tenant_id = $3 
          AND se.status = 'active'
          AND ai.tenant_id = $3
          AND a.tenant_id = $3
          AND a.status = 'published'
          AND ($4::uuid IS NULL OR cl.academic_year_id = $4::uuid)
      `;

      console.log('🔍 Querying assignment with params:', {
        instanceId,
        studentId,
        tenantId: actualTenantId
      });

      const assignmentResult = await fastify.pg.query(assignmentQuery, [instanceId, studentId, actualTenantId, activeAcademicYearId || null]);

      console.log('📊 Assignment query result:', {
        rowCount: assignmentResult.rows.length,
        found: assignmentResult.rows.length > 0
      });

      if (assignmentResult.rows.length === 0) {
        console.error('❌ Assignment not found or access denied');

        // Debug: Check if assignment instance exists
        const instanceCheck = await fastify.pg.query(
          'SELECT id, assignment_id, class_id, status FROM assignment_instances WHERE id = $1',
          [instanceId]
        );
        console.log('🔍 Instance exists:', instanceCheck.rows);

        // Debug: Check student enrollment
        const enrollmentCheck = await fastify.pg.query(
          'SELECT se.id, se.student_id, se.class_id, se.status FROM student_enrollments se WHERE se.student_id = $1',
          [studentId]
        );
        console.log('🔍 Student enrollments:', enrollmentCheck.rows);

        return reply.status(404).send({
          success: false,
          error: 'Devoir non trouvé ou accès non autorisé',
          debug: {
            instanceId,
            studentId,
            tenantId: actualTenantId,
            instanceExists: instanceCheck.rows.length > 0,
            instanceData: instanceCheck.rows[0],
            enrollments: enrollmentCheck.rows
          }
        });
      }

      console.log('✅ Assignment found:', assignmentResult.rows[0].title);
      
      const row = assignmentResult.rows[0];
      
      // Transform the data to match the expected format
      const assignment = {
        id: row.instance_id,
        assignment_id: row.assignment_id,
        title: row.title,
        description: row.description || '',
        course: {
          id: row.course_id,
          name: row.course_name,
          code: row.course_code
        },
        instructor: {
          id: row.teacher_id,
          first_name: row.teacher_first_name,
          last_name: row.teacher_last_name
        },
        due_date: row.due_date,
        submitted_at: row.submitted_at,
        status: row.status,
        priority: row.priority,
        max_points: Number(row.max_points ?? (row.submission_type === 'evaluation' ? 0 : 100)),
        grade: row.grade,
        submission_type: row.submission_type || 'online',
        feedback: row.feedback,
        allow_late_submissions: row.late_submission_allowed || false,
        subject_content: row.subject_content,
        subject_document_url: row.subject_document_url,
        subject_document_name: row.subject_document_url ? row.subject_document_url.split('/').pop() : null,
        max_file_size_mb: row.max_file_size_mb || 10,
        max_attempts: row.max_attempts || 2,
        duration_minutes: row.duration_minutes,
        submission_count: row.submission_count || 0,
        can_submit: row.max_attempts ? (row.submission_count < row.max_attempts) : true
      };

      return reply.send({
        success: true,
        data: assignment
      });

    } catch (error: any) {
      fastify.log.error('Error in GET /api/v1/student/assignments/:id:', error);
      
      // Log detailed error information
      console.error('❌ [ASSIGNMENT DETAIL ERROR]');
      console.error('   Message:', error?.message);
      console.error('   Stack:', error?.stack);
      console.error('   Params:', { instanceId, tenantId, userIdHeader });
      
      // Check for specific error types
      if (error?.code === '23502') { // PostgreSQL NOT NULL violation
        return reply.status(400).send({
          success: false,
          error: 'Données manquantes dans la requête'
        });
      }
      
      if (error?.code === '22P02') { // PostgreSQL invalid UUID
        return reply.status(400).send({
          success: false,
          error: 'ID de devoir invalide'
        });
      }
      
      if (error?.code === '23503') { // PostgreSQL foreign key violation
        return reply.status(404).send({
          success: false,
          error: 'Référence invalide dans les données'
        });
      }
      
      // Generic 500 error for unexpected issues
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du devoir',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      });
    }
  });
}
