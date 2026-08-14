import { FastifyInstance } from "fastify";
import { z } from "zod";
import { emailService } from "../services/email.service";
import { emailLogoAttachments, emailLogoPreviewUrl } from "../services/brand-assets";
import {
  PORTAL_URL,
  WEB_ORIGIN,
  deliverMessage,
  ensureDeliveryLogChannelColumn,
  resolveDisplayName,
  summarizeStatuses,
} from "../services/message-delivery";
import {
  MESSAGE_TEMPLATE_DEFINITIONS,
  MESSAGE_TEMPLATE_KINDS,
  MESSAGE_TEMPLATE_PROFILE_LABELS,
  buildSampleContext,
  isMessageTemplateKind,
  loadTenantMessageTemplate,
  loadTenantMessageTemplates,
  renderMessageEmail,
  resetTenantMessageTemplate,
  saveTenantMessageTemplate,
  type MessageEmailTemplate,
  type MessageTemplateKind,
} from "../services/message-email-templates";
import { resolveTenantName } from "../services/teacher-credentials-email";

/** Rôles autorisés sur toutes les routes de ce module. */
const ADMIN_ROLES = ['admin', 'super_admin', 'Administrateur'];

function isAdmin(roles: string[] | undefined): boolean {
  return (roles || []).some((r: string) => ADMIN_ROLES.includes(r));
}

/** Nom affiché de l'administrateur connecté, utilisé comme expéditeur. */
function resolveSenderName(pool: any, userId: string): Promise<string> {
  return resolveDisplayName(pool, userId, 'Administration');
}

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

