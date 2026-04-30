import { FastifyInstance } from "fastify";
import { z } from "zod";

const StudentGradesQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  course_id: z.string().uuid().optional(),
  assignment_type: z.enum(['quiz', 'exam', 'project', 'homework', 'lab', 'all']).default('all'),
  semester: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0)
});

const StudentGradeSchema = z.object({
  id: z.string().uuid(),
  course: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string()
  }),
  assignment: z.object({
    id: z.string().uuid(),
    title: z.string(),
    type: z.string()
  }),
  grade: z.number(),
  max_grade: z.number(),
  coefficient: z.number(),
  date: z.string(),
  instructor: z.object({
    id: z.string().uuid(),
    first_name: z.string(),
    last_name: z.string()
  }),
  feedback: z.string().nullable()
});

const StudentGradesResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(StudentGradeSchema),
  statistics: z.object({
    average: z.number(),
    total_points: z.number(),
    max_total_points: z.number(),
    grade_distribution: z.object({
      excellent: z.number(), // >= 16
      good: z.number(),      // 14-15
      average: z.number(),   // 12-13
      below_average: z.number() // < 12
    })
  }),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    has_more: z.boolean()
  })
});

export async function studentGradesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/student/grades - Liste des notes de l'étudiant
  fastify.get("/", {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          course_id: { type: 'string' },
          assignment_type: { type: 'string' },
          semester: { type: 'string' },
          limit: { type: 'number', default: 20 },
          offset: { type: 'number', default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const { student_id, course_id, assignment_type, semester, limit, offset } = request.query as z.infer<typeof StudentGradesQuerySchema>;
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
      return reply.status(401).send({
        success: false,
        error: 'Authentification requise'
      });
    }

    try {
      // Set tenant context for RLS
      await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

      // Get student ID from user ID
      const studentQuery = await fastify.pg.query(
        'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
        [userIdHeader, tenantId]
      );

      if (studentQuery.rows.length === 0) {
        return reply.status(403).send({
          success: false,
          error: 'Profil étudiant non trouvé'
        });
      }

      const studentId = studentQuery.rows[0].id;

      // Build query conditions
      let whereConditions = ['s.student_id = $1', 's.tenant_id = $2', 's.status = $3'];
      let queryParams = [studentId, tenantId, 'graded'];
      let paramIndex = 4;

      if (course_id) {
        whereConditions.push(`c.id = $${paramIndex}`);
        queryParams.push(course_id);
        paramIndex++;
      }

      if (assignment_type && assignment_type !== 'all') {
        whereConditions.push(`a.type = $${paramIndex}`);
        queryParams.push(assignment_type);
        paramIndex++;
      }

      if (activeAcademicYearId) {
        whereConditions.push(`
          EXISTS (
            SELECT 1
            FROM assignment_instances ai
            JOIN classes cl ON cl.id = ai.class_id
            JOIN student_enrollments se ON se.class_id = ai.class_id
            WHERE ai.assignment_id = a.id
              AND ai.tenant_id = s.tenant_id
              AND se.student_id = s.student_id
              AND se.tenant_id = s.tenant_id
              AND se.status = 'active'
              AND cl.academic_year_id = $${paramIndex}
          )
        `);
        queryParams.push(activeAcademicYearId);
        paramIndex++;
      }

      // Query to get graded submissions with assignment and course info
      const limitParamIndex = paramIndex;
      const offsetParamIndex = paramIndex + 1;
      
      const gradesQuery = `
        SELECT
          s.id as submission_id,
          s.manual_score,
          s.final_score,
          s.feedback,
          s.graded_at,
          a.id as assignment_id,
          a.title as assignment_title,
          a.type as assignment_type,
          20 as max_points,
          c.id as course_id,
          c.name as course_name,
          c.code as course_code,
          t.id as teacher_id,
          u.first_name as teacher_first_name,
          u.last_name as teacher_last_name
        FROM assignment_submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN courses c ON a.course_id = c.id
        LEFT JOIN teachers t ON a.teacher_id = t.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY s.graded_at DESC
        LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `;

      queryParams.push(limit, offset);

      const gradesResult = await fastify.pg.query(gradesQuery, queryParams);

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM assignment_submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN courses c ON a.course_id = c.id
        WHERE ${whereConditions.join(' AND ')}
      `;

      const countResult = await fastify.pg.query(countQuery, queryParams.slice(0, -2));
      const total = parseInt(countResult.rows[0].total);

      // Format grades data
      const grades = gradesResult.rows.map((row: any) => ({
        id: row.submission_id,
        course: {
          id: row.course_id,
          name: row.course_name,
          code: row.course_code
        },
        assignment: {
          id: row.assignment_id,
          title: row.assignment_title,
          type: row.assignment_type
        },
        grade: row.final_score || row.manual_score || 0,
        max_grade: row.max_points || 20,
        coefficient: 1, // Default coefficient
        date: row.graded_at,
        instructor: {
          id: row.teacher_id || 'unknown',
          first_name: row.teacher_first_name || 'Enseignant',
          last_name: row.teacher_last_name || 'Principal'
        },
        feedback: row.feedback
      }));

      // Calculate statistics
      const totalPoints = grades.reduce((sum, grade) => sum + (grade.grade * grade.coefficient), 0);
      const maxTotalPoints = grades.reduce((sum, grade) => sum + (grade.max_grade * grade.coefficient), 0);
      const average = grades.length > 0 ? totalPoints / grades.reduce((sum, grade) => sum + grade.coefficient, 0) : 0;

      const gradeDistribution = {
        excellent: grades.filter(g => g.grade >= 16).length,
        very_good: grades.filter(g => g.grade >= 14 && g.grade < 16).length,
        good: grades.filter(g => g.grade >= 12 && g.grade < 14).length,
        fair: grades.filter(g => g.grade >= 10 && g.grade < 12).length,
        passable: grades.filter(g => g.grade >= 8 && g.grade < 10).length,
        insufficient: grades.filter(g => g.grade < 8).length
      };

      return reply.send({
        success: true,
        data: {
          grades,
          stats: {
            total_assignments: grades.length,
            graded_assignments: grades.length,
            average_score: Math.round(average * 100) / 100,
            best_score: grades.length > 0 ? Math.max(...grades.map(g => g.grade)) : 0
          }
        },
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total
        }
      });

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des notes'
      });
    }
  });
}
