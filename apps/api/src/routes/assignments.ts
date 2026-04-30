import { FastifyInstance } from "fastify";
import {
  AssignmentType,
  AssignmentStatus,
  SubmissionStatus
} from "@ecoledigitale/contracts";
import { getFileStorageService } from "../services/fileStorage";
import { getAIEvaluationService } from "../services/ai-evaluation.service";
import { getTextExtractionService } from "../services/textExtraction";

export async function assignmentsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/assignments - List assignments
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["evaluation", "homework"] },
          // Removed status filter - assignments no longer have status
          course_id: { type: "string", format: "uuid" },
          teacher_id: { type: "string", format: "uuid" },
          search: { type: "string" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const { type, status, course_id, teacher_id, search, page = 1, limit = 20 } = request.query as any;
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Resolve teacher_id from X-User-Id header if provided (security: prevent access to other teachers' data)
        let resolvedTeacherId: string | null = null;
        if (userIdHeader) {
          const teacherRes = await fastify.pg.query(
            `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
            [userIdHeader, tenantId]
          );
          if (teacherRes.rows.length > 0) {
            resolvedTeacherId = teacherRes.rows[0].id;
            fastify.log.info(`[GET /assignments] Resolved teacher_id from X-User-Id ${userIdHeader}: ${resolvedTeacherId}`);
          } else {
            fastify.log.warn(`[GET /assignments] Teacher not found for user_id: ${userIdHeader} in tenant: ${tenantId}`);
          }
        }

        // Use resolved teacher_id if available, otherwise use teacher_id from query (for admin/backward compatibility)
        const effectiveTeacherId = resolvedTeacherId || teacher_id;

        let whereConditions = ['a.tenant_id = $1'];
        let queryParams: any[] = [tenantId];
        let paramIndex = 2;

        if (type) {
          whereConditions.push(`a.type = $${paramIndex}`);
          queryParams.push(type);
          paramIndex++;
        }

        // Removed status filtering - assignments no longer have status

        if (course_id) {
          whereConditions.push(`a.course_id = $${paramIndex}`);
          queryParams.push(course_id);
          paramIndex++;
        }

        if (effectiveTeacherId) {
          // Include assignments created by the teacher OR assignments for courses the teacher teaches
          whereConditions.push(`(
            a.teacher_id = $${paramIndex}
            OR a.course_id IN (
              SELECT DISTINCT cc.course_id
              FROM teacher_assignments ta
              JOIN class_courses cc ON ta.class_course_id = cc.id
              WHERE ta.teacher_id = $${paramIndex} AND ta.tenant_id = a.tenant_id
            )
          )`);
          queryParams.push(effectiveTeacherId);
          paramIndex++;
        }

        if (search) {
          whereConditions.push(`(a.title ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex})`);
          queryParams.push(`%${search}%`);
          paramIndex++;
        }

        const offset = (page - 1) * limit;
        const whereClause = whereConditions.join(' AND ');

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM assignments a WHERE ${whereClause}`;
        const countResult = await fastify.pg.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        // Get assignments with related data
        const assignmentsQuery = `
          SELECT
            a.*,
            c.name as course_title,
            c.code as course_code,
            COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name
          FROM assignments a
          JOIN courses c ON a.course_id = c.id
          JOIN teachers t ON a.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE ${whereClause}
          ORDER BY a.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, offset);
        const result = await fastify.pg.query(assignmentsQuery, queryParams);

        const assignments = result.rows.map(row => ({
          id: row.id,
          tenant_id: row.tenant_id,
          course_id: row.course_id,
          teacher_id: row.teacher_id,
          title: row.title,
          description: row.description,
          type: row.type,
          creation_mode: row.creation_mode,
          source_document_url: row.source_document_url,
          duration_minutes: row.duration_minutes,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          max_attempts: row.max_attempts,
          shuffle_questions: row.shuffle_questions,
          show_results_mode: row.show_results_mode,
          subject_content: row.subject_content,
          subject_document_url: row.subject_document_url,
          max_file_size_mb: row.max_file_size_mb,
          late_submission_allowed: row.late_submission_allowed,
          late_penalty_percent: row.late_penalty_percent,
          status: row.status,
          settings: row.settings,
          created_at: row.created_at,
          updated_at: row.updated_at,
          course_title: row.course_title,
          course_code: row.course_code,
          teacher_name: row.teacher_name,
        }));

        return {
          assignments,
          total,
          page,
          limit,
        };
      } catch (error) {
        fastify.log.error('Fetch assignments error:', error);
        console.error('Fetch assignments error details:', error);
        return reply.status(500).send({
          error: "Failed to fetch assignments",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
  });

  // GET /api/v1/assignments/question-defaults - Return default counts for placeholder generation
  fastify.get("/question-defaults", {
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;
      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      // For now, return static sane defaults. In the future, we can persist per-tenant preferences.
      return reply.send({
        defaults: {
          single_choice: 3,
          multiple_choice: 2,
          true_false: 2,
          short_text: 1,
          fill_blank: 0,
          points: 1
        }
      });
    }
  });

  // POST /api/v1/assignments/question-defaults - Accept defaults payload (no-op persistence for now)
  fastify.post("/question-defaults", {
    schema: {
      body: {
        type: "object",
        properties: {
          defaults: { type: "object" }
        },
        required: ["defaults"]
      }
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;
      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      // In dev, simply acknowledge. Later we can persist per-tenant preferences.
      return reply.send({ success: true });
    }
  });

  // POST /api/v1/assignments - Create assignment
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          course_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["evaluation", "homework"] },
          creation_mode: { type: "string", enum: ["manual", "ai_generated"] },
          evaluation_type: { type: "string", enum: ["online", "pdf", "ai_generated"] },
          source_document_url: { type: "string" },
          source_documents: { type: "array" },
          ai_config: { type: "object" },
          duration_minutes: { type: "number", minimum: 1 },
          starts_at: { type: "string", format: "date-time" },
          ends_at: { type: "string", format: "date-time" },
          max_attempts: { type: "number", minimum: 1 },
          shuffle_questions: { type: "boolean" },
          show_results_mode: { type: "string", enum: ["immediate", "after_end", "after_correction"] },
          subject_content: { type: "string" },
          subject_document_url: { type: "string" },
          max_file_size_mb: { type: "number", minimum: 1 },
          late_submission_allowed: { type: "boolean" },
          late_penalty_percent: { type: "number", minimum: 0, maximum: 100 },
          settings: { type: "object" },
        },
        required: ["course_id", "title", "type"],
      },
    },
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;
      // ✅ FIX: Use X-User-Id header like other routes
      const userId = (request as any).user?.id || request.headers['x-user-id'] as string;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        let teacherId;

        if (userId) {
          // Try to get teacher ID from user ID
          const teacherResult = await fastify.pg.query(
            'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
            [userId, tenantId]
          );

          if (teacherResult.rows.length > 0) {
            teacherId = teacherResult.rows[0].id;
            console.log(`✅ Teacher ID found for user ${userId}: ${teacherId}`);
          } else {
            console.log(`⚠️ No teacher profile found for user ${userId}`);
          }
        } else {
          console.log('⚠️ No user ID provided in request');
        }

        // ❌ REMOVED: Fallback to random teacher - this causes the bug!
        // If no teacher ID found, return an error instead
        if (!teacherId) {
          return reply.status(403).send({ 
            error: "Teacher profile not found. Please ensure you are logged in as a teacher.",
            details: "No teacher_id could be determined for this request"
          });
        }
        const assignmentData = request.body as any;

        // Normalize dates and ensure ends_at is provided (DB requires NOT NULL)
        const startsAt = (assignmentData as any).starts_at ? new Date((assignmentData as any).starts_at) : null;
        let endsAt = (assignmentData as any).ends_at ? new Date((assignmentData as any).ends_at) : null;
        if (!endsAt) {
          const base = startsAt ?? new Date();
          const duration = Number((assignmentData as any).duration_minutes) || ((assignmentData as any).type === 'evaluation' ? 60 : 1440); // default 1h for evaluations, 24h for homework
          endsAt = new Date(base.getTime() + duration * 60 * 1000);
        }


        const insertQuery = `
          INSERT INTO assignments (
            tenant_id, course_id, teacher_id, title, description, type, creation_mode,
            evaluation_type, source_document_url, source_documents, ai_config, ai_generation_status,
            duration_minutes, starts_at, ends_at, max_attempts,
            shuffle_questions, show_results_mode, subject_content, subject_document_url,
            max_file_size_mb, late_submission_allowed, late_penalty_percent, settings
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
          ) RETURNING *
        `;

        const values = [
          tenantId,
          assignmentData.course_id,
          teacherId,
          assignmentData.title,
          assignmentData.description,
          assignmentData.type,
          assignmentData.creation_mode || 'manual',
          assignmentData.evaluation_type || (assignmentData.type === 'homework' ? 'pdf' : 'online'),
          assignmentData.source_document_url,
          assignmentData.source_documents ? JSON.stringify(assignmentData.source_documents) : null,
          assignmentData.ai_config ? JSON.stringify(assignmentData.ai_config) : null,
          assignmentData.evaluation_type === 'ai_generated' ? 'not_started' : null,
          assignmentData.duration_minutes,
          startsAt,
          endsAt,
          assignmentData.max_attempts || 1,
          assignmentData.shuffle_questions || false,
          assignmentData.show_results_mode || 'after_correction',
          assignmentData.subject_content,
          assignmentData.subject_document_url,
          assignmentData.max_file_size_mb || 10,
          assignmentData.late_submission_allowed || false,
          assignmentData.late_penalty_percent || 0,
          JSON.stringify(assignmentData.settings || {}),
        ];

        const result = await fastify.pg.query(insertQuery, values);
        const assignment = result.rows[0];

        return reply.status(201).send({
          id: assignment.id,
          tenant_id: assignment.tenant_id,
          course_id: assignment.course_id,
          teacher_id: assignment.teacher_id,
          title: assignment.title,
          description: assignment.description,
          type: assignment.type,
          creation_mode: assignment.creation_mode,
          evaluation_type: assignment.evaluation_type,
          source_document_url: assignment.source_document_url,
          source_documents: assignment.source_documents,
          ai_config: assignment.ai_config,
          ai_generation_status: assignment.ai_generation_status,
          ai_generation_error: assignment.ai_generation_error,
          duration_minutes: assignment.duration_minutes,
          starts_at: assignment.starts_at,
          ends_at: assignment.ends_at,
          max_attempts: assignment.max_attempts,
          shuffle_questions: assignment.shuffle_questions,
          show_results_mode: assignment.show_results_mode,
          subject_content: assignment.subject_content,
          subject_document_url: assignment.subject_document_url,
          max_file_size_mb: assignment.max_file_size_mb,
          late_submission_allowed: assignment.late_submission_allowed,
          late_penalty_percent: assignment.late_penalty_percent,
          status: assignment.status,
          settings: assignment.settings,
          created_at: assignment.created_at,
          updated_at: assignment.updated_at,
        });
      } catch (error) {
        fastify.log.error('Assignment creation error:', error);
        console.error('Assignment creation error details:', error);
        return reply.status(500).send({
          error: "Failed to create assignment",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
  });

  // GET /api/v1/assignments/:id - Get assignment by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const query = `
          SELECT
            a.*,
            c.name as course_title,
            c.code as course_code,
            COALESCE(u.first_name || ' ' || u.last_name, t.first_name || ' ' || t.last_name, 'Enseignant') as teacher_name
          FROM assignments a
          JOIN courses c ON a.course_id = c.id
          JOIN teachers t ON a.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE a.id = $1 AND a.tenant_id = $2
        `;

        const result = await fastify.pg.query(query, [id, tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        const row = result.rows[0];
        const assignment = {
          id: row.id,
          tenant_id: row.tenant_id,
          course_id: row.course_id,
          teacher_id: row.teacher_id,
          title: row.title,
          description: row.description,
          type: row.type,
          creation_mode: row.creation_mode,
          source_document_url: row.source_document_url,
          duration_minutes: row.duration_minutes,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          max_attempts: row.max_attempts,
          shuffle_questions: row.shuffle_questions,
          show_results_mode: row.show_results_mode,
          subject_content: row.subject_content,
          subject_document_url: row.subject_document_url,
          max_file_size_mb: row.max_file_size_mb,
          late_submission_allowed: row.late_submission_allowed,
          late_penalty_percent: row.late_penalty_percent,
          status: row.status,
          settings: row.settings,
          created_at: row.created_at,
          updated_at: row.updated_at,
          course_title: row.course_title,
          course_code: row.course_code,
          teacher_name: row.teacher_name,
        };

        return assignment;
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to fetch assignment" });
      }
    },
  });

  // PUT /api/v1/assignments/:id - Update assignment
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["evaluation", "homework"] },
          creation_mode: { type: "string", enum: ["manual", "ai_generated"] },
          source_document_url: { type: "string" },
          duration_minutes: { type: "number", minimum: 1 },
          starts_at: { type: "string", format: "date-time" },
          ends_at: { type: "string", format: "date-time" },
          max_attempts: { type: "number", minimum: 1 },
          shuffle_questions: { type: "boolean" },
          show_results_mode: { type: "string", enum: ["immediate", "after_end", "after_correction"] },
          subject_content: { type: "string" },
          subject_document_url: { type: "string" },
          max_file_size_mb: { type: "number", minimum: 1 },
          late_submission_allowed: { type: "boolean" },
          late_penalty_percent: { type: "number", minimum: 0, maximum: 100 },
          status: { type: "string", enum: ["draft", "published", "archived"] },
          settings: { type: "object" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.headers['x-tenant'] as string;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      if (!userId) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if assignment exists and user has permission
        const checkQuery = `
          SELECT a.*, t.user_id as teacher_user_id
          FROM assignments a
          JOIN teachers t ON a.teacher_id = t.id
          WHERE a.id = $1 AND a.tenant_id = $2
        `;
        const checkResult = await fastify.pg.query(checkQuery, [id, tenantId]);

        if (checkResult.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        const assignment = checkResult.rows[0];
        if (assignment.teacher_user_id !== userId) {
          return reply.status(403).send({ error: "You can only update your own assignments" });
        }

        const updateData = request.body as any;
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        // Build dynamic update query
        Object.keys(updateData).forEach(key => {
          if (updateData[key] !== undefined) {
            updateFields.push(`${key} = $${paramIndex}`);
            if (key === 'starts_at' || key === 'ends_at') {
              updateValues.push(new Date(updateData[key]));
            } else if (key === 'settings') {
              updateValues.push(JSON.stringify(updateData[key]));
            } else {
              updateValues.push(updateData[key]);
            }
            paramIndex++;
          }
        });

        if (updateFields.length === 0) {
          return reply.status(400).send({ error: "No fields to update" });
        }

        updateFields.push(`updated_at = NOW()`);

        const updateQuery = `
          UPDATE assignments
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING *
        `;

        updateValues.push(id, tenantId);
        const result = await fastify.pg.query(updateQuery, updateValues);
        const updatedAssignment = result.rows[0];

        return {
          id: updatedAssignment.id,
          tenant_id: updatedAssignment.tenant_id,
          course_id: updatedAssignment.course_id,
          teacher_id: updatedAssignment.teacher_id,
          title: updatedAssignment.title,
          description: updatedAssignment.description,
          type: updatedAssignment.type,
          creation_mode: updatedAssignment.creation_mode,
          source_document_url: updatedAssignment.source_document_url,
          duration_minutes: updatedAssignment.duration_minutes,
          starts_at: updatedAssignment.starts_at,
          ends_at: updatedAssignment.ends_at,
          max_attempts: updatedAssignment.max_attempts,
          shuffle_questions: updatedAssignment.shuffle_questions,
          show_results_mode: updatedAssignment.show_results_mode,
          subject_content: updatedAssignment.subject_content,
          subject_document_url: updatedAssignment.subject_document_url,
          max_file_size_mb: updatedAssignment.max_file_size_mb,
          late_submission_allowed: updatedAssignment.late_submission_allowed,
          late_penalty_percent: updatedAssignment.late_penalty_percent,
          status: updatedAssignment.status,
          settings: updatedAssignment.settings,
          created_at: updatedAssignment.created_at,
          updated_at: updatedAssignment.updated_at,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to update assignment" });
      }
    },
  });

  // DELETE /api/v1/assignments/:id - Delete assignment
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.headers['x-tenant'] as string;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      if (!userId) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if assignment exists and user has permission
        const checkQuery = `
          SELECT a.*, t.user_id as teacher_user_id
          FROM assignments a
          JOIN teachers t ON a.teacher_id = t.id
          WHERE a.id = $1 AND a.tenant_id = $2
        `;
        const checkResult = await fastify.pg.query(checkQuery, [id, tenantId]);

        if (checkResult.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        const assignment = checkResult.rows[0];
        if (assignment.teacher_user_id !== userId) {
          return reply.status(403).send({ error: "You can only delete your own assignments" });
        }

        // Check if there are any submissions
        const submissionsCheck = await fastify.pg.query(
          'SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = $1',
          [id]
        );

        if (parseInt(submissionsCheck.rows[0].count) > 0) {
          return reply.status(400).send({
            error: "Cannot delete assignment with existing submissions"
          });
        }

        // Delete the assignment (cascade will handle related records)
        await fastify.pg.query(
          'DELETE FROM assignments WHERE id = $1 AND tenant_id = $2',
          [id, tenantId]
        );

        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to delete assignment" });
      }
    },
  });

  // POST /api/v1/assignments/upload-document - Upload assignment document (PDF)
  fastify.post("/upload-document", {
    handler: async (request, reply) => {
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      // Prepare shared vars for logging in catch
      let assignmentId: string | null = null;
      let documentType: string | null = null;
      let fileMeta: any = null;

      try {
        // TODO: Re-enable authentication in production
        // const userId = (request as any).user?.id;
        // if (!userId) {
        //   return reply.status(401).send({ error: "Authentication required" });
        // }

        // Accept fields in any order by iterating multipart parts
        const parts = request.parts();
        let fileBuffer: Buffer | null = null;
        let fileMimetype: string | null = null;
        let fileName: string | null = null;

        for await (const part of parts as any) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer();
            fileMimetype = part.mimetype;
            fileName = part.filename || 'document.pdf';
            fileMeta = { filename: fileName, mimetype: fileMimetype, fieldname: part.fieldname };
          } else if (part.type === 'field') {
            if (part.fieldname === 'assignmentId') assignmentId = part.value;
            if (part.fieldname === 'documentType') documentType = part.value;
          }
        }

        if (!fileBuffer) {
          return reply.status(400).send({ error: "No file uploaded" });
        }

        if (!assignmentId) {
          return reply.status(400).send({ error: "Assignment ID is required" });
        }

        if (!documentType) {
          return reply.status(400).send({ error: "Document type is required" });
        }

        // Validate file type
        if ((fileMimetype || '').toLowerCase() !== 'application/pdf') {
          return reply.status(400).send({ error: "Only PDF files are allowed" });
        }

        // Validate file size (50MB limit)
        const maxSize = 50 * 1024 * 1024; // 50MB
        const buffer = fileBuffer as Buffer;
        if (buffer.length > maxSize) {
          return reply.status(400).send({ error: "File size exceeds 50MB limit" });
        }

        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify assignment exists and get course_id
        const assignmentCheck = await fastify.pg.query(
          'SELECT id, course_id, type FROM assignments WHERE id = $1 AND tenant_id = $2',
          [assignmentId, tenantId]
        );

        if (assignmentCheck.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        const assignment = assignmentCheck.rows[0];
        const courseId = assignment.course_id;

        // Generate unique filename
        const timestamp = Date.now();
        const originalName = fileName || 'document.pdf';
        const fileExtension = '.pdf';
        const uniqueFileName = `assignment-${assignmentId}-${documentType}-${timestamp}${fileExtension}`;

        // Upload file using file storage service
        const fileStorageService = getFileStorageService();
        const uploadResult = await fileStorageService.uploadFile(buffer, {
          tenantId,
          courseId,
          fileName: uniqueFileName,
          contentType: fileMimetype || 'application/pdf',
          metadata: {
            originalFileName: originalName,
            assignmentId,
            documentType,
            uploadedBy: 'system', // TODO: Use actual user ID when auth is implemented
          }
        });

        // Update assignment with document URL
        // Use the full key for the FileStorageService endpoint
        const documentUrl = `/api/v1/files/${uploadResult.key}`;
        const updateField = documentType === 'subject_document' ? 'subject_document_url' : 'subject_document_url';

        await fastify.pg.query(
          `UPDATE assignments SET ${updateField} = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          [documentUrl, assignmentId, tenantId]
        );

        return reply.status(200).send({
          success: true,
          fileUrl: documentUrl,
          fileName: uniqueFileName,
          originalName: originalName,
          fileSize: buffer.length,
          message: "Document uploaded successfully"
        });

      } catch (error) {
        fastify.log.error('File upload error:', {
          error: (error as any)?.message,
          stack: (error as any)?.stack,
          assignmentId,
          documentType,
          fileMeta,
        });
        return reply.status(500).send({
          error: "Failed to upload document",
          details: (error as any)?.message
        });
      }
    },
  });

  // GET /api/v1/assignments/:id/generation-status - Get AI generation status
  fastify.get<{
    Params: { id: string };
  }>("/:id/generation-status", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const tenantId = request.tenantId;

      const result = await fastify.pg.query(
        `SELECT ai_generation_status, ai_generation_error, created_at, updated_at 
         FROM assignments 
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: "Assignment not found" });
      }

      return reply.send(result.rows[0]);
    },
  });

  // POST /api/v1/assignments/ai-evaluation - Create AI-generated evaluation
  fastify.post("/ai-evaluation", {
    schema: {
      body: {
        type: "object",
        properties: {
          course_id: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1 },
          description: { type: "string" },
          source_documents: { type: "array", items: { type: "string", format: "uuid" } },
          ai_config: {
            type: "object",
            properties: {
              mcq: { type: "number", minimum: 0 },
              short_answer: { type: "number", minimum: 0 },
              long_answer: { type: "number", minimum: 0 },
              true_false: { type: "number", minimum: 0 },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] }
            },
            required: ["difficulty"]
          },
          duration_minutes: { type: "number", minimum: 1 },
          starts_at: { type: "string", format: "date-time" },
          ends_at: { type: "string", format: "date-time" },
          max_attempts: { type: "number", minimum: 1 },
          shuffle_questions: { type: "boolean" },
          show_results_mode: { type: "string", enum: ["immediate", "after_end", "after_correction"] },
        },
        required: ["course_id", "title", "source_documents", "ai_config", "duration_minutes"]
      }
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const assignmentData = request.body as any;

        // Validate total questions
        const totalQuestions = (assignmentData.ai_config.mcq || 0) +
                              (assignmentData.ai_config.short_answer || 0) +
                              (assignmentData.ai_config.long_answer || 0) +
                              (assignmentData.ai_config.true_false || 0);

        if (totalQuestions === 0) {
          return reply.status(400).send({ error: "At least one question type must be specified" });
        }

        if (totalQuestions > 50) {
          return reply.status(400).send({ error: "Maximum 50 questions can be generated at once" });
        }

        // Get teacher ID (same logic as regular assignment creation)
        let teacherId: string | null = null;

        if (request.user?.id) {
          const teacherResult = await fastify.pg.query(
            'SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2',
            [tenantId, request.user.id]
          );

          if (teacherResult.rows.length > 0) {
            teacherId = teacherResult.rows[0].id;
          }
        }

        if (!teacherId) {
          const defaultTeacherResult = await fastify.pg.query(
            'SELECT id FROM teachers WHERE tenant_id = $1 LIMIT 1',
            [tenantId]
          );

          if (defaultTeacherResult.rows.length === 0) {
            return reply.status(403).send({ error: "No teachers available in this tenant" });
          }

          teacherId = defaultTeacherResult.rows[0].id;
        }

        // Create assignment with AI evaluation type
        const insertQuery = `
          INSERT INTO assignments (
            tenant_id, course_id, teacher_id, title, description, type, creation_mode,
            evaluation_type, source_documents, ai_config, ai_generation_status,
            duration_minutes, starts_at, ends_at, max_attempts,
            shuffle_questions, show_results_mode, status, settings
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
          ) RETURNING *
        `;

        const values = [
          tenantId,
          assignmentData.course_id,
          teacherId,
          assignmentData.title,
          assignmentData.description,
          'evaluation',
          'ai_generated',
          'ai_generated',
          JSON.stringify(assignmentData.source_documents),
          JSON.stringify(assignmentData.ai_config),
          'processing',
          assignmentData.duration_minutes,
          assignmentData.starts_at ? new Date(assignmentData.starts_at) : null,
          // If ends_at not provided, compute from starts_at + duration_minutes
          assignmentData.ends_at ? new Date(assignmentData.ends_at) : new Date((assignmentData.starts_at ? new Date(assignmentData.starts_at).getTime() : Date.now()) + (Number(assignmentData.duration_minutes || 60) * 60 * 1000)),
          assignmentData.max_attempts || 1,
          assignmentData.shuffle_questions || false,
          assignmentData.show_results_mode || 'after_correction',
          assignmentData.status || 'published', // Default to 'published' instead of database default 'draft'
          JSON.stringify({}),
        ];

        const result = await fastify.pg.query(insertQuery, values);
        const assignment = result.rows[0];

        // Start AI generation process asynchronously
        setImmediate(async () => {
          try {
            fastify.log.info(`🤖 Starting AI question generation for assignment ${assignment.id}`);
            await generateQuestionsForAssignment(fastify, assignment.id, tenantId);
            fastify.log.info(`✅ Successfully completed AI generation for assignment ${assignment.id}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            
            fastify.log.error(`❌ Failed to generate questions for assignment ${assignment.id}:`, {
              error: errorMessage,
              stack: errorStack,
              assignmentId: assignment.id,
              tenantId,
            });

            // Update assignment status to failed
            await fastify.pg.query(
              'UPDATE assignments SET ai_generation_status = $1, ai_generation_error = $2 WHERE id = $3',
              ['failed', errorMessage, assignment.id]
            );
          }
        });

        return reply.status(201).send({
          id: assignment.id,
          tenant_id: assignment.tenant_id,
          course_id: assignment.course_id,
          teacher_id: assignment.teacher_id,
          title: assignment.title,
          description: assignment.description,
          type: assignment.type,
          creation_mode: assignment.creation_mode,
          evaluation_type: assignment.evaluation_type,
          source_documents: assignment.source_documents,
          ai_config: assignment.ai_config,
          ai_generation_status: assignment.ai_generation_status,
          duration_minutes: assignment.duration_minutes,
          starts_at: assignment.starts_at,
          ends_at: assignment.ends_at,
          max_attempts: assignment.max_attempts,
          shuffle_questions: assignment.shuffle_questions,
          show_results_mode: assignment.show_results_mode,
          status: assignment.status,
          settings: assignment.settings,
          created_at: assignment.created_at,
          updated_at: assignment.updated_at,
        });
      } catch (error) {
        fastify.log.error('AI evaluation creation error:', error);
        return reply.status(500).send({
          error: "Failed to create AI evaluation",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
  });
}

