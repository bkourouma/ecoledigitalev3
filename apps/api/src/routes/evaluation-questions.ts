import { FastifyInstance } from "fastify";
import { z } from "zod";

const QuestionSchema = z.object({
  id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank']),
  question_text: z.string(),
  options: z.array(z.string()).optional(),
  correct_answer: z.any().optional(),
  points: z.number().positive(),
  order_index: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

const QuestionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(QuestionSchema)
});

export async function evaluationQuestionsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/assignments/:assignmentId/questions - Get questions for an evaluation
  fastify.get("/:assignmentId/questions", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" }
        },
        required: ["assignmentId"]
      }
    },
    handler: async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;
      const authUserId = (request as any).userId || (request as any).user?.id;
      const userIdHeader = (authUserId as string) || (request.headers['x-user-id'] as string);

      // Resolve tenantId properly (convert slug to UUID if needed)
      let resolvedTenantId = tenantId;
      if (tenantId === 'imhotepacademy') {
        resolvedTenantId = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
      }

      if (!resolvedTenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant ID requis'
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', resolvedTenantId]);

        // Verify assignment exists and get details
        // For students, we need to check the assignment_instance dates, not the base assignment dates
        let assignment: any;
        let instanceEndDate: Date | null = null;
        
        // First, check if user is a student and get their instance
        if (userIdHeader) {
          const studentInstanceCheck = await fastify.pg.query(`
            SELECT 
              a.id, 
              a.type, 
              a.status,
              a.title,
              ai.ends_at as instance_ends_at,
              ai.starts_at as instance_starts_at,
              a.ends_at as assignment_ends_at,
              c.name as course_name,
              c.code as course_code
            FROM assignments a
            JOIN courses c ON a.course_id = c.id
            JOIN assignment_instances ai ON a.id = ai.assignment_id
            JOIN student_enrollments se ON ai.class_id = se.class_id
            JOIN student_profiles sp ON se.student_id = sp.id
            WHERE a.id = $1 
              AND a.tenant_id = $2
              AND sp.user_id = $3
              AND se.status = 'active'
            LIMIT 1
          `, [assignmentId, resolvedTenantId, userIdHeader]);

          if (studentInstanceCheck.rows.length > 0) {
            // User is a student, use instance dates
            assignment = studentInstanceCheck.rows[0];
            instanceEndDate = new Date(assignment.instance_ends_at);
            // Override ends_at with instance date for students
            assignment.ends_at = assignment.instance_ends_at;
          }
        }
        
        // If no student instance found, check if user is a teacher or fetch base assignment
        if (!assignment) {
          const assignmentCheck = await fastify.pg.query(`
            SELECT 
              a.id, 
              a.type, 
              a.status,
              a.title,
              a.ends_at,
              c.name as course_name,
              c.code as course_code
            FROM assignments a
            JOIN courses c ON a.course_id = c.id
            WHERE a.id = $1 AND a.tenant_id = $2
          `, [assignmentId, resolvedTenantId]);

          if (assignmentCheck.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: 'Évaluation non trouvée'
            });
          }

          assignment = assignmentCheck.rows[0];
        }
        
        // Only return questions for evaluation type assignments
        if (assignment.type !== 'evaluation') {
          return reply.status(400).send({
            success: false,
            error: 'Cette assignation n\'est pas une évaluation en ligne',
            assignment_type: assignment.type
          });
        }

        // Check if assignment is published (allow teachers to access draft assignments)
        if (assignment.status !== 'published') {
          // TEMPORARY: Allow access for development/testing
          if (process.env.NODE_ENV === 'development' && request.headers['x-dev-auth'] === '1') {
            console.log('🔓 DEV MODE: Allowing access to draft assignment');
          } else {
            // Allow teachers to access draft assignments for editing
            if (userIdHeader) {
              const teacherCheck = await fastify.pg.query(`
                SELECT COUNT(*) as count
                FROM teachers t
                WHERE t.user_id = $1 AND t.tenant_id = $2
              `, [userIdHeader, resolvedTenantId]);

              if (parseInt(teacherCheck.rows[0].count) === 0) {
                return reply.status(403).send({
                  success: false,
                  error: 'Cette évaluation n\'est pas encore publiée',
                  status: assignment.status
                });
              }
            } else {
              return reply.status(403).send({
                success: false,
                error: 'Cette évaluation n\'est pas encore publiée',
                status: assignment.status
              });
            }
          }
        }

        // Check if assignment is still active (not expired) - allow teachers to access expired assignments for editing
        const now = new Date();
        const endDate = new Date(assignment.ends_at);
        if (now > endDate) {
          // TEMPORARY: Allow access for development/testing
          if (process.env.NODE_ENV === 'development' && request.headers['x-dev-auth'] === '1') {
            console.log('🔓 DEV MODE: Allowing access to expired assignment');
          } else {
            // Allow teachers to access expired assignments for editing
            if (userIdHeader) {
              const teacherCheck = await fastify.pg.query(`
                SELECT COUNT(*) as count
                FROM teachers t
                WHERE t.user_id = $1 AND t.tenant_id = $2
              `, [userIdHeader, resolvedTenantId]);

              if (parseInt(teacherCheck.rows[0].count) === 0) {
                return reply.status(403).send({
                  success: false,
                  error: 'Cette évaluation a expiré',
                  ended_at: assignment.ends_at
                });
              }
            } else {
              return reply.status(403).send({
                success: false,
                error: 'Cette évaluation a expiré',
                ended_at: assignment.ends_at
              });
            }
          }
        }

        // Check if user has permission to access this assignment
        // For students: check if they are enrolled in a class that has this assignment
        // For teachers: check if they created this assignment
        if (userIdHeader) {
          // TEMPORARY: Skip permission check in development mode
          if (process.env.NODE_ENV === 'development' && request.headers['x-dev-auth'] === '1') {
            console.log('🔓 DEV MODE: Skipping permission check');
          } else {
            // First check if user is a teacher and created this assignment
            const teacherPermissionCheck = await fastify.pg.query(`
              SELECT COUNT(*) as count
              FROM assignments a
              JOIN teachers t ON a.teacher_id = t.id
              WHERE a.id = $1 
                AND t.user_id = $2 
                AND a.tenant_id = $3
            `, [assignmentId, userIdHeader, resolvedTenantId]);

            if (parseInt(teacherPermissionCheck.rows[0].count) === 0) {
              // If not a teacher, check student permissions
              const studentPermissionCheck = await fastify.pg.query(`
                SELECT COUNT(*) as count
                FROM assignment_instances ai
                JOIN student_enrollments se ON ai.class_id = se.class_id
                JOIN student_profiles sp ON se.student_id = sp.id
                WHERE ai.assignment_id = $1 
                  AND sp.user_id = $2 
                  AND se.status = 'active'
                  AND ai.tenant_id = $3
              `, [assignmentId, userIdHeader, resolvedTenantId]);

              if (parseInt(studentPermissionCheck.rows[0].count) === 0) {
                return reply.status(403).send({
                  success: false,
                  error: 'Vous n\'avez pas accès à cette évaluation'
                });
              }
            }
          }
        }

        // Get questions for the assignment
        const questionsQuery = `
          SELECT 
            eq.id,
            eq.assignment_id,
            eq.type,
            eq.question_text,
            eq.options,
            eq.correct_answer,
            eq.points,
            eq.order_index,
            eq.created_at,
            eq.updated_at
          FROM evaluation_questions eq
          WHERE eq.assignment_id = $1 AND eq.tenant_id = $2
          ORDER BY eq.order_index ASC
        `;

        const questionsResult = await fastify.pg.query(questionsQuery, [assignmentId, resolvedTenantId]);
        
        const questions = questionsResult.rows.map(row => ({
          id: row.id,
          assignment_id: row.assignment_id,
          type: row.type,
          question_text: row.question_text,
          options: row.options || [],
          correct_answer: row.correct_answer,
          points: row.points,
          order_index: row.order_index,
          created_at: row.created_at,
          updated_at: row.updated_at
        }));

        // Return assignment info along with questions
        return reply.send({
          success: true,
          data: questions,
          assignment: {
            id: assignment.id,
            title: assignment.title,
            course_name: assignment.course_name,
            course_code: assignment.course_code,
            ends_at: assignment.ends_at,
            type: assignment.type,
            status: assignment.status
          },
          meta: {
            total_questions: questions.length,
            total_points: questions.reduce((sum, q) => sum + parseFloat(q.points), 0)
          }
        });

      } catch (error) {
        console.error('Error fetching evaluation questions:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des questions'
        });
      }
    }
  });

  // POST /api/v1/assignments/:assignmentId/questions - Create a new question
  fastify.post("/:assignmentId/questions", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" }
        },
        required: ["assignmentId"]
      },
      body: {
        type: "object",
        properties: {
          type: { type: "string", enum: ['single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank'] },
          question_text: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_answer: {}, // Can be string, number, or array
          points: { type: "number", minimum: 0 },
          order_index: { type: "number", minimum: 0 },
          ai_generated: { type: "boolean" }
        },
        required: ["type", "question_text", "points"]
      }
    },
    handler: async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;

      // Resolve tenantId properly (convert slug to UUID if needed)
      let resolvedTenantId = tenantId;
      if (tenantId === 'imhotepacademy') {
        resolvedTenantId = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
      }
      const body = request.body as any;

      if (!resolvedTenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant ID requis'
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', resolvedTenantId]);

        // Verify assignment exists and is an evaluation
        const assignmentCheck = await fastify.pg.query(`
          SELECT id, type, status
          FROM assignments
          WHERE id = $1 AND tenant_id = $2
        `, [assignmentId, resolvedTenantId]);

        if (assignmentCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Assignment non trouvé'
          });
        }

        const assignment = assignmentCheck.rows[0];

        if (assignment.type !== 'evaluation') {
          return reply.status(400).send({
            success: false,
            error: 'Seules les évaluations peuvent avoir des questions',
            assignment_type: assignment.type
          });
        }

        // Get the next order_index if not provided
        let orderIndex = body.order_index;
        if (orderIndex === undefined) {
          const maxOrderResult = await fastify.pg.query(`
            SELECT COALESCE(MAX(order_index), -1) + 1 as next_order
            FROM evaluation_questions
            WHERE assignment_id = $1 AND tenant_id = $2
          `, [assignmentId, resolvedTenantId]);
          orderIndex = maxOrderResult.rows[0].next_order;
        }

        // Insert the question
        const insertQuery = `
          INSERT INTO evaluation_questions (
            tenant_id,
            assignment_id,
            type,
            question_text,
            options,
            correct_answer,
            points,
            order_index,
            ai_generated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `;

        // For short_text and fill_blank, correct_answer is a string and should be stored as JSON string
        // For other types (single_choice, multiple_choice, true_false), it's a number, boolean, or array
        // JSON.stringify handles all these cases correctly
        const correctAnswerToStore = typeof body.correct_answer === 'string' 
          ? JSON.stringify(body.correct_answer)  // String needs to be JSON stringified
          : JSON.stringify(body.correct_answer); // Other types also need JSON stringification

        const result = await fastify.pg.query(insertQuery, [
          resolvedTenantId,
          assignmentId,
          body.type,
          body.question_text,
          JSON.stringify(body.options || []),
          correctAnswerToStore,
          body.points || 1,
          orderIndex,
          body.ai_generated || false
        ]);

        const question = result.rows[0];

        // Parse correct_answer safely
        // For short_text and fill_blank, correct_answer is stored as a JSON string
        // For other types, it might be a number, boolean, or array
        let parsedCorrectAnswer = question.correct_answer;
        if (typeof question.correct_answer === 'string') {
          try {
            // Try to parse as JSON first
            const parsed = JSON.parse(question.correct_answer);
            parsedCorrectAnswer = parsed;
          } catch (e) {
            // If parsing fails, check if it's a valid JSON string that needs unescaping
            // For example, if stored as "\"string\"" it should be parsed
            // But if it's already a plain string, use it as-is
            // This handles the case where PostgreSQL returns the JSON string as-is
            try {
              // Try wrapping in quotes and parsing (handles unescaped JSON strings)
              if (question.correct_answer.startsWith('"') && question.correct_answer.endsWith('"')) {
                parsedCorrectAnswer = JSON.parse(question.correct_answer);
              } else {
                // It's a plain string, use as-is
                parsedCorrectAnswer = question.correct_answer;
              }
            } catch (e2) {
              // Final fallback: use as-is
              parsedCorrectAnswer = question.correct_answer;
            }
          }
        }

        return reply.status(201).send({
          success: true,
          data: {
            id: question.id,
            assignment_id: question.assignment_id,
            type: question.type,
            question_text: question.question_text,
            options: typeof question.options === 'string' ? JSON.parse(question.options) : question.options,
            correct_answer: parsedCorrectAnswer,
            points: question.points,
            order_index: question.order_index,
            created_at: question.created_at,
            updated_at: question.updated_at
          }
        });

      } catch (error) {
        console.error('Error creating question:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création de la question',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  });

  // POST /api/v1/assignments/:assignmentId/questions/bulk-placeholders - Create bulk placeholder questions
  fastify.post("/:assignmentId/questions/bulk-placeholders", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" }
        },
        required: ["assignmentId"]
      },
      body: {
        type: "object",
        properties: {
          single_choice: { type: "number", minimum: 0 },
          multiple_choice: { type: "number", minimum: 0 },
          true_false: { type: "number", minimum: 0 },
          short_text: { type: "number", minimum: 0 },
          fill_blank: { type: "number", minimum: 0 },
          default_points: { type: "number", minimum: 0, default: 1 }
        }
      }
    },
    handler: async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;

      // Resolve tenantId properly (convert slug to UUID if needed)
      let resolvedTenantId = tenantId;
      if (tenantId === 'imhotepacademy') {
        resolvedTenantId = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
      }
      const body = request.body as any;

      if (!resolvedTenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant ID requis'
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', resolvedTenantId]);

        // Verify assignment exists and is an evaluation
        const assignmentCheck = await fastify.pg.query(`
          SELECT id, type, status
          FROM assignments
          WHERE id = $1 AND tenant_id = $2
        `, [assignmentId, resolvedTenantId]);

        if (assignmentCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Assignment non trouvé'
          });
        }

        const assignment = assignmentCheck.rows[0];

        if (assignment.type !== 'evaluation') {
          return reply.status(400).send({
            success: false,
            error: 'Seules les évaluations peuvent avoir des questions',
            assignment_type: assignment.type
          });
        }

        // Get current max order_index to continue from there
        const maxOrderResult = await fastify.pg.query(`
          SELECT COALESCE(MAX(order_index), -1) as max_order
          FROM evaluation_questions
          WHERE assignment_id = $1 AND tenant_id = $2
        `, [assignmentId, resolvedTenantId]);
        
        let currentOrderIndex = maxOrderResult.rows[0].max_order + 1;
        const defaultPoints = body.default_points || 1;
        const questionIds: string[] = [];

        // Create placeholder questions based on counts
        const questionTypes = [
          { type: 'single_choice', count: body.single_choice || 0, placeholder: 'Question QCM (choix unique) - À éditer' },
          { type: 'multiple_choice', count: body.multiple_choice || 0, placeholder: 'Question choix multiple - À éditer' },
          { type: 'true_false', count: body.true_false || 0, placeholder: 'Question Vrai/Faux - À éditer' },
          { type: 'short_text', count: body.short_text || 0, placeholder: 'Question réponse courte - À éditer' },
          { type: 'fill_blank', count: body.fill_blank || 0, placeholder: 'Question texte à trou - À éditer' }
        ];

        for (const questionType of questionTypes) {
          for (let i = 0; i < questionType.count; i++) {
            // Prepare options and correct_answer based on question type
            let options = [];
            let correct_answer = null;

            switch (questionType.type) {
              case 'single_choice':
              case 'multiple_choice':
                options = ['Option A', 'Option B', 'Option C', 'Option D'];
                correct_answer = questionType.type === 'single_choice' ? 0 : [0]; // First option selected by default
                break;
              case 'true_false':
                options = ['Vrai', 'Faux'];
                correct_answer = 0; // Vrai by default
                break;
              case 'short_text':
              case 'fill_blank':
                options = [];
                correct_answer = 'Réponse attendue';
                break;
            }

            const insertQuery = `
              INSERT INTO evaluation_questions (
                tenant_id,
                assignment_id,
                type,
                question_text,
                options,
                correct_answer,
                points,
                order_index,
                ai_generated
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING id
            `;

            const result = await fastify.pg.query(insertQuery, [
              resolvedTenantId,
              assignmentId,
              questionType.type,
              `${questionType.placeholder} ${i + 1}`,
              JSON.stringify(options),
              JSON.stringify(correct_answer),
              defaultPoints,
              currentOrderIndex++,
              false
            ]);

            questionIds.push(result.rows[0].id);
          }
        }

        if (questionIds.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Aucune question à créer. Veuillez spécifier au moins un type de question avec un nombre > 0.'
          });
        }

        return reply.status(201).send({
          success: true,
          message: `${questionIds.length} questions placeholder créées avec succès`,
          question_ids: questionIds,
          count: questionIds.length
        });

      } catch (error) {
        console.error('Error creating bulk placeholders:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création des questions placeholder',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  });

  // PUT /api/v1/assignments/:assignmentId/questions/:questionId - Update a question
  fastify.put("/:assignmentId/questions/:questionId", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          questionId: { type: "string", format: "uuid" }
        },
        required: ["assignmentId", "questionId"]
      },
      body: {
        type: "object",
        properties: {
          type: { type: "string", enum: ['single_choice', 'multiple_choice', 'true_false', 'short_text', 'fill_blank'] },
          question_text: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_answer: {},
          points: { type: "number", minimum: 0 },
          order_index: { type: "number", minimum: 0 }
        }
      }
    },
    handler: async (request, reply) => {
      const { assignmentId, questionId } = request.params as { assignmentId: string; questionId: string };
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;

      // Resolve tenantId properly (convert slug to UUID if needed)
      let resolvedTenantId = tenantId;
      if (tenantId === 'imhotepacademy') {
        resolvedTenantId = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
      }
      const body = request.body as any;

      if (!resolvedTenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant ID requis'
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', resolvedTenantId]);

        // Build update query dynamically based on provided fields
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (body.type !== undefined) {
          updates.push(`type = $${paramIndex++}`);
          values.push(body.type);
        }
        if (body.question_text !== undefined) {
          updates.push(`question_text = $${paramIndex++}`);
          values.push(body.question_text);
        }
        if (body.options !== undefined) {
          updates.push(`options = $${paramIndex++}`);
          values.push(JSON.stringify(body.options));
        }
        if (body.correct_answer !== undefined) {
          updates.push(`correct_answer = $${paramIndex++}`);
          values.push(JSON.stringify(body.correct_answer));
        }
        if (body.points !== undefined) {
          updates.push(`points = $${paramIndex++}`);
          values.push(body.points);
        }
        if (body.order_index !== undefined) {
          updates.push(`order_index = $${paramIndex++}`);
          values.push(body.order_index);
        }

        if (updates.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Aucune donnée à mettre à jour'
          });
        }

        updates.push(`updated_at = NOW()`);
        values.push(questionId, assignmentId, resolvedTenantId);

        const updateQuery = `
          UPDATE evaluation_questions
          SET ${updates.join(', ')}
          WHERE id = $${paramIndex++} AND assignment_id = $${paramIndex++} AND tenant_id = $${paramIndex++}
          RETURNING *
        `;

        const result = await fastify.pg.query(updateQuery, values);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Question non trouvée'
          });
        }

        const question = result.rows[0];

        return reply.send({
          success: true,
          data: {
            id: question.id,
            assignment_id: question.assignment_id,
            type: question.type,
            question_text: question.question_text,
            options: typeof question.options === 'string' ? JSON.parse(question.options) : question.options,
            correct_answer: typeof question.correct_answer === 'string' ? JSON.parse(question.correct_answer) : question.correct_answer,
            points: question.points,
            order_index: question.order_index,
            created_at: question.created_at,
            updated_at: question.updated_at
          }
        });

      } catch (error) {
        console.error('Error updating question:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour de la question'
        });
      }
    }
  });

  // DELETE /api/v1/assignments/:assignmentId/questions/:questionId - Delete a question
  fastify.delete("/:assignmentId/questions/:questionId", {
    schema: {
      params: {
        type: "object",
        properties: {
          assignmentId: { type: "string", format: "uuid" },
          questionId: { type: "string", format: "uuid" }
        },
        required: ["assignmentId", "questionId"]
      }
    },
    handler: async (request, reply) => {
      const { assignmentId, questionId } = request.params as { assignmentId: string; questionId: string };
      const tenantId = (request as any).tenantId || request.headers['x-tenant'] as string;

      // Resolve tenantId properly (convert slug to UUID if needed)
      let resolvedTenantId = tenantId;
      if (tenantId === 'imhotepacademy') {
        resolvedTenantId = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
      }

      if (!resolvedTenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant ID requis'
        });
      }

      try {
        // Set tenant context for RLS
        await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', resolvedTenantId]);

        const deleteQuery = `
          DELETE FROM evaluation_questions
          WHERE id = $1 AND assignment_id = $2 AND tenant_id = $3
          RETURNING *
        `;

        const result = await fastify.pg.query(deleteQuery, [questionId, assignmentId, resolvedTenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Question non trouvée'
          });
        }

        return reply.send({
          success: true,
          message: 'Question supprimée avec succès'
        });

      } catch (error) {
        console.error('Error deleting question:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la suppression de la question'
        });
      }
    }
  });
}