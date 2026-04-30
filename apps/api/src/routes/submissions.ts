import { FastifyInstance } from "fastify";
import {
  SubmissionStatus
} from "@ecoledigitale/contracts";
import { getFileStorageService } from "../services/fileStorage";
import path from "path";
import { randomUUID } from "crypto";

/** Permet de noter une soumission « en cours » si un fichier (ou une date de remise) est déjà présent (élève n’a pas cliqué sur Envoyer). */
function submissionIsGradable(row: {
  status: string;
  submitted_file_url?: string | null;
  submitted_at?: Date | string | null;
}): boolean {
  if (row.status === "submitted" || row.status === "graded") return true;
  if (row.status !== "in_progress") return false;
  const hasFile = Boolean(row.submitted_file_url && String(row.submitted_file_url).trim() !== "");
  const hasSubmittedAt = row.submitted_at != null && String(row.submitted_at).trim() !== "";
  return hasFile || hasSubmittedAt;
}

export async function submissionsRoutes(fastify: FastifyInstance) {
  // POST /api/v1/assignments/:assignmentId/submissions - Create a new submission
  fastify.post("/:assignmentId/submissions", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId"],
      },
      body: {
        type: "object",
        properties: {
          // For homework submissions
          submitted_file_url: { type: "string" },
          submitted_file_name: { type: "string" },
          submitted_file_size_mb: { type: "number", minimum: 0 },
          // For evaluation submissions
          answers: { type: "object" },
          // For text submissions
          text_content: { type: "string" },
          // Common fields
          time_spent_seconds: { type: "number", minimum: 0 },
        },
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const {
        submitted_file_url,
        submitted_file_name,
        submitted_file_size_mb,
        answers,
        text_content,
        time_spent_seconds,
      } = request.body as any;
      const tenantId = request.tenantId;
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

        // Get student ID from user ID
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({ error: "Student not found" });
        }

        const studentId = studentQuery.rows[0].id;

        // Check if assignment exists and get its details
        // Note: assignmentId here could be either a template ID or an instance ID
        // First, check if it's an instance ID
        const instanceCheckQuery = await fastify.pg.query(
          'SELECT assignment_id, ends_at, late_submission_allowed FROM assignment_instances WHERE id = $1 AND tenant_id = $2',
          [assignmentId, tenantId]
        );

        let actualAssignmentId = assignmentId;
        let deadlineToCheck = null;
        let lateAllowed = false;

        if (instanceCheckQuery.rows.length > 0) {
          // It's an instance ID - use instance's deadline
          const instance = instanceCheckQuery.rows[0];
          actualAssignmentId = instance.assignment_id;
          deadlineToCheck = instance.ends_at;
          lateAllowed = instance.late_submission_allowed;
          console.log('✅ Using instance deadline:', deadlineToCheck);
        }

        // Get the actual assignment details
        const assignmentQuery = await fastify.pg.query(
          'SELECT id, type, max_attempts, ends_at, late_submission_allowed FROM assignments WHERE id = $1 AND tenant_id = $2',
          [actualAssignmentId, tenantId]
        );

        if (assignmentQuery.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        const assignment = assignmentQuery.rows[0];

        // Use instance deadline if available, otherwise use template deadline
        if (!deadlineToCheck) {
          deadlineToCheck = assignment.ends_at;
          lateAllowed = assignment.late_submission_allowed;
        }

        // Check if assignment has ended
        const now = new Date();
        const isLate = deadlineToCheck && now > new Date(deadlineToCheck);
        
        if (isLate && !lateAllowed) {
          return reply.status(400).send({ error: "Assignment submission deadline has passed" });
        }

        // Check existing submissions count (use actualAssignmentId from template)
        const existingSubmissionsQuery = await fastify.pg.query(
          'SELECT COUNT(*) as count FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2 AND tenant_id = $3',
          [actualAssignmentId, studentId, tenantId]
        );

        const submissionCount = parseInt(existingSubmissionsQuery.rows[0].count);
        
        // Get max attempts from assignment instance if available
        const maxAttemptsQuery = await fastify.pg.query(
          'SELECT ai.max_attempts FROM assignment_instances ai WHERE ai.assignment_id = $1 AND ai.tenant_id = $2 LIMIT 1',
          [actualAssignmentId, tenantId]
        );
        
        const maxAttempts = maxAttemptsQuery.rows[0]?.max_attempts || assignment.max_attempts || 2;
        
        if (submissionCount >= maxAttempts) {
          return reply.status(400).send({ 
            error: "Maximum number of attempts reached",
            message: `Vous avez déjà soumis ce devoir ${submissionCount} fois sur ${maxAttempts} tentatives autorisées.`
          });
        }

        // Determine attempt number
        const attemptNumber = submissionCount + 1;

        // Create submission
        const insertQuery = `
          INSERT INTO assignment_submissions (
            tenant_id, assignment_id, student_id, attempt_number,
            submitted_file_url, submitted_file_name, submitted_file_size_mb,
            answers, time_spent_seconds, status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'in_progress'
          ) RETURNING *
        `;

        const result = await fastify.pg.query(insertQuery, [
          tenantId,
          actualAssignmentId,  // Use template ID, not instance ID
          studentId,
          attemptNumber,
          submitted_file_url || null,
          submitted_file_name || null,
          submitted_file_size_mb || null,
          answers ? JSON.stringify(answers) : null,
          time_spent_seconds || null,
        ]);

        const submission = result.rows[0];

        return {
          id: submission.id,
          assignment_id: submission.assignment_id,
          student_id: submission.student_id,
          attempt_number: submission.attempt_number,
          submitted_file_url: submission.submitted_file_url,
          submitted_file_name: submission.submitted_file_name,
          submitted_file_size_mb: submission.submitted_file_size_mb ? parseFloat(submission.submitted_file_size_mb) : null,
          answers: submission.answers,
          time_spent_seconds: submission.time_spent_seconds,
          status: submission.status,
          created_at: submission.created_at,
          updated_at: submission.updated_at,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to create submission" });
      }
    },
  });

  // PATCH /api/v1/assignments/:assignmentId/submissions/:submissionId - Update a submission
  fastify.patch("/:assignmentId/submissions/:submissionId", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId", "submissionId"],
      },
      body: {
        type: "object",
        properties: {
          submitted_file_url: { type: "string" },
          submitted_file_name: { type: "string" },
          submitted_file_size_mb: { type: "number", minimum: 0 },
          answers: { type: "object" },
          text_content: { type: "string" },
          time_spent_seconds: { type: "number", minimum: 0 },
        },
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId, submissionId } = request.params as { assignmentId: string; submissionId: string };
      const {
        submitted_file_url,
        submitted_file_name,
        submitted_file_size_mb,
        answers,
        text_content,
        time_spent_seconds,
      } = request.body as any;
      const tenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      if (!userIdHeader) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      try {
        // Convert tenant name/slug to UUID if needed
        let actualTenantId = tenantId;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await fastify.pg.query(tenantQuery, [tenantId]);
          if (tenantResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Tenant not found' });
          }
          actualTenantId = tenantResult.rows[0].id;
        }

        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', actualTenantId]);

        // Get student ID from user ID
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userIdHeader, actualTenantId]
        );

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({ error: "Student not found" });
        }

        const studentId = studentQuery.rows[0].id;

        // Resolve instance ID to template assignment ID if needed
        let actualAssignmentId = assignmentId;
        const instanceCheck = await fastify.pg.query(
          'SELECT assignment_id FROM assignment_instances WHERE id = $1 AND tenant_id = $2',
          [assignmentId, actualTenantId]
        );
        if (instanceCheck.rows.length > 0) {
          actualAssignmentId = instanceCheck.rows[0].assignment_id;
        }

        // Check if submission exists and belongs to the student
        const submissionQuery = await fastify.pg.query(
          'SELECT * FROM assignment_submissions WHERE id = $1 AND assignment_id = $2 AND student_id = $3 AND tenant_id = $4',
          [submissionId, actualAssignmentId, studentId, actualTenantId]
        );

        if (submissionQuery.rows.length === 0) {
          return reply.status(404).send({ error: "Submission not found" });
        }

        const submission = submissionQuery.rows[0];

        // Check if submission is already submitted or graded
        if (submission.status === 'submitted' || submission.status === 'graded') {
          return reply.status(400).send({ error: "Cannot update a submitted or graded submission" });
        }

        // Build update query dynamically based on provided fields
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (submitted_file_url !== undefined) {
          updateFields.push(`submitted_file_url = $${paramIndex}`);
          updateValues.push(submitted_file_url);
          paramIndex++;
        }

        if (submitted_file_name !== undefined) {
          updateFields.push(`submitted_file_name = $${paramIndex}`);
          updateValues.push(submitted_file_name);
          paramIndex++;
        }

        if (submitted_file_size_mb !== undefined) {
          updateFields.push(`submitted_file_size_mb = $${paramIndex}`);
          updateValues.push(submitted_file_size_mb);
          paramIndex++;
        }

        if (answers !== undefined) {
          updateFields.push(`answers = $${paramIndex}`);
          updateValues.push(JSON.stringify(answers));
          paramIndex++;
        }

        if (text_content !== undefined) {
          updateFields.push(`text_content = $${paramIndex}`);
          updateValues.push(text_content);
          paramIndex++;
        }

        if (time_spent_seconds !== undefined) {
          updateFields.push(`time_spent_seconds = $${paramIndex}`);
          updateValues.push(time_spent_seconds);
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({ error: "No fields to update" });
        }

        // Add updated_at
        updateFields.push(`updated_at = NOW()`);

        // Add WHERE clause parameters
        updateValues.push(submissionId, actualAssignmentId, studentId, actualTenantId);

        const updateQuery = `
          UPDATE assignment_submissions
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND assignment_id = $${paramIndex + 1} AND student_id = $${paramIndex + 2} AND tenant_id = $${paramIndex + 3}
          RETURNING *
        `;

        const result = await fastify.pg.query(updateQuery, updateValues);
        const updatedSubmission = result.rows[0];

        return {
          id: updatedSubmission.id,
          assignment_id: updatedSubmission.assignment_id,
          student_id: updatedSubmission.student_id,
          attempt_number: updatedSubmission.attempt_number,
          submitted_file_url: updatedSubmission.submitted_file_url,
          submitted_file_name: updatedSubmission.submitted_file_name,
          submitted_file_size_mb: updatedSubmission.submitted_file_size_mb ? parseFloat(updatedSubmission.submitted_file_size_mb) : null,
          answers: updatedSubmission.answers,
          text_content: updatedSubmission.text_content,
          time_spent_seconds: updatedSubmission.time_spent_seconds,
          status: updatedSubmission.status,
          created_at: updatedSubmission.created_at,
          updated_at: updatedSubmission.updated_at,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to update submission" });
      }
    },
  });

  // GET /api/v1/assignments/:assignmentId/submissions - List submissions for an assignment
  fastify.get("/:assignmentId/submissions", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId"],
      },
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["in_progress", "submitted", "graded"] },
          student_id: { type: "string", format: "uuid" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const { status, student_id, page = 1, limit = 20 } = request.query as any;
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      // TODO: Implement proper authentication middleware
      // For now, skip authentication check for development
      // if (!userId) {
      //   return reply.status(401).send({ error: "Authentication required" });
      // }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if user has permission to view submissions (teacher of the assignment)
        const permissionCheck = await fastify.pg.query(`
          SELECT a.id, t.user_id as teacher_user_id
          FROM assignments a
          JOIN teachers t ON a.teacher_id = t.id
          WHERE a.id = $1 AND a.tenant_id = $2
        `, [assignmentId, tenantId]);

        if (permissionCheck.rows.length === 0) {
          return reply.status(404).send({ error: "Assignment not found" });
        }

        // TODO: Implement proper permission check when authentication is added
        // For now, skip permission check for development
        // if (permissionCheck.rows[0].teacher_user_id !== userId) {
        //   return reply.status(403).send({ error: "You can only view submissions for your own assignments" });
        // }

        let whereConditions = ['s.assignment_id = $1', 's.tenant_id = $2'];
        let queryParams: any[] = [assignmentId, tenantId];
        let paramIndex = 3;

        if (status) {
          whereConditions.push(`s.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        if (student_id) {
          whereConditions.push(`s.student_id = $${paramIndex}`);
          queryParams.push(student_id);
          paramIndex++;
        }

        const offset = (page - 1) * limit;
        const whereClause = whereConditions.join(' AND ');

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM assignment_submissions s WHERE ${whereClause}`;
        const countResult = await fastify.pg.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        // Get submissions with student info
        const submissionsQuery = `
          SELECT 
            s.*,
            u.first_name || ' ' || u.last_name as student_name,
            u.email as student_email,
            st.student_number
          FROM assignment_submissions s
          JOIN student_profiles st ON s.student_id = st.id
          JOIN users u ON st.user_id = u.id
          WHERE ${whereClause}
          ORDER BY s.submitted_at DESC NULLS LAST, s.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(limit, offset);
        const result = await fastify.pg.query(submissionsQuery, queryParams);

        const submissions = result.rows.map(row => ({
          id: row.id,
          tenant_id: row.tenant_id,
          assignment_id: row.assignment_id,
          student_id: row.student_id,
          attempt_number: row.attempt_number,
          answers: row.answers,
          auto_score: row.auto_score ? parseFloat(row.auto_score) : null,
          submitted_file_url: row.submitted_file_url,
          submitted_file_name: row.submitted_file_name,
          submitted_file_size_mb: row.submitted_file_size_mb ? parseFloat(row.submitted_file_size_mb) : null,
          manual_score: row.manual_score ? parseFloat(row.manual_score) : null,
          final_score: row.final_score ? parseFloat(row.final_score) : null,
          time_spent_seconds: row.time_spent_seconds,
          submitted_at: row.submitted_at,
          graded_at: row.graded_at,
          graded_by: row.graded_by,
          feedback: row.feedback,
          is_late: row.is_late,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          student_name: row.student_name,
          student_email: row.student_email,
          student_number: row.student_number,
        }));

        return {
          submissions,
          total,
          page,
          limit,
        };
      } catch (error) {
        fastify.log.error(error);

        // Check if it's a "relation does not exist" error (students table not created yet)
        if ((error as any).code === '42P01' && (error as any).message?.includes('students')) {
          fastify.log.warn('Students table does not exist yet, returning empty submissions list');
          return {
            submissions: [],
            total: 0,
            page,
            limit,
          };
        }

        return reply.status(500).send({ error: "Failed to fetch submissions" });
      }
    },
  });

  // GET /api/v1/assignments/:assignmentId/submissions/:submissionId - Get a specific submission
  fastify.get("/:assignmentId/submissions/:submissionId", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId", "submissionId"],
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId, submissionId } = request.params as {
        assignmentId: string;
        submissionId: string;
      };
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get submission with student info
        const query = `
          SELECT 
            s.*,
            u.first_name || ' ' || u.last_name as student_name,
            u.email as student_email,
            st.student_number as student_number
          FROM assignment_submissions s
          JOIN student_profiles st ON s.student_id = st.id
          JOIN users u ON st.user_id = u.id
          WHERE s.id = $1 AND s.assignment_id = $2 AND s.tenant_id = $3
        `;
        
        const result = await fastify.pg.query(query, [submissionId, assignmentId, tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: "Submission not found" });
        }

        const row = result.rows[0];
        return {
          id: row.id,
          tenant_id: row.tenant_id,
          assignment_id: row.assignment_id,
          student_id: row.student_id,
          attempt_number: row.attempt_number,
          answers: row.answers,
          auto_score: row.auto_score ? parseFloat(row.auto_score) : null,
          submitted_file_url: row.submitted_file_url,
          submitted_file_name: row.submitted_file_name,
          submitted_file_size_mb: row.submitted_file_size_mb ? parseFloat(row.submitted_file_size_mb) : null,
          manual_score: row.manual_score ? parseFloat(row.manual_score) : null,
          final_score: row.final_score ? parseFloat(row.final_score) : null,
          time_spent_seconds: row.time_spent_seconds,
          submitted_at: row.submitted_at,
          graded_at: row.graded_at,
          graded_by: row.graded_by,
          feedback: row.feedback,
          is_late: row.is_late,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          student_name: row.student_name,
          student_email: row.student_email,
          student_number: row.student_number,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to fetch submission" });
      }
    },
  });

  // GET /api/v1/assignments/:assignmentId/submissions/my-submission - Get current user's latest submission (no side effects)
  fastify.get("/:assignmentId/submissions/my-submission", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId"],
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const tenantId = request.tenantId;
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

        // Get student ID from user ID
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({ error: "Student not found" });
        }

        const studentId = studentQuery.rows[0].id;

        // Resolve instance ID to template assignment ID if needed
        let actualAssignmentId = assignmentId;
        const instanceCheck = await fastify.pg.query(
          'SELECT assignment_id FROM assignment_instances WHERE id = $1 AND tenant_id = $2',
          [assignmentId, tenantId]
        );
        if (instanceCheck.rows.length > 0) {
          actualAssignmentId = instanceCheck.rows[0].assignment_id;
        }

        // Fetch the most recent submission for this student and assignment
        const submissionQuery = await fastify.pg.query(
          `SELECT * FROM assignment_submissions
           WHERE assignment_id = $1 AND student_id = $2 AND tenant_id = $3
           ORDER BY created_at DESC
           LIMIT 1`,
          [actualAssignmentId, studentId, tenantId]
        );

        if (submissionQuery.rows.length === 0) {
          return reply.status(404).send({ error: "Submission not found" });
        }

        const s = submissionQuery.rows[0];
        return {
          id: s.id,
          assignment_id: s.assignment_id,
          student_id: s.student_id,
          attempt_number: s.attempt_number,
          submitted_file_url: s.submitted_file_url,
          submitted_file_name: s.submitted_file_name,
          submitted_file_size_mb: s.submitted_file_size_mb ? parseFloat(s.submitted_file_size_mb) : null,
          answers: s.answers,
          time_spent_seconds: s.time_spent_seconds,
          status: s.status,
          created_at: s.created_at,
          updated_at: s.updated_at,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to fetch submission" });
      }
    },
  });

  // POST /api/v1/assignments/:assignmentId/submissions/:submissionId/finalize - Finalize a submission (review and submit)
  fastify.post("/:assignmentId/submissions/:submissionId/finalize", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId", "submissionId"],
      },
      body: {
        type: "object",
        properties: {
          confirm_submit: { type: "boolean", default: false },
          review_data: { type: "object" },
        },
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId, submissionId } = request.params as {
        assignmentId: string;
        submissionId: string;
      };
      const { confirm_submit = false, review_data } = request.body as any;
      const tenantId = request.headers['x-tenant'] as string;
      const userIdHeader = request.headers['x-user-id'] as string;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant ID requis"
        });
      }

      if (!userIdHeader) {
        return reply.status(401).send({
          success: false,
          error: "Authentification requise"
        });
      }

      try {
        // Convert tenant name/slug to UUID if needed
        let actualTenantId = tenantId;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await fastify.pg.query(tenantQuery, [tenantId]);
          if (tenantResult.rows.length === 0) {
            return reply.status(404).send({ success: false, error: 'Tenant non trouvé' });
          }
          actualTenantId = tenantResult.rows[0].id;
        }

        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', actualTenantId]);

        // Get student ID from user ID (WITH tenant_id for multi-tenant isolation)
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userIdHeader, actualTenantId]
        );

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "Profil étudiant non trouvé"
          });
        }

        const studentId = studentQuery.rows[0].id;

        // 🔄 Check if assignmentId is actually an instance_id and resolve to assignment_id if needed
        let actualAssignmentId = assignmentId;
        const instanceCheck = await fastify.pg.query(
          'SELECT assignment_id FROM assignment_instances WHERE id = $1 AND tenant_id = $2',
          [assignmentId, actualTenantId]
        );

        if (instanceCheck.rows.length > 0) {
          actualAssignmentId = instanceCheck.rows[0].assignment_id;
          console.log('🔄 Found instance ID, using assignment ID:', actualAssignmentId);
        }

        // Get submission details - NOTE: We need to check the instance deadline, not assignment deadline
        // The assignment_instances table has the actual deadline for each class/instance
        const submissionQuery = await fastify.pg.query(`
          SELECT 
            s.*,
            a.title as assignment_title,
            a.type as assignment_type,
            COALESCE(ai.ends_at, a.ends_at) as ends_at,
            COALESCE(ai.late_submission_allowed, a.late_submission_allowed) as late_submission_allowed
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          LEFT JOIN assignment_instances ai ON ai.assignment_id = a.id AND ai.tenant_id = s.tenant_id
          WHERE s.id = $1 AND s.assignment_id = $2 AND s.student_id = $3
        `, [submissionId, actualAssignmentId, studentId]);

        if (submissionQuery.rows.length === 0) {
          return reply.status(404).send({ 
            success: false,
            error: "Soumission non trouvée" 
          });
        }

        const submission = submissionQuery.rows[0];

        // Check if submission is already submitted
        if (submission.status === 'submitted' || submission.status === 'graded') {
          return reply.status(400).send({ 
            success: false,
            error: "Cette soumission a déjà été envoyée",
            submission_status: submission.status
          });
        }

        // Check deadline - use instance deadline if available
        const now = new Date();
        const isLate = submission.ends_at && now > new Date(submission.ends_at);

        if (isLate && !submission.late_submission_allowed) {
          return reply.status(400).send({ 
            success: false,
            error: "Le délai de soumission est dépassé",
            deadline: submission.ends_at,
            is_late: true
          });
        }

        // If not confirming submit, return review data
        if (!confirm_submit) {
          return reply.send({
            success: true,
            review_data: {
              submission_id: submission.id,
              assignment_title: submission.assignment_title,
              assignment_type: submission.assignment_type,
              has_file: !!submission.submitted_file_url,
              file_name: submission.submitted_file_name,
              file_size_mb: submission.submitted_file_size_mb,
              has_answers: !!submission.answers,
              answers_count: submission.answers ? Object.keys(submission.answers).length : 0,
              time_spent_seconds: submission.time_spent_seconds,
              deadline: submission.ends_at,
              is_late: isLate,
              can_submit: true
            }
          });
        }

        // Finalize submission
        const updateQuery = `
          UPDATE assignment_submissions
          SET
            status = 'submitted',
            submitted_at = NOW(),
            is_late = $1,
            updated_at = NOW()
          WHERE id = $2 AND assignment_id = $3 AND student_id = $4
          RETURNING *
        `;

        const result = await fastify.pg.query(updateQuery, [
          isLate,
          submissionId,
          actualAssignmentId,
          studentId
        ]);

        const finalizedSubmission = result.rows[0];

        return reply.send({
          success: true,
          message: "Soumission finalisée avec succès",
          submission: {
            id: finalizedSubmission.id,
            status: finalizedSubmission.status,
            submitted_at: finalizedSubmission.submitted_at,
            is_late: finalizedSubmission.is_late
          }
        });

      } catch (error) {
        console.error('Error finalizing submission:', error);
        return reply.status(500).send({ 
          success: false,
          error: "Erreur lors de la finalisation de la soumission" 
        });
      }
    },
  });

  // POST /api/v1/assignments/:assignmentId/submissions/:submissionId/submit - Submit a submission
  fastify.post("/:assignmentId/submissions/:submissionId/submit", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId", "submissionId"],
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId, submissionId } = request.params as {
        assignmentId: string;
        submissionId: string;
      };
      const tenantId = request.tenantId;
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

        // Get student ID from user ID
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({ error: "Student not found" });
        }

        const studentId = studentQuery.rows[0].id;

        // Check if submission exists and belongs to the student
        const submissionQuery = await fastify.pg.query(
          'SELECT * FROM assignment_submissions WHERE id = $1 AND assignment_id = $2 AND student_id = $3 AND tenant_id = $4',
          [submissionId, assignmentId, studentId, tenantId]
        );

        if (submissionQuery.rows.length === 0) {
          return reply.status(404).send({ error: "Submission not found" });
        }

        const submission = submissionQuery.rows[0];

        // Check if submission is already submitted
        if (submission.status === 'submitted' || submission.status === 'graded') {
          return reply.status(400).send({ error: "Submission is already submitted" });
        }

        // Check if assignment has ended
        const assignmentQuery = await fastify.pg.query(
          'SELECT ends_at, late_submission_allowed FROM assignments WHERE id = $1 AND tenant_id = $2',
          [assignmentId, tenantId]
        );

        if (assignmentQuery.rows.length > 0) {
          const assignment = assignmentQuery.rows[0];
          const now = new Date();
          const isLate = assignment.ends_at && now > new Date(assignment.ends_at);

          if (isLate && !assignment.late_submission_allowed) {
            return reply.status(400).send({ error: "Assignment submission deadline has passed and late submissions are not allowed" });
          }
        }

        // Update submission status to submitted
        const updateQuery = `
          UPDATE assignment_submissions
          SET
            status = 'submitted',
            submitted_at = NOW(),
            is_late = CASE
              WHEN (SELECT ends_at FROM assignments WHERE id = $1) IS NOT NULL
                AND NOW() > (SELECT ends_at FROM assignments WHERE id = $1)
              THEN true
              ELSE false
            END,
            updated_at = NOW()
          WHERE id = $2 AND assignment_id = $1 AND student_id = $3 AND tenant_id = $4
          RETURNING *
        `;

        const result = await fastify.pg.query(updateQuery, [
          assignmentId,
          submissionId,
          studentId,
          tenantId,
        ]);

        const submittedSubmission = result.rows[0];

        return {
          id: submittedSubmission.id,
          assignment_id: submittedSubmission.assignment_id,
          student_id: submittedSubmission.student_id,
          attempt_number: submittedSubmission.attempt_number,
          submitted_file_url: submittedSubmission.submitted_file_url,
          submitted_file_name: submittedSubmission.submitted_file_name,
          submitted_file_size_mb: submittedSubmission.submitted_file_size_mb ? parseFloat(submittedSubmission.submitted_file_size_mb) : null,
          answers: submittedSubmission.answers,
          time_spent_seconds: submittedSubmission.time_spent_seconds,
          status: submittedSubmission.status,
          submitted_at: submittedSubmission.submitted_at,
          is_late: submittedSubmission.is_late,
          created_at: submittedSubmission.created_at,
          updated_at: submittedSubmission.updated_at,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to submit submission" });
      }
    },
  });

  // POST /api/v1/assignments/:assignmentId/submissions/:submissionId/grade - Grade a submission
  fastify.post("/:assignmentId/submissions/:submissionId/grade", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId", "submissionId"],
      },
      body: {
        type: "object",
        properties: {
          manual_score: { type: "number", minimum: 0 },
          feedback: { type: "string" },
          auto_grade: { type: "boolean", default: false },
        },
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId, submissionId } = request.params as {
        assignmentId: string;
        submissionId: string;
      };
      const { manual_score, feedback, auto_grade = false } = request.body as any;
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      // TODO: Implement proper authentication middleware
      // For now, skip authentication check for development
      // if (!userId) {
      //   return reply.status(401).send({ error: "Authentication required" });
      // }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check permissions
        const permissionCheck = await fastify.pg.query(`
          SELECT s.*, a.type as assignment_type, t.user_id as teacher_user_id
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN teachers t ON a.teacher_id = t.id
          WHERE s.id = $1 AND s.assignment_id = $2 AND s.tenant_id = $3
        `, [submissionId, assignmentId, tenantId]);

        if (permissionCheck.rows.length === 0) {
          return reply.status(404).send({ error: "Submission not found" });
        }

        const submission = permissionCheck.rows[0];
        // TODO: Implement proper permission check when authentication is added
        // For now, skip permission check for development
        // if (submission.teacher_user_id !== userId) {
        //   return reply.status(403).send({ error: "You can only grade submissions for your own assignments" });
        // }

        if (!submissionIsGradable(submission)) {
          return reply.status(400).send({
            error:
              submission.status === "in_progress"
                ? "Impossible de noter : aucun fichier ou date de remise — l'élève doit envoyer le devoir ou déposer un travail."
                : "Seules les soumissions envoyées ou déjà notées peuvent être corrigées.",
          });
        }

        let finalScore = manual_score;
        let autoScore = submission.auto_score;

        // If auto_grade is requested and it's an evaluation, calculate auto score
        if (auto_grade && submission.assignment_type === 'evaluation') {
          autoScore = await calculateAutoScore(fastify, submissionId, assignmentId);
          if (manual_score === undefined) {
            finalScore = autoScore;
          }
        }

        // Update submission with grading information
        const updateQuery = `
          UPDATE assignment_submissions 
          SET 
            manual_score = $1,
            auto_score = $2,
            final_score = $3,
            feedback = $4,
            graded_at = NOW(),
            graded_by = $5,
            status = 'graded',
            updated_at = NOW()
          WHERE id = $6 AND assignment_id = $7 AND tenant_id = $8
          RETURNING *
        `;

        const result = await fastify.pg.query(updateQuery, [
          manual_score || null,
          autoScore,
          finalScore,
          feedback || null,
          userId,
          submissionId,
          assignmentId,
          tenantId
        ]);

        const gradedSubmission = result.rows[0];

        return {
          id: gradedSubmission.id,
          manual_score: gradedSubmission.manual_score ? parseFloat(gradedSubmission.manual_score) : null,
          auto_score: gradedSubmission.auto_score ? parseFloat(gradedSubmission.auto_score) : null,
          final_score: gradedSubmission.final_score ? parseFloat(gradedSubmission.final_score) : null,
          feedback: gradedSubmission.feedback,
          graded_at: gradedSubmission.graded_at,
          graded_by: gradedSubmission.graded_by,
          status: gradedSubmission.status,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to grade submission" });
      }
    },
  });

  // POST /api/v1/assignments/:assignmentId/submissions/:submissionId/auto-grade - Auto-grade evaluation
  fastify.post("/:assignmentId/submissions/:submissionId/auto-grade", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId", "submissionId"],
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId, submissionId } = request.params as {
        assignmentId: string;
        submissionId: string;
      };
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({ error: "Tenant ID is required" });
      }

      // TODO: Implement proper authentication middleware
      // For now, skip authentication check for development
      // if (!userId) {
      //   return reply.status(401).send({ error: "Authentication required" });
      // }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check permissions and assignment type
        const permissionCheck = await fastify.pg.query(`
          SELECT s.*, a.type as assignment_type, t.user_id as teacher_user_id
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN teachers t ON a.teacher_id = t.id
          WHERE s.id = $1 AND s.assignment_id = $2 AND s.tenant_id = $3
        `, [submissionId, assignmentId, tenantId]);

        if (permissionCheck.rows.length === 0) {
          return reply.status(404).send({ error: "Submission not found" });
        }

        const submission = permissionCheck.rows[0];
        // TODO: Implement proper permission check when authentication is added
        // For now, skip permission check for development
        // if (submission.teacher_user_id !== userId) {
        //   return reply.status(403).send({ error: "You can only grade submissions for your own assignments" });
        // }

        if (submission.assignment_type !== 'evaluation') {
          return reply.status(400).send({ error: "Auto-grading is only available for evaluations" });
        }

        if (submission.status !== 'submitted') {
          return reply.status(400).send({ error: "Can only auto-grade submitted evaluations" });
        }

        // Calculate auto score
        const autoScore = await calculateAutoScore(fastify, submissionId, assignmentId);

        // Update submission with auto score
        const updateQuery = `
          UPDATE assignment_submissions 
          SET 
            auto_score = $1,
            final_score = $1,
            graded_at = NOW(),
            graded_by = $2,
            status = 'graded',
            updated_at = NOW()
          WHERE id = $3 AND assignment_id = $4 AND tenant_id = $5
          RETURNING auto_score, final_score, graded_at, status
        `;

        const result = await fastify.pg.query(updateQuery, [
          autoScore,
          userId,
          submissionId,
          assignmentId,
          tenantId
        ]);

        const gradedSubmission = result.rows[0];

        return {
          auto_score: parseFloat(gradedSubmission.auto_score),
          final_score: parseFloat(gradedSubmission.final_score),
          graded_at: gradedSubmission.graded_at,
          status: gradedSubmission.status,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to auto-grade submission" });
      }
    },
  });

  // Helper function to calculate automatic score for evaluations
  async function calculateAutoScore(fastify: FastifyInstance, submissionId: string, assignmentId: string): Promise<number> {
    try {
      // Get submission answers and questions
      const submissionQuery = `
        SELECT answers FROM assignment_submissions 
        WHERE id = $1
      `;
      const submissionResult = await fastify.pg.query(submissionQuery, [submissionId]);
      const answers = submissionResult.rows[0]?.answers || {};

      // Get questions for the assignment
      const questionsQuery = `
        SELECT id, type, correct_answer, points, options
        FROM evaluation_questions 
        WHERE assignment_id = $1
        ORDER BY order_index
      `;
      const questionsResult = await fastify.pg.query(questionsQuery, [assignmentId]);
      const questions = questionsResult.rows;

      let totalScore = 0;
      let maxScore = 0;

      // Calculate score for each question
      for (const question of questions) {
        maxScore += parseFloat(question.points);
        const studentAnswer = answers[question.id];
        
        if (studentAnswer === undefined || studentAnswer === null) {
          continue; // No answer provided
        }

        let isCorrect = false;

        switch (question.type) {
          case 'single_choice':
            isCorrect = studentAnswer === question.correct_answer;
            break;
          
          case 'multiple_choice':
            const correctAnswers = Array.isArray(question.correct_answer) ? question.correct_answer : [];
            const userAnswers = Array.isArray(studentAnswer) ? studentAnswer : [];
            isCorrect = correctAnswers.length === userAnswers.length && 
                       correctAnswers.every((a: any) => userAnswers.includes(a));
            break;
          
          case 'true_false':
            isCorrect = studentAnswer === question.correct_answer;
            break;
          
          case 'short_text':
          case 'fill_blank':
            // For text questions, we could implement fuzzy matching or AI scoring
            // For now, exact match (case-insensitive)
            const correctText = String(question.correct_answer).toLowerCase().trim();
            const studentText = String(studentAnswer).toLowerCase().trim();
            isCorrect = correctText === studentText;
            break;
        }

        if (isCorrect) {
          totalScore += parseFloat(question.points);
        }

        // Store individual question response for detailed feedback
        await fastify.pg.query(`
          INSERT INTO evaluation_question_responses (
            tenant_id, submission_id, question_id, answer, auto_score
          ) VALUES (
            (SELECT tenant_id FROM assignment_submissions WHERE id = $1),
            $1, $2, $3, $4
          ) ON CONFLICT (submission_id, question_id) 
          DO UPDATE SET answer = $3, auto_score = $4
        `, [submissionId, question.id, JSON.stringify(studentAnswer), isCorrect ? parseFloat(question.points) : 0]);
      }

      // Convert to percentage score (0-20 scale)
      const percentageScore = maxScore > 0 ? (totalScore / maxScore) * 20 : 0;
      return Math.round(percentageScore * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      fastify.log.error(error);
      return 0;
    }
  }

  // POST /api/v1/assignments/:assignmentId/submissions/upload - Upload file for submission
  fastify.post("/:assignmentId/submissions/upload", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
        },
        required: ["assignmentId"],
      },
    },
    handler: async (request: any, reply: any) => {
      const { assignmentId: instanceId } = request.params as { assignmentId: string };
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant ID is required"
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Authentication required"
        });
      }

      try {
        console.log('🔍 Upload Debug Info:', {
          instanceId,
          tenantId,
          userId
        });

        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get student ID from user ID
        const studentQuery = await fastify.pg.query(
          'SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        console.log('👤 Student Query Result:', {
          rowCount: studentQuery.rows.length,
          rows: studentQuery.rows
        });

        if (studentQuery.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "Student not found"
          });
        }

        const studentId = studentQuery.rows[0].id;

        // Get assignment instance and related assignment data
        const instanceQuery = await fastify.pg.query(`
          SELECT
            ai.id as instance_id,
            ai.assignment_id,
            ai.ends_at,
            ai.late_submission_allowed,
            a.type,
            a.max_file_size_mb,
            a.course_id
          FROM assignment_instances ai
          JOIN assignments a ON ai.assignment_id = a.id
          WHERE ai.id = $1 AND ai.tenant_id = $2
        `, [instanceId, tenantId]);

        console.log('📋 Instance Query Result:', {
          instanceId,
          tenantId,
          rowCount: instanceQuery.rows.length,
          rows: instanceQuery.rows
        });

        if (instanceQuery.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Assignment instance not found"
          });
        }

        const instance = instanceQuery.rows[0];
        const assignmentId = instance.assignment_id;
        const courseId = instance.course_id;

        console.log('✅ Found instance:', {
          instanceId: instance.instance_id,
          assignmentId,
          type: instance.type,
          maxFileSize: instance.max_file_size_mb
        });

        if (instance.type !== 'homework') {
          return reply.status(400).send({
            success: false,
            error: "This assignment does not accept file uploads"
          });
        }

        // Check if assignment has ended and late submissions are not allowed
        const now = new Date();
        const isLate = instance.ends_at && now > new Date(instance.ends_at);

        if (isLate && !instance.late_submission_allowed) {
          return reply.status(400).send({
            success: false,
            error: "Assignment submission deadline has passed"
          });
        }

        // Check if student already has a submission
        const existingSubmissionQuery = await fastify.pg.query(
          'SELECT id, status FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2 AND tenant_id = $3',
          [assignmentId, studentId, tenantId]
        );

        if (existingSubmissionQuery.rows.length > 0) {
          const existingSubmission = existingSubmissionQuery.rows[0];
          if (existingSubmission.status === 'submitted' || existingSubmission.status === 'graded') {
            return reply.status(400).send({
              success: false,
              error: "You have already submitted this assignment"
            });
          }
        }

        // Handle file upload
        const data = await request.file();

        if (!data) {
          return reply.status(400).send({
            success: false,
            error: "No file provided"
          });
        }

        // Validate file type (PDF only) - check both MIME type and extension
        const allowedMimeTypes = ['application/pdf'];
        const allowedExtensions = ['.pdf'];
        const fileExtension = path.extname(data.filename).toLowerCase();

        if (!allowedMimeTypes.includes(data.mimetype) || !allowedExtensions.includes(fileExtension)) {
          return reply.status(400).send({
            success: false,
            error: "Only PDF files are allowed"
          });
        }

        // Get file buffer and validate size
        const fileBuffer = await data.toBuffer();
        const maxSizeBytes = (instance.max_file_size_mb || 10) * 1024 * 1024;

        if (fileBuffer.length > maxSizeBytes) {
          return reply.status(400).send({
            success: false,
            error: `File size exceeds limit of ${instance.max_file_size_mb || 10}MB`
          });
        }

        // Validate PDF file signature (magic numbers)
        const pdfSignature = fileBuffer.slice(0, 4);
        const validPdfSignatures = [
          Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
        ];

        const isValidPdf = validPdfSignatures.some(signature =>
          pdfSignature.equals(signature)
        );

        if (!isValidPdf) {
          return reply.status(400).send({
            success: false,
            error: "Invalid PDF file format"
          });
        }

        // Sanitize filename to prevent directory traversal
        const sanitizedFilename = data.filename.replace(/[^a-zA-Z0-9.-]/g, '_');

        // Additional security: check for suspicious content
        if (fileBuffer.length < 100) {
          return reply.status(400).send({
            success: false,
            error: "File appears to be corrupted or too small"
          });
        }

        // Generate unique filename using sanitized original name
        const uniqueFilename = `submission-${studentId}-${assignmentId}-${Date.now()}${fileExtension}`;

        // Upload file using file storage service
        const fileStorageService = getFileStorageService();
        const uploadResult = await fileStorageService.uploadFile(fileBuffer, {
          tenantId,
          courseId, // Use the actual courseId
          fileName: uniqueFilename,
          contentType: data.mimetype,
          metadata: {
            originalFileName: sanitizedFilename,
            assignmentId,
            studentId,
            uploadedBy: userId,
            submissionType: 'homework'
          }
        });

        // Create or update submission record
        let submissionId;
        if (existingSubmissionQuery.rows.length > 0) {
          // Update existing submission
          const updateQuery = `
            UPDATE assignment_submissions
            SET
              submitted_file_url = $1,
              submitted_file_name = $2,
              submitted_file_size_mb = $3,
              status = 'in_progress',
              updated_at = NOW()
            WHERE id = $4 AND tenant_id = $5
            RETURNING id
          `;

          const result = await fastify.pg.query(updateQuery, [
            `/api/v1/files/${uploadResult.key}`,
            sanitizedFilename,
            fileBuffer.length / (1024 * 1024),
            existingSubmissionQuery.rows[0].id,
            tenantId
          ]);

          submissionId = result.rows[0].id;
        } else {
          // Create new submission
          const insertQuery = `
            INSERT INTO assignment_submissions (
              tenant_id, assignment_id, student_id, attempt_number,
              submitted_file_url, submitted_file_name, submitted_file_size_mb,
              status, is_late
            ) VALUES (
              $1, $2, $3, 1, $4, $5, $6, 'in_progress', $7
            ) RETURNING id
          `;

          const result = await fastify.pg.query(insertQuery, [
            tenantId,
            assignmentId,
            studentId,
            `/api/v1/files/${uploadResult.key}`,
            sanitizedFilename,
            fileBuffer.length / (1024 * 1024),
            isLate
          ]);

          submissionId = result.rows[0].id;
        }

        return reply.send({
          success: true,
          data: {
            submissionId,
            fileUrl: `/api/v1/files/${uploadResult.key}`,
            fileName: data.filename,
            fileSize: fileBuffer.length,
            sizeMB: (fileBuffer.length / (1024 * 1024)).toFixed(2),
            isLate,
            status: 'in_progress'
          },
          message: "File uploaded successfully. Use the submit endpoint to finalize your submission."
        });

      } catch (error) {
        console.error('Error uploading submission file:', error);
        return reply.status(500).send({
          success: false,
          error: "Error uploading file"
        });
      }
    },
  });

  // GET /api/v1/teacher/corrections - Get all submissions for teacher's assignments
  fastify.get("/teacher/corrections", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["submitted", "graded", "all"] },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 }
        }
      }
    },
    handler: async (request: any, reply: any) => {
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;
      const { assignmentId, classId, status = "all", page = 1, limit = 20 } = request.query as any;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant ID is required"
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Authentication required"
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get teacher ID from user ID
        const teacherQuery = await fastify.pg.query(
          'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        if (teacherQuery.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "Teacher not found"
          });
        }

        const teacherId = teacherQuery.rows[0].id;

        // Build query conditions
        // Include submissions where teacher is assigned in assignments table OR assignment_instances table
        let whereConditions = ['(a.teacher_id = $1 OR ai.teacher_id = $1)', 'a.tenant_id = $2'];
        let queryParams = [teacherId, tenantId];
        let paramIndex = 3;

        if (assignmentId) {
          whereConditions.push(`a.id = $${paramIndex}`);
          queryParams.push(assignmentId);
          paramIndex++;
        }

        if (classId) {
          whereConditions.push(`se.class_id = $${paramIndex}`);
          queryParams.push(classId);
          paramIndex++;
        }

        if (status !== "all") {
          whereConditions.push(`s.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        } else {
          // Only show submitted and graded submissions
          whereConditions.push(`s.status IN ('submitted', 'graded')`);
        }

        // Main query to get submissions with assignment and student info
        // Join with student_enrollments to get class information from student's enrollment
        const submissionsQuery = `
          SELECT
            s.id as submission_id,
            s.assignment_id,
            s.student_id,
            s.submitted_file_url,
            s.submitted_file_name,
            s.submitted_file_size_mb,
            s.manual_score,
            s.final_score,
            s.feedback,
            s.status,
            s.submitted_at,
            s.graded_at,
            s.is_late,
            a.id as assignment_id,
            a.title as assignment_title,
            a.type as assignment_type,
            a.max_file_size_mb,
            c.id as course_id,
            c.name as course_name,
            c.code as course_code,
            cl.id as class_id,
            cl.name as class_name,
            st.student_number as student_number,
            u.first_name as student_first_name,
            u.last_name as student_last_name,
            u.email as student_email
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN courses c ON a.course_id = c.id
          JOIN student_profiles st ON s.student_id = st.id
          JOIN users u ON st.user_id = u.id
          LEFT JOIN student_enrollments se ON st.id = se.student_id AND se.tenant_id = s.tenant_id
          LEFT JOIN classes cl ON se.class_id = cl.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY s.submitted_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(limit, (page - 1) * limit);

        const submissionsResult = await fastify.pg.query(submissionsQuery, queryParams);

        // Get total count for pagination
        const countQuery = `
          SELECT COUNT(*) as total
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN student_profiles st ON s.student_id = st.id
          LEFT JOIN student_enrollments se ON st.id = se.student_id AND se.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(' AND ')}
        `;

        const countResult = await fastify.pg.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        // Format submissions data
        const submissions = submissionsResult.rows.map((row: any) => ({
          id: row.submission_id,
          assignment: {
            id: row.assignment_id,
            title: row.assignment_title,
            type: row.assignment_type,
            max_file_size_mb: row.max_file_size_mb
          },
          course: {
            id: row.course_id,
            name: row.course_name,
            code: row.course_code
          },
          class: row.class_id ? {
            id: row.class_id,
            name: row.class_name
          } : null,
          student: {
            id: row.student_id,
            number: row.student_number,
            first_name: row.student_first_name,
            last_name: row.student_last_name,
            email: row.student_email,
            full_name: `${row.student_first_name} ${row.student_last_name}`
          },
          file: {
            url: row.submitted_file_url,
            name: row.submitted_file_name,
            size_mb: row.submitted_file_size_mb ? parseFloat(row.submitted_file_size_mb) : null
          },
          grade: {
            manual_score: row.manual_score ? parseFloat(row.manual_score) : null,
            final_score: row.final_score ? parseFloat(row.final_score) : null,
            feedback: row.feedback
          },
          status: row.status,
          submitted_at: row.submitted_at,
          graded_at: row.graded_at,
          is_late: row.is_late
        }));

        return reply.send({
          success: true,
          data: {
            submissions,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit)
            }
          }
        });

      } catch (error) {
        console.error('Error fetching teacher corrections:', error);
        return reply.status(500).send({
          success: false,
          error: "Error fetching submissions"
        });
      }
    },
  });

  // GET /api/v1/submissions/student/grades - Get student's grades (student only)
  fastify.get("/student/grades", {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          courseId: { type: 'string' },
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 }
        }
      }
    },
    handler: async (request: any, reply: any) => {
    try {
      const { courseId, limit = 50, offset = 0 } = request.query as any;
      const userId = request.headers['x-user-id'] as string;

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'User ID is required'
        });
      }

      // Build the query
      let query = `
        SELECT
          s.id,
          s.final_score,
          s.feedback,
          s.submitted_at,
          s.graded_at,
          s.is_late,
          a.id as assignment_id,
          a.title as assignment_title,
          a.type as assignment_type,
          c.id as course_id,
          c.name as course_name,
          c.code as course_code
        FROM assignment_submissions s
        JOIN assignment_instances ai ON s.assignment_instance_id = ai.id
        JOIN assignments a ON ai.assignment_id = a.id
        JOIN courses c ON ai.course_id = c.id
        WHERE s.student_id = $1
          AND s.status = 'graded'
          AND s.final_score IS NOT NULL
      `;

      const queryParams: any[] = [userId];
      let paramIndex = 2;

      if (courseId) {
        query += ` AND c.id = $${paramIndex}`;
        queryParams.push(courseId);
        paramIndex++;
      }

      query += ` ORDER BY s.graded_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit, offset);

      const result = await fastify.pg.query(query, queryParams);

      // Get statistics
      let statsQuery = `
        SELECT
          COUNT(*) as total_assignments,
          COUNT(CASE WHEN s.status = 'graded' THEN 1 END) as graded_assignments,
          AVG(CASE WHEN s.final_score IS NOT NULL THEN s.final_score END) as average_score,
          MAX(s.final_score) as best_score
        FROM assignment_submissions s
        JOIN assignment_instances ai ON s.assignment_instance_id = ai.id
        JOIN assignments a ON ai.assignment_id = a.id
        JOIN courses c ON ai.course_id = c.id
        WHERE s.student_id = $1
      `;

      const statsParams = [userId];
      if (courseId) {
        statsQuery += ` AND c.id = $2`;
        statsParams.push(courseId);
      }

      const statsResult = await fastify.pg.query(statsQuery, statsParams);

      const grades = result.rows.map((row: any) => ({
        id: row.id,
        assignment: {
          id: row.assignment_id,
          title: row.assignment_title,
          type: row.assignment_type
        },
        course: {
          id: row.course_id,
          name: row.course_name,
          code: row.course_code
        },
        grade: {
          final_score: row.final_score,
          feedback: row.feedback
        },
        submitted_at: row.submitted_at,
        graded_at: row.graded_at,
        is_late: row.is_late
      }));

      const stats = statsResult.rows[0] || {};

      return reply.send({
        success: true,
        data: {
          grades,
          stats: {
            total_assignments: parseInt(stats.total_assignments) || 0,
            graded_assignments: parseInt(stats.graded_assignments) || 0,
            average_score: parseFloat(stats.average_score) || 0,
            best_score: parseFloat(stats.best_score) || 0
          }
        }
      });

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch grades'
      });
    }
    }
  });

  // POST /api/v1/submissions/:submissionId/grade - Grade a submission (teacher only)
  fastify.post("/:submissionId/grade", {
    schema: {
      params: {
        type: "object",
        properties: {
          submissionId: { type: "string", format: "uuid" },
        },
        required: ["submissionId"],
      },
      body: {
        type: "object",
        properties: {
          score: { type: "number", minimum: 0, maximum: 20 },
          feedback: { type: "string" }
        },
        required: ["score"]
      }
    },
    handler: async (request: any, reply: any) => {
      const { submissionId } = request.params as { submissionId: string };
      const { score, feedback } = request.body as { score: number; feedback?: string };
      const tenantId = request.tenantId;
      const userId = (request as any).user?.id;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: "Tenant ID is required"
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Authentication required"
        });
      }

      // Validate score
      if (score < 0 || score > 20) {
        return reply.status(400).send({
          success: false,
          error: "Score must be between 0 and 20"
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get teacher ID from user ID
        const teacherQuery = await fastify.pg.query(
          'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
          [userId, tenantId]
        );

        if (teacherQuery.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: "Teacher not found"
          });
        }

        const teacherId = teacherQuery.rows[0].id;

        // Check if submission exists and teacher owns the assignment
        const submissionQuery = await fastify.pg.query(`
          SELECT
            s.*,
            a.teacher_id,
            a.title as assignment_title,
            st.student_number as student_number,
            u.first_name as student_first_name,
            u.last_name as student_last_name
          FROM assignment_submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN student_profiles st ON s.student_id = st.id
          JOIN users u ON st.user_id = u.id
          WHERE s.id = $1 AND s.tenant_id = $2
        `, [submissionId, tenantId]);

        if (submissionQuery.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Submission not found"
          });
        }

        const submission = submissionQuery.rows[0];

        // Check if teacher owns this assignment
        if (submission.teacher_id !== teacherId) {
          return reply.status(403).send({
            success: false,
            error: "You can only grade submissions for your own assignments"
          });
        }

        if (!submissionIsGradable(submission)) {
          return reply.status(400).send({
            success: false,
            error:
              submission.status === "in_progress"
                ? "Impossible de noter : aucun fichier ou date de remise — l'élève doit envoyer le devoir ou déposer un travail."
                : "Seules les soumissions envoyées ou déjà notées peuvent être corrigées.",
          });
        }

        // Update submission with grade
        const updateQuery = `
          UPDATE assignment_submissions
          SET
            manual_score = $1,
            final_score = $1,
            feedback = $2,
            status = 'graded',
            graded_at = NOW(),
            graded_by = $3,
            updated_at = NOW()
          WHERE id = $4 AND tenant_id = $5
          RETURNING *
        `;

        const result = await fastify.pg.query(updateQuery, [
          score,
          feedback || null,
          userId,
          submissionId,
          tenantId
        ]);

        const gradedSubmission = result.rows[0];

        return reply.send({
          success: true,
          data: {
            id: gradedSubmission.id,
            assignment_title: submission.assignment_title,
            student: {
              number: submission.student_number,
              name: `${submission.student_first_name} ${submission.student_last_name}`
            },
            grade: {
              score: parseFloat(gradedSubmission.final_score),
              feedback: gradedSubmission.feedback
            },
            status: gradedSubmission.status,
            graded_at: gradedSubmission.graded_at
          },
          message: "Submission graded successfully"
        });

      } catch (error) {
        console.error('Error grading submission:', error);
        return reply.status(500).send({
          success: false,
          error: "Error grading submission"
        });
      }
    },
  });
}