// Ensure parent_school_conversations tables exist (same function as in parent-messages.ts)
async function ensureSchoolConversationsTables(pool: any): Promise<void> {
  try {
    const conversationsTableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'parent_school_conversations'
      )`
    );

    if (!conversationsTableCheck.rows[0].exists) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

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

      await pool.query('ALTER TABLE parent_school_conversations ENABLE ROW LEVEL SECURITY');
      await pool.query('ALTER TABLE parent_school_conversation_messages ENABLE ROW LEVEL SECURITY');

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
    if (error.code !== '42P07' && error.code !== '42710' && !error.message.includes('already exists')) {
      throw error;
    }
  }
}

export async function adminMessagesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/admin/messages/conversations - List all conversations with parents
  fastify.get('/conversations', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'List all conversations with parents',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
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
      const { childId, parentId, status, page = 1, limit = 20 } = request.query as {
        childId?: string;
        parentId?: string;
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Ensure tables exist
        await ensureSchoolConversationsTables(pool);

        // Build WHERE clause
        let whereClause = 'WHERE psc.tenant_id = $1';
        const params: any[] = [tenantId];
        let paramIndex = 2;

        if (childId) {
          whereClause += ` AND psc.student_id = $${paramIndex}`;
          params.push(childId);
          paramIndex++;
        }

        if (parentId) {
          whereClause += ` AND psc.parent_id = $${paramIndex}`;
          params.push(parentId);
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
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name,
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
          JOIN users p ON psc.parent_id = p.id
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
          parentName: row.parent_name,
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
          msg: 'Error fetching admin conversations',
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

  // GET /api/v1/admin/messages/conversations/:conversationId - Get conversation thread
  fastify.get('/conversations/:conversationId', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Get conversation thread with parent',
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
                    parentName: { type: 'string' },
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
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
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM parent_school_conversations psc
          JOIN users p ON psc.parent_id = p.id
          JOIN student_profiles sp ON psc.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE psc.id = $1 AND psc.tenant_id = $2
        `;
        const conversationResult = await pool.query(conversationQuery, [conversationId, tenantId]);

        if (conversationResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found',
          });
        }

        const convRow = conversationResult.rows[0];
        const conversation = {
          id: convRow.id,
          parentId: convRow.parent_id,
          parentName: convRow.parent_name,
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

  // POST /api/v1/admin/messages/conversations/:conversationId/reply - Reply to conversation
  fastify.post('/conversations/:conversationId/reply', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Reply to a conversation with parent',
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
          sendWhatsapp: { type: 'boolean' },
          sendEmail: { type: 'boolean' },
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
                whatsappStatus: { type: 'string' },
                emailStatus: { type: 'string' },
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
      const { content, sendWhatsapp, sendEmail } = request.body as {
        content: string;
        sendWhatsapp?: boolean;
        sendEmail?: boolean;
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
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

        // Verify conversation exists — les noms parent/enfant alimentent le
        // modèle d'email de la réponse.
        const conversationCheck = await pool.query(
          `SELECT psc.id, psc.status, psc.parent_id, psc.subject,
                  COALESCE(p.first_name || ' ' || p.last_name, p.name) AS parent_name,
                  COALESCE(cu.first_name || ' ' || cu.last_name, cu.name) AS child_name
             FROM parent_school_conversations psc
             JOIN users p ON psc.parent_id = p.id
             LEFT JOIN student_profiles sp ON sp.id = psc.student_id
             LEFT JOIN users cu ON cu.id = sp.user_id
            WHERE psc.id = $1 AND psc.tenant_id = $2`,
          [conversationId, tenantId]
        );

        if (conversationCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Conversation not found',
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
        const senderName = senderResult.rows[0]?.sender_name || 'Admin';

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

        const convSubject = conversationCheck.rows[0]?.subject || "";
        const parentId = conversationCheck.rows[0]?.parent_id as string;
        const schoolName = await resolveTenantName(pool, tenantId);
        const delivery = await deliverMessage({
          pool,
          tenantId,
          sourceType: "admin_parent_conversation_message",
          sourceId: messageRow.id,
          recipientUserId: parentId,
          whatsappText: `${convSubject}\n\n${messageRow.content}`,
          sendWhatsapp: !!sendWhatsapp,
          sendEmail: !!sendEmail,
          templateKind: "admin_parent_reply",
          context: {
            recipientName: conversationCheck.rows[0]?.parent_name || "",
            subject: convSubject,
            message: messageRow.content,
            senderName,
            schoolName,
            portalUrl: PORTAL_URL,
            extra: {
              childName: conversationCheck.rows[0]?.child_name || "",
              conversationSubject: convSubject,
            },
          },
          log: fastify.log,
        });

        return reply.send({
          success: true,
          data: {
            whatsappStatus: delivery.whatsappStatus,
            emailStatus: delivery.emailStatus,
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

  // GET /api/v1/admin/messages/parents - Get list of parents with their children for conversation creation
  fastify.get('/parents', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Get list of parents with their children for conversation creation',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
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
                parents: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      children: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            name: { type: 'string' },
                          },
                        },
                      },
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
      const { search } = request.query as { search?: string };

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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get parents with their children
        let parentsQuery = `
          SELECT DISTINCT
            p.id as parent_id,
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name,
            p.email as parent_email,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM users p
          INNER JOIN user_roles ur ON ur.user_id = p.id AND ur.tenant_id = p.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          INNER JOIN student_parents sp_rel ON sp_rel.parent_id = p.id AND sp_rel.tenant_id = $1
          INNER JOIN student_profiles sp ON sp_rel.student_id = sp.id AND sp.tenant_id = $1
          INNER JOIN users u ON sp.user_id = u.id AND u.tenant_id = $1
          WHERE p.tenant_id = $1
        `;
        const params: any[] = [tenantId];

        if (search) {
          parentsQuery += ` AND (
            COALESCE(p.first_name || ' ' || p.last_name, p.name) ILIKE $2
            OR p.email ILIKE $2
            OR COALESCE(u.first_name || ' ' || u.last_name, u.name) ILIKE $2
          )`;
          params.push(`%${search}%`);
        }

        parentsQuery += ` ORDER BY parent_name, child_name`;

        const parentsResult = await pool.query(parentsQuery, params);

        // Group by parent
        const parentsMap = new Map<string, {
          id: string;
          name: string;
          email: string;
          children: Array<{ id: string; name: string }>;
        }>();

        parentsResult.rows.forEach((row: any) => {
          if (!parentsMap.has(row.parent_id)) {
            parentsMap.set(row.parent_id, {
              id: row.parent_id,
              name: row.parent_name,
              email: row.parent_email,
              children: [],
            });
          }
          const parent = parentsMap.get(row.parent_id)!;
          // Add child if not already added
          if (!parent.children.find(c => c.id === row.child_id)) {
            parent.children.push({
              id: row.child_id,
              name: row.child_name,
            });
          }
        });

        const parents = Array.from(parentsMap.values());

        return reply.send({
          success: true,
          data: {
            parents,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching parents for conversation',
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

  // GET /api/v1/admin/messages/students-by-class-with-parents — élèves d'une classe avec parent (sélection enfant → parent)
  fastify.get('/students-by-class-with-parents', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Students in a class with parent linkage',
      querystring: {
        type: 'object',
        required: ['classId'],
        properties: { classId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { classId } = request.query as { classId: string };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        const q = await pool.query(
          `SELECT DISTINCT
              sp.id AS "studentProfileId",
              COALESCE(su.first_name || ' ' || su.last_name, su.name) AS "studentName",
              sp_rel.parent_id AS "parentId",
              COALESCE(pu.first_name || ' ' || pu.last_name, pu.name) AS "parentName",
              pu.email AS "parentEmail"
           FROM student_enrollments se
           JOIN student_profiles sp ON sp.id = se.student_id AND sp.tenant_id = se.tenant_id
           JOIN users su ON su.id = sp.user_id
           JOIN student_parents sp_rel ON sp_rel.student_id = sp.id AND sp_rel.tenant_id = sp.tenant_id
           JOIN users pu ON pu.id = sp_rel.parent_id
           WHERE se.class_id = $1 AND se.tenant_id = $2 AND sp.status = 'active'
           ORDER BY "studentName", "parentName"`,
          [classId, tenantId]
        );
        return reply.send({ success: true, data: q.rows });
      } catch (error: any) {
        fastify.log.error({ msg: 'students-by-class-with-parents', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/admin/messages/bulk-parent-conversations — même message à plusieurs couples parent/enfant
  fastify.post('/bulk-parent-conversations', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Start parent conversations in bulk (classes and/or explicit student profiles)',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
          allClasses: { type: 'boolean' },
          classIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          studentProfileIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
          sendEmail: { type: 'boolean' },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const body = request.body as {
        allClasses?: boolean;
        classIds?: string[];
        studentProfileIds?: string[];
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
        sendEmail?: boolean;
      };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }
      const {
        subject,
        content,
        sendWhatsapp,
        sendEmail,
        allClasses,
        classIds = [],
        studentProfileIds = [],
      } = body;
      if (!subject?.trim() || !content?.trim()) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'subject and content required' });
      }
      if (!allClasses && classIds.length === 0 && studentProfileIds.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Indiquez allClasses, classIds et/ou studentProfileIds',
        });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        await ensureSchoolConversationsTables(pool);

        // Les noms parent/enfant sont récupérés dès la sélection des cibles :
        // le modèle d'email les personnalise pour chaque destinataire.
        type BulkTarget = { parentId: string; childId: string; parentName: string; childName: string };
        const pairSet = new Map<string, BulkTarget>();
        const collect = (rows: any[]) => {
          for (const row of rows) {
            pairSet.set(`${row.parent_id}:${row.child_id}`, {
              parentId: row.parent_id,
              childId: row.child_id,
              parentName: row.parent_name || '',
              childName: row.child_name || '',
            });
          }
        };

        if (studentProfileIds.length > 0) {
          const r = await pool.query(
            `SELECT DISTINCT sp_rel.parent_id, sp_rel.student_id AS child_id,
                    COALESCE(pu.first_name || ' ' || pu.last_name, pu.name) AS parent_name,
                    COALESCE(su.first_name || ' ' || su.last_name, su.name) AS child_name
             FROM student_parents sp_rel
             JOIN users pu ON pu.id = sp_rel.parent_id
             JOIN student_profiles sp ON sp.id = sp_rel.student_id AND sp.tenant_id = sp_rel.tenant_id
             JOIN users su ON su.id = sp.user_id
             WHERE sp_rel.tenant_id = $1 AND sp_rel.student_id = ANY($2::uuid[])`,
            [tenantId, studentProfileIds]
          );
          collect(r.rows);
        }

        let classIdList = [...classIds];
        if (allClasses) {
          const cls = await pool.query(`SELECT id FROM classes WHERE tenant_id = $1`, [tenantId]);
          classIdList = cls.rows.map((x: any) => x.id);
        }
        if (classIdList.length > 0) {
          const r = await pool.query(
            `SELECT DISTINCT sp_rel.parent_id, se.student_id AS child_id,
                    COALESCE(pu.first_name || ' ' || pu.last_name, pu.name) AS parent_name,
                    COALESCE(su.first_name || ' ' || su.last_name, su.name) AS child_name
             FROM student_enrollments se
             JOIN student_parents sp_rel ON sp_rel.student_id = se.student_id AND sp_rel.tenant_id = se.tenant_id
             JOIN users pu ON pu.id = sp_rel.parent_id
             JOIN student_profiles sp ON sp.id = se.student_id AND sp.tenant_id = se.tenant_id
             JOIN users su ON su.id = sp.user_id
             WHERE se.tenant_id = $1 AND se.class_id = ANY($2::uuid[])`,
            [tenantId, classIdList]
          );
          collect(r.rows);
        }

        const pairs = Array.from(pairSet.values());
        if (pairs.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Aucun parent/élève trouvé pour les critères choisis',
          });
        }

        // Chargés une seule fois : un envoi groupé peut viser des centaines de
        // parents, inutile de relire le modèle et le nom de l'école à chaque tour.
        const senderName = await resolveSenderName(pool, userId);
        const schoolName = await resolveTenantName(pool, tenantId);
        const emailTemplate = sendEmail
          ? await loadTenantMessageTemplate(pool, tenantId, 'admin_parent_bulk')
          : undefined;

        let created = 0;
        const emailStatuses: string[] = [];
        for (const { parentId, childId, parentName, childName } of pairs) {
          const relationshipCheck = await pool.query(
            `SELECT id FROM student_parents 
             WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
            [parentId, childId, tenantId]
          );
          if (relationshipCheck.rows.length === 0) continue;

          const conversationResult = await pool.query(
            `INSERT INTO parent_school_conversations (tenant_id, parent_id, student_id, subject, status)
             VALUES ($1, $2, $3, $4, 'active')
             RETURNING id`,
            [tenantId, parentId, childId, subject.trim()]
          );
          const conversationId = conversationResult.rows[0].id;

          const messageResult = await pool.query(
            `INSERT INTO parent_school_conversation_messages (tenant_id, conversation_id, sender_id, content)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [tenantId, conversationId, userId, content.trim()]
          );
          const messageId = messageResult.rows[0].id;
          const delivery = await deliverMessage({
            pool,
            tenantId,
            sourceType: 'admin_parent_conversation_message',
            sourceId: messageId,
            recipientUserId: parentId,
            whatsappText: `${subject.trim()}\n\n${content.trim()}`,
            sendWhatsapp: !!sendWhatsapp,
            sendEmail: !!sendEmail,
            templateKind: 'admin_parent_bulk',
            template: emailTemplate,
            context: {
              recipientName: parentName,
              subject: subject.trim(),
              message: content.trim(),
              senderName,
              schoolName,
              portalUrl: PORTAL_URL,
              extra: { childName },
            },
            log: fastify.log,
          });
          emailStatuses.push(delivery.emailStatus);
          created++;
        }

        return reply.status(201).send({
          success: true,
          data: {
            created,
            totalTargets: pairs.length,
            emailSummary: sendEmail ? summarizeStatuses(emailStatuses) : undefined,
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: 'bulk-parent-conversations', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/admin/messages/conversations - Start a new conversation with a parent
  fastify.post('/conversations', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Start a new conversation with a parent',
      body: {
        type: 'object',
        required: ['parentId', 'childId', 'subject', 'content'],
        properties: {
          parentId: { type: 'string', format: 'uuid' },
          childId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
          sendEmail: { type: 'boolean' },
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
                emailStatus: { type: 'string' },
                conversation: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    parentId: { type: 'string', format: 'uuid' },
                    parentName: { type: 'string' },
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
      const { parentId, childId, subject, content, sendWhatsapp, sendEmail } = request.body as {
        parentId: string;
        childId: string;
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
        sendEmail?: boolean;
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      if (!parentId || !childId || !subject || !content) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'parentId, childId, subject, and content are required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Ensure tables exist
        await ensureSchoolConversationsTables(pool);

        // Verify parent-child relationship
        const relationshipCheck = await pool.query(
          `SELECT id FROM student_parents 
           WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
          [parentId, childId, tenantId]
        );

        if (relationshipCheck.rows.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Child is not linked to this parent',
          });
        }

        // Get parent name
        const parentInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as parent_name
          FROM users
          WHERE id = $1
        `, [parentId]);

        if (parentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        const parentName = parentInfo.rows[0].parent_name;

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

        // Get admin name
        const adminInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as admin_name
          FROM users
          WHERE id = $1
        `, [userId]);

        const adminName = adminInfo.rows[0]?.admin_name || 'Admin';

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
        `, [tenantId, parentId, childId, subject]);

        const conversationId = conversationResult.rows[0].id;
        const createdAt = conversationResult.rows[0].created_at;

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
        `, [tenantId, conversationId, userId, content]);

        const messageId = messageResult.rows[0].id;
        const sentAt = messageResult.rows[0].sent_at;

        const schoolName = await resolveTenantName(pool, tenantId);
        const delivery = await deliverMessage({
          pool,
          tenantId,
          sourceType: "admin_parent_conversation_message",
          sourceId: messageId,
          recipientUserId: parentId,
          whatsappText: `${subject}\n\n${content}`,
          sendWhatsapp: !!sendWhatsapp,
          sendEmail: !!sendEmail,
          templateKind: "admin_parent_new",
          context: {
            recipientName: parentName,
            subject,
            message: content,
            senderName: adminName,
            schoolName,
            portalUrl: PORTAL_URL,
            extra: { childName },
          },
          log: fastify.log,
        });

        return reply.status(201).send({
          success: true,
          data: {
            whatsappStatus: delivery.whatsappStatus,
            emailStatus: delivery.emailStatus,
            conversation: {
              id: conversationId,
              parentId,
              parentName,
              childId,
              childName,
              subject,
              status: 'active',
              createdAt,
            },
            message: {
              id: messageId,
              senderId: userId,
              senderName: adminName,
              content,
              sentAt,
            },
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error creating conversation from admin',
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

  // GET /api/v1/admin/messages/teacher-messages - List all teacher messages (admin view)
  fastify.get('/teacher-messages', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'List all teacher messages (admin view)',
      querystring: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
          parentId: { type: 'string', format: 'uuid' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
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
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      teacherId: { type: 'string', format: 'uuid' },
                      teacherName: { type: 'string' },
                      parentId: { type: 'string', format: 'uuid' },
                      parentName: { type: 'string' },
                      subject: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', nullable: true },
                      sentAt: { type: 'string' },
                      isRead: { type: 'boolean' },
                      readAt: { type: 'string', nullable: true },
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
      const {
        childId,
        teacherId,
        parentId,
        startDate,
        endDate,
        priorityLevel,
        page = 1,
        limit = 20,
      } = request.query as {
        childId?: string;
        teacherId?: string;
        parentId?: string;
        startDate?: string;
        endDate?: string;
        priorityLevel?: string;
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Build where conditions
        const whereConditions: string[] = [];
        const queryParams: any[] = [];
        let paramIndex = 1;

        whereConditions.push(`tm.tenant_id = $${paramIndex}`);
        queryParams.push(tenantId);
        paramIndex++;

        if (childId) {
          whereConditions.push(`tm.student_id = $${paramIndex}`);
          queryParams.push(childId);
          paramIndex++;
        }

        if (teacherId) {
          whereConditions.push(`tm.teacher_id = $${paramIndex}`);
          queryParams.push(teacherId);
          paramIndex++;
        }

        if (parentId) {
          whereConditions.push(`tm.parent_id = $${paramIndex}`);
          queryParams.push(parentId);
          paramIndex++;
        }

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

        if (priorityLevel) {
          whereConditions.push(`tm.priority_level = $${paramIndex}`);
          queryParams.push(priorityLevel);
          paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total messages
        const countQuery = `
          SELECT COUNT(*) as total
          FROM teacher_messages tm
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query messages with pagination
        const messagesQuery = `
          SELECT 
            tm.id,
            tm.teacher_id,
            tm.student_id as child_id,
            tm.parent_id,
            tm.subject,
            tm.content,
            tm.priority_level,
            tm.sent_at,
            tm.read_at,
            COALESCE(t.first_name || ' ' || t.last_name, t.name) as teacher_name,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name
          FROM teacher_messages tm
          JOIN users t ON tm.teacher_id = t.id
          JOIN student_profiles sp ON tm.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN users p ON tm.parent_id = p.id
          ${whereClause}
          ORDER BY tm.sent_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const messagesResult = await pool.query(messagesQuery, [...queryParams, limit, offset]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          childId: row.child_id,
          childName: row.child_name,
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          parentId: row.parent_id,
          parentName: row.parent_name,
          subject: row.subject,
          content: row.content,
          priorityLevel: row.priority_level,
          sentAt: row.sent_at,
          isRead: !!row.read_at,
          readAt: row.read_at,
        }));

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
          msg: 'Error fetching admin teacher messages',
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

  // POST /api/v1/admin/messages/send-to-teachers - Send message to one or multiple teachers
  fastify.post('/send-to-teachers', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Send message to one or multiple teachers',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
          teacherIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          allTeachers: { type: 'boolean' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          sendWhatsapp: { type: 'boolean' },
          sendEmail: { type: 'boolean' },
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
                message: { type: 'string' },
                sentTo: { type: 'number' },
                emailSummary: { type: 'object', additionalProperties: { type: 'number' } },
              },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      let {
        teacherIds = [],
        subject,
        content,
        priorityLevel,
        allTeachers,
        sendWhatsapp,
        sendEmail,
      } = request.body as {
        teacherIds?: string[];
        subject: string;
        content: string;
        priorityLevel?: string;
        allTeachers?: boolean;
        sendWhatsapp?: boolean;
        sendEmail?: boolean;
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      if (!subject || !content) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'subject and content are required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        if (allTeachers) {
          const allT = await pool.query(
            `SELECT DISTINCT t.user_id AS id
             FROM teachers t
             WHERE t.tenant_id = $1 AND t.user_id IS NOT NULL`,
            [tenantId]
          );
          teacherIds = allT.rows.map((row: any) => row.id);
        }

        if (!teacherIds || teacherIds.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Sélectionnez au moins un enseignant ou utilisez allTeachers: true',
          });
        }

        // Ensure admin_teacher_messages table exists
        const tableCheck = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'admin_teacher_messages'
          )`
        );

        if (!tableCheck.rows[0].exists) {
          await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

          await pool.query(
            `CREATE TABLE admin_teacher_messages (
              id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
              tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              subject VARCHAR(255) NOT NULL,
              content TEXT NOT NULL,
              priority_level VARCHAR(20),
              sent_at TIMESTAMPTZ DEFAULT NOW(),
              read_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )`
          );

          await pool.query(
            `CREATE INDEX idx_admin_teacher_messages_tenant_teacher 
             ON admin_teacher_messages(tenant_id, teacher_id)`
          );

          await pool.query(
            `CREATE INDEX idx_admin_teacher_messages_admin 
             ON admin_teacher_messages(tenant_id, admin_id)`
          );

          await pool.query('ALTER TABLE admin_teacher_messages ENABLE ROW LEVEL SECURITY');

          await pool.query(
            `CREATE POLICY admin_teacher_messages_tenant_isolation
             ON admin_teacher_messages
             FOR ALL
             USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`
          );
        }

        // Verify all teachers exist and belong to tenant
        const teachersPlaceholders = teacherIds.map((_, i) => `$${i + 1}`).join(', ');
        const teachersCheck = await pool.query(
          `SELECT t.user_id, u.id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as teacher_name
           FROM teachers t
           JOIN users u ON t.user_id = u.id
           WHERE t.user_id IN (${teachersPlaceholders}) AND t.tenant_id = $${teacherIds.length + 1}
           AND u.tenant_id = $${teacherIds.length + 1}`,
          [...teacherIds, tenantId]
        );

        if (teachersCheck.rows.length !== teacherIds.length) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'One or more teachers not found or do not belong to this tenant',
          });
        }

        // Get admin name
        const adminName = await resolveSenderName(pool, userId);
        const schoolName = await resolveTenantName(pool, tenantId);
        const teacherNames = new Map<string, string>(
          teachersCheck.rows.map((row: any) => [row.user_id, row.teacher_name || ''])
        );
        const emailTemplate = sendEmail
          ? await loadTenantMessageTemplate(pool, tenantId, 'admin_teacher')
          : undefined;

        // Insert messages for each teacher
        const deliveries = await Promise.all(
          teacherIds.map(async (teacherId: string) => {
            const ins = await pool.query(
              `INSERT INTO admin_teacher_messages (
                tenant_id,
                admin_id,
                teacher_id,
                subject,
                content,
                priority_level
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id`,
              [tenantId, userId, teacherId, subject, content, priorityLevel || null]
            );
            const mid = ins.rows[0]?.id;
            if (!mid) return null;
            return deliverMessage({
              pool,
              tenantId,
              sourceType: "admin_teacher_message",
              sourceId: mid,
              recipientUserId: teacherId,
              whatsappText: `${subject}\n\n${content}`,
              sendWhatsapp: !!sendWhatsapp,
              sendEmail: !!sendEmail,
              templateKind: 'admin_teacher',
              template: emailTemplate,
              context: {
                recipientName: teacherNames.get(teacherId) || '',
                subject,
                message: content,
                senderName: adminName,
                schoolName,
                priorityLevel,
                portalUrl: PORTAL_URL,
              },
              log: fastify.log,
            });
          })
        );

        return reply.status(201).send({
          success: true,
          data: {
            message: 'Messages envoyés avec succès',
            sentTo: teacherIds.length,
            emailSummary: sendEmail
              ? summarizeStatuses(deliveries.filter(Boolean).map((d: any) => d.emailStatus))
              : undefined,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error sending messages to teachers',
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

  // POST /api/v1/admin/messages/send-to-students - Send announcement to students
  fastify.post('/send-to-students', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Send announcement to students by class or individually',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
          classIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Array of class IDs to send to all students in those classes',
          },
          studentIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Array of student profile IDs to send individually',
          },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          sendWhatsapp: { type: 'boolean' },
          sendEmail: { type: 'boolean' },
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
                message: { type: 'string' },
                sentTo: { type: 'number' },
                emailSummary: { type: 'object', additionalProperties: { type: 'number' } },
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const {
        classIds = [],
        studentIds = [],
        subject,
        content,
        priorityLevel,
        sendWhatsapp,
        sendEmail,
      } = request.body as any;

      if (classIds.length === 0 && studentIds.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Either classIds or studentIds must be provided',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Ensure admin_student_messages table exists
        await pool.query(`
          CREATE TABLE IF NOT EXISTS admin_student_messages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            priority_level VARCHAR(20),
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_student_messages_tenant 
          ON admin_student_messages(tenant_id)
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_student_messages_student 
          ON admin_student_messages(student_id)
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_student_messages_admin 
          ON admin_student_messages(admin_id)
        `);

        // Enable RLS if not already enabled
        try {
          await pool.query('ALTER TABLE admin_student_messages ENABLE ROW LEVEL SECURITY');
        } catch (e: any) {
          if (!e.message.includes('already enabled')) {
            throw e;
          }
        }

        // Create RLS policy if not exists
        try {
          // Check if policy already exists
          const policyCheck = await pool.query(`
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = 'admin_student_messages' 
            AND policyname = 'admin_student_messages_tenant_isolation'
          `);
          
          if (policyCheck.rows.length === 0) {
            await pool.query(`
              CREATE POLICY admin_student_messages_tenant_isolation
              ON admin_student_messages
              FOR ALL
              USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            `);
          }
        } catch (e: any) {
          // If policy check fails, try to create it anyway (might be permission issue)
          // Check for both English and French error messages
          if (!e.message.includes('already exists') && !e.message.includes('existe déjà') && !e.message.includes('duplicate key')) {
            fastify.log.warn({
              msg: 'Error checking/creating RLS policy for admin_student_messages',
              error: e.message,
            });
            // Don't throw - policy might already exist
          }
        }

        let targetStudentIds: string[] = [];

        // If classIds provided, get all students from those classes
        if (classIds.length > 0) {
          const classIdsPlaceholders = classIds.map((_, i) => `$${i + 1}`).join(', ');
          const studentsFromClasses = await pool.query(
            `SELECT DISTINCT sp.id
             FROM student_profiles sp
             JOIN student_enrollments se ON sp.id = se.student_id
             WHERE se.class_id IN (${classIdsPlaceholders}) 
               AND sp.tenant_id = $${classIds.length + 1}
               AND se.tenant_id = $${classIds.length + 1}
               AND sp.status = 'active'`,
            [...classIds, tenantId]
          );
          targetStudentIds = studentsFromClasses.rows.map((row: any) => row.id);
        }

        // If studentIds provided, add them to the list
        if (studentIds.length > 0) {
          // Verify all students exist and belong to tenant
          const studentsPlaceholders = studentIds.map((_, i) => `$${i + 1}`).join(', ');
          const studentsCheck = await pool.query(
            `SELECT id FROM student_profiles 
             WHERE id IN (${studentsPlaceholders}) AND tenant_id = $${studentIds.length + 1}`,
            [...studentIds, tenantId]
          );

          if (studentsCheck.rows.length !== studentIds.length) {
            return reply.status(400).send({
              success: false,
              error: 'Bad Request',
              message: 'One or more students not found or do not belong to this tenant',
            });
          }

          // Add studentIds to target list (avoid duplicates)
          const existingIds = new Set(targetStudentIds);
          studentIds.forEach((id: string) => {
            if (!existingIds.has(id)) {
              targetStudentIds.push(id);
            }
          });
        }

        if (targetStudentIds.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'No students found to send message to',
          });
        }

        // Get admin name
        const adminName = await resolveSenderName(pool, userId);
        const schoolName = await resolveTenantName(pool, tenantId);
        const emailTemplate = sendEmail
          ? await loadTenantMessageTemplate(pool, tenantId, 'admin_student')
          : undefined;

        // Compte utilisateur et nom de chaque étudiant ciblé, en une requête.
        const studentAccounts = await pool.query(
          `SELECT sp.id, sp.user_id,
                  COALESCE(u.first_name || ' ' || u.last_name, u.name) AS student_name
             FROM student_profiles sp
             JOIN users u ON u.id = sp.user_id
            WHERE sp.id = ANY($1::uuid[]) AND sp.tenant_id = $2`,
          [targetStudentIds, tenantId]
        );
        const accountByProfile = new Map<string, { userId: string; name: string }>(
          studentAccounts.rows.map((row: any) => [row.id, { userId: row.user_id, name: row.student_name || '' }])
        );

        // Insert messages for each student
        const deliveries = await Promise.all(
          targetStudentIds.map(async (studentProfileId: string) => {
            const ins = await pool.query(
              `INSERT INTO admin_student_messages (
                tenant_id,
                admin_id,
                student_id,
                subject,
                content,
                priority_level
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id`,
              [tenantId, userId, studentProfileId, subject, content, priorityLevel || null]
            );
            const mid = ins.rows[0]?.id;
            const account = accountByProfile.get(studentProfileId);
            if (!mid || !account?.userId) return null;
            return deliverMessage({
              pool,
              tenantId,
              sourceType: 'admin_student_message',
              sourceId: mid,
              recipientUserId: account.userId,
              whatsappText: `${subject}\n\n${content}`,
              sendWhatsapp: !!sendWhatsapp,
              sendEmail: !!sendEmail,
              templateKind: 'admin_student',
              template: emailTemplate,
              context: {
                recipientName: account.name,
                subject,
                message: content,
                senderName: adminName,
                schoolName,
                priorityLevel,
                portalUrl: PORTAL_URL,
              },
              log: fastify.log,
            });
          })
        );

        fastify.log.info({
          msg: 'Admin announcement sent to students',
          userId,
          tenantId,
          sentTo: targetStudentIds.length,
          classIds: classIds.length,
          studentIds: studentIds.length,
        });

        return reply.status(201).send({
          success: true,
          data: {
            message: `Annonce envoyée à ${targetStudentIds.length} étudiant(s) avec succès`,
            sentTo: targetStudentIds.length,
            emailSummary: sendEmail
              ? summarizeStatuses(deliveries.filter(Boolean).map((d: any) => d.emailStatus))
              : undefined,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error sending announcement to students',
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

  // GET /api/v1/admin/messages/students-by-class - Get students by class (for admin)
  fastify.get('/students-by-class', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Get students by class for admin',
      querystring: {
        type: 'object',
        required: ['classId'],
        properties: {
          classId: { type: 'string', format: 'uuid' },
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
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  email: { type: 'string' },
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r))) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const { classId } = request.query as any;

      if (!classId) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'classId is required',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get students enrolled in the class
        const studentsQuery = await pool.query(
          `SELECT
            sp.id,
            u.first_name as "firstName",
            u.last_name as "lastName",
            u.email
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          JOIN student_enrollments se ON sp.id = se.student_id
          WHERE se.class_id = $1 
            AND sp.tenant_id = $2
            AND se.tenant_id = $2
            AND sp.status = 'active'
          ORDER BY u.last_name, u.first_name`,
          [classId, tenantId]
        );

        const students = studentsQuery.rows;

        return reply.send({
          success: true,
          data: students,
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching students by class',
          userId,
          tenantId,
          classId,
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

  /* ======================================================================
   * Modèles d'email — un modèle personnalisable par type d'envoi
   * ==================================================================== */

  /** Valide un couple sujet/corps reçu du client. `null` = payload invalide. */
  function parseTemplatePayload(value: unknown): MessageEmailTemplate | null {
    const candidate = value as Partial<MessageEmailTemplate> | null | undefined;
    const subject = typeof candidate?.subject === 'string' ? candidate.subject.trim() : '';
    const body = typeof candidate?.body === 'string' ? candidate.body.trim() : '';
    if (!subject || subject.length > 255) return null;
    if (!body || body.length > 50_000) return null;
    return { subject, body };
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Schéma de paramètre commun aux routes `:kind`. */
  const KIND_PARAMS = {
    type: 'object',
    required: ['kind'],
    properties: { kind: { type: 'string', enum: MESSAGE_TEMPLATE_KINDS } },
  } as const;

  /** Métadonnées statiques d'un modèle, partagées par toutes les réponses. */
  function templateMeta(kind: MessageTemplateKind) {
    const definition = MESSAGE_TEMPLATE_DEFINITIONS[kind];
    return {
      kind,
      profile: definition.profile,
      profileLabel: MESSAGE_TEMPLATE_PROFILE_LABELS[definition.profile],
      label: definition.label,
      description: definition.description,
      accent: definition.accent,
      variables: definition.variables,
      defaults: definition.defaults,
    };
  }

  // GET /api/v1/admin/messages/email-templates — tous les modèles du tenant
  fastify.get('/email-templates', {
    schema: {
      tags: ['Admin Messages'],
      summary: "Modèles d'email des messages administratifs",
      querystring: { type: 'object', properties: {} },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant Required', message: 'Tenant context requis' });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }

      try {
        const [templates, schoolName] = await Promise.all([
          loadTenantMessageTemplates(pool, tenantId),
          resolveTenantName(pool, tenantId),
        ]);

        return reply.send({
          success: true,
          data: {
            emailConfigured: emailService.isConfigured(),
            schoolName,
            portalUrl: PORTAL_URL,
            logoUrl: emailLogoPreviewUrl(WEB_ORIGIN),
            templates: MESSAGE_TEMPLATE_KINDS.map((kind) => ({
              ...templateMeta(kind),
              ...templates[kind],
              isCustomized:
                templates[kind].subject !== MESSAGE_TEMPLATE_DEFINITIONS[kind].defaults.subject ||
                templates[kind].body !== MESSAGE_TEMPLATE_DEFINITIONS[kind].defaults.body,
            })),
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: 'Error loading message email templates', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // PUT /api/v1/admin/messages/email-templates/:kind — personnalise un modèle
  fastify.put('/email-templates/:kind', {
    schema: { tags: ['Admin Messages'], summary: "Enregistre un modèle d'email", params: KIND_PARAMS },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const { kind } = request.params as { kind: string };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant Required', message: 'Tenant context requis' });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }
      if (!isMessageTemplateKind(kind)) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: "Type de modèle inconnu" });
      }

      const parsed = parseTemplatePayload(request.body);
      if (!parsed) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Le sujet et le corps du modèle sont requis',
        });
      }

      try {
        await saveTenantMessageTemplate(pool, tenantId, kind, parsed);
        return reply.send({ success: true, data: { ...templateMeta(kind), ...parsed, isCustomized: true } });
      } catch (error: any) {
        fastify.log.error({ msg: 'Error saving message email template', kind, error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // DELETE /api/v1/admin/messages/email-templates/:kind — retour au modèle par défaut
  fastify.delete('/email-templates/:kind', {
    schema: { tags: ['Admin Messages'], summary: "Réinitialise un modèle d'email", params: KIND_PARAMS },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const { kind } = request.params as { kind: string };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant Required', message: 'Tenant context requis' });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }
      if (!isMessageTemplateKind(kind)) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: "Type de modèle inconnu" });
      }

      try {
        await resetTenantMessageTemplate(pool, tenantId, kind);
        const defaults = MESSAGE_TEMPLATE_DEFINITIONS[kind].defaults;
        return reply.send({ success: true, data: { ...templateMeta(kind), ...defaults, isCustomized: false } });
      } catch (error: any) {
        fastify.log.error({ msg: 'Error resetting message email template', kind, error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/admin/messages/email-templates/:kind/preview — rendu HTML
  fastify.post('/email-templates/:kind/preview', {
    schema: { tags: ['Admin Messages'], summary: "Aperçu HTML d'un modèle d'email", params: KIND_PARAMS },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { kind } = request.params as { kind: string };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant Required', message: 'Tenant context requis' });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }
      if (!isMessageTemplateKind(kind)) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: "Type de modèle inconnu" });
      }

      try {
        // Le brouillon en cours d'édition prime ; sinon on rend le modèle enregistré.
        const draft = parseTemplatePayload((request.body as any)?.template);
        const template: MessageEmailTemplate =
          draft ?? (await loadTenantMessageTemplate(pool, tenantId, kind));

        const [schoolName, senderName] = await Promise.all([
          resolveTenantName(pool, tenantId),
          resolveSenderName(pool, userId),
        ]);

        const context = buildSampleContext(kind, { schoolName, senderName, portalUrl: PORTAL_URL });
        // Aperçu navigateur : le logo est servi en http, pas en CID.
        const rendered = renderMessageEmail(kind, template, context, {
          logoSrc: emailLogoPreviewUrl(WEB_ORIGIN),
        });

        return reply.send({ success: true, data: { kind, ...rendered } });
      } catch (error: any) {
        fastify.log.error({ msg: 'Error previewing message email template', kind, error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/admin/messages/email-templates/:kind/test — email de test
  fastify.post('/email-templates/:kind/test', {
    schema: { tags: ['Admin Messages'], summary: "Envoie un email de test avec le modèle", params: KIND_PARAMS },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { kind } = request.params as { kind: string };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant Required', message: 'Tenant context requis' });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }
      if (!isMessageTemplateKind(kind)) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: "Type de modèle inconnu" });
      }
      if (!emailService.isConfigured()) {
        return reply.status(503).send({
          success: false,
          error: 'Email Not Configured',
          message:
            "Service email non configuré (variables SMTP_HOST / SMTP_USER / SMTP_PASSWORD manquantes).",
        });
      }

      const rawTo = (request.body as any)?.to;
      const to = typeof rawTo === 'string' ? rawTo.trim() : '';
      if (!EMAIL_RE.test(to)) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'Adresse email de test invalide',
        });
      }

      try {
        const draft = parseTemplatePayload((request.body as any)?.template);
        const template: MessageEmailTemplate =
          draft ?? (await loadTenantMessageTemplate(pool, tenantId, kind));

        const [schoolName, senderName] = await Promise.all([
          resolveTenantName(pool, tenantId),
          resolveSenderName(pool, userId),
        ]);

        const context = buildSampleContext(kind, { schoolName, senderName, portalUrl: PORTAL_URL });
        const { subject, html, text } = renderMessageEmail(kind, template, context);

        await emailService.sendEmail({
          to,
          subject: `[TEST] ${subject}`,
          html,
          text,
          attachments: emailLogoAttachments(),
        });

        return reply.send({ success: true, data: { sentTo: to } });
      } catch (error: any) {
        fastify.log.error({ msg: 'Error sending test email', kind, error: error.message });
        return reply.status(502).send({
          success: false,
          error: 'Email Send Failed',
          message: error.message || "Échec de l'envoi de l'email de test",
        });
      }
    },
  });

  // GET /api/v1/admin/messages/delivery-log — journal des relais WhatsApp / email
  fastify.get('/delivery-log', {
    schema: {
      tags: ['Admin Messages'],
      summary: 'Journal des envois relayés (WhatsApp, email)',
      querystring: {
        type: 'object',
        properties: {
          channel: { type: 'string', enum: ['whatsapp', 'email'] },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const { channel, limit = 25 } = request.query as { channel?: string; limit?: number };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant Required', message: 'Tenant context requis' });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Admin role required' });
      }

      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        await ensureDeliveryLogChannelColumn(pool);

        const params: any[] = [tenantId];
        let where = 'WHERE l.tenant_id = $1';
        if (channel) {
          params.push(channel);
          where += ` AND l.channel = $${params.length}`;
        }
        params.push(limit);

        const result = await pool.query(
          `SELECT l.id, l.channel, l.source_type, l.status, l.message_preview,
                  l.phone_e164, l.recipient_address, l.error_message, l.created_at,
                  COALESCE(u.first_name || ' ' || u.last_name, u.name) AS recipient_name
             FROM app_whatsapp_delivery_log l
             LEFT JOIN users u ON u.id = l.recipient_user_id
             ${where}
             ORDER BY l.created_at DESC
             LIMIT $${params.length}`,
          params
        );

        return reply.send({
          success: true,
          data: result.rows.map((row: any) => ({
            id: row.id,
            channel: row.channel || 'whatsapp',
            sourceType: row.source_type,
            status: row.status,
            preview: row.message_preview,
            recipientName: row.recipient_name,
            recipientAddress: row.recipient_address || row.phone_e164,
            errorMessage: row.error_message,
            createdAt: row.created_at,
          })),
        });
      } catch (error: any) {
        // La table n'existe pas tant qu'aucun envoi n'a eu lieu : journal vide.
        fastify.log.warn({ msg: 'delivery-log unavailable', error: error.message });
        return reply.send({ success: true, data: [] });
      }
    },
  });
}
