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

// Schema for creating a conversation
const CreateConversationSchema = z.object({
  studentId: z.string().uuid(),
  subject: z.string().min(1).max(255),
  content: z.string().min(1),
});

// Schema for replying to a conversation
const ReplyConversationSchema = z.object({
  content: z.string().min(1),
});

export async function teacherConversationsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/teacher/conversations - List all conversations for the authenticated teacher
  fastify.get('/', {
    schema: {
      tags: ['Teacher Conversations'],
      summary: 'List all conversation threads for the authenticated teacher',
      querystring: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          parentId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['active', 'archived', 'closed'] },
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
                conversations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      parentId: { type: 'string', format: 'uuid' },
                      parentName: { type: 'string' },
                      teacherId: { type: 'string', format: 'uuid' },
                      studentId: { type: 'string', format: 'uuid' },
                      studentName: { type: 'string' },
                      subject: { type: 'string' },
                      status: { type: 'string', enum: ['active', 'archived', 'closed'] },
                      lastMessagePreview: { type: 'string', nullable: true },
                      lastMessageDate: { type: 'string' },
                      unreadCount: { type: 'number' },
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
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { studentId, parentId, status, page = 1, limit = 20 } = request.query as {
        studentId?: string;
        parentId?: string;
        status?: 'active' | 'archived' | 'closed';
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

      // Check if user has teacher role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires teacher role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify teacher exists
        const teacherInfo = await pool.query(`
          SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
        `, [userId, tenantId]);

        if (teacherInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Teacher profile not found',
          });
        }

        // Build query with filters
        const whereConditions = [
          'ptc.teacher_id = $1',
          'ptc.tenant_id = $2',
        ];
        const queryParams: any[] = [userId, tenantId];
        let paramIndex = 3;

        // Filter by student
        if (studentId) {
          // Verify teacher is assigned to this student (via teacher_assignments -> classes -> student_enrollments)
          const assignmentCheck = await pool.query(`
            SELECT ta.id
            FROM teacher_assignments ta
            JOIN class_courses cc ON ta.class_course_id = cc.id
            JOIN classes cl ON cc.class_id = cl.id
            JOIN student_enrollments se ON se.class_id = cl.id
            WHERE ta.teacher_id = (
              SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
            )
            AND se.student_id = $3
            AND ta.tenant_id = $2
            LIMIT 1
          `, [userId, tenantId, studentId]);

          if (assignmentCheck.rows.length === 0) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Student not assigned to teacher',
            });
          }

          whereConditions.push(`ptc.student_id = $${paramIndex}`);
          queryParams.push(studentId);
          paramIndex++;
        }

        // Filter by parent
        if (parentId) {
          whereConditions.push(`ptc.parent_id = $${paramIndex}`);
          queryParams.push(parentId);
          paramIndex++;
        }

        // Filter by status
        if (status) {
          whereConditions.push(`ptc.status = $${paramIndex}`);
          queryParams.push(status);
          paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total conversations
        const countQuery = `
          SELECT COUNT(*) as total
          FROM parent_teacher_conversations ptc
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query conversations with pagination
        const conversationsQuery = `
          SELECT 
            ptc.id as conversation_id,
            ptc.parent_id,
            ptc.teacher_id,
            ptc.student_id,
            ptc.subject,
            ptc.status,
            ptc.created_at,
            ptc.updated_at as last_message_date,
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name,
            sp.id as student_profile_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            (
              SELECT COUNT(*) 
              FROM conversation_messages cm 
              WHERE cm.conversation_id = ptc.id 
              AND cm.read_at IS NULL 
              AND cm.sender_id != $1
            ) as unread_count,
            (
              SELECT content 
              FROM conversation_messages cm 
              WHERE cm.conversation_id = ptc.id 
              ORDER BY cm.sent_at DESC 
              LIMIT 1
            ) as last_message_preview
          FROM parent_teacher_conversations ptc
          JOIN users p ON ptc.parent_id = p.id
          JOIN student_profiles sp ON ptc.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          ${whereClause}
          ORDER BY ptc.updated_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const conversationsResult = await pool.query(conversationsQuery, [...queryParams, limit, offset]);

        const conversations = conversationsResult.rows.map((row: any) => ({
          id: row.conversation_id,
          parentId: row.parent_id,
          parentName: row.parent_name,
          teacherId: row.teacher_id,
          studentId: row.student_id,
          studentName: row.student_name,
          subject: row.subject,
          status: row.status,
          lastMessagePreview: row.last_message_preview,
          lastMessageDate: row.last_message_date,
          unreadCount: parseInt(row.unread_count || '0', 10),
          createdAt: row.created_at,
          updatedAt: row.last_message_date,
        }));

        return reply.send({
          success: true,
          data: {
            conversations,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching teacher conversations',
          userId,
          tenantId,
          error: error.message,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // GET /api/v1/teacher/conversations/:conversationId - Get conversation thread with all messages
  fastify.get('/:conversationId', {
    schema: {
      tags: ['Teacher Conversations'],
      summary: 'Get conversation thread with all messages',
      params: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', format: 'uuid' },
        },
        required: ['conversationId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                conversation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    parentName: { type: 'string' },
                    teacherId: { type: 'string', format: 'uuid' },
                    studentId: { type: 'string', format: 'uuid' },
                    studentName: { type: 'string' },
                    subject: { type: 'string' },
                    status: { type: 'string', enum: ['active', 'archived', 'closed'] },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      senderId: { type: 'string', format: 'uuid' },
                      senderName: { type: 'string' },
                      senderRole: { type: 'string', enum: ['parent', 'teacher'] },
                      content: { type: 'string' },
                      sentAt: { type: 'string' },
                      isRead: { type: 'boolean' },
                      readAt: { type: 'string', nullable: true },
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
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { conversationId } = request.params as { conversationId: string };

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

      // Check if user has teacher role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires teacher role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify conversation belongs to teacher
        const conversationCheck = await pool.query(`
          SELECT 
            ptc.id,
            ptc.parent_id,
            ptc.teacher_id,
            ptc.student_id,
            ptc.subject,
            ptc.status,
            ptc.created_at,
            ptc.updated_at,
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name
          FROM parent_teacher_conversations ptc
          JOIN users p ON ptc.parent_id = p.id
          JOIN student_profiles sp ON ptc.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE ptc.id = $1 AND ptc.teacher_id = $2 AND ptc.tenant_id = $3
        `, [conversationId, userId, tenantId]);

        if (conversationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found or access denied',
          });
        }

        const convRow = conversationCheck.rows[0];

        // Get all messages in conversation
        const messagesQuery = `
          SELECT 
            cm.id,
            cm.sender_id,
            cm.content,
            cm.sent_at,
            cm.read_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as sender_name,
            CASE 
              WHEN cm.sender_id = $1 THEN 'teacher'
              ELSE 'parent'
            END as sender_role
          FROM conversation_messages cm
          JOIN users u ON cm.sender_id = u.id
          WHERE cm.conversation_id = $2
          ORDER BY cm.sent_at ASC
        `;
        const messagesResult = await pool.query(messagesQuery, [userId, conversationId]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          senderId: row.sender_id,
          senderName: row.sender_name,
          senderRole: row.sender_role,
          content: row.content,
          sentAt: row.sent_at,
          isRead: row.read_at !== null,
          readAt: row.read_at,
        }));

        // Mark messages as read for teacher
        await pool.query(`
          UPDATE conversation_messages
          SET read_at = NOW()
          WHERE conversation_id = $1 AND sender_id != $2 AND read_at IS NULL
        `, [conversationId, userId]);

        return reply.send({
          success: true,
          data: {
            conversation: {
              id: convRow.id,
              parentId: convRow.parent_id,
              parentName: convRow.parent_name,
              teacherId: convRow.teacher_id,
              studentId: convRow.student_id,
              studentName: convRow.student_name,
              subject: convRow.subject,
              status: convRow.status,
              createdAt: convRow.created_at,
              updatedAt: convRow.updated_at,
            },
            messages,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching conversation thread',
          userId,
          tenantId,
          conversationId,
          error: error.message,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/teacher/conversations - Start a new conversation
  fastify.post('/', {
    schema: {
      tags: ['Teacher Conversations'],
      summary: 'Start a new conversation with a parent',
      body: {
        type: 'object',
        required: ['studentId', 'subject', 'content'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                conversation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    parentName: { type: 'string' },
                    teacherId: { type: 'string', format: 'uuid' },
                    studentId: { type: 'string', format: 'uuid' },
                    studentName: { type: 'string' },
                    subject: { type: 'string' },
                    status: { type: 'string' },
                    createdAt: { type: 'string' },
                  },
                },
                message: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    senderId: { type: 'string', format: 'uuid' },
                    senderName: { type: 'string' },
                    content: { type: 'string' },
                    sentAt: { type: 'string' },
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
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;

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

      // Check if user has teacher role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires teacher role',
        });
      }

      // Validate request body
      const parsed = CreateConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: parsed.error.errors.map(e => e.message).join(', '),
        });
      }

      const { studentId, subject, content } = parsed.data;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify teacher is assigned to student (via teacher_assignments -> classes -> student_enrollments)
        const assignmentCheck = await pool.query(`
          SELECT ta.id
          FROM teacher_assignments ta
          JOIN class_courses cc ON ta.class_course_id = cc.id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN student_enrollments se ON se.class_id = cl.id
          WHERE ta.teacher_id = (
            SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2
          )
          AND se.student_id = $3
          AND ta.tenant_id = $2
          LIMIT 1
        `, [userId, tenantId, studentId]);

        if (assignmentCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'You are not assigned to teach this student',
          });
        }

        // Get student and parent information
        const studentInfo = await pool.query(`
          SELECT 
            sp.id,
            sp.user_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            (SELECT parent_id FROM student_parents WHERE student_id = sp.id AND tenant_id = $1 LIMIT 1) as parent_id
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $2 AND sp.tenant_id = $1
        `, [tenantId, studentId]);

        if (studentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Student not found',
          });
        }

        const student = studentInfo.rows[0];
        const parentId = student.parent_id;

        if (!parentId) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Student has no linked parent',
          });
        }

        // Get parent name
        const parentInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as parent_name
          FROM users
          WHERE id = $1
        `, [parentId]);

        const parentName = parentInfo.rows[0]?.parent_name || 'Parent';

        // Create conversation
        const conversationResult = await pool.query(`
          INSERT INTO parent_teacher_conversations (
            tenant_id,
            parent_id,
            teacher_id,
            student_id,
            subject,
            status
          )
          VALUES ($1, $2, $3, $4, $5, 'active')
          RETURNING id, created_at
        `, [tenantId, parentId, userId, studentId, subject]);

        const conversationId = conversationResult.rows[0].id;
        const createdAt = conversationResult.rows[0].created_at;

        // Create first message
        const messageResult = await pool.query(`
          INSERT INTO conversation_messages (
            tenant_id,
            conversation_id,
            sender_id,
            content
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id, sent_at
        `, [tenantId, conversationId, userId, content]);

        const messageId = messageResult.rows[0].id;
        const sentAt = messageResult.rows[0].sent_at;

        // Get teacher name
        const teacherInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as teacher_name
          FROM users
          WHERE id = $1
        `, [userId]);

        const teacherName = teacherInfo.rows[0]?.teacher_name || 'Teacher';

        return reply.status(201).send({
          success: true,
          data: {
            conversation: {
              id: conversationId,
              parentId,
              parentName,
              teacherId: userId,
              studentId,
              studentName: student.student_name,
              subject,
              status: 'active',
              createdAt,
            },
            message: {
              id: messageId,
              senderId: userId,
              senderName: teacherName,
              content,
              sentAt,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error creating conversation',
          userId,
          tenantId,
          error: error.message,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/teacher/conversations/:conversationId/reply - Reply to a conversation
  fastify.post('/:conversationId/reply', {
    schema: {
      tags: ['Teacher Conversations'],
      summary: 'Reply to a conversation thread',
      params: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', format: 'uuid' },
        },
        required: ['conversationId'],
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1 },
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
                message: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    senderId: { type: 'string', format: 'uuid' },
                    senderName: { type: 'string' },
                    content: { type: 'string' },
                    sentAt: { type: 'string' },
                    isRead: { type: 'boolean' },
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
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { conversationId } = request.params as { conversationId: string };

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

      // Check if user has teacher role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires teacher role',
        });
      }

      // Validate request body
      const parsed = ReplyConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: parsed.error.errors.map(e => e.message).join(', '),
        });
      }

      const { content } = parsed.data;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify conversation belongs to teacher
        const conversationCheck = await pool.query(`
          SELECT id FROM parent_teacher_conversations
          WHERE id = $1 AND teacher_id = $2 AND tenant_id = $3
        `, [conversationId, userId, tenantId]);

        if (conversationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found or access denied',
          });
        }

        // Create message
        const messageResult = await pool.query(`
          INSERT INTO conversation_messages (
            tenant_id,
            conversation_id,
            sender_id,
            content
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id, sent_at
        `, [tenantId, conversationId, userId, content]);

        // Update conversation updated_at
        await pool.query(`
          UPDATE parent_teacher_conversations
          SET updated_at = NOW()
          WHERE id = $1
        `, [conversationId]);

        // Get teacher name
        const teacherInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as teacher_name
          FROM users
          WHERE id = $1
        `, [userId]);

        const teacherName = teacherInfo.rows[0]?.teacher_name || 'Teacher';

        return reply.send({
          success: true,
          data: {
            message: {
              id: messageResult.rows[0].id,
              senderId: userId,
              senderName: teacherName,
              content,
              sentAt: messageResult.rows[0].sent_at,
              isRead: false,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error replying to conversation',
          userId,
          tenantId,
          conversationId,
          error: error.message,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });
}

