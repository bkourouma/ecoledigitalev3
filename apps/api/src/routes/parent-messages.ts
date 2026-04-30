import { FastifyInstance } from "fastify";
import { z } from "zod";
import { logAndMaybeSendWhatsapp } from "../services/whatsapp-delivery-log";

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

// Verify parent-child relationship utility for messages
async function verifyParentChildRelationshipForMessages(
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

// Ensure parent_school_conversations tables exist
async function ensureSchoolConversationsTables(pool: any): Promise<void> {
  try {
    // Check if parent_school_conversations table exists
    const conversationsTableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'parent_school_conversations'
      )`
    );

    if (!conversationsTableCheck.rows[0].exists) {
      // Enable UUID extension if not already enabled
      await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Create parent_school_conversations table
      await pool.query(
        `CREATE TABLE parent_school_conversations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
          subject VARCHAR(255) NOT NULL,
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );

      // Create parent_school_conversation_messages table
      await pool.query(
        `CREATE TABLE parent_school_conversation_messages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          conversation_id UUID NOT NULL REFERENCES parent_school_conversations(id) ON DELETE CASCADE,
          sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT NOW(),
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );

      // Create indexes
      await pool.query(
        `CREATE INDEX idx_parent_school_conversations_tenant_parent 
         ON parent_school_conversations(tenant_id, parent_id)`
      );

      await pool.query(
        `CREATE INDEX idx_parent_school_conversations_student 
         ON parent_school_conversations(tenant_id, student_id)`
      );

      await pool.query(
        `CREATE INDEX idx_parent_school_conversation_messages_conversation 
         ON parent_school_conversation_messages(conversation_id)`
      );

      // Enable RLS
      await pool.query('ALTER TABLE parent_school_conversations ENABLE ROW LEVEL SECURITY');
      await pool.query('ALTER TABLE parent_school_conversation_messages ENABLE ROW LEVEL SECURITY');

      // Create RLS policies
      await pool.query(
        `CREATE POLICY parent_school_conversations_tenant_isolation
         ON parent_school_conversations
         FOR ALL
         USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`
      );

      await pool.query(
        `CREATE POLICY parent_school_conversation_messages_tenant_isolation
         ON parent_school_conversation_messages
         FOR ALL
         USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`
      );
    }
  } catch (error: any) {
    // If table already exists or policy already exists, ignore the error
    if (error.code !== '42P07' && error.code !== '42710' && !error.message.includes('already exists')) {
      throw error;
    }
  }
}

export async function parentMessagesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/messages/teacher-messages - List all messages from teachers for children linked to the authenticated parent
  fastify.get('/teacher-messages', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'List all messages from teachers for children linked to the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          readStatus: { type: 'string', enum: ['read', 'unread', 'all'] },
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
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      teacherId: { type: 'string', format: 'uuid' },
                      teacherName: { type: 'string' },
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      parentId: { type: 'string', format: 'uuid' },
                      subject: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], nullable: true },
                      sentAt: { type: 'string' },
                      readAt: { type: 'string', nullable: true },
                      isRead: { type: 'boolean' },
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
      const { childId, teacherId, startDate, endDate, readStatus, page = 1, limit = 20 } = request.query as {
        childId?: string;
        teacherId?: string;
        startDate?: string;
        endDate?: string;
        readStatus?: 'read' | 'unread' | 'all';
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

        // Verify child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForMessages(pool, userId, childId, tenantId);
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
          'tm.parent_id = $1',
          'tm.tenant_id = $2',
        ];
        const queryParams: any[] = [userId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`tm.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by teacher
        if (teacherId) {
          whereConditions.push(`tm.teacher_id = $${paramIndex}`);
          queryParams.push(teacherId);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`tm.sent_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`tm.sent_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Filter by read status
        if (readStatus && readStatus !== 'all') {
          if (readStatus === 'read') {
            whereConditions.push(`tm.read_at IS NOT NULL`);
          } else if (readStatus === 'unread') {
            whereConditions.push(`tm.read_at IS NULL`);
          }
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total messages
        const countQuery = `
          SELECT COUNT(*) as total
          FROM teacher_messages tm
          JOIN student_parents sp_rel ON tm.student_id = sp_rel.student_id AND tm.parent_id = sp_rel.parent_id
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query messages with pagination
        const messagesQuery = `
          SELECT 
            tm.id as message_id,
            tm.teacher_id,
            tm.student_id,
            tm.parent_id,
            tm.subject,
            tm.content,
            tm.priority_level,
            tm.sent_at,
            tm.read_at,
            COALESCE(t.first_name || ' ' || t.last_name, t.name) as teacher_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM teacher_messages tm
          JOIN student_parents sp_rel ON tm.student_id = sp_rel.student_id AND tm.parent_id = sp_rel.parent_id
          JOIN users t ON tm.teacher_id = t.id
          JOIN student_profiles sp ON tm.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          ${whereClause}
          ORDER BY tm.sent_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const messagesResult = await pool.query(messagesQuery, [...queryParams, limit, offset]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.message_id,
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          studentId: row.student_id,
          childId: row.child_id,
          childName: row.child_name,
          parentId: row.parent_id,
          subject: row.subject,
          content: row.content,
          priorityLevel: row.priority_level,
          sentAt: row.sent_at,
          readAt: row.read_at,
          isRead: row.read_at !== null,
        }));

        fastify.log.info({
          msg: 'Teacher messages fetched successfully',
          userId,
          tenantId,
          messageCount: messages.length,
          total,
        });

        return reply.send({
          success: true,
          data: {
            messages,
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
          msg: 'Error fetching teacher messages',
          userId,
          tenantId,
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // GET /api/v1/parent/messages/announcements - List all school announcements for the authenticated parent's tenant
  fastify.get('/announcements', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'List all school announcements for the authenticated parent\'s tenant',
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          readStatus: { type: 'string', enum: ['read', 'unread', 'all'] },
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
                announcements: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      authorId: { type: 'string', format: 'uuid' },
                      authorName: { type: 'string' },
                      title: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], nullable: true },
                      postedAt: { type: 'string' },
                      readAt: { type: 'string', nullable: true },
                      isRead: { type: 'boolean' },
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
      const { startDate, endDate, priorityLevel, readStatus, page = 1, limit = 20 } = request.query as {
        startDate?: string;
        endDate?: string;
        priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
        readStatus?: 'read' | 'unread' | 'all';
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

      // Check if user has parent or teacher role
      const userRoles = request.user?.roles || [];
      const isParent = userRoles.some((r: string) => ['parent', 'Parent'].includes(r));
      const isTeacher = userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r));
      
      if (!isParent && !isTeacher) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent or teacher role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build query with filters
        const whereConditions = [
          'sa.tenant_id = $1',
        ];
        const queryParams: any[] = [tenantId];
        let paramIndex = 2;

        // Filter by date range
        if (startDate) {
          whereConditions.push(`sa.posted_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`sa.posted_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Filter by priority level
        if (priorityLevel) {
          whereConditions.push(`sa.priority_level = $${paramIndex}`);
          queryParams.push(priorityLevel);
          paramIndex++;
        }

        // Filter by read status - check announcement_reads table (only for parents)
        let readStatusJoin = '';
        if (isParent) {
          if (readStatus && readStatus !== 'all') {
            if (readStatus === 'read') {
              readStatusJoin = `INNER JOIN announcement_reads ar ON sa.id = ar.announcement_id AND ar.parent_id = $${paramIndex}`;
              queryParams.push(userId);
              paramIndex++;
            } else if (readStatus === 'unread') {
              readStatusJoin = `LEFT JOIN announcement_reads ar ON sa.id = ar.announcement_id AND ar.parent_id = $${paramIndex}`;
              queryParams.push(userId);
              paramIndex++;
              whereConditions.push(`ar.id IS NULL`);
            }
          } else {
            // Always join to get read status
            readStatusJoin = `LEFT JOIN announcement_reads ar ON sa.id = ar.announcement_id AND ar.parent_id = $${paramIndex}`;
            queryParams.push(userId);
            paramIndex++;
          }
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total announcements
        const countQuery = `
          SELECT COUNT(DISTINCT sa.id) as total
          FROM school_announcements sa
          ${readStatusJoin}
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query announcements with pagination
        const announcementsQuery = `
          SELECT 
            sa.id as announcement_id,
            sa.author_id,
            sa.title,
            sa.content,
            sa.priority_level,
            sa.posted_at,
            COALESCE(a.first_name || ' ' || a.last_name, a.name) as author_name,
            ${isParent ? 'ar.read_at' : 'NULL as read_at'}
          FROM school_announcements sa
          JOIN users a ON sa.author_id = a.id
          ${readStatusJoin}
          ${whereClause}
          ORDER BY sa.posted_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const announcementsResult = await pool.query(announcementsQuery, [...queryParams, limit, offset]);

        const announcements = announcementsResult.rows.map((row: any) => ({
          id: row.announcement_id,
          authorId: row.author_id,
          authorName: row.author_name,
          title: row.title,
          content: row.content,
          priorityLevel: row.priority_level,
          postedAt: row.posted_at,
          readAt: isParent ? row.read_at : null,
          isRead: isParent ? (row.read_at !== null) : false,
        }));

        return reply.send({
          success: true,
          data: {
            announcements,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // GET /api/v1/parent/messages/conversations - List all conversation threads for the authenticated parent
  fastify.get('/conversations', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'List all conversation threads for the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
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
                      teacherId: { type: 'string', format: 'uuid' },
                      teacherName: { type: 'string' },
                      studentId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
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
      const { childId, teacherId, status, page = 1, limit = 20 } = request.query as {
        childId?: string;
        teacherId?: string;
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
          'ptc.parent_id = $1',
          'ptc.tenant_id = $2',
        ];
        const queryParams: any[] = [userId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForMessages(pool, userId, childId, tenantId);
          if (!relationshipExists) {
            return reply.status(403).send({
              success: false,
              error: 'Forbidden',
              message: 'Child not linked to parent',
            });
          }
          whereConditions.push(`ptc.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by teacher
        if (teacherId) {
          whereConditions.push(`ptc.teacher_id = $${paramIndex}`);
          queryParams.push(teacherId);
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
          JOIN student_parents sp_rel ON ptc.student_id = sp_rel.student_id AND ptc.parent_id = sp_rel.parent_id
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
            COALESCE(t.first_name || ' ' || t.last_name, t.name) as teacher_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
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
          JOIN student_parents sp_rel ON ptc.student_id = sp_rel.student_id AND ptc.parent_id = sp_rel.parent_id
          JOIN users t ON ptc.teacher_id = t.id
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
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          studentId: row.student_id,
          childId: row.child_id,
          childName: row.child_name,
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
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // GET /api/v1/parent/messages/conversations/:conversationId - Get conversation thread with all messages
  fastify.get('/conversations/:conversationId', {
    schema: {
      tags: ['Parent Messages'],
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
                    teacherId: { type: 'string', format: 'uuid' },
                    teacherName: { type: 'string' },
                    studentId: { type: 'string', format: 'uuid' },
                    childId: { type: 'string', format: 'uuid' },
                    childName: { type: 'string' },
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
                      conversationId: { type: 'string', format: 'uuid' },
                      senderId: { type: 'string', format: 'uuid' },
                      senderName: { type: 'string' },
                      content: { type: 'string' },
                      sentAt: { type: 'string' },
                      readAt: { type: 'string', nullable: true },
                      isRead: { type: 'boolean' },
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

        // Verify parent has access to this conversation
        const conversationCheck = await pool.query(
          `SELECT ptc.id, ptc.parent_id, ptc.teacher_id, ptc.student_id, ptc.subject, ptc.status, ptc.created_at, ptc.updated_at,
                  COALESCE(t.first_name || ' ' || t.last_name, t.name) as teacher_name,
                  sp.id as child_id,
                  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
           FROM parent_teacher_conversations ptc
           JOIN student_parents sp_rel ON ptc.student_id = sp_rel.student_id AND ptc.parent_id = sp_rel.parent_id
           JOIN users t ON ptc.teacher_id = t.id
           JOIN student_profiles sp ON ptc.student_id = sp.id
           JOIN users u ON sp.user_id = u.id
           WHERE ptc.id = $1 AND ptc.parent_id = $2 AND ptc.tenant_id = $3`,
          [conversationId, userId, tenantId]
        );

        if (conversationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found or access denied',
          });
        }

        const convRow = conversationCheck.rows[0];
        const conversation = {
          id: convRow.id,
          parentId: convRow.parent_id,
          teacherId: convRow.teacher_id,
          teacherName: convRow.teacher_name,
          studentId: convRow.student_id,
          childId: convRow.child_id,
          childName: convRow.child_name,
          subject: convRow.subject,
          status: convRow.status,
          createdAt: convRow.created_at,
          updatedAt: convRow.updated_at,
        };

        // Get all messages in chronological order
        const messagesQuery = `
          SELECT 
            cm.id as message_id,
            cm.conversation_id,
            cm.sender_id,
            cm.content,
            cm.sent_at,
            cm.read_at,
            COALESCE(s.first_name || ' ' || s.last_name, s.name) as sender_name
          FROM conversation_messages cm
          JOIN users s ON cm.sender_id = s.id
          WHERE cm.conversation_id = $1 AND cm.tenant_id = $2
          ORDER BY cm.sent_at ASC
        `;
        const messagesResult = await pool.query(messagesQuery, [conversationId, tenantId]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.message_id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          senderName: row.sender_name,
          content: row.content,
          sentAt: row.sent_at,
          readAt: row.read_at,
          isRead: row.read_at !== null,
        }));

        return reply.send({
          success: true,
          data: {
            conversation,
            messages,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/parent/messages/conversations - Start a new conversation with a teacher
  fastify.post('/conversations', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Start a new conversation with a teacher',
      body: {
        type: 'object',
        required: ['childId', 'teacherId', 'subject', 'content'],
        properties: {
          childId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
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
                whatsappStatus: { type: 'string' },
                conversation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    teacherId: { type: 'string', format: 'uuid' },
                    teacherName: { type: 'string' },
                    studentId: { type: 'string', format: 'uuid' },
                    childId: { type: 'string', format: 'uuid' },
                    childName: { type: 'string' },
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
      const { childId, teacherId, subject, content, sendWhatsapp } = request.body as {
        childId: string;
        teacherId: string;
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
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

      if (!childId || !teacherId || !subject || !content) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'childId, teacherId, subject, and content are required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipCheck = await pool.query(
          `SELECT id FROM student_parents 
           WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
          [userId, childId, tenantId]
        );

        if (relationshipCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Verify teacher exists and get teacher user_id
        const teacherCheck = await pool.query(`
          SELECT t.id, t.user_id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as teacher_name
          FROM teachers t
          JOIN users u ON t.user_id = u.id
          WHERE t.id = $1 AND t.tenant_id = $2
        `, [teacherId, tenantId]);

        if (teacherCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Teacher not found',
          });
        }

        const teacher = teacherCheck.rows[0];
        const teacherUserId = teacher.user_id;
        const teacherName = teacher.teacher_name;

        // Verify teacher is assigned to this student (via teacher_assignments -> classes -> student_enrollments)
        const assignmentCheck = await pool.query(`
          SELECT ta.id
          FROM teacher_assignments ta
          JOIN class_courses cc ON ta.class_course_id = cc.id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN student_enrollments se ON se.class_id = cl.id
          WHERE ta.teacher_id = $1
          AND se.student_id = $2
          AND ta.tenant_id = $3
          LIMIT 1
        `, [teacherId, childId, tenantId]);

        if (assignmentCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Teacher is not assigned to teach this student',
          });
        }

        // Get child name
        const childInfo = await pool.query(`
          SELECT sp.id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `, [childId, tenantId]);

        if (childInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Child not found',
          });
        }

        const childName = childInfo.rows[0].child_name;

        // Get parent name
        const parentInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as parent_name
          FROM users
          WHERE id = $1
        `, [userId]);

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
        `, [tenantId, userId, teacherUserId, childId, subject]);

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

        const waText = `${subject}\n\n${content}`;
        const wa = await logAndMaybeSendWhatsapp({
          pool,
          tenantId,
          sourceType: "parent_teacher_conversation_message",
          sourceId: messageId,
          recipientUserId: teacherUserId,
          text: waText,
          sendWhatsapp: !!sendWhatsapp,
          log: fastify.log,
        });

        return reply.status(201).send({
          success: true,
          data: {
            whatsappStatus: wa.whatsappStatus,
            conversation: {
              id: conversationId,
              parentId: userId,
              teacherId: teacherUserId,
              teacherName,
              studentId: childId,
              childId,
              childName,
              subject,
              status: 'active',
              createdAt,
            },
            message: {
              id: messageId,
              senderId: userId,
              senderName: parentName,
              content,
              sentAt,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error creating parent conversation',
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

  // GET /api/v1/parent/messages/teachers/:childId - Get teachers for a specific child
  fastify.get('/teachers/:childId', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Get teachers for a specific child',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                teachers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      userId: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      courseName: { type: 'string' },
                      className: { type: 'string' },
                      coursesSummary: { type: 'string' },
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
      const { childId } = request.params as { childId: string };

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

        // Verify parent-child relationship
        const relationshipCheck = await pool.query(
          `SELECT id FROM student_parents 
           WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
          [userId, childId, tenantId]
        );

        if (relationshipCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Enseignants assignés (agrégation par enseignant : une ligne = un destinataire, matières listées)
        const teachersQuery = `
          SELECT
            t.id,
            t.user_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as teacher_name,
            u.email,
            COALESCE(co.name, 'Matière') as course_name,
            COALESCE(cl.name, 'Classe') as class_name
          FROM teachers t
          JOIN users u ON t.user_id = u.id
          JOIN teacher_assignments ta ON ta.teacher_id = t.id
          JOIN class_courses cc ON ta.class_course_id = cc.id
          JOIN classes cl ON cc.class_id = cl.id
          JOIN courses co ON co.id = cc.course_id
          JOIN student_enrollments se ON se.class_id = cl.id
          WHERE se.student_id = $1
          AND ta.tenant_id = $2
          AND t.tenant_id = $2
          ORDER BY teacher_name, course_name, class_name
        `;
        const teachersResult = await pool.query(teachersQuery, [childId, tenantId]);

        const merged = new Map<
          string,
          { id: string; userId: string; name: string; email: string; courseLabels: string[] }
        >();
        for (const row of teachersResult.rows as any[]) {
          const label = `${row.course_name} — ${row.class_name}`;
          const existing = merged.get(row.id);
          if (!existing) {
            merged.set(row.id, {
              id: row.id,
              userId: row.user_id,
              name: row.teacher_name,
              email: row.email,
              courseLabels: [label],
            });
          } else if (!existing.courseLabels.includes(label)) {
            existing.courseLabels.push(label);
          }
        }

        const teachers = [...merged.values()].map((t) => {
          const summary = t.courseLabels.join(' · ');
          return {
            id: t.id,
            userId: t.userId,
            name: t.name,
            email: t.email,
            coursesSummary: summary,
            courseName: summary,
            className: '',
          };
        });

        return reply.send({
          success: true,
          data: {
            teachers,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching teachers for child',
          userId,
          tenantId,
          childId,
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

  // POST /api/v1/parent/messages/conversations/:conversationId/reply - Reply to a conversation thread
  fastify.post('/conversations/:conversationId/reply', {
    schema: {
      tags: ['Parent Messages'],
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
        properties: {
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
        },
        required: ['content'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                whatsappStatus: { type: 'string' },
                message: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    conversationId: { type: 'string', format: 'uuid' },
                    senderId: { type: 'string', format: 'uuid' },
                    senderName: { type: 'string' },
                    content: { type: 'string' },
                    sentAt: { type: 'string' },
                    readAt: { type: 'string', nullable: true },
                    isRead: { type: 'boolean' },
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
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { conversationId } = request.params as { conversationId: string };
      const { content, sendWhatsapp } = request.body as { content: string; sendWhatsapp?: boolean };

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

      if (!content || content.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Message content is required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent has access to this conversation
        const conversationCheck = await pool.query(
          `SELECT id, parent_id, teacher_id, status
           FROM parent_teacher_conversations
           WHERE id = $1 AND parent_id = $2 AND tenant_id = $3`,
          [conversationId, userId, tenantId]
        );

        if (conversationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found or access denied',
          });
        }

        const conversation = conversationCheck.rows[0];
        if (conversation.status === 'closed') {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Cannot reply to a closed conversation',
          });
        }

        // Get sender name
        const senderResult = await pool.query(
          `SELECT COALESCE(first_name || ' ' || last_name, name) as sender_name
           FROM users
           WHERE id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );
        const senderName = senderResult.rows[0]?.sender_name || 'Parent';

        // Insert new message
        const insertMessageQuery = `
          INSERT INTO conversation_messages (tenant_id, conversation_id, sender_id, content, sent_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING id, conversation_id, sender_id, content, sent_at, read_at
        `;
        const messageResult = await pool.query(insertMessageQuery, [
          tenantId,
          conversationId,
          userId,
          content.trim(),
        ]);

        const messageRow = messageResult.rows[0];

        // Update conversation updated_at timestamp (trigger should handle this, but we'll do it explicitly)
        await pool.query(
          `UPDATE parent_teacher_conversations
           SET updated_at = NOW()
           WHERE id = $1`,
          [conversationId]
        );

        const message = {
          id: messageRow.id,
          conversationId: messageRow.conversation_id,
          senderId: messageRow.sender_id,
          senderName,
          content: messageRow.content,
          sentAt: messageRow.sent_at,
          readAt: messageRow.read_at,
          isRead: messageRow.read_at !== null,
        };

        const teacherUserId = conversation.teacher_id as string;
        const wa = await logAndMaybeSendWhatsapp({
          pool,
          tenantId,
          sourceType: "parent_teacher_conversation_message",
          sourceId: messageRow.id,
          recipientUserId: teacherUserId,
          text: content.trim(),
          sendWhatsapp: !!sendWhatsapp,
          log: fastify.log,
        });

        return reply.send({
          success: true,
          data: {
            whatsappStatus: wa.whatsappStatus,
            message,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // GET /api/v1/parent/messages/notifications - List all notifications for the authenticated parent
  fastify.get('/notifications', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'List all notifications for the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          notificationType: { type: 'string', enum: ['message', 'announcement', 'event', 'grade', 'payment', 'other'] },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          readStatus: { type: 'string', enum: ['read', 'unread', 'all'] },
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
                notifications: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      parentId: { type: 'string', format: 'uuid' },
                      notificationType: { type: 'string', enum: ['message', 'announcement', 'event', 'grade', 'payment', 'other'] },
                      title: { type: 'string' },
                      content: { type: 'string' },
                      actionLink: { type: 'string', nullable: true },
                      readAt: { type: 'string', nullable: true },
                      isRead: { type: 'boolean' },
                      createdAt: { type: 'string' },
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
      const { notificationType, startDate, endDate, readStatus, page = 1, limit = 20 } = request.query as {
        notificationType?: 'message' | 'announcement' | 'event' | 'grade' | 'payment' | 'other';
        startDate?: string;
        endDate?: string;
        readStatus?: 'read' | 'unread' | 'all';
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
          'n.parent_id = $1',
          'n.tenant_id = $2',
        ];
        const queryParams: any[] = [userId, tenantId];
        let paramIndex = 3;

        // Filter by notification type
        if (notificationType) {
          whereConditions.push(`n.notification_type = $${paramIndex}`);
          queryParams.push(notificationType);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`n.created_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`n.created_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Filter by read status
        if (readStatus && readStatus !== 'all') {
          if (readStatus === 'read') {
            whereConditions.push(`n.read_at IS NOT NULL`);
          } else if (readStatus === 'unread') {
            whereConditions.push(`n.read_at IS NULL`);
          }
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total notifications
        const countQuery = `
          SELECT COUNT(*) as total
          FROM notifications n
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query notifications with pagination
        const notificationsQuery = `
          SELECT 
            n.id as notification_id,
            n.parent_id,
            n.notification_type,
            n.title,
            n.content,
            n.action_link,
            n.read_at,
            n.created_at
          FROM notifications n
          ${whereClause}
          ORDER BY n.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const notificationsResult = await pool.query(notificationsQuery, [...queryParams, limit, offset]);

        const notifications = notificationsResult.rows.map((row: any) => ({
          id: row.notification_id,
          parentId: row.parent_id,
          notificationType: row.notification_type,
          title: row.title,
          content: row.content,
          actionLink: row.action_link,
          readAt: row.read_at,
          isRead: row.read_at !== null,
          createdAt: row.created_at,
        }));

        return reply.send({
          success: true,
          data: {
            notifications,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/parent/messages/notifications/:notificationId/read - Mark notification as read
  fastify.post('/notifications/:notificationId/read', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Mark notification as read',
      params: {
        type: 'object',
        properties: {
          notificationId: { type: 'string', format: 'uuid' },
        },
        required: ['notificationId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                notification: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    notificationType: { type: 'string', enum: ['message', 'announcement', 'event', 'grade', 'payment', 'other'] },
                    title: { type: 'string' },
                    content: { type: 'string' },
                    actionLink: { type: 'string', nullable: true },
                    readAt: { type: 'string', nullable: true },
                    isRead: { type: 'boolean' },
                    createdAt: { type: 'string' },
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
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { notificationId } = request.params as { notificationId: string };

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

        // Verify parent has access to this notification
        const notificationCheck = await pool.query(
          `SELECT id, parent_id, notification_type, title, content, action_link, read_at, created_at
           FROM notifications
           WHERE id = $1 AND parent_id = $2 AND tenant_id = $3`,
          [notificationId, userId, tenantId]
        );

        if (notificationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Notification not found or access denied',
          });
        }

        // Update notification read_at timestamp
        const updateQuery = `
          UPDATE notifications
          SET read_at = NOW()
          WHERE id = $1 AND parent_id = $2 AND tenant_id = $3
          RETURNING id, parent_id, notification_type, title, content, action_link, read_at, created_at
        `;
        const updateResult = await pool.query(updateQuery, [notificationId, userId, tenantId]);

        const notificationRow = updateResult.rows[0];
        const notification = {
          id: notificationRow.id,
          parentId: notificationRow.parent_id,
          notificationType: notificationRow.notification_type,
          title: notificationRow.title,
          content: notificationRow.content,
          actionLink: notificationRow.action_link,
          readAt: notificationRow.read_at,
          isRead: notificationRow.read_at !== null,
          createdAt: notificationRow.created_at,
        };

        return reply.send({
          success: true,
          data: {
            notification,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // GET /api/v1/parent/messages/event-invitations - List all event invitations for the authenticated parent
  fastify.get('/event-invitations', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'List all event invitations for the authenticated parent',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          eventType: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          rsvpStatus: { type: 'string', enum: ['pending', 'accepted', 'declined', 'tentative'] },
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
                invitations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      eventId: { type: 'string', format: 'uuid', nullable: true },
                      parentId: { type: 'string', format: 'uuid' },
                      studentId: { type: 'string', format: 'uuid', nullable: true },
                      childId: { type: 'string', format: 'uuid', nullable: true },
                      childName: { type: 'string', nullable: true },
                      eventName: { type: 'string' },
                      eventDescription: { type: 'string', nullable: true },
                      eventDate: { type: 'string' },
                      eventLocation: { type: 'string', nullable: true },
                      organizerId: { type: 'string', format: 'uuid' },
                      organizerName: { type: 'string' },
                      rsvpStatus: { type: 'string', enum: ['pending', 'accepted', 'declined', 'tentative'] },
                      rsvpDeadline: { type: 'string', nullable: true },
                      rsvpResponseAt: { type: 'string', nullable: true },
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
      const { childId, eventType, startDate, endDate, rsvpStatus, page = 1, limit = 20 } = request.query as {
        childId?: string;
        eventType?: string;
        startDate?: string;
        endDate?: string;
        rsvpStatus?: 'pending' | 'accepted' | 'declined' | 'tentative';
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

        // Verify child relationship if childId is provided
        if (childId) {
          const relationshipExists = await verifyParentChildRelationshipForMessages(pool, userId, childId, tenantId);
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
          'ei.parent_id = $1',
          'ei.tenant_id = $2',
        ];
        const queryParams: any[] = [userId, tenantId];
        let paramIndex = 3;

        // Filter by child
        if (childId) {
          whereConditions.push(`ei.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        // Filter by event type (if event_type column exists, otherwise filter by event_name)
        if (eventType) {
          whereConditions.push(`ei.event_name ILIKE $${paramIndex}`);
          queryParams.push(`%${eventType}%`);
          paramIndex++;
        }

        // Filter by date range
        if (startDate) {
          whereConditions.push(`ei.event_date >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`ei.event_date <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Filter by RSVP status
        if (rsvpStatus) {
          whereConditions.push(`ei.rsvp_status = $${paramIndex}`);
          queryParams.push(rsvpStatus);
          paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total invitations
        const countQuery = `
          SELECT COUNT(*) as total
          FROM event_invitations ei
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query invitations with pagination
        const invitationsQuery = `
          SELECT 
            ei.id as invitation_id,
            ei.event_id,
            ei.parent_id,
            ei.student_id,
            ei.event_name,
            ei.event_description,
            ei.event_date,
            ei.event_location,
            ei.organizer_id,
            ei.rsvp_status,
            ei.rsvp_deadline,
            ei.rsvp_response_at,
            ei.created_at,
            ei.updated_at,
            o.first_name || ' ' || o.last_name as organizer_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM event_invitations ei
          JOIN users o ON ei.organizer_id = o.id
          LEFT JOIN student_profiles sp ON ei.student_id = sp.id
          LEFT JOIN users u ON sp.user_id = u.id
          ${whereClause}
          ORDER BY ei.event_date ASC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const invitationsResult = await pool.query(invitationsQuery, [...queryParams, limit, offset]);

        const invitations = invitationsResult.rows.map((row: any) => ({
          id: row.invitation_id,
          eventId: row.event_id,
          parentId: row.parent_id,
          studentId: row.student_id,
          childId: row.child_id,
          childName: row.child_name,
          eventName: row.event_name,
          eventDescription: row.event_description,
          eventDate: row.event_date,
          eventLocation: row.event_location,
          organizerId: row.organizer_id,
          organizerName: row.organizer_name,
          rsvpStatus: row.rsvp_status,
          rsvpDeadline: row.rsvp_deadline,
          rsvpResponseAt: row.rsvp_response_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        return reply.send({
          success: true,
          data: {
            invitations,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/parent/messages/event-invitations/:invitationId/rsvp - Respond to event invitation
  fastify.post('/event-invitations/:invitationId/rsvp', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Respond to event invitation with RSVP',
      params: {
        type: 'object',
        properties: {
          invitationId: { type: 'string', format: 'uuid' },
        },
        required: ['invitationId'],
      },
      body: {
        type: 'object',
        properties: {
          rsvpStatus: { type: 'string', enum: ['accepted', 'declined', 'tentative'] },
        },
        required: ['rsvpStatus'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                invitation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    eventId: { type: 'string', format: 'uuid', nullable: true },
                    parentId: { type: 'string', format: 'uuid' },
                    studentId: { type: 'string', format: 'uuid', nullable: true },
                    childId: { type: 'string', format: 'uuid', nullable: true },
                    childName: { type: 'string', nullable: true },
                    eventName: { type: 'string' },
                    eventDescription: { type: 'string', nullable: true },
                    eventDate: { type: 'string' },
                    eventLocation: { type: 'string', nullable: true },
                    organizerId: { type: 'string', format: 'uuid' },
                    organizerName: { type: 'string' },
                    rsvpStatus: { type: 'string', enum: ['pending', 'accepted', 'declined', 'tentative'] },
                    rsvpDeadline: { type: 'string', nullable: true },
                    rsvpResponseAt: { type: 'string', nullable: true },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
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
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { invitationId } = request.params as { invitationId: string };
      const { rsvpStatus } = request.body as { rsvpStatus: 'accepted' | 'declined' | 'tentative' };

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

        // Verify parent has access to this invitation
        const invitationCheck = await pool.query(
          `SELECT 
            ei.id,
            ei.event_id,
            ei.parent_id,
            ei.student_id,
            ei.event_name,
            ei.event_description,
            ei.event_date,
            ei.event_location,
            ei.organizer_id,
            ei.rsvp_status,
            ei.rsvp_deadline,
            ei.rsvp_response_at,
            ei.created_at,
            ei.updated_at,
            o.first_name || ' ' || o.last_name as organizer_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
           FROM event_invitations ei
           JOIN users o ON ei.organizer_id = o.id
           LEFT JOIN student_profiles sp ON ei.student_id = sp.id
           LEFT JOIN users u ON sp.user_id = u.id
           WHERE ei.id = $1 AND ei.parent_id = $2 AND ei.tenant_id = $3`,
          [invitationId, userId, tenantId]
        );

        if (invitationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Invitation not found or access denied',
          });
        }

        const invitationRow = invitationCheck.rows[0];

        // Check RSVP deadline
        if (invitationRow.rsvp_deadline) {
          const deadline = new Date(invitationRow.rsvp_deadline);
          const now = new Date();
          if (now > deadline) {
            return reply.status(400).send({
              success: false,
              error: 'RSVP Deadline Passed',
              message: 'The RSVP deadline for this event has passed',
            });
          }
        }

        // Update RSVP status
        const updateQuery = `
          UPDATE event_invitations
          SET rsvp_status = $1,
              rsvp_response_at = NOW(),
              updated_at = NOW()
          WHERE id = $2 AND parent_id = $3 AND tenant_id = $4
          RETURNING 
            id,
            event_id,
            parent_id,
            student_id,
            event_name,
            event_description,
            event_date,
            event_location,
            organizer_id,
            rsvp_status,
            rsvp_deadline,
            rsvp_response_at,
            created_at,
            updated_at
        `;
        const updateResult = await pool.query(updateQuery, [rsvpStatus, invitationId, userId, tenantId]);

        // Fetch updated invitation with joins
        const updatedInvitationQuery = `
          SELECT 
            ei.id as invitation_id,
            ei.event_id,
            ei.parent_id,
            ei.student_id,
            ei.event_name,
            ei.event_description,
            ei.event_date,
            ei.event_location,
            ei.organizer_id,
            ei.rsvp_status,
            ei.rsvp_deadline,
            ei.rsvp_response_at,
            ei.created_at,
            ei.updated_at,
            o.first_name || ' ' || o.last_name as organizer_name,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM event_invitations ei
          JOIN users o ON ei.organizer_id = o.id
          LEFT JOIN student_profiles sp ON ei.student_id = sp.id
          LEFT JOIN users u ON sp.user_id = u.id
          WHERE ei.id = $1
        `;
        const finalResult = await pool.query(updatedInvitationQuery, [invitationId]);

        const finalRow = finalResult.rows[0];
        const invitation = {
          id: finalRow.invitation_id,
          eventId: finalRow.event_id,
          parentId: finalRow.parent_id,
          studentId: finalRow.student_id,
          childId: finalRow.child_id,
          childName: finalRow.child_name,
          eventName: finalRow.event_name,
          eventDescription: finalRow.event_description,
          eventDate: finalRow.event_date,
          eventLocation: finalRow.event_location,
          organizerId: finalRow.organizer_id,
          organizerName: finalRow.organizer_name,
          rsvpStatus: finalRow.rsvp_status,
          rsvpDeadline: finalRow.rsvp_deadline,
          rsvpResponseAt: finalRow.rsvp_response_at,
          createdAt: finalRow.created_at,
          updatedAt: finalRow.updated_at,
        };

        return reply.send({
          success: true,
          data: {
            invitation,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/parent/messages/school-messages - Send a message to the school/establishment
  fastify.post('/school-messages', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Send a message to the school/establishment about a child',
      body: {
        type: 'object',
        required: ['childId', 'subject', 'content'],
        properties: {
          childId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
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
                whatsappStatus: { type: 'string' },
                conversation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    childId: { type: 'string', format: 'uuid' },
                    childName: { type: 'string' },
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
      const { childId, subject, content, sendWhatsapp } = request.body as {
        childId: string;
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
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

      if (!childId || !subject || !content) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'childId, subject, and content are required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipCheck = await pool.query(
          `SELECT id FROM student_parents 
           WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
          [userId, childId, tenantId]
        );

        if (relationshipCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Ensure tables exist
        await ensureSchoolConversationsTables(pool);

        // Get child name
        const childInfo = await pool.query(`
          SELECT sp.id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `, [childId, tenantId]);

        if (childInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Child not found',
          });
        }

        const childName = childInfo.rows[0].child_name;

        // Get parent name
        const parentInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as parent_name
          FROM users
          WHERE id = $1
        `, [userId]);

        const parentName = parentInfo.rows[0]?.parent_name || 'Parent';

        // Create conversation
        const conversationResult = await pool.query(`
          INSERT INTO parent_school_conversations (
            tenant_id,
            parent_id,
            student_id,
            subject,
            status
          )
          VALUES ($1, $2, $3, $4, 'active')
          RETURNING id, created_at
        `, [tenantId, userId, childId, subject]);

        const conversationId = conversationResult.rows[0].id;
        const createdAt = conversationResult.rows[0].created_at;

        const structuredContent = `[Enfant concerné : ${childName}]\n\n${content}`;

        // Create first message
        const messageResult = await pool.query(`
          INSERT INTO parent_school_conversation_messages (
            tenant_id,
            conversation_id,
            sender_id,
            content
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id, sent_at
        `, [tenantId, conversationId, userId, structuredContent]);

        const messageId = messageResult.rows[0].id;
        const sentAt = messageResult.rows[0].sent_at;

        const admins = await pool.query(
          `SELECT DISTINCT ur.user_id
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           JOIN users u ON u.id = ur.user_id AND u.tenant_id = $1
           WHERE ur.tenant_id = $1
             AND r.key IN ('admin','super_admin','Administrateur')
           LIMIT 30`,
          [tenantId]
        );
        let lastWa: string = "skipped";
        for (const row of admins.rows) {
          const wa = await logAndMaybeSendWhatsapp({
            pool,
            tenantId,
            sourceType: "parent_school_message",
            sourceId: messageId,
            recipientUserId: row.user_id,
            text: `[Parent → Établissement — ${childName}] ${subject}\n\n${structuredContent}`,
            sendWhatsapp: !!sendWhatsapp,
            log: fastify.log,
          });
          lastWa = wa.whatsappStatus;
        }

        return reply.status(201).send({
          success: true,
          data: {
            whatsappStatus: lastWa,
            conversation: {
              id: conversationId,
              parentId: userId,
              childId,
              childName,
              subject,
              status: 'active',
              createdAt,
            },
            message: {
              id: messageId,
              senderId: userId,
              senderName: parentName,
              content: structuredContent,
              sentAt,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error sending message to school',
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

  // GET /api/v1/parent/messages/school-conversations - List all conversations with school
  fastify.get('/school-conversations', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'List all conversations with the school/establishment',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
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
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      subject: { type: 'string' },
                      status: { type: 'string' },
                      createdAt: { type: 'string' },
                      updatedAt: { type: 'string' },
                      lastMessage: {
                        type: 'object',
                        properties: {
                          content: { type: 'string' },
                          sentAt: { type: 'string' },
                          senderName: { type: 'string' },
                        },
                      },
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
      const { childId, status, page = 1, limit = 20 } = request.query as {
        childId?: string;
        status?: string;
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

        // Ensure tables exist
        await ensureSchoolConversationsTables(pool);

        // Build WHERE clause
        let whereClause = 'WHERE psc.parent_id = $1 AND psc.tenant_id = $2';
        const params: any[] = [userId, tenantId];
        let paramIndex = 3;

        if (childId) {
          whereClause += ` AND psc.student_id = $${paramIndex}`;
          params.push(childId);
          paramIndex++;
        }

        if (status) {
          whereClause += ` AND psc.status = $${paramIndex}`;
          params.push(status);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM parent_school_conversations psc
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Get conversations with last message
        const conversationsQuery = `
          SELECT 
            psc.id,
            psc.parent_id,
            psc.student_id as child_id,
            psc.subject,
            psc.status,
            psc.created_at,
            psc.updated_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            (
              SELECT 
                json_build_object(
                  'content', pscm.content,
                  'sentAt', pscm.sent_at,
                  'senderName', COALESCE(sender.first_name || ' ' || sender.last_name, sender.name)
                )
              FROM parent_school_conversation_messages pscm
              JOIN users sender ON pscm.sender_id = sender.id
              WHERE pscm.conversation_id = psc.id
              ORDER BY pscm.sent_at DESC
              LIMIT 1
            ) as last_message
          FROM parent_school_conversations psc
          JOIN student_profiles sp ON psc.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          ${whereClause}
          ORDER BY psc.updated_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);
        const conversationsResult = await pool.query(conversationsQuery, params);

        const conversations = conversationsResult.rows.map((row: any) => ({
          id: row.id,
          parentId: row.parent_id,
          childId: row.child_id,
          childName: row.child_name,
          subject: row.subject,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastMessage: row.last_message,
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
          msg: 'Error fetching school conversations',
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

  // GET /api/v1/parent/messages/school-conversations/:conversationId - Get conversation thread
  fastify.get('/school-conversations/:conversationId', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Get conversation thread with school',
      params: {
        type: 'object',
        required: ['conversationId'],
        properties: {
          conversationId: { type: 'string', format: 'uuid' },
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
                conversation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    childId: { type: 'string', format: 'uuid' },
                    childName: { type: 'string' },
                    subject: { type: 'string' },
                    status: { type: 'string' },
                    createdAt: { type: 'string' },
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

        // Ensure tables exist
        await ensureSchoolConversationsTables(pool);

        // Get conversation
        const conversationQuery = `
          SELECT 
            psc.id,
            psc.parent_id,
            psc.student_id as child_id,
            psc.subject,
            psc.status,
            psc.created_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM parent_school_conversations psc
          JOIN student_profiles sp ON psc.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE psc.id = $1 AND psc.parent_id = $2 AND psc.tenant_id = $3
        `;
        const conversationResult = await pool.query(conversationQuery, [conversationId, userId, tenantId]);

        if (conversationResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found or access denied',
          });
        }

        const convRow = conversationResult.rows[0];
        const conversation = {
          id: convRow.id,
          parentId: convRow.parent_id,
          childId: convRow.child_id,
          childName: convRow.child_name,
          subject: convRow.subject,
          status: convRow.status,
          createdAt: convRow.created_at,
        };

        // Get messages
        const messagesQuery = `
          SELECT 
            pscm.id,
            pscm.sender_id,
            pscm.content,
            pscm.sent_at,
            pscm.read_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as sender_name
          FROM parent_school_conversation_messages pscm
          JOIN users u ON pscm.sender_id = u.id
          WHERE pscm.conversation_id = $1
          ORDER BY pscm.sent_at ASC
        `;
        const messagesResult = await pool.query(messagesQuery, [conversationId]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          senderId: row.sender_id,
          senderName: row.sender_name,
          content: row.content,
          sentAt: row.sent_at,
          isRead: !!row.read_at,
        }));

        return reply.send({
          success: true,
          data: {
            conversation,
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

  // POST /api/v1/parent/messages/school-conversations/:conversationId/reply - Reply to conversation
  fastify.post('/school-conversations/:conversationId/reply', {
    schema: {
      tags: ['Parent Messages'],
      summary: 'Reply to a conversation with school',
      params: {
        type: 'object',
        required: ['conversationId'],
        properties: {
          conversationId: { type: 'string', format: 'uuid' },
        },
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
      const { content } = request.body as { content: string };

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

      if (!content || !content.trim()) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Message content is required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Ensure tables exist
        await ensureSchoolConversationsTables(pool);

        // Verify parent has access to this conversation
        const conversationCheck = await pool.query(
          `SELECT id, parent_id, status
           FROM parent_school_conversations
           WHERE id = $1 AND parent_id = $2 AND tenant_id = $3`,
          [conversationId, userId, tenantId]
        );

        if (conversationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found or access denied',
          });
        }

        const conversation = conversationCheck.rows[0];
        if (conversation.status === 'closed') {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Cannot reply to a closed conversation',
          });
        }

        // Get sender name
        const senderResult = await pool.query(
          `SELECT COALESCE(first_name || ' ' || last_name, name) as sender_name
           FROM users
           WHERE id = $1`,
          [userId]
        );
        const senderName = senderResult.rows[0]?.sender_name || 'Parent';

        // Insert new message
        const insertMessageQuery = `
          INSERT INTO parent_school_conversation_messages (tenant_id, conversation_id, sender_id, content, sent_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING id, conversation_id, sender_id, content, sent_at, read_at
        `;
        const messageResult = await pool.query(insertMessageQuery, [
          tenantId,
          conversationId,
          userId,
          content.trim(),
        ]);

        const messageRow = messageResult.rows[0];

        // Update conversation updated_at timestamp
        await pool.query(
          `UPDATE parent_school_conversations
           SET updated_at = NOW()
           WHERE id = $1`,
          [conversationId]
        );

        return reply.send({
          success: true,
          data: {
            message: {
              id: messageRow.id,
              senderId: messageRow.sender_id,
              senderName,
              content: messageRow.content,
              sentAt: messageRow.sent_at,
              isRead: !!messageRow.read_at,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error replying to school conversation',
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
