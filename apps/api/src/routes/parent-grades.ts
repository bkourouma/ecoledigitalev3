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

// Verify parent-child relationship utility
async function verifyParentChildRelationshipForGrades(
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

export async function parentGradesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/grades/assignments - List all graded assignments for children linked to the authenticated parent
  fastify.get('/assignments', {
    schema: {
      tags: ['Parent Grades'],
      summary: 'List all graded assignments for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          courseId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
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
                      submittedAt: { type: 'string', nullable: true },
                      gradedAt: { type: 'string', nullable: true },
                      dueDate: { type: 'string', nullable: true },
                    },
                  },
                },
                pagination: {
                  type: 'object',
                  properties: {
                    page: { type: 'number' },
                    limit: { type: 'number' },
                    total: { type: 'number' },
                    totalPages: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
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
      const { childId, courseId, startDate, endDate, page = 1, limit = 20 } = request.query as {
        childId?: string;
        courseId?: string;
        startDate?: string;
        endDate?: string;
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

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForGrades(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          '(s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`s.student_id = $${paramIndex}`);
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
          whereConditions.push(`s.graded_at >= $${paramIndex}::date`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`s.graded_at <= $${paramIndex}::date`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Count total for pagination
        const countQuery = `
          SELECT COUNT(DISTINCT s.id) as total
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id AND se.status = 'active'
          LEFT JOIN classes cl ON se.class_id = cl.id
          LEFT JOIN assignment_instances ai ON a.id = ai.assignment_id AND cl.id = ai.class_id AND ai.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query graded assignments
        const gradesQuery = `
          SELECT DISTINCT
            s.id as submission_id,
            s.assignment_id,
            a.title as assignment_name,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            COALESCE(s.final_score, s.manual_score) as grade,
            20 as max_points,
            s.submitted_at,
            s.graded_at,
            s.feedback,
            ai.ends_at as due_date
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id AND se.status = 'active'
          LEFT JOIN classes cl ON se.class_id = cl.id
          LEFT JOIN assignment_instances ai ON a.id = ai.assignment_id AND cl.id = ai.class_id AND ai.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY s.graded_at DESC NULLS LAST, s.submitted_at DESC NULLS LAST
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);
        const gradesResult = await pool.query(gradesQuery, queryParams);

        // Process grades to calculate percentage
        const grades = gradesResult.rows.map((row: any) => {
          const grade = parseFloat(row.grade);
          const maxPoints = parseFloat(row.max_points);
          const percentage = maxPoints > 0 ? (grade / maxPoints) * 100 : 0;

          return {
            id: row.submission_id,
            assignmentId: row.assignment_id,
            assignmentName: row.assignment_name,
            courseId: row.course_id,
            courseName: row.course_name,
            courseCode: row.course_code || null,
            childId: row.child_id,
            childName: row.child_name,
            grade,
            maxPoints,
            percentage: Math.round(percentage * 100) / 100, // Round to 2 decimal places
            feedback: row.feedback || null,
            submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
            gradedAt: row.graded_at ? row.graded_at.toISOString() : null,
            dueDate: row.due_date ? (typeof row.due_date === 'string' ? row.due_date : row.due_date.toISOString().split('T')[0]) : null,
          };
        });

        return reply.send({
          success: true,
          data: {
            grades,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        fastify.log.error({
          msg: 'Error fetching assignment grades',
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId, courseId, startDate, endDate, page, limit },
        }, 'Failed to fetch assignment grades');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching assignment grades',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/grades/by-course - Get grades organized by course
  fastify.get('/by-course', {
    schema: {
      description: 'Get grades organized by course for children linked to the authenticated parent',
      tags: ['parent-grades'],
      querystring: {
        type: 'object',
        properties: {
          childId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by specific child (optional)',
          },
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
                courses: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      courseId: { type: 'string', format: 'uuid' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      assignmentGrades: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            assignmentId: { type: 'string', format: 'uuid' },
                            assignmentName: { type: 'string' },
                            grade: { type: 'number' },
                            maxPoints: { type: 'number' },
                            percentage: { type: 'number' },
                            gradedAt: { type: 'string', nullable: true },
                          },
                        },
                      },
                      courseAverage: { type: 'number' },
                      totalGraded: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = request.user?.id;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'Tenant context is required',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User authentication is required',
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

      // Extract childId from query before try block so it's available in catch
      const { childId } = request.query as { childId?: string };

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForGrades(
            pool,
            userId,
            childId,
            tenantId
          );
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          '(s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`s.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Query grades grouped by course
        const gradesQuery = `
          SELECT DISTINCT
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            s.id as submission_id,
            s.assignment_id,
            a.title as assignment_name,
            COALESCE(s.final_score, s.manual_score) as grade,
            20 as max_points,
            s.graded_at
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id AND se.status = 'active'
          LEFT JOIN classes cl ON se.class_id = cl.id
          LEFT JOIN assignment_instances ai ON a.id = ai.assignment_id AND cl.id = ai.class_id AND ai.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY c.name, s.graded_at DESC NULLS LAST
        `;

        const gradesResult = await pool.query(gradesQuery, queryParams);

        // Group grades by course
        const coursesMap = new Map<string, any>();

        gradesResult.rows.forEach((row: any) => {
          const courseId = row.course_id;
          const childId = row.child_id;

          // Create unique key for course-child combination
          const key = `${courseId}-${childId}`;

          if (!coursesMap.has(key)) {
            coursesMap.set(key, {
              courseId: row.course_id,
              courseName: row.course_name,
              courseCode: row.course_code,
              childId: row.child_id,
              childName: row.child_name,
              assignmentGrades: [],
              courseAverage: 0,
              totalGraded: 0,
            });
          }

          const course = coursesMap.get(key)!;
          const grade = parseFloat(row.grade) || 0;
          const maxPoints = parseFloat(row.max_points) || 20; // Notes sur 20 par défaut
          const percentage = maxPoints > 0 ? (grade / maxPoints) * 100 : 0;

          course.assignmentGrades.push({
            id: row.submission_id,
            assignmentId: row.assignment_id,
            assignmentName: row.assignment_name,
            grade: grade,
            maxPoints: maxPoints,
            percentage: Math.round(percentage * 100) / 100,
            gradedAt: row.graded_at ? (typeof row.graded_at === 'string' ? row.graded_at : row.graded_at.toISOString()) : null,
          });
        });

        // Calculate course averages and totals
        const courses = Array.from(coursesMap.values()).map((course) => {
          const grades = course.assignmentGrades.map((ag: any) => ag.grade);
          const totalGraded = grades.length;
          const courseAverage = totalGraded > 0
            ? grades.reduce((sum: number, grade: number) => sum + grade, 0) / totalGraded
            : 0;

          return {
            ...course,
            courseAverage: Math.round(courseAverage * 100) / 100,
            totalGraded: totalGraded,
          };
        });

        return reply.send({
          success: true,
          data: {
            courses: courses,
          },
        });
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        const errorStack = error.stack;
        
        fastify.log.error({
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId: childId },
        }, 'Failed to fetch grades by course');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching grades by course',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/grades/averages - Get overall grade averages and statistics
  fastify.get('/averages', {
    schema: {
      description: 'Get overall grade averages and statistics for children linked to the authenticated parent',
      tags: ['parent-grades'],
      querystring: {
        type: 'object',
        properties: {
          childId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by specific child (optional)',
          },
          startDate: {
            type: 'string',
            format: 'date',
            description: 'Filter by date range start (optional)',
          },
          endDate: {
            type: 'string',
            format: 'date',
            description: 'Filter by date range end (optional)',
          },
          semester: {
            type: 'string',
            description: 'Filter by semester (e.g., "2024-2025-1") (optional)',
          },
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
                statistics: {
                  type: 'object',
                  properties: {
                    overallAverage: { type: 'number' },
                    totalGraded: { type: 'number' },
                    gradeDistribution: {
                      type: 'object',
                      properties: {
                        excellent: { type: 'number' },
                        good: { type: 'number' },
                        average: { type: 'number' },
                        belowAverage: { type: 'number' },
                      },
                    },
                    bestScore: { type: 'number' },
                    worstScore: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = request.user?.id;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'Tenant context is required',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User authentication is required',
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

      // Extract query parameters before try block so they're available in catch
      const { childId, startDate, endDate, semester } = request.query as {
        childId?: string;
        startDate?: string;
        endDate?: string;
        semester?: string;
      };

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForGrades(
            pool,
            userId,
            childId,
            tenantId
          );
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          '(s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`s.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`s.graded_at >= $${paramIndex}::date`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`s.graded_at <= $${paramIndex}::date`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Note: Semester filtering would require joining with academic_years or similar table
        // For now, we'll skip semester filtering as it's not in the base schema

        // Query all graded assignments
        const gradesQuery = `
          SELECT DISTINCT
            COALESCE(s.final_score, s.manual_score) as grade
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id AND se.status = 'active'
          LEFT JOIN classes cl ON se.class_id = cl.id
          LEFT JOIN assignment_instances ai ON a.id = ai.assignment_id AND cl.id = ai.class_id AND ai.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const gradesResult = await pool.query(gradesQuery, queryParams);

        // Calculate statistics
        const grades = gradesResult.rows.map((row: any) => parseFloat(row.grade) || 0);
        const totalGraded = grades.length;

        if (totalGraded === 0) {
          return reply.send({
            success: true,
            data: {
              statistics: {
                overallAverage: 0,
                totalGraded: 0,
                gradeDistribution: {
                  excellent: 0,
                  good: 0,
                  average: 0,
                  belowAverage: 0,
                },
                bestScore: 0,
                worstScore: 0,
              },
            },
          });
        }

        // Calculate overall average
        const overallAverage = grades.reduce((sum: number, grade: number) => sum + grade, 0) / totalGraded;

        // Calculate grade distribution
        // Excellent: >= 16
        // Good: 14-15
        // Average: 12-13
        // Below Average: < 12
        const gradeDistribution = {
          excellent: grades.filter((g: number) => g >= 16).length,
          good: grades.filter((g: number) => g >= 14 && g < 16).length,
          average: grades.filter((g: number) => g >= 12 && g < 14).length,
          belowAverage: grades.filter((g: number) => g < 12).length,
        };

        // Calculate best and worst scores
        const bestScore = Math.max(...grades);
        const worstScore = Math.min(...grades);

        return reply.send({
          success: true,
          data: {
            statistics: {
              overallAverage: Math.round(overallAverage * 100) / 100,
              totalGraded: totalGraded,
              gradeDistribution: gradeDistribution,
              bestScore: Math.round(bestScore * 100) / 100,
              worstScore: Math.round(worstScore * 100) / 100,
            },
          },
        });
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        const errorStack = error.stack;
        
        fastify.log.error({
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId: childId, startDate, endDate, semester },
        }, 'Failed to fetch overall averages');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching overall averages',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });

  // GET /api/v1/parent/grades/trends - Get grade trends data for chart visualization
  fastify.get('/trends', {
    schema: {
      description: 'Get grade trends data for chart visualization for children linked to the authenticated parent',
      tags: ['parent-grades'],
      querystring: {
        type: 'object',
        properties: {
          childId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by specific child (optional)',
          },
          courseId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by specific course (optional)',
          },
          startDate: {
            type: 'string',
            format: 'date',
            description: 'Filter by date range start (optional, default: current academic year start)',
          },
          endDate: {
            type: 'string',
            format: 'date',
            description: 'Filter by date range end (optional, default: current date)',
          },
          semester: {
            type: 'string',
            description: 'Filter by semester (e.g., "2024-2025-1") (optional)',
          },
          period: {
            type: 'string',
            enum: ['week', 'month', 'semester'],
            description: 'Time period grouping: "week", "month", "semester" (default: "month")',
          },
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
                trends: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      periodStart: { type: 'string' },
                      periodEnd: { type: 'string' },
                      periodLabel: { type: 'string' },
                      averageGrade: { type: 'number' },
                      gradeCount: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = request.user?.id;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'Tenant context is required',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User authentication is required',
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

      // Extract query parameters before try block so they're available in catch
      const { childId, courseId, startDate, endDate, semester, period = 'month' } = request.query as {
        childId?: string;
        courseId?: string;
        startDate?: string;
        endDate?: string;
        semester?: string;
        period?: 'week' | 'month' | 'semester';
      };

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForGrades(
            pool,
            userId,
            childId,
            tenantId
          );
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
        }

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
          '($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)',
          '(s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)',
          's.graded_at IS NOT NULL',
        ];
        const queryParams: any[] = [userId, tenantId, activeAcademicYearId || null];
        let paramIndex = 4;

        // Filter by child
        if (childId) {
          whereConditions.push(`s.student_id = $${paramIndex}`);
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
          whereConditions.push(`s.graded_at >= $${paramIndex}::date`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`s.graded_at <= $${paramIndex}::date`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Note: Semester filtering would require joining with academic_years or similar table
        // For now, we'll skip semester filtering as it's not in the base schema

        // Determine DATE_TRUNC interval based on period
        let dateTruncInterval: string;
        switch (period) {
          case 'week':
            dateTruncInterval = 'week';
            break;
          case 'month':
            dateTruncInterval = 'month';
            break;
          case 'semester':
            // For semester, we'll use month grouping and then group by semester in application logic
            dateTruncInterval = 'month';
            break;
          default:
            dateTruncInterval = 'month';
        }

        // Add date trunc interval to params
        queryParams.push(dateTruncInterval);
        const dateTruncParamIndex = paramIndex;
        paramIndex++;

        // Query grade trends grouped by time period
        const trendsQuery = `
          SELECT DISTINCT
            DATE_TRUNC($${dateTruncParamIndex}, s.graded_at) as period_start,
            COUNT(DISTINCT s.id) as grade_count,
            AVG(COALESCE(s.final_score, s.manual_score)) as average_grade
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles sp ON s.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          LEFT JOIN student_enrollments se ON sp.id = se.student_id AND se.tenant_id = s.tenant_id AND se.status = 'active'
          LEFT JOIN classes cl ON se.class_id = cl.id
          LEFT JOIN assignment_instances ai ON a.id = ai.assignment_id AND cl.id = ai.class_id AND ai.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(' AND ')}
          GROUP BY DATE_TRUNC($${dateTruncParamIndex}, s.graded_at)
          ORDER BY period_start ASC
        `;

        const trendsResult = await pool.query(trendsQuery, queryParams);

        // Format trends data
        const trends = trendsResult.rows.map((row: any) => {
          const periodStart = row.period_start;
          const periodStartDate = periodStart instanceof Date ? periodStart : new Date(periodStart);
          
          // Calculate period end based on period type
          let periodEndDate: Date;
          let periodLabel: string;
          
          switch (period) {
            case 'week':
              periodEndDate = new Date(periodStartDate);
              periodEndDate.setDate(periodEndDate.getDate() + 6);
              periodEndDate.setHours(23, 59, 59, 999);
              periodLabel = `Semaine ${periodStartDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
              break;
            case 'month':
              periodEndDate = new Date(periodStartDate.getFullYear(), periodStartDate.getMonth() + 1, 0);
              periodEndDate.setHours(23, 59, 59, 999);
              periodLabel = periodStartDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
              break;
            case 'semester':
              // For semester, group months into semesters
              const month = periodStartDate.getMonth();
              const semester = month < 6 ? 1 : 2;
              const year = periodStartDate.getFullYear();
              periodEndDate = new Date(year, semester === 1 ? 5 : 11, 31);
              periodEndDate.setHours(23, 59, 59, 999);
              periodLabel = `Semestre ${semester} ${year}`;
              break;
            default:
              periodEndDate = new Date(periodStartDate);
              periodEndDate.setDate(periodEndDate.getDate() + 30);
              periodLabel = periodStartDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
          }

          const averageGrade = parseFloat(row.average_grade) || 0;
          const gradeCount = parseInt(row.grade_count, 10) || 0;

          return {
            periodStart: periodStartDate.toISOString(),
            periodEnd: periodEndDate.toISOString(),
            periodLabel: periodLabel,
            averageGrade: Math.round(averageGrade * 100) / 100,
            gradeCount: gradeCount,
          };
        });

        return reply.send({
          success: true,
          data: {
            trends: trends,
          },
        });
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        const errorStack = error.stack;
        
        fastify.log.error({
          error: errorMessage,
          stack: errorStack,
          userId,
          tenantId,
          filters: { childId: childId, courseId, startDate, endDate, semester, period },
        }, 'Failed to fetch grade trends');
        
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: isDevelopment ? errorMessage : 'An error occurred while fetching grade trends',
          ...(isDevelopment && { stack: errorStack }),
        });
      }
    },
  });
}

