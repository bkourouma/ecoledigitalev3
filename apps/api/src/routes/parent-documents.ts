import { FastifyInstance } from "fastify";

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

// Verify parent-child access control utility
// Checks that authenticated user ID matches parent ID through student_parents relationship
// Returns userId and tenantId if authorized, otherwise sends error response and returns null
async function verifyParentChildAccess(
  pool: any,
  request: AuthenticatedRequest,
  reply: any,
  childId?: string
): Promise<{ userId: string; tenantId: string } | null> {
  const tenantId = request.tenantId;
  const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;

  if (!tenantId) {
    reply.status(400).send({
      success: false,
      error: 'Tenant Required',
      message: 'This endpoint requires tenant context',
    });
    return null;
  }

  if (!userId) {
    reply.status(401).send({
      success: false,
      error: 'Authentication Required',
      message: 'User ID is required',
    });
    return null;
  }

  // Check if user has parent role
  const userRoles = request.user?.roles || [];
  if (!userRoles.includes('parent')) {
    reply.status(403).send({
      success: false,
      error: 'Forbidden',
      message: 'This endpoint requires parent role',
    });
    return null;
  }

  // If childId is provided, verify parent-child relationship
  if (childId) {
    const result = await pool.query(
      `SELECT id FROM student_parents 
       WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
      [userId, childId, tenantId]
    );
    
    if (result.rows.length === 0) {
      reply.status(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Child not linked to parent',
      });
      return null;
    }
  }

  return {
    userId,
    tenantId,
  };
}

export async function parentDocumentsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/documents/report-cards - Get report cards for the authenticated parent's children
  fastify.get('/report-cards', {
    schema: {
      tags: ['Parent Documents'],
      summary: 'Get report cards for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          semester: { type: 'number', minimum: 1, maximum: 2 },
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
                reportCards: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      reportCardId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                      semester: { type: 'number' },
                      reportDate: { type: 'string', format: 'date' },
                      overallGrade: { type: 'number' },
                      reportUrl: { type: 'string' },
                      downloadable: { type: 'boolean' },
                      viewable: { type: 'boolean' },
                    },
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
      const { childId, academicYearId, semester } = request.query as {
        childId?: string;
        academicYearId?: string;
        semester?: number;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'sp_rel.tenant_id = $2',
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`se.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Filter by semester
        if (semester !== undefined) {
          if (semester === 1) {
            whereConditions.push(`LOWER(ap.name) LIKE $${paramIndex}`);
            queryParams.push('%semestre 1%');
            paramIndex++;
          } else if (semester === 2) {
            whereConditions.push(`LOWER(ap.name) LIKE $${paramIndex}`);
            queryParams.push('%semestre 2%');
            paramIndex++;
          }
        }

        const whereClause = whereConditions.join(' AND ');

        // Query report cards based on semester averages matrix data.
        // This keeps parent bulletins aligned with /annee-academique/moyennes-semestre.
        const query = `
          SELECT 
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            se.academic_year_id as academic_year_id,
            ay.name as academic_year_name,
            ap.id as period_id,
            ap.name as period_name,
            CASE
              WHEN LOWER(ap.name) LIKE '%semestre 2%' THEN 2
              ELSE 1
            END as semester,
            COALESCE(ap.end_date, ap.start_date, CURRENT_DATE) as report_date,
            AVG(spca.average) as overall_grade,
            se.class_id as class_id
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          JOIN student_enrollments se ON se.student_id = sp.id AND se.status = 'active'
          JOIN academic_year_periods ap ON ap.academic_year_id = se.academic_year_id AND ap.tenant_id = se.tenant_id
          JOIN academic_years ay ON ay.id = se.academic_year_id
          LEFT JOIN student_period_course_averages spca
            ON spca.tenant_id = se.tenant_id
           AND spca.student_id = sp.id
           AND spca.class_id = se.class_id
           AND spca.academic_year_period_id = ap.id
          WHERE ${whereClause}
          GROUP BY
            sp.id,
            u.first_name,
            u.last_name,
            u.name,
            se.academic_year_id,
            ay.name,
            ap.id,
            ap.name,
            ap.end_date,
            ap.start_date,
            se.class_id
          HAVING COUNT(spca.course_id) > 0
          ORDER BY report_date DESC
        `;

        const result = await pool.query(query, queryParams);

        // Transform results to match API contract
        const reportCards = result.rows.map((row: any) => ({
          reportCardId: `${row.child_id}-${row.period_id}`,
          childId: row.child_id,
          childName: row.child_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          semester: parseInt(row.semester, 10) || 1,
          reportDate: row.report_date ? new Date(row.report_date).toISOString().split('T')[0] : null,
          overallGrade: row.overall_grade != null ? parseFloat(row.overall_grade) : 0,
          reportUrl: `/api/v1/parent/documents/report-cards/${row.child_id}/${row.period_id}/pdf?classId=${row.class_id}`,
          downloadable: true,
          viewable: true,
        }));

        return reply.status(200).send({
          success: true,
          data: {
            reportCards,
          },
        });
      } catch (error: any) {
        const errorMessage = error.message || String(error);
        fastify.log.error('Error fetching report cards:', {
          error: errorMessage,
          stack: error.stack,
          code: error.code,
        });

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: errorMessage || 'Failed to fetch report cards',
        });
      }
    },
  });

  // GET /api/v1/parent/documents/report-cards/:childId/:periodId/pdf
  // Generate a report card PDF on-the-fly from semester averages data.
  fastify.get('/report-cards/:childId/:periodId/pdf', {
    schema: {
      tags: ['Parent Documents'],
      summary: 'Generate and view/download a child report card PDF',
      params: {
        type: 'object',
        required: ['childId', 'periodId'],
        properties: {
          childId: { type: 'string', format: 'uuid' },
          periodId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        required: ['classId'],
        properties: {
          classId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const { childId, periodId } = request.params as { childId: string; periodId: string };
      const { classId } = request.query as { classId: string };

      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) return;
      const { tenantId } = auth;

      try {
        // Ensure the requested class/period belongs to this child enrollment.
        const enrollmentCheck = await pool.query(
          `SELECT 1
           FROM student_enrollments se
           JOIN academic_year_periods ap
             ON ap.academic_year_id = se.academic_year_id
            AND ap.tenant_id = se.tenant_id
           WHERE se.student_id = $1
             AND se.class_id = $2
             AND se.tenant_id = $3
             AND se.status = 'active'
             AND ap.id = $4
           LIMIT 1`,
          [childId, classId, tenantId, periodId]
        );

        if (enrollmentCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not enrolled for the selected class/period',
          });
        }

        // Reuse existing semester-averages PDF generator via in-process routing.
        const injected = await fastify.inject({
          method: 'POST',
          url: '/api/v1/semester-averages/report-cards/pdf',
          headers: {
            'content-type': 'application/json',
            'x-tenant': tenantId,
            ...(request.headers?.authorization
              ? { authorization: request.headers.authorization as string }
              : {}),
            ...(request.user?.id ? { 'x-user-id': request.user.id } : {}),
          },
          payload: JSON.stringify({
            classId,
            periodId,
            studentId: childId,
          }),
        });

        if (injected.statusCode >= 400) {
          return reply
            .status(injected.statusCode)
            .type(injected.headers['content-type'] || 'application/json')
            .send(injected.payload);
        }

        if (injected.rawPayload) {
          return reply
            .status(200)
            .type(injected.headers['content-type'] || 'application/pdf')
            .header(
              'Content-Disposition',
              injected.headers['content-disposition'] || 'inline; filename="bulletin.pdf"'
            )
            .send(Buffer.from(injected.rawPayload));
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Empty PDF payload',
        });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error?.message || 'Failed to generate report card PDF',
        });
      }
    },
  });

  // GET /api/v1/parent/documents/transcripts - Get transcripts for the authenticated parent's children
  fastify.get('/transcripts', {
    schema: {
      tags: ['Parent Documents'],
      summary: 'Get transcripts for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
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
                transcripts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      transcriptId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                      transcriptDate: { type: 'string', format: 'date' },
                      totalCredits: { type: 'number' },
                      gpa: { type: 'number' },
                      transcriptUrl: { type: 'string' },
                      downloadable: { type: 'boolean' },
                      viewable: { type: 'boolean' },
                    },
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
      const { childId, academicYearId } = request.query as {
        childId?: string;
        academicYearId?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          't.tenant_id = $2',
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`t.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        const whereClause = whereConditions.join(' AND ');

        // Query transcripts
        // Note: If transcripts table doesn't exist, this will return empty array
        // In production, you may want to generate transcripts from completed courses and grades
        const query = `
          SELECT 
            t.id as transcript_id,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            ay.id as academic_year_id,
            ay.name as academic_year_name,
            t.transcript_date,
            t.total_credits,
            t.gpa,
            COALESCE(t.transcript_url, '') as transcript_url,
            COALESCE(t.downloadable, true) as downloadable,
            COALESCE(t.viewable, true) as viewable
          FROM transcripts t
          JOIN student_profiles sp ON t.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN academic_years ay ON t.academic_year_id = ay.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE ${whereClause}
          ORDER BY t.transcript_date DESC
        `;

        const result = await pool.query(query, queryParams);

        // Transform results to match API contract
        const transcripts = result.rows.map((row: any) => ({
          transcriptId: row.transcript_id,
          childId: row.child_id,
          childName: row.child_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          transcriptDate: row.transcript_date ? new Date(row.transcript_date).toISOString().split('T')[0] : null,
          totalCredits: parseInt(row.total_credits) || 0,
          gpa: parseFloat(row.gpa) || 0,
          transcriptUrl: row.transcript_url || '',
          downloadable: row.downloadable !== false,
          viewable: row.viewable !== false,
        }));

        return reply.status(200).send({
          success: true,
          data: {
            transcripts,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty array instead of error
        const errorMessage = error.message || String(error);
        const errorMessageLower = errorMessage.toLowerCase();
        
        // Check for various forms of "table does not exist" errors (English and French)
        // PostgreSQL error: "la relation « transcripts » n'existe pas"
        if (
          errorMessageLower.includes('does not exist') ||
          errorMessageLower.includes('n\'existe pas') ||
          (errorMessageLower.includes('relation') && errorMessageLower.includes('transcripts'))
        ) {
          fastify.log.info('transcripts table does not exist, returning empty array');
          return reply.status(200).send({
            success: true,
            data: {
              transcripts: [],
            },
          });
        }

        // Log the full error for debugging
        fastify.log.error('Error fetching transcripts:', {
          error: errorMessage,
          stack: error.stack,
          code: error.code,
        });
        
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: errorMessage || 'Failed to fetch transcripts',
        });
      }
    },
  });

  // GET /api/v1/parent/documents/attendance-reports - Get attendance reports for the authenticated parent's children
  fastify.get('/attendance-reports', {
    schema: {
      tags: ['Parent Documents'],
      summary: 'Get attendance reports for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
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
                attendanceReports: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      reportId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                      reportPeriod: { type: 'string' },
                      reportDate: { type: 'string', format: 'date' },
                      attendanceRate: { type: 'number' },
                      totalDays: { type: 'number' },
                      presentDays: { type: 'number' },
                      absentDays: { type: 'number' },
                      reportUrl: { type: 'string' },
                      downloadable: { type: 'boolean' },
                      viewable: { type: 'boolean' },
                    },
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
      const { childId, academicYearId, startDate, endDate } = request.query as {
        childId?: string;
        academicYearId?: string;
        startDate?: string;
        endDate?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'ar.tenant_id = $2',
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`ar.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`ar.report_date >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`ar.report_date <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        const whereClause = whereConditions.join(' AND ');

        // Query attendance reports
        // Note: If attendance_reports table doesn't exist, this will return empty array
        // In production, you may want to generate attendance reports from attendance_records
        const query = `
          SELECT 
            ar.id as report_id,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            ay.id as academic_year_id,
            ay.name as academic_year_name,
            ar.report_period,
            ar.report_date,
            ar.attendance_rate,
            ar.total_days,
            ar.present_days,
            ar.absent_days,
            COALESCE(ar.report_url, '') as report_url,
            COALESCE(ar.downloadable, true) as downloadable,
            COALESCE(ar.viewable, true) as viewable
          FROM attendance_reports ar
          JOIN student_profiles sp ON ar.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN academic_years ay ON ar.academic_year_id = ay.id
          JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
          WHERE ${whereClause}
          ORDER BY ar.report_date DESC
        `;

        const result = await pool.query(query, queryParams);

        // Transform results to match API contract
        const attendanceReports = result.rows.map((row: any) => ({
          reportId: row.report_id,
          childId: row.child_id,
          childName: row.child_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          reportPeriod: row.report_period || '',
          reportDate: row.report_date ? new Date(row.report_date).toISOString().split('T')[0] : null,
          attendanceRate: parseFloat(row.attendance_rate) || 0,
          totalDays: parseInt(row.total_days) || 0,
          presentDays: parseInt(row.present_days) || 0,
          absentDays: parseInt(row.absent_days) || 0,
          reportUrl: row.report_url || '',
          downloadable: row.downloadable !== false,
          viewable: row.viewable !== false,
        }));

        return reply.status(200).send({
          success: true,
          data: {
            attendanceReports,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty array instead of error
        const errorMessage = error.message || String(error);
        const errorMessageLower = errorMessage.toLowerCase();
        
        // Check for various forms of "table does not exist" errors (English and French)
        // PostgreSQL error: "la relation « attendance_reports » n'existe pas"
        if (
          errorMessageLower.includes('does not exist') ||
          errorMessageLower.includes('n\'existe pas') ||
          (errorMessageLower.includes('relation') && errorMessageLower.includes('attendance_reports'))
        ) {
          fastify.log.info('attendance_reports table does not exist, returning empty array');
          return reply.status(200).send({
            success: true,
            data: {
              attendanceReports: [],
            },
          });
        }

        // Log the full error for debugging
        fastify.log.error('Error fetching attendance reports:', {
          error: errorMessage,
          stack: error.stack,
          code: error.code,
        });
        
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: errorMessage || 'Failed to fetch attendance reports',
        });
      }
    },
  });

  // GET /api/v1/parent/documents/payment-receipts - Get payment receipts for the authenticated parent's children
  fastify.get('/payment-receipts', {
    schema: {
      tags: ['Parent Documents'],
      summary: 'Get payment receipts for the authenticated parent\'s children',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
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
                paymentReceipts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      receiptId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      receiptNumber: { type: 'string' },
                      paymentDate: { type: 'string', format: 'date' },
                      amount: { type: 'number' },
                      currency: { type: 'string' },
                      paymentMethod: { type: 'string' },
                      feeType: { type: 'string', enum: ['tuition', 'inscription', 'annexes', 'autres'] },
                      academicYearId: { type: 'string', format: 'uuid' },
                      academicYearName: { type: 'string' },
                      receiptUrl: { type: 'string' },
                      downloadable: { type: 'boolean' },
                      viewable: { type: 'boolean' },
                    },
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
      const { childId, academicYearId, startDate, endDate } = request.query as {
        childId?: string;
        academicYearId?: string;
        startDate?: string;
        endDate?: string;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = academicYearId || activeAcademicYearId;

      // Verify parent access
      const auth = await verifyParentChildAccess(pool, request, reply, childId);
      if (!auth) {
        return; // Error response already sent
      }

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sp_rel.parent_id = $1',
          'pt.tenant_id = $2',
          'sp_rel.tenant_id = $2',
          'se.tenant_id = $2',
          "pt.status = 'completed'",
        ];
        const queryParams: any[] = [parentId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`sp.id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by academic year
        if (effectiveAcademicYearId) {
          whereConditions.push(`se.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`pt.processed_at::DATE >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`pt.processed_at::DATE <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        const whereClause = whereConditions.join(' AND ');

        // Query completed payments for linked children, including receipt metadata when available.
        // Some payment flows create the transaction before the receipt row is generated.
        const query = `
          SELECT 
            COALESCE(pr.id, pt.id) as receipt_id,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            COALESCE(pr.receipt_number, '') as receipt_number,
            pt.processed_at::DATE as payment_date,
            pt.amount,
            pt.currency,
            pt.payment_method,
            pt.fee_type,
            se.academic_year_id,
            ay.name as academic_year_name,
            COALESCE(pr.receipt_url, pt.receipt_url, '') as receipt_url,
            true as downloadable,
            true as viewable
          FROM payment_transactions pt
          LEFT JOIN payment_receipts pr ON pr.transaction_id = pt.id AND pr.tenant_id = pt.tenant_id
          JOIN student_profiles sp ON pt.student_id = sp.id AND sp.tenant_id = pt.tenant_id
          JOIN users u ON sp.user_id = u.id AND u.tenant_id = sp.tenant_id
          JOIN student_enrollments se
            ON pt.enrollment_id = se.id
           AND se.student_id = sp.id
           AND se.tenant_id = pt.tenant_id
          JOIN academic_years ay ON se.academic_year_id = ay.id AND ay.tenant_id = se.tenant_id
          JOIN student_parents sp_rel
            ON sp.id = sp_rel.student_id
           AND sp_rel.tenant_id = sp.tenant_id
          WHERE ${whereClause}
          ORDER BY pt.processed_at DESC
        `;

        const result = await pool.query(query, queryParams);

        // Transform results to match API contract
        const paymentReceipts = result.rows.map((row: any) => {
          // Map 'scolarite' to 'tuition' for API response
          const apiFeeType = row.fee_type === 'scolarite' ? 'tuition' : row.fee_type;
          
          return {
            receiptId: row.receipt_id,
            childId: row.child_id,
            childName: row.child_name,
            receiptNumber: row.receipt_number || '',
            paymentDate: row.payment_date ? new Date(row.payment_date).toISOString().split('T')[0] : null,
            amount: parseFloat(row.amount) || 0,
            currency: row.currency || 'XOF',
            paymentMethod: row.payment_method || '',
            feeType: apiFeeType || 'autres',
            academicYearId: row.academic_year_id,
            academicYearName: row.academic_year_name || '',
            receiptUrl: row.receipt_url || '',
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
          };
        });

        return reply.status(200).send({
          success: true,
          data: {
            paymentReceipts,
          },
        });
      } catch (error: any) {
        // Log the full error for debugging
        const errorMessage = error.message || String(error);
        fastify.log.error('Error fetching payment receipts:', {
          error: errorMessage,
          stack: error.stack,
          code: error.code,
        });
        
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: errorMessage || 'Failed to fetch payment receipts',
        });
      }
    },
  });
}
