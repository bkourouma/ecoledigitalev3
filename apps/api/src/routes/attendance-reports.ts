import { FastifyInstance } from "fastify";
import { z } from "zod";

// Schema for creating attendance report (base schema without refine)
const AttendanceReportBaseSchema = z.object({
  studentId: z.string().uuid("L'ID de l'étudiant doit être un UUID valide"),
  academicYearId: z.string().uuid("L'ID de l'année académique doit être un UUID valide"),
  reportPeriod: z.string().optional(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  attendanceRate: z.number().min(0).max(100, "Le taux de présence doit être entre 0 et 100"),
  totalDays: z.number().int().min(0, "Le nombre total de jours doit être positif ou nul"),
  presentDays: z.number().int().min(0, "Le nombre de jours présents doit être positif ou nul"),
  absentDays: z.number().int().min(0, "Le nombre de jours absents doit être positif ou nul"),
  reportUrl: z.string().optional().or(z.literal('')).refine(
    (val) => !val || val === '' || val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: "L'URL du rapport doit être un chemin relatif (commençant par /) ou une URL complète" }
  ),
  downloadable: z.boolean().optional(),
  viewable: z.boolean().optional(),
});

// Schema for creating attendance report (with validation)
const CreateAttendanceReportSchema = AttendanceReportBaseSchema.refine(
  (data) => data.presentDays + data.absentDays <= data.totalDays,
  {
    message: "La somme des jours présents et absents ne peut pas dépasser le nombre total de jours",
    path: ["presentDays", "absentDays"],
  }
);

// Schema for updating attendance report (partial with validation)
const UpdateAttendanceReportSchema = AttendanceReportBaseSchema.partial().refine(
  (data) => {
    // Only validate if all three fields are present
    if (data.presentDays !== undefined && data.absentDays !== undefined && data.totalDays !== undefined) {
      return data.presentDays + data.absentDays <= data.totalDays;
    }
    return true;
  },
  {
    message: "La somme des jours présents et absents ne peut pas dépasser le nombre total de jours",
    path: ["presentDays", "absentDays"],
  }
);

