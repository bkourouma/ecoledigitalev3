import { FastifyInstance } from "fastify";
import {
  PORTAL_URL,
  deliverMessage,
  resolveAdminRecipients,
  resolveDisplayName,
  summarizeStatuses,
} from "../services/message-delivery";
import { loadTenantMessageTemplate } from "../services/message-email-templates";
import { resolveTenantName } from "../services/teacher-credentials-email";

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

export async function studentMessagesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/student/messages/admin-messages - Get messages sent by admin to this student
  fastify.get('/admin-messages', {
    schema: {
      tags: ['Student Messages'],
      summary: 'Get messages sent by admin to this student',
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
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      subject: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', nullable: true },
                      sentAt: { type: 'string' },
                      readAt: { type: 'string', nullable: true },
                      isRead: { type: 'boolean' },
                      adminName: { type: 'string' },
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

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify student exists
        const studentInfo = await pool.query(
          `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );

        if (studentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Student profile not found',
          });
        }

        const studentId = studentInfo.rows[0].id;

        // Get query parameters
        const { startDate, endDate, priorityLevel, readStatus = 'all', page = 1, limit = 20 } = request.query as any;

        // Build where conditions
        const whereConditions: string[] = [];
        const queryParams: any[] = [];
        let paramIndex = 1;

        // Always include student_id and tenant_id
        whereConditions.push(`asm.student_id = $${paramIndex}`);
        queryParams.push(studentId);
        paramIndex++;

        whereConditions.push(`asm.tenant_id = $${paramIndex}`);
        queryParams.push(tenantId);
        paramIndex++;

        if (startDate) {
          whereConditions.push(`asm.sent_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`asm.sent_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        if (priorityLevel) {
          whereConditions.push(`asm.priority_level = $${paramIndex}`);
          queryParams.push(priorityLevel);
          paramIndex++;
        }

        if (readStatus === 'read') {
          whereConditions.push(`asm.read_at IS NOT NULL`);
        } else if (readStatus === 'unread') {
          whereConditions.push(`asm.read_at IS NULL`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total messages
        const countQuery = `
          SELECT COUNT(*) as total
          FROM admin_student_messages asm
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query messages with pagination
        const messagesQuery = `
          SELECT 
            asm.id,
            asm.subject,
            asm.content,
            asm.priority_level,
            asm.sent_at,
            asm.read_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as admin_name
          FROM admin_student_messages asm
          JOIN users u ON asm.admin_id = u.id
          ${whereClause}
          ORDER BY asm.sent_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const messagesResult = await pool.query(messagesQuery, [...queryParams, limit, offset]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          subject: row.subject,
          content: row.content,
          priorityLevel: row.priority_level,
          sentAt: row.sent_at,
          readAt: row.read_at,
          isRead: !!row.read_at,
          adminName: row.admin_name,
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
          msg: 'Error fetching admin messages for student',
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

  // GET /api/v1/student/messages/teacher-messages - Get messages sent by teachers to this student
  fastify.get('/teacher-messages', {
    schema: {
      tags: ['Student Messages'],
      summary: 'Get messages sent by teachers to this student',
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
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      subject: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', nullable: true },
                      sentAt: { type: 'string' },
                      readAt: { type: 'string', nullable: true },
                      isRead: { type: 'boolean' },
                      teacherName: { type: 'string' },
                      teacherId: { type: 'string' },
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

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify student exists
        const studentInfo = await pool.query(
          `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );

        if (studentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Student profile not found',
          });
        }

        const studentId = studentInfo.rows[0].id;

        // Get query parameters
        const { startDate, endDate, priorityLevel, readStatus = 'all', page = 1, limit = 20 } = request.query as any;

        // Build where conditions
        const whereConditions: string[] = [];
        const queryParams: any[] = [];
        let paramIndex = 1;

        // Always include student_id and tenant_id
        whereConditions.push(`tm.student_id = $${paramIndex}`);
        queryParams.push(studentId);
        paramIndex++;

        whereConditions.push(`tm.tenant_id = $${paramIndex}`);
        queryParams.push(tenantId);
        paramIndex++;

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

        if (readStatus === 'read') {
          whereConditions.push(`tm.read_at IS NOT NULL`);
        } else if (readStatus === 'unread') {
          whereConditions.push(`tm.read_at IS NULL`);
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
            tm.subject,
            tm.content,
            tm.priority_level,
            tm.sent_at,
            tm.read_at,
            tm.teacher_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as teacher_name
          FROM teacher_messages tm
          JOIN users u ON tm.teacher_id = u.id
          ${whereClause}
          ORDER BY tm.sent_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const messagesResult = await pool.query(messagesQuery, [...queryParams, limit, offset]);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          subject: row.subject,
          content: row.content,
          priorityLevel: row.priority_level,
          sentAt: row.sent_at,
          readAt: row.read_at,
          isRead: !!row.read_at,
          teacherName: row.teacher_name,
          teacherId: row.teacher_id,
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
          msg: 'Error fetching teacher messages for student',
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

  // POST /api/v1/student/messages/reply-to-teacher - Reply to a teacher message
  fastify.post('/reply-to-teacher', {
    schema: {
      tags: ['Student Messages'],
      summary: 'Reply to a teacher message',
      body: {
        type: 'object',
        required: ['messageId', 'teacherId', 'content'],
        properties: {
          messageId: { type: 'string', format: 'uuid' },
          teacherId: { type: 'string', format: 'uuid' },
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
                message: { type: 'string' },
                whatsappStatus: { type: 'string' },
                emailStatus: { type: 'string' },
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

      const { messageId, teacherId, content, sendWhatsapp, sendEmail } = request.body as any;

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

        // Verify student exists
        const studentInfo = await pool.query(
          `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );

        if (studentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Student profile not found',
          });
        }

        const studentId = studentInfo.rows[0].id;

        // Verify the message exists and belongs to this student
        const messageCheck = await pool.query(
          `SELECT id, teacher_id, student_id, subject FROM teacher_messages
           WHERE id = $1 AND student_id = $2 AND tenant_id = $3`,
          [messageId, studentId, tenantId]
        );

        if (messageCheck.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Message not found or access denied',
          });
        }

        const message = messageCheck.rows[0];

        // Verify teacherId matches
        if (message.teacher_id !== teacherId) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'Teacher ID mismatch',
          });
        }

        // Get student name
        const studentInfo2 = await pool.query(
          `SELECT COALESCE(first_name || ' ' || last_name, name) as student_name
           FROM users
           WHERE id = $1`,
          [userId]
        );
        const studentName = studentInfo2.rows[0]?.student_name || 'Étudiant';

        // Create a reply message - we'll store it in a student_replies table or similar
        // For now, we'll create a simple reply mechanism
        // In a production system, you might want to create a conversation thread
        
        // Create student_replies table if it doesn't exist
        await pool.query(`
          CREATE TABLE IF NOT EXISTS student_replies (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
            teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            original_message_id UUID NOT NULL REFERENCES teacher_messages(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_student_replies_tenant 
          ON student_replies(tenant_id)
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_student_replies_message 
          ON student_replies(original_message_id)
        `);

        // Enable RLS if not already enabled
        try {
          await pool.query('ALTER TABLE student_replies ENABLE ROW LEVEL SECURITY');
        } catch (e: any) {
          if (!e.message.includes('already enabled')) {
            throw e;
          }
        }

        // Create RLS policy if not exists
        try {
          const policyCheck = await pool.query(`
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = 'student_replies' 
            AND policyname = 'student_replies_tenant_isolation'
          `);
          
          if (policyCheck.rows.length === 0) {
            await pool.query(`
              CREATE POLICY student_replies_tenant_isolation
              ON student_replies
              FOR ALL
              USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            `);
          }
        } catch (e: any) {
          if (!e.message.includes('already exists') && !e.message.includes('existe déjà')) {
            fastify.log.warn({
              msg: 'Error checking/creating RLS policy for student_replies',
              error: e.message,
            });
          }
        }

        // Insert reply
        const replyResult = await pool.query(
          `INSERT INTO student_replies (
            tenant_id,
            student_id,
            teacher_id,
            original_message_id,
            content
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, sent_at`,
          [tenantId, studentId, teacherId, messageId, content.trim()]
        );

        const [teacherName, schoolName] = await Promise.all([
          resolveDisplayName(pool, teacherId, 'Enseignant'),
          resolveTenantName(pool, tenantId),
        ]);
        const conversationSubject = message.subject || '';
        const delivery = await deliverMessage({
          pool,
          tenantId,
          sourceType: 'student_teacher_message',
          sourceId: replyResult.rows[0].id,
          recipientUserId: teacherId,
          whatsappText: `[Réponse de ${studentName}] ${conversationSubject}\n\n${content.trim()}`,
          sendWhatsapp: !!sendWhatsapp,
          sendEmail: !!sendEmail,
          templateKind: 'student_teacher_reply',
          context: {
            recipientName: teacherName,
            subject: conversationSubject,
            message: content.trim(),
            senderName: studentName,
            schoolName,
            portalUrl: PORTAL_URL,
            extra: { conversationSubject },
          },
          log: fastify.log,
        });

        fastify.log.info({
          msg: 'Student replied to teacher message',
          userId,
          tenantId,
          messageId,
          teacherId,
        });

        return reply.status(201).send({
          success: true,
          data: {
            message: 'Réponse envoyée avec succès',
            replyId: replyResult.rows[0].id,
            sentAt: replyResult.rows[0].sent_at,
            whatsappStatus: delivery.whatsappStatus,
            emailStatus: delivery.emailStatus,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error replying to teacher message',
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

  // GET /api/v1/student/messages/my-teachers — enseignants des classes / matières de l'élève
  fastify.get('/my-teachers', {
    schema: { tags: ['Student Messages'], summary: 'Teachers assigned to student classes' },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['student', 'Student', 'Étudiant'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Student role required' });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        const sp = await pool.query(
          `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );
        if (sp.rows.length === 0) {
          return reply.status(404).send({ success: false, error: 'Not Found', message: 'Student profile not found' });
        }
        const sid = sp.rows[0].id;
        const q = await pool.query(
          `SELECT DISTINCT
              cc.id AS "classCourseId",
              t.id AS "teacherDbId",
              t.user_id AS "teacherUserId",
              COALESCE(u.first_name || ' ' || u.last_name, u.name) AS "teacherName",
              u.email AS "teacherEmail",
              COALESCE(co.name, 'Matière') AS "courseName",
              COALESCE(cl.name, 'Classe') AS "className"
           FROM student_enrollments se
           JOIN class_courses cc ON cc.class_id = se.class_id AND cc.tenant_id = se.tenant_id
           JOIN classes cl ON cl.id = se.class_id
           JOIN courses co ON co.id = cc.course_id
           JOIN teacher_assignments ta ON ta.class_course_id = cc.id AND ta.tenant_id = se.tenant_id
           JOIN teachers t ON t.id = ta.teacher_id
           JOIN users u ON u.id = t.user_id
           WHERE se.student_id = $1 AND se.tenant_id = $2
           ORDER BY "teacherName", "courseName"`,
          [sid, tenantId]
        );
        return reply.send({ success: true, data: q.rows });
      } catch (error: any) {
        fastify.log.error({ msg: 'my-teachers', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/student/messages/to-school
  fastify.post('/to-school', {
    schema: {
      tags: ['Student Messages'],
      summary: 'Send a message to school administration',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
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
      const { subject, content, sendWhatsapp, sendEmail } = request.body as {
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
        sendEmail?: boolean;
      };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['student', 'Student', 'Étudiant'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Student role required' });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        const sp = await pool.query(
          `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );
        if (sp.rows.length === 0) {
          return reply.status(404).send({ success: false, error: 'Not Found', message: 'Student profile not found' });
        }
        const profileId = sp.rows[0].id;
        const sn = await pool.query(
          `SELECT COALESCE(u.first_name || ' ' || u.last_name, u.name) AS n FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.id = $1`,
          [profileId]
        );
        const studentName = sn.rows[0]?.n || 'Étudiant';
        await pool.query(`
          CREATE TABLE IF NOT EXISTS establishment_inbound_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_role VARCHAR(24) NOT NULL,
            context_student_profile_id UUID REFERENCES student_profiles(id) ON DELETE SET NULL,
            subject VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            sent_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        const fullContent = `[Étudiant : ${studentName}]\n\n${content}`;
        const ins = await pool.query(
          `INSERT INTO establishment_inbound_messages (tenant_id, from_user_id, from_role, context_student_profile_id, subject, content)
           VALUES ($1, $2, 'student', $3, $4, $5) RETURNING id`,
          [tenantId, userId, profileId, subject.trim(), fullContent]
        );
        const id = ins.rows[0].id;
        const [admins, schoolName] = await Promise.all([
          resolveAdminRecipients(pool, tenantId),
          resolveTenantName(pool, tenantId),
        ]);
        const emailTemplate = sendEmail
          ? await loadTenantMessageTemplate(pool, tenantId, 'student_school')
          : undefined;

        let lastWa = 'skipped';
        const emailStatuses: string[] = [];
        for (const admin of admins) {
          const delivery = await deliverMessage({
            pool,
            tenantId,
            sourceType: 'student_school_message',
            sourceId: id,
            recipientUserId: admin.userId,
            whatsappText: `[Élève → Établissement — ${studentName}] ${subject}\n\n${fullContent}`,
            sendWhatsapp: !!sendWhatsapp,
            sendEmail: !!sendEmail,
            templateKind: 'student_school',
            template: emailTemplate,
            context: {
              recipientName: admin.name,
              subject: subject.trim(),
              // Le nom de l'étudiant est déjà porté par {{studentName}} dans le
              // modèle : l'email reprend le texte saisi, sans le préfixe.
              message: content.trim(),
              senderName: studentName,
              schoolName,
              portalUrl: PORTAL_URL,
            },
            log: fastify.log,
          });
          lastWa = delivery.whatsappStatus;
          emailStatuses.push(delivery.emailStatus);
        }
        return reply.status(201).send({
          success: true,
          data: {
            id,
            whatsappStatus: lastWa,
            emailSummary: sendEmail ? summarizeStatuses(emailStatuses) : undefined,
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: 'student to-school', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/student/messages/to-teacher
  fastify.post('/to-teacher', {
    schema: {
      tags: ['Student Messages'],
      summary: 'Send a message to a teacher (assigned to student classes)',
      body: {
        type: 'object',
        required: ['teacherUserId', 'subject', 'content'],
        properties: {
          teacherUserId: { type: 'string', format: 'uuid' },
          classCourseId: { type: 'string', format: 'uuid' },
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
      const { teacherUserId, classCourseId, subject, content, sendWhatsapp, sendEmail } = request.body as {
        teacherUserId: string;
        classCourseId?: string;
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
        sendEmail?: boolean;
      };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['student', 'Student', 'Étudiant'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Student role required' });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        // La classe de l'élève est remontée ici pour que l'email reçu par
        // l'enseignant situe tout de suite l'expéditeur ({{className}}).
        const sp = await pool.query(
          `SELECT sp.id, cl.name AS class_name
             FROM student_profiles sp
             LEFT JOIN student_enrollments se ON se.student_id = sp.id AND se.tenant_id = sp.tenant_id
             LEFT JOIN classes cl ON cl.id = se.class_id
            WHERE sp.user_id = $1 AND sp.tenant_id = $2
            ORDER BY se.created_at DESC NULLS LAST
            LIMIT 1`,
          [userId, tenantId]
        );
        if (sp.rows.length === 0) {
          return reply.status(404).send({ success: false, error: 'Not Found', message: 'Student profile not found' });
        }
        const studentProfileId = sp.rows[0].id;
        const studentClassName = sp.rows[0].class_name || '';
        const ok = classCourseId
          ? await pool.query(
              `SELECT 1 FROM teacher_assignments ta
               JOIN class_courses cc ON ta.class_course_id = cc.id
               JOIN student_enrollments se ON se.class_id = cc.class_id
               JOIN teachers t ON t.id = ta.teacher_id
               WHERE se.student_id = $1 AND t.user_id = $2 AND ta.tenant_id = $3 AND cc.id = $4::uuid
               LIMIT 1`,
              [studentProfileId, teacherUserId, tenantId, classCourseId]
            )
          : await pool.query(
              `SELECT 1 FROM teacher_assignments ta
               JOIN class_courses cc ON ta.class_course_id = cc.id
               JOIN student_enrollments se ON se.class_id = cc.class_id
               JOIN teachers t ON t.id = ta.teacher_id
               WHERE se.student_id = $1 AND t.user_id = $2 AND ta.tenant_id = $3
               LIMIT 1`,
              [studentProfileId, teacherUserId, tenantId]
            );
        if (ok.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Cet enseignant n’est pas affecté à une de vos classes',
          });
        }
        const ins = await pool.query(
          `INSERT INTO teacher_student_messages (
             tenant_id, sender_id, recipient_id, sender_type, recipient_type, subject, content, priority
           ) VALUES ($1, $2, $3, 'student', 'teacher', $4, $5, 'normal')
           RETURNING id`,
          [tenantId, userId, teacherUserId, subject.trim(), content.trim()]
        );
        const mid = ins.rows[0].id;
        const [studentName, teacherName, schoolName] = await Promise.all([
          resolveDisplayName(pool, userId, 'Étudiant'),
          resolveDisplayName(pool, teacherUserId, 'Enseignant'),
          resolveTenantName(pool, tenantId),
        ]);
        const delivery = await deliverMessage({
          pool,
          tenantId,
          sourceType: 'student_teacher_message',
          sourceId: mid,
          recipientUserId: teacherUserId,
          whatsappText: `${subject.trim()}\n\n${content.trim()}`,
          sendWhatsapp: !!sendWhatsapp,
          sendEmail: !!sendEmail,
          templateKind: 'student_teacher_new',
          context: {
            recipientName: teacherName,
            subject: subject.trim(),
            message: content.trim(),
            senderName: studentName,
            schoolName,
            portalUrl: PORTAL_URL,
            extra: { className: studentClassName },
          },
          log: fastify.log,
        });
        return reply.status(201).send({
          success: true,
          data: {
            id: mid,
            whatsappStatus: delivery.whatsappStatus,
            emailStatus: delivery.emailStatus,
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: 'student to-teacher', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });
}
