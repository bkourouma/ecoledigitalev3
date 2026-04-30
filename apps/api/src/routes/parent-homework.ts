import { FastifyInstance } from "fastify";
import { z } from "zod";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    roles?: string[];
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

// Verify parent-child relationship and child enrollment utility
async function verifyParentChildRelationshipForAssignment(
  pool: any,
  parentId: string,
  childId: string,
  classId: string,
  tenantId: string
): Promise<boolean> {
  // First verify parent-child relationship
  const relationshipResult = await pool.query(
    `SELECT id FROM student_parents 
     WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
    [parentId, childId, tenantId]
  );
  
  if (relationshipResult.rows.length === 0) {
    return false;
  }
  
  // Then verify child is enrolled in the class
  const enrollmentResult = await pool.query(
    `SELECT id FROM student_enrollments 
     WHERE student_id = $1 AND class_id = $2 AND tenant_id = $3 AND status = 'active'`,
    [childId, classId, tenantId]
  );
  
  return enrollmentResult.rows.length > 0;
}

// Verify parent-child relationship utility (for endpoints that don't need class verification)
async function verifyParentChildRelationship(
  pool: any,
  parentId: string,
  childId: string,
  tenantId: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM student_parents 
     WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
    [parentId, childId, tenantId]
  );
  return result.rows.length > 0;
}

export async function parentHomeworkRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/homework/assignments/active - Get active assignments for parent's children
  fastify.get('/assignments/active', {
    schema: {
      tags: ['Parent Homework'],
      summary: 'Get active assignments for all parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                assignments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      assignmentId: { type: 'string', format: 'uuid' },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      dueDate: { type: 'string' },
                      daysRemaining: { type: 'number' },
                      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                      status: { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'expired', 'graded'] },
                      submissionType: { type: 'string', enum: ['evaluation', 'homework'] },
                      maxPoints: { type: 'number' },
                      submittedAt: { type: 'string', nullable: true },
                      grade: { type: 'number', nullable: true },
                      feedback: { type: 'string', nullable: true },
                    },
                  },
                },
                total: { type: 'number' },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, courseId } = request.query as {
        childId?: string;
        courseId?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          'se.status = \'active\'',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          'ai.tenant_id = $2',
          'a.tenant_id = $2',
          'a.status = \'published\'',
          'ai.ends_at > NOW()',
          '(sa.final_score IS NULL AND sa.manual_score IS NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          // Verify parent-child relationship
          const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Query active assignments
        const activeAssignmentsQuery = `
          SELECT DISTINCT
            ai.id as instance_id,
            a.id as assignment_id,
            a.title,
            a.description,
            a.type as submission_type,
            100 as max_points,
            ai.ends_at as due_date,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            COALESCE(sa.submitted_at, NULL) as submitted_at,
            COALESCE(sa.final_score, sa.manual_score, NULL) as grade,
            COALESCE(sa.feedback, NULL) as feedback,
            CASE 
              WHEN (sa.final_score IS NOT NULL OR sa.manual_score IS NOT NULL) THEN 'graded'
              WHEN sa.submitted_at IS NOT NULL THEN 'submitted'
              WHEN ai.ends_at < NOW() THEN 'expired'
              ELSE 'pending'
            END as status
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN classes cl ON ai.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN assignment_submissions sa ON a.id = sa.assignment_id AND sp.id = sa.student_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ai.ends_at ASC
        `;

        const assignmentsResult = await pool.query(activeAssignmentsQuery, queryParams);

        // Process assignments to calculate days remaining and priority
        const now = new Date();
        const assignments = assignmentsResult.rows.map((row: any) => {
          const dueDate = new Date(row.due_date);
          const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          // Calculate priority based on days remaining
          let priority: 'high' | 'medium' | 'low';
          if (daysRemaining <= 3) {
            priority = 'high';
          } else if (daysRemaining <= 7) {
            priority = 'medium';
          } else {
            priority = 'low';
          }

          return {
            id: row.instance_id,
            assignmentId: row.assignment_id,
            title: row.title,
            description: row.description || '',
            courseId: row.course_id,
            courseName: row.course_name,
            courseCode: row.course_code || null,
            childId: row.student_id,
            childName: row.student_name,
            dueDate: row.due_date.toISOString().split('T')[0],
            daysRemaining: Math.max(0, daysRemaining),
            priority,
            status: row.status,
            submissionType: row.submission_type,
            maxPoints: row.max_points,
            submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
            grade: row.grade ? parseFloat(row.grade) : null,
            feedback: row.feedback || null,
          };
        });

        return reply.send({
          success: true,
          data: {
            assignments,
            total: assignments.length,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching active assignments',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId, courseId },
        }, 'Failed to fetch active assignments');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching active assignments',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/homework/assignments/upcoming-deadlines - Get upcoming deadlines for parent's children
  fastify.get('/assignments/upcoming-deadlines', {
    schema: {
      tags: ['Parent Homework'],
      summary: 'Get upcoming assignment deadlines for all parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                deadlines: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      assignmentId: { type: 'string', format: 'uuid' },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      dueDate: { type: 'string' },
                      daysRemaining: { type: 'number' },
                      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                      status: { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'expired', 'graded'] },
                      submissionType: { type: 'string', enum: ['evaluation', 'homework'] },
                      maxPoints: { type: 'number' },
                    },
                  },
                },
                total: { type: 'number' },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId } = request.query as {
        childId?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          'se.status = \'active\'',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          'ai.tenant_id = $2',
          'a.tenant_id = $2',
          'a.status = \'published\'',
          'ai.ends_at > NOW()',
          'ai.ends_at <= NOW() + INTERVAL \'30 days\'',
          '(sa.final_score IS NULL AND sa.manual_score IS NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          // Verify parent-child relationship
          const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Query upcoming deadlines (within next 30 days)
        const upcomingDeadlinesQuery = `
          SELECT DISTINCT
            ai.id as instance_id,
            a.id as assignment_id,
            a.title,
            a.description,
            a.type as submission_type,
            100 as max_points,
            ai.ends_at as due_date,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            COALESCE(sa.submitted_at, NULL) as submitted_at,
            CASE 
              WHEN (sa.final_score IS NOT NULL OR sa.manual_score IS NOT NULL) THEN 'graded'
              WHEN sa.submitted_at IS NOT NULL THEN 'submitted'
              WHEN ai.ends_at < NOW() THEN 'expired'
              ELSE 'pending'
            END as status
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN classes cl ON ai.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN assignment_submissions sa ON a.id = sa.assignment_id AND sp.id = sa.student_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ai.ends_at ASC
        `;

        const deadlinesResult = await pool.query(upcomingDeadlinesQuery, queryParams);

        // Process deadlines to calculate days remaining and priority
        const now = new Date();
        const deadlines = deadlinesResult.rows.map((row: any) => {
          const dueDate = new Date(row.due_date);
          const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          // Calculate priority based on days remaining
          let priority: 'high' | 'medium' | 'low';
          if (daysRemaining <= 3) {
            priority = 'high';
          } else if (daysRemaining <= 7) {
            priority = 'medium';
          } else {
            priority = 'low';
          }

          return {
            id: row.instance_id,
            assignmentId: row.assignment_id,
            title: row.title,
            description: row.description || '',
            courseId: row.course_id,
            courseName: row.course_name,
            courseCode: row.course_code || null,
            childId: row.student_id,
            childName: row.student_name,
            dueDate: row.due_date.toISOString().split('T')[0],
            daysRemaining: Math.max(0, daysRemaining),
            priority,
            status: row.status,
            submissionType: row.submission_type,
            maxPoints: row.max_points,
          };
        });

        return reply.send({
          success: true,
          data: {
            deadlines,
            total: deadlines.length,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching upcoming deadlines',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId },
        }, 'Failed to fetch upcoming deadlines');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching upcoming deadlines',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/homework/assignments/completed - Get completed assignments for parent's children
  fastify.get('/assignments/completed', {
    schema: {
      tags: ['Parent Homework'],
      summary: 'Get completed assignments for all parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                assignments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      assignmentId: { type: 'string', format: 'uuid' },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      dueDate: { type: 'string' },
                      submittedAt: { type: 'string', nullable: true },
                      grade: { type: 'number', nullable: true },
                      maxPoints: { type: 'number' },
                      feedback: { type: 'string', nullable: true },
                      status: { type: 'string', enum: ['submitted', 'expired', 'graded'] },
                      submissionType: { type: 'string', enum: ['evaluation', 'homework'] },
                    },
                  },
                },
                total: { type: 'number' },
                page: { type: 'number' },
                limit: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, courseId, page = 1, limit = 20 } = request.query as {
        childId?: string;
        courseId?: string;
        page?: number;
        limit?: number;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          'se.status = \'active\'',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          'ai.tenant_id = $2',
          'a.tenant_id = $2',
          '(ai.ends_at < NOW() OR sub.submitted_at IS NOT NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          // Verify parent-child relationship
          const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Calculate pagination
        const offset = (page - 1) * limit;

        // Query completed assignments
        const completedAssignmentsQuery = `
          SELECT DISTINCT
            ai.id as instance_id,
            a.id as assignment_id,
            a.title,
            a.description,
            a.type as submission_type,
            COALESCE(sub.max_points, 20) as max_points,
            ai.ends_at as due_date,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            sub.submitted_at,
            COALESCE(sub.final_score, sub.manual_score, NULL) as grade,
            COALESCE(sub.feedback, NULL) as feedback,
            CASE 
              WHEN (sub.final_score IS NOT NULL OR sub.manual_score IS NOT NULL) THEN 'graded'
              WHEN sub.submitted_at IS NOT NULL THEN 'submitted'
              WHEN ai.ends_at < NOW() THEN 'expired'
              ELSE 'pending'
            END as status
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN classes cl ON ai.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sp.id = sub.student_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY COALESCE(sub.submitted_at, ai.ends_at) DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        // Get total count for pagination
        const countQuery = `
          SELECT COUNT(DISTINCT ai.id) as total
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN classes cl ON ai.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sp.id = sub.student_id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const [assignmentsResult, countResult] = await Promise.all([
          pool.query(completedAssignmentsQuery, [...queryParams, limit, offset]),
          pool.query(countQuery, queryParams),
        ]);

        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);

        // Process assignments
        const assignments = assignmentsResult.rows.map((row: any) => ({
          id: row.instance_id,
          assignmentId: row.assignment_id,
          title: row.title,
          description: row.description || '',
          courseId: row.course_id,
          courseName: row.course_name,
          courseCode: row.course_code || null,
          childId: row.student_id,
          childName: row.student_name,
          dueDate: row.due_date.toISOString().split('T')[0],
          submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
          grade: row.grade ? parseFloat(row.grade) : null,
          maxPoints: row.max_points,
          feedback: row.feedback || null,
          status: row.status,
          submissionType: row.submission_type,
        }));

        return reply.send({
          success: true,
          data: {
            assignments,
            total,
            page,
            limit,
            totalPages,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching completed assignments',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId, courseId, page, limit },
        }, 'Failed to fetch completed assignments');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching completed assignments',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/homework/grades - Get grades for parent's children
  fastify.get('/grades', {
    schema: {
      tags: ['Parent Homework'],
      summary: 'Get grades for all parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                grades: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      assignmentId: { type: 'string', format: 'uuid' },
                      assignmentName: { type: 'string' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      grade: { type: 'number' },
                      maxPoints: { type: 'number' },
                      percentage: { type: 'number' },
                      feedback: { type: 'string', nullable: true },
                      submittedAt: { type: 'string' },
                      gradedAt: { type: 'string', nullable: true },
                      dueDate: { type: 'string', nullable: true },
                    },
                  },
                },
                statistics: {
                  type: 'object',
                  properties: {
                    average: { type: 'number' },
                    totalGraded: { type: 'number' },
                    gradeDistribution: { type: 'object' },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, courseId, startDate, endDate } = request.query as {
        childId?: string;
        courseId?: string;
        startDate?: string;
        endDate?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          'sub.tenant_id = $2',
          'a.tenant_id = $2',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          '(sub.final_score IS NOT NULL OR sub.manual_score IS NOT NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          // Verify parent-child relationship
          const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`sub.graded_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }
        if (endDate) {
          whereConditions.push(`sub.graded_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Query grades - Use DISTINCT ON to ensure unique submissions
        const gradesQuery = `
          SELECT DISTINCT ON (sub.id)
            sub.id as submission_id,
            a.id as assignment_id,
            a.title as assignment_name,
            a.type as assignment_type,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            COALESCE(sub.final_score, sub.manual_score) as grade,
            20 as max_points,
            sub.feedback,
            sub.submitted_at,
            sub.graded_at,
            ai.ends_at as due_date
          FROM assignment_submissions sub
          JOIN assignments a ON sub.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON sub.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN assignment_instances ai ON sub.assignment_instance_id = ai.id
          LEFT JOIN classes cl ON ai.class_id = cl.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY sub.id, sub.graded_at DESC NULLS LAST, sub.submitted_at DESC
        `;

        const gradesResult = await pool.query(gradesQuery, queryParams);

        // Process grades and calculate statistics
        // Use a Map to deduplicate by submission_id to ensure uniqueness
        const gradesMap = new Map<string, any>();
        const seenIds = new Set<string>();
        
        gradesResult.rows
          .filter((row: any) => row.grade != null && !isNaN(parseFloat(row.grade)))
          .forEach((row: any) => {
            // Use submission_id as key to ensure uniqueness
            const submissionId = row.submission_id;
            
            // Skip if we've already seen this submission_id
            if (seenIds.has(submissionId)) {
              fastify.log.warn({
                msg: 'Duplicate submission_id found',
                submissionId,
                userId,
                tenantId,
              }, 'Skipping duplicate submission');
              return;
            }
            
            seenIds.add(submissionId);
            
            const grade = parseFloat(row.grade);
            const maxPoints = parseInt(row.max_points, 10) || 20;
            const percentage = maxPoints > 0 ? (grade / maxPoints) * 100 : 0;

            gradesMap.set(submissionId, {
              id: submissionId,
              assignmentId: row.assignment_id,
              assignmentName: row.assignment_name,
              courseId: row.course_id,
              courseName: row.course_name,
              courseCode: row.course_code || null,
              childId: row.student_id,
              childName: row.student_name,
              grade,
              maxPoints,
              percentage: Math.round(percentage * 100) / 100, // Round to 2 decimal places
              feedback: row.feedback || null,
              submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
              gradedAt: row.graded_at ? row.graded_at.toISOString() : null,
              dueDate: row.due_date ? row.due_date.toISOString().split('T')[0] : null,
            });
          });
        
        // Convert Map to array and sort by graded_at
        const grades = Array.from(gradesMap.values()).sort((a, b) => {
          const aDate = a.gradedAt ? new Date(a.gradedAt).getTime() : 0;
          const bDate = b.gradedAt ? new Date(b.gradedAt).getTime() : 0;
          return bDate - aDate; // Descending order
        });

        // Calculate statistics
        const totalGraded = grades.length;
        const average = totalGraded > 0
          ? grades.reduce((sum, g) => sum + g.percentage, 0) / totalGraded
          : 0;

        // Calculate grade distribution (by percentage ranges)
        const distribution: { [key: string]: number } = {
          'A (90-100)': 0,
          'B (80-89)': 0,
          'C (70-79)': 0,
          'D (60-69)': 0,
          'F (0-59)': 0,
        };

        grades.forEach((grade) => {
          if (grade.percentage >= 90) {
            distribution['A (90-100)']++;
          } else if (grade.percentage >= 80) {
            distribution['B (80-89)']++;
          } else if (grade.percentage >= 70) {
            distribution['C (70-79)']++;
          } else if (grade.percentage >= 60) {
            distribution['D (60-69)']++;
          } else {
            distribution['F (0-59)']++;
          }
        });

        return reply.send({
          success: true,
          data: {
            grades,
            statistics: {
              average: Math.round(average * 100) / 100, // Round to 2 decimal places
              totalGraded,
              gradeDistribution: distribution,
            },
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching grades',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId, courseId, startDate, endDate },
        }, 'Failed to fetch grades');
        
        // In development, return more details about the error
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching grades',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // Phase 7: User Story 5 - Access Course Materials
  // GET /api/v1/parent/homework/course-materials - Get course materials for parent's children
  fastify.get('/course-materials', {
    schema: {
      tags: ['Parent Homework'],
      summary: 'Get course materials for all parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                materials: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      title: { type: 'string' },
                      fileName: { type: 'string' },
                      fileType: { type: 'string' },
                      fileSize: { type: 'number' },
                      uploadedAt: { type: 'string' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const userId = request.user?.id;
      const tenantId = request.tenantId;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { childId, courseId } = request.query as { childId?: string; courseId?: string };

      if (!userId || !tenantId) {
        return reply.status(401).send({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Verify parent role
      const userRoles = request.user?.roles || [];
      if (!Array.isArray(userRoles) || !userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'Parent role required',
        });
      }

      try {
        // Build WHERE conditions
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          'se.status = $3',
          '($4::uuid IS NULL OR cl.academic_year_id = $4::uuid)',
        ];
        const queryParams: any[] = [userId, tenantId, 'active', activeAcademicYearId || null];
        let paramIndex = 5;

        // Filter by child if provided
        if (childId) {
          // Verify parent-child relationship
          const relationshipCheck = await pool.query(
            'SELECT id FROM student_parents WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3',
            [userId, childId, tenantId]
          );

          if (relationshipCheck.rows.length === 0) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }

          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by course if provided
        if (courseId) {
          whereConditions.push(`c.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Query course materials for parent's children
        // Join through: course_materials -> courses -> class_courses -> classes -> student_enrollments -> student_profiles -> student_parents
        const materialsQuery = `
          SELECT DISTINCT ON (cm.id)
            cm.id as material_id,
            cm.title,
            cm.file_name,
            cm.file_type,
            cm.file_size,
            cm.created_at as uploaded_at,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name
          FROM course_materials cm
          JOIN courses c ON cm.course_id = c.id
          JOIN class_courses cc ON c.id = cc.course_id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY cm.id, cm.created_at DESC
        `;

        const materialsResult = await pool.query(materialsQuery, queryParams);

        // Format materials
        const materials = materialsResult.rows.map((row: any) => ({
          id: row.material_id,
          courseId: row.course_id,
          courseName: row.course_name,
          courseCode: row.course_code || null,
          title: row.title,
          fileName: row.file_name,
          fileType: row.file_type,
          fileSize: parseInt(row.file_size, 10),
          uploadedAt: row.uploaded_at ? row.uploaded_at.toISOString() : null,
          childId: row.student_id,
          childName: row.student_name,
        }));

        return reply.send({
          success: true,
          data: {
            materials,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching course materials',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId, courseId },
        }, 'Failed to fetch course materials');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching course materials',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/homework/course-materials/:materialId/download - Download course material
  fastify.get('/course-materials/:materialId/download', {
    schema: {
      tags: ['Parent Homework'],
      summary: 'Download course material file',
      params: {
        type: 'object',
        properties: {
          materialId: { type: 'string', format: 'uuid' },
        },
        required: ['materialId'],
      },
      response: {
        200: {
          type: 'string',
          format: 'binary',
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const userId = request.user?.id;
      const tenantId = request.tenantId;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;
      const { materialId } = request.params as { materialId: string };

      if (!userId || !tenantId) {
        return reply.status(401).send({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Verify parent role
      const userRoles = request.user?.roles || [];
      if (!Array.isArray(userRoles) || !userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'Parent role required',
        });
      }

      try {
        // Get material and verify parent-child relationship and child enrollment
        const materialQuery = `
          SELECT DISTINCT ON (cm.id)
            cm.id,
            cm.minio_key,
            cm.file_name,
            cm.file_type,
            cm.file_size,
            sp.id as student_id
          FROM course_materials cm
          JOIN courses c ON cm.course_id = c.id
          JOIN class_courses cc ON c.id = cc.course_id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN student_enrollments se ON cl.id = se.class_id
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE cm.id = $1
            AND cm.tenant_id = $2
            AND sp_rel.parent_id = $3
            AND sp_rel.tenant_id = $2
            AND se.status = 'active'
            AND ($4::uuid IS NULL OR cl.academic_year_id = $4::uuid)
          LIMIT 1
        `;

        const materialResult = await pool.query(materialQuery, [materialId, tenantId, userId, activeAcademicYearId || null]);

        if (materialResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Material not found or access denied',
          });
        }

        const material = materialResult.rows[0];

        // Get file storage service
        const { getFileStorageService } = await import('../services/fileStorage');
        const fileStorageService = getFileStorageService();

        // Get file stream
        try {
          const fileStream = await fileStorageService.getFileStream(material.minio_key);
          
          reply.type(material.file_type);
          reply.header('Content-Disposition', `attachment; filename="${material.file_name}"`);
          reply.header('Content-Length', material.file_size);
          
          return reply.send(fileStream);
        } catch (streamError) {
          fastify.log.error({
            msg: 'Error streaming material file',
            error: streamError instanceof Error ? streamError.message : String(streamError),
            materialId,
            minioKey: material.minio_key,
          }, 'Failed to stream material file');
          
          return reply.status(500).send({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to download material file',
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error downloading course material',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          materialId,
        }, 'Failed to download course material');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while downloading the material',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });
}