export async function attendanceReportsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/attendance-reports - List attendance reports
  fastify.get("/", {
    schema: {
      tags: ['Attendance Reports'],
      summary: 'List attendance reports',
      querystring: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
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
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  studentId: { type: 'string' },
                  studentName: { type: 'string' },
                  academicYearId: { type: 'string' },
                  academicYearName: { type: 'string' },
                  reportPeriod: { type: 'string', nullable: true },
                  reportDate: { type: 'string' },
                  attendanceRate: { type: 'number' },
                  totalDays: { type: 'number' },
                  presentDays: { type: 'number' },
                  absentDays: { type: 'number' },
                  reportUrl: { type: 'string', nullable: true },
                  downloadable: { type: 'boolean' },
                  viewable: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
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
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const query = request.query as {
        studentId?: string;
        academicYearId?: string;
        startDate?: string;
        endDate?: string;
        page: number;
        limit: number;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = query.academicYearId || activeAcademicYearId;

      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Build WHERE conditions
        const whereConditions = ['ar.tenant_id = $1'];
        const queryParams: any[] = [request.tenantId];
        let paramIndex = 2;

        if (query.studentId) {
          whereConditions.push(`ar.student_id = $${paramIndex}`);
          queryParams.push(query.studentId);
          paramIndex++;
        }

        if (effectiveAcademicYearId) {
          whereConditions.push(`ar.academic_year_id = $${paramIndex}`);
          queryParams.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (query.startDate) {
          whereConditions.push(`ar.report_date >= $${paramIndex}`);
          queryParams.push(query.startDate);
          paramIndex++;
        }

        if (query.endDate) {
          whereConditions.push(`ar.report_date <= $${paramIndex}`);
          queryParams.push(query.endDate);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM attendance_reports ar
          WHERE ${whereConditions.join(' AND ')}
        `;
        const countResult = await client.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / query.limit);

        // Get attendance reports
        const reportsQuery = `
          SELECT 
            ar.id,
            ar.student_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            ar.academic_year_id,
            ay.name as academic_year_name,
            ar.report_period,
            ar.report_date,
            ar.attendance_rate,
            ar.total_days,
            ar.present_days,
            ar.absent_days,
            ar.report_url,
            COALESCE(ar.downloadable, true) as downloadable,
            COALESCE(ar.viewable, true) as viewable,
            ar.created_at,
            ar.updated_at
          FROM attendance_reports ar
          JOIN student_profiles sp ON ar.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN academic_years ay ON ar.academic_year_id = ay.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ar.report_date DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(query.limit, offset);
        const reportsResult = await client.query(reportsQuery, queryParams);

        const reports = reportsResult.rows.map((row: any) => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          academicYearId: row.academic_year_id,
          academicYearName: row.academic_year_name,
          reportPeriod: row.report_period || null,
          reportDate: row.report_date ? row.report_date.toISOString().split('T')[0] : null,
          attendanceRate: parseFloat(row.attendance_rate) || 0,
          totalDays: parseInt(row.total_days) || 0,
          presentDays: parseInt(row.present_days) || 0,
          absentDays: parseInt(row.absent_days) || 0,
          reportUrl: row.report_url || null,
          downloadable: row.downloadable !== false,
          viewable: row.viewable !== false,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        }));

        return reply.send({
          success: true,
          data: reports,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while fetching attendance reports',
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // POST /api/v1/attendance-reports - Create attendance report
  fastify.post("/", {
    schema: {
      tags: ['Attendance Reports'],
      summary: 'Create attendance report',
      body: {
        type: 'object',
        required: ['studentId', 'academicYearId', 'reportDate', 'attendanceRate', 'totalDays', 'presentDays', 'absentDays'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          reportPeriod: { type: 'string' },
          reportDate: { type: 'string', format: 'date' },
          attendanceRate: { type: 'number', minimum: 0, maximum: 100 },
          totalDays: { type: 'number', minimum: 0 },
          presentDays: { type: 'number', minimum: 0 },
          absentDays: { type: 'number', minimum: 0 },
          reportUrl: { type: 'string' },
          downloadable: { type: 'boolean' },
          viewable: { type: 'boolean' },
        },
      },
      response: { 201: { type: 'object' } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      // Validate with Zod schema
      let body;
      try {
        body = CreateAttendanceReportSchema.parse(request.body);
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          fastify.log.error('Validation error:', validationError.errors);
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: validationError.errors.map(e => e.message).join(', '),
            details: validationError.errors,
          });
        }
        throw validationError;
      }

      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        const insertQuery = `
          INSERT INTO attendance_reports (
            tenant_id, student_id, academic_year_id, report_period, report_date, 
            attendance_rate, total_days, present_days, absent_days, report_url, downloadable, viewable
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id, student_id, academic_year_id, report_period, report_date, 
            attendance_rate, total_days, present_days, absent_days, report_url, downloadable, viewable, created_at, updated_at
        `;

        const result = await client.query(insertQuery, [
          request.tenantId,
          body.studentId,
          body.academicYearId,
          body.reportPeriod || null,
          body.reportDate,
          body.attendanceRate,
          body.totalDays,
          body.presentDays,
          body.absentDays,
          body.reportUrl || null,
          body.downloadable !== false,
          body.viewable !== false,
        ]);

        const row = result.rows[0];

        // Get student and academic year names
        const studentResult = await client.query(
          'SELECT COALESCE(u.first_name || \' \' || u.last_name, u.name) as name FROM student_profiles sp JOIN users u ON sp.user_id = u.id WHERE sp.id = $1',
          [body.studentId]
        );
        const yearResult = await client.query('SELECT name FROM academic_years WHERE id = $1', [body.academicYearId]);

        return reply.status(201).send({
          success: true,
          data: {
            id: row.id,
            studentId: row.student_id,
            studentName: studentResult.rows[0]?.name || '',
            academicYearId: row.academic_year_id,
            academicYearName: yearResult.rows[0]?.name || '',
            reportPeriod: row.report_period || null,
            reportDate: row.report_date ? row.report_date.toISOString().split('T')[0] : null,
            attendanceRate: parseFloat(row.attendance_rate) || 0,
            totalDays: parseInt(row.total_days) || 0,
            presentDays: parseInt(row.present_days) || 0,
            absentDays: parseInt(row.absent_days) || 0,
            reportUrl: row.report_url || null,
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error creating attendance report:', {
          error: error.message,
          stack: error.stack,
          code: error.code,
          body: request.body,
        });
        
        // Handle foreign key constraint violations
        if (error.code === '23503') {
          return reply.status(400).send({
            success: false,
            error: 'Invalid Reference',
            message: 'L\'étudiant ou l\'année académique spécifié n\'existe pas.',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while creating attendance report',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // PUT /api/v1/attendance-reports/:id - Update attendance report
  fastify.put("/:id", {
    schema: {
      tags: ['Attendance Reports'],
      summary: 'Update attendance report',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          academicYearId: { type: 'string', format: 'uuid' },
          reportPeriod: { type: 'string' },
          reportDate: { type: 'string', format: 'date' },
          attendanceRate: { type: 'number', minimum: 0, maximum: 100 },
          totalDays: { type: 'number', minimum: 0 },
          presentDays: { type: 'number', minimum: 0 },
          absentDays: { type: 'number', minimum: 0 },
          reportUrl: { type: 'string' },
          downloadable: { type: 'boolean' },
          viewable: { type: 'boolean' },
        },
      },
      response: { 200: { type: 'object' } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      // Validate with Zod schema
      let body;
      try {
        body = UpdateAttendanceReportSchema.parse(request.body);
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          fastify.log.error('Validation error:', validationError.errors);
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: validationError.errors.map(e => e.message).join(', '),
            details: validationError.errors,
          });
        }
        throw validationError;
      }
      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (body.studentId !== undefined) {
          updateFields.push(`student_id = $${paramIndex}`);
          updateValues.push(body.studentId);
          paramIndex++;
        }
        if (body.academicYearId !== undefined) {
          updateFields.push(`academic_year_id = $${paramIndex}`);
          updateValues.push(body.academicYearId);
          paramIndex++;
        }
        if (body.reportPeriod !== undefined) {
          updateFields.push(`report_period = $${paramIndex}`);
          updateValues.push(body.reportPeriod || null);
          paramIndex++;
        }
        if (body.reportDate !== undefined) {
          updateFields.push(`report_date = $${paramIndex}`);
          updateValues.push(body.reportDate);
          paramIndex++;
        }
        if (body.attendanceRate !== undefined) {
          updateFields.push(`attendance_rate = $${paramIndex}`);
          updateValues.push(body.attendanceRate);
          paramIndex++;
        }
        if (body.totalDays !== undefined) {
          updateFields.push(`total_days = $${paramIndex}`);
          updateValues.push(body.totalDays);
          paramIndex++;
        }
        if (body.presentDays !== undefined) {
          updateFields.push(`present_days = $${paramIndex}`);
          updateValues.push(body.presentDays);
          paramIndex++;
        }
        if (body.absentDays !== undefined) {
          updateFields.push(`absent_days = $${paramIndex}`);
          updateValues.push(body.absentDays);
          paramIndex++;
        }
        if (body.reportUrl !== undefined) {
          updateFields.push(`report_url = $${paramIndex}`);
          updateValues.push(body.reportUrl || null);
          paramIndex++;
        }
        if (body.downloadable !== undefined) {
          updateFields.push(`downloadable = $${paramIndex}`);
          updateValues.push(body.downloadable);
          paramIndex++;
        }
        if (body.viewable !== undefined) {
          updateFields.push(`viewable = $${paramIndex}`);
          updateValues.push(body.viewable);
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'No fields to update',
          });
        }

        updateFields.push(`updated_at = NOW()`);
        updateValues.push(request.tenantId, id);

        const updateQuery = `
          UPDATE attendance_reports
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex - 1}
          RETURNING id, student_id, academic_year_id, report_period, report_date, 
            attendance_rate, total_days, present_days, absent_days, report_url, downloadable, viewable, created_at, updated_at
        `;

        const result = await client.query(updateQuery, updateValues);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Attendance report not found',
          });
        }

        const row = result.rows[0];

        // Get student and academic year names
        const studentResult = await client.query(
          'SELECT COALESCE(u.first_name || \' \' || u.last_name, u.name) as name FROM student_profiles sp JOIN users u ON sp.user_id = u.id WHERE sp.id = $1',
          [row.student_id]
        );
        const yearResult = await client.query('SELECT name FROM academic_years WHERE id = $1', [row.academic_year_id]);

        return reply.send({
          success: true,
          data: {
            id: row.id,
            studentId: row.student_id,
            studentName: studentResult.rows[0]?.name || '',
            academicYearId: row.academic_year_id,
            academicYearName: yearResult.rows[0]?.name || '',
            reportPeriod: row.report_period || null,
            reportDate: row.report_date ? row.report_date.toISOString().split('T')[0] : null,
            attendanceRate: parseFloat(row.attendance_rate) || 0,
            totalDays: parseInt(row.total_days) || 0,
            presentDays: parseInt(row.present_days) || 0,
            absentDays: parseInt(row.absent_days) || 0,
            reportUrl: row.report_url || null,
            downloadable: row.downloadable !== false,
            viewable: row.viewable !== false,
            createdAt: row.created_at ? row.created_at.toISOString() : null,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error updating attendance report:', {
          error: error.message,
          stack: error.stack,
          code: error.code,
          body: request.body,
        });
        
        // Handle foreign key constraint violations
        if (error.code === '23503') {
          return reply.status(400).send({
            success: false,
            error: 'Invalid Reference',
            message: 'L\'étudiant ou l\'année académique spécifié n\'existe pas.',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while updating attendance report',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });

  // DELETE /api/v1/attendance-reports/:id - Delete attendance report
  fastify.delete("/:id", {
    schema: {
      tags: ['Attendance Reports'],
      summary: 'Delete attendance report',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: { type: 'object' } },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();

      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

        const deleteQuery = `
          DELETE FROM attendance_reports
          WHERE id = $1 AND tenant_id = $2
          RETURNING id
        `;

        const result = await client.query(deleteQuery, [id, request.tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Attendance report not found',
          });
        }

        return reply.send({
          success: true,
          message: 'Attendance report deleted successfully',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: error.message || 'An error occurred while deleting attendance report',
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    },
  });
}