// Helper function to generate questions for an assignment
async function generateQuestionsForAssignment(fastify: FastifyInstance, assignmentId: string, tenantId: string) {
  try {
    fastify.log.info(`📋 Step 1: Setting tenant context for ${tenantId}`);
    // Set tenant context
    await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

    fastify.log.info(`📋 Step 2: Fetching assignment details for ${assignmentId}`);
    // Get assignment details
    const assignmentResult = await fastify.pg.query(
      'SELECT * FROM assignments WHERE id = $1 AND tenant_id = $2',
      [assignmentId, tenantId]
    );

    if (assignmentResult.rows.length === 0) {
      throw new Error('Assignment not found');
    }

    const assignment = assignmentResult.rows[0];
    // Note: source_documents and ai_config are stored as JSONB, so they're already parsed objects
    const sourceDocuments = assignment.source_documents;
    const aiConfig = assignment.ai_config;
    
    fastify.log.info(`📋 Step 3: Assignment loaded. Source docs: ${JSON.stringify(sourceDocuments)}, AI config: ${JSON.stringify(aiConfig)}`);

    fastify.log.info(`📋 Step 4: Fetching document details from course_materials`);
    // Get document details
    const documentsResult = await fastify.pg.query(
      `SELECT id, title, file_name, minio_key FROM course_materials
       WHERE tenant_id = $1 AND course_id = $2 AND id = ANY($3)`,
      [tenantId, assignment.course_id, sourceDocuments]
    );

    fastify.log.info(`📋 Step 5: Found ${documentsResult.rows.length} documents`);
    if (documentsResult.rows.length === 0) {
      throw new Error(`No documents found for source_documents: ${JSON.stringify(sourceDocuments)}`);
    }

    // Extract text from documents
    const textExtractionService = getTextExtractionService();
    const fileStorageService = getFileStorageService();

    let combinedContent = '';

    for (const doc of documentsResult.rows) {
      fastify.log.info(`📄 Processing document: ${doc.title} (${doc.file_name}), minio_key: ${doc.minio_key}`);
      const fileBuffer = await fileStorageService.getFileBuffer(doc.minio_key);
      fastify.log.info(`📄 File buffer size: ${fileBuffer.length} bytes`);
      
      const extractionResult = await textExtractionService.extractText(
        fileBuffer,
        'application/pdf',
        doc.file_name
      );
      fastify.log.info(`📄 Extracted text length: ${extractionResult.text.length} characters`);

      const cleanedText = textExtractionService.cleanText(extractionResult.text);
      combinedContent += `\n\n=== Document: ${doc.title} ===\n\n${cleanedText}`;
    }

    fastify.log.info(`📋 Step 6: Total content length: ${combinedContent.length} characters`);
    fastify.log.info(`📋 Step 7: Calling AI service to generate questions...`);
    
    // Generate questions using AI service
    const aiService = getAIEvaluationService();
    const generationResult = await aiService.generateQuestions({
      content: combinedContent.trim(),
      config: aiConfig,
      aiInstructions: assignment.settings?.ai_instructions,
    });
    
    fastify.log.info(`📋 Step 8: AI service returned ${generationResult.questions.length} questions`);

    // Insert generated questions into database
    let orderIndex = 0;
    for (const question of generationResult.questions) {
      // Insert into evaluation_questions table
      const questionResult = await fastify.pg.query(
        `INSERT INTO evaluation_questions (
          tenant_id, assignment_id, type, question_text, options, correct_answer,
          points, order_index, ai_generated
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tenantId,
          assignmentId,
          mapAIQuestionTypeToDBType(question.type),
          question.question_text,
          question.options ? JSON.stringify(question.options) : null,
          JSON.stringify(question.correct_answer),
          question.points,
          orderIndex++,
          true
        ]
      );

      // Insert into ai_generated_questions table for metadata
      await fastify.pg.query(
        `INSERT INTO ai_generated_questions (
          tenant_id, assignment_id, evaluation_question_id, question_type,
          difficulty_level, source_content, ai_model_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          assignmentId,
          questionResult.rows[0].id,
          question.type,
          question.difficulty_level,
          question.source_content,
          'gpt-4'
        ]
      );
    }

    // Update assignment status to completed
    await fastify.pg.query(
      'UPDATE assignments SET ai_generation_status = $1 WHERE id = $2',
      ['completed', assignmentId]
    );

    fastify.log.info(`Successfully generated ${generationResult.questions.length} questions for assignment ${assignmentId}`);
  } catch (error) {
    fastify.log.error(`Question generation failed for assignment ${assignmentId}:`, error);
    throw error;
  }
}

// Helper function to map AI question types to database question types
function mapAIQuestionTypeToDBType(aiType: string): string {
  const mapping: Record<string, string> = {
    'mcq': 'single_choice',
    'short_answer': 'short_text',
    'long_answer': 'short_text',
    'true_false': 'true_false'
  };
  return mapping[aiType] || 'short_text';
}
