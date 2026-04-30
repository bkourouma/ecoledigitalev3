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

// Schema for creating a teacher message
const CreateTeacherMessageSchema = z.object({
  studentId: z.string().uuid(),
  subject: z.string().min(1).max(255),
  content: z.string().min(1),
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export async function teacherMessagesRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // POST /api/v1/teacher/messages - Create a new message to parent
  fastify.post('/', {
    schema: {
      tags: ['Teacher Messages'],
      summary: 'Create a new message to parent',
      body: {
        type: 'object',
        required: ['studentId', 'subject', 'content'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
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
                id: { type: 'string', format: 'uuid' },
                studentId: { type: 'string', format: 'uuid' },
                studentName: { type: 'string' },
                parentId: { type: 'string', format: 'uuid' },
                parentName: { type: 'string' },
                subject: { type: 'string' },
                content: { type: 'string' },
                priorityLevel: { type: 'string', nullable: true },
                sentAt: { type: 'string' },
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
      const parsed = CreateTeacherMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: parsed.error.errors.map(e => e.message).join(', '),
        });
      }

      const { studentId, subject, content, priorityLevel } = parsed.data;
      const sendWhatsapp = !!(request.body as any)?.sendWhatsapp;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify teacher is assigned to this student
        const teacherCheck = await pool.query(`
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

        if (teacherCheck.rows.length === 0) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'You are not assigned to teach this student',
          });
        }

        // Get student info and parent info
        const studentInfo = await pool.query(`
          SELECT 
            sp.id as student_id,
            sp.user_id as student_user_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `, [studentId, tenantId]);

        if (studentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Student not found',
          });
        }

        const student = studentInfo.rows[0];

        // Get parent(s) for this student
        const parentInfo = await pool.query(`
          SELECT 
            sp_rel.parent_id,
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name
          FROM student_parents sp_rel
          JOIN users p ON sp_rel.parent_id = p.id
          WHERE sp_rel.student_id = $1 AND sp_rel.tenant_id = $2
          LIMIT 1
        `, [studentId, tenantId]);

        if (parentInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'No parent found for this student',
          });
        }

        const parent = parentInfo.rows[0];

        // Verify teacher exists (teacher_id in teacher_messages references users.id, not teachers.id)
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

        // teacher_id in teacher_messages references users.id, so we use userId directly
        // Insert message
        const insertResult = await pool.query(`
          INSERT INTO teacher_messages (
            tenant_id,
            teacher_id,
            student_id,
            parent_id,
            subject,
            content,
            priority_level
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING 
            id,
            student_id,
            parent_id,
            subject,
            content,
            priority_level,
            sent_at
        `, [
          tenantId,
          userId, // Use userId directly since teacher_id references users.id
          studentId,
          parent.parent_id,
          subject,
          content,
          priorityLevel || null,
        ]);

        const message = insertResult.rows[0];

        await logAndMaybeSendWhatsapp({
          pool,
          tenantId,
          sourceType: "teacher_parent_message",
          sourceId: message.id,
          recipientUserId: parent.parent_id,
          text: `${subject}\n\n${content}`,
          sendWhatsapp: sendWhatsapp,
          log: fastify.log,
        });

        fastify.log.info({
          msg: 'Teacher message created successfully',
          userId,
          tenantId,
          messageId: message.id,
          studentId,
          parentId: parent.parent_id,
        });

        return reply.status(201).send({
          success: true,
          data: {
            id: message.id,
            studentId: message.student_id,
            studentName: student.student_name,
            parentId: message.parent_id,
            parentName: parent.parent_name,
            subject: message.subject,
            content: message.content,
            priorityLevel: message.priority_level,
            sentAt: message.sent_at,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error creating teacher message',
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

  // GET /api/v1/teacher/messages - List messages sent by teacher
  fastify.get('/', {
    schema: {
      tags: ['Teacher Messages'],
      summary: 'List messages sent by teacher',
      querystring: {
        type: 'object',
        properties: {
          studentId: { type: 'string', format: 'uuid' },
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
                      studentId: { type: 'string', format: 'uuid' },
                      studentName: { type: 'string' },
                      parentId: { type: 'string', format: 'uuid' },
                      parentName: { type: 'string' },
                      subject: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', nullable: true },
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
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const {
        studentId,
        parentId,
        startDate,
        endDate,
        priorityLevel,
        page = 1,
        limit = 20,
      } = request.query as any;

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

        // Verify teacher exists (teacher_id in teacher_messages references users.id, not teachers.id)
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

        // Build where conditions - start with base conditions
        // teacher_id in teacher_messages references users.id, so we use userId directly
        const whereConditions: string[] = [];
        const queryParams: any[] = [];
        let paramIndex = 1;

        // Always include teacher_id and tenant_id
        whereConditions.push(`tm.teacher_id = $${paramIndex}`);
        queryParams.push(userId); // Use userId directly since teacher_id references users.id
        paramIndex++;

        whereConditions.push(`tm.tenant_id = $${paramIndex}`);
        queryParams.push(tenantId);
        paramIndex++;

        if (studentId) {
          whereConditions.push(`tm.student_id = $${paramIndex}`);
          queryParams.push(studentId);
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

        // Add limit and offset to query params
        const limitParamIndex = paramIndex;
        const offsetParamIndex = paramIndex + 1;
        const messagesQueryParams = [...queryParams, limit, offset];

        // Query messages with pagination
        const messagesQuery = `
          SELECT 
            tm.id,
            tm.student_id,
            tm.parent_id,
            tm.subject,
            tm.content,
            tm.priority_level,
            tm.sent_at,
            tm.read_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name,
            COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name
          FROM teacher_messages tm
          JOIN student_profiles sp ON tm.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN users p ON tm.parent_id = p.id
          ${whereClause}
          ORDER BY tm.sent_at DESC
          LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
        `;
        const messagesResult = await pool.query(messagesQuery, messagesQueryParams);

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          parentId: row.parent_id,
          parentName: row.parent_name,
          subject: row.subject,
          content: row.content,
          priorityLevel: row.priority_level,
          sentAt: row.sent_at,
          readAt: row.read_at,
          isRead: row.read_at !== null,
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

  // GET /api/v1/teacher/messages/admin-messages - Get messages sent by admin to this teacher
  fastify.get('/admin-messages', {
    schema: {
      tags: ['Teacher Messages'],
      summary: 'Get messages sent by admin to this teacher',
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

        // Verify teacher exists
        const teacherInfo = await pool.query(
          `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );

        if (teacherInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Teacher profile not found',
          });
        }

        // Get query parameters
        const { startDate, endDate, priorityLevel, readStatus = 'all', page = 1, limit = 20 } = request.query as any;

        // Build where conditions
        const whereConditions: string[] = [];
        const queryParams: any[] = [];
        let paramIndex = 1;

        // Always include teacher_id and tenant_id
        whereConditions.push(`atm.teacher_id = $${paramIndex}`);
        queryParams.push(userId);
        paramIndex++;

        whereConditions.push(`atm.tenant_id = $${paramIndex}`);
        queryParams.push(tenantId);
        paramIndex++;

        if (startDate) {
          whereConditions.push(`atm.sent_at >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`atm.sent_at <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        if (priorityLevel) {
          whereConditions.push(`atm.priority_level = $${paramIndex}`);
          queryParams.push(priorityLevel);
          paramIndex++;
        }

        if (readStatus === 'read') {
          whereConditions.push(`atm.read_at IS NOT NULL`);
        } else if (readStatus === 'unread') {
          whereConditions.push(`atm.read_at IS NULL`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total messages
        const countQuery = `
          SELECT COUNT(*) as total
          FROM admin_teacher_messages atm
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Query messages with pagination
        const messagesQuery = `
          SELECT 
            atm.id,
            atm.subject,
            atm.content,
            atm.priority_level,
            atm.sent_at,
            atm.read_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as admin_name
          FROM admin_teacher_messages atm
          JOIN users u ON atm.admin_id = u.id
          ${whereClause}
          ORDER BY atm.sent_at DESC
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
          msg: 'Error fetching admin messages for teacher',
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

  // POST /api/v1/teacher/messages/bulk-to-parents
  fastify.post('/bulk-to-parents', {
    schema: {
      tags: ['Teacher Messages'],
      summary: 'Message parents for several students or an entire class (assigned classes only)',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
          studentIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          classId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          sendWhatsapp: { type: 'boolean' },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const body = request.body as {
        studentIds?: string[];
        classId?: string;
        subject: string;
        content: string;
        priorityLevel?: string;
        sendWhatsapp?: boolean;
      };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Teacher role required' });
      }
      let studentIds = [...(body.studentIds || [])];
      if (body.classId) {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        const r = await pool.query(
          `SELECT DISTINCT se.student_id AS id
           FROM student_enrollments se
           JOIN class_courses cc ON cc.class_id = se.class_id AND cc.tenant_id = se.tenant_id
           JOIN teacher_assignments ta ON ta.class_course_id = cc.id AND ta.tenant_id = se.tenant_id
           WHERE se.class_id = $1 AND se.tenant_id = $2
             AND ta.teacher_id = (SELECT id FROM teachers WHERE user_id = $3 AND tenant_id = $2)`,
          [body.classId, tenantId, userId]
        );
        studentIds = r.rows.map((x: any) => x.id);
      }
      if (studentIds.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Bad Request',
          message: 'studentIds ou classId requis (élèves accessibles)',
        });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        let sent = 0;
        for (const studentId of studentIds) {
          const teacherCheck = await pool.query(
            `SELECT ta.id
             FROM teacher_assignments ta
             JOIN class_courses cc ON ta.class_course_id = cc.id
             JOIN classes cl ON cc.class_id = cl.id
             JOIN student_enrollments se ON se.class_id = cl.id
             WHERE ta.teacher_id = (SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2)
              AND se.student_id = $3 AND ta.tenant_id = $2 LIMIT 1`,
            [userId, tenantId, studentId]
          );
          if (teacherCheck.rows.length === 0) continue;

          const studentInfo = await pool.query(
            `SELECT sp.id as student_id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as student_name
             FROM student_profiles sp JOIN users u ON sp.user_id = u.id
             WHERE sp.id = $1 AND sp.tenant_id = $2`,
            [studentId, tenantId]
          );
          if (studentInfo.rows.length === 0) continue;

          const parentInfo = await pool.query(
            `SELECT sp_rel.parent_id, COALESCE(p.first_name || ' ' || p.last_name, p.name) as parent_name
             FROM student_parents sp_rel JOIN users p ON sp_rel.parent_id = p.id
             WHERE sp_rel.student_id = $1 AND sp_rel.tenant_id = $2 LIMIT 1`,
            [studentId, tenantId]
          );
          if (parentInfo.rows.length === 0) continue;
          const parent = parentInfo.rows[0];

          const ins = await pool.query(
            `INSERT INTO teacher_messages (tenant_id, teacher_id, student_id, parent_id, subject, content, priority_level)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [tenantId, userId, studentId, parent.parent_id, body.subject, body.content, body.priorityLevel || null]
          );
          const mid = ins.rows[0]?.id;
          if (mid) {
            await logAndMaybeSendWhatsapp({
              pool,
              tenantId,
              sourceType: 'teacher_parent_message',
              sourceId: mid,
              recipientUserId: parent.parent_id,
              text: `${body.subject}\n\n${body.content}`,
              sendWhatsapp: !!body.sendWhatsapp,
              log: fastify.log,
            });
            sent++;
          }
        }
        return reply.status(201).send({ success: true, data: { sentTo: sent } });
      } catch (error: any) {
        fastify.log.error({ msg: 'bulk-to-parents', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/teacher/messages/to-establishment
  fastify.post('/to-establishment', {
    schema: {
      tags: ['Teacher Messages'],
      summary: 'Send a message to school administration',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { subject, content, sendWhatsapp } = request.body as {
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
      };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Teacher role required' });
      }
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
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
        const ins = await pool.query(
          `INSERT INTO establishment_inbound_messages (tenant_id, from_user_id, from_role, subject, content)
           VALUES ($1, $2, 'teacher', $3, $4) RETURNING id`,
          [tenantId, userId, subject.trim(), content.trim()]
        );
        const id = ins.rows[0].id;
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
        for (const row of admins.rows) {
          await logAndMaybeSendWhatsapp({
            pool,
            tenantId,
            sourceType: 'teacher_establishment_message',
            sourceId: id,
            recipientUserId: row.user_id,
            text: `[Enseignant → Établissement] ${subject}\n\n${content}`,
            sendWhatsapp: !!sendWhatsapp,
            log: fastify.log,
          });
        }
        return reply.status(201).send({ success: true, data: { id } });
      } catch (error: any) {
        fastify.log.error({ msg: 'to-establishment', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });

  // POST /api/v1/teacher/messages/to-students (teacher_student_messages)
  fastify.post('/to-students', {
    schema: {
      tags: ['Teacher Messages'],
      summary: 'Message students (profile IDs) or all students in a class',
      body: {
        type: 'object',
        required: ['subject', 'content'],
        properties: {
          studentProfileIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          classId: { type: 'string', format: 'uuid' },
          subject: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          sendWhatsapp: { type: 'boolean' },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const body = request.body as {
        studentProfileIds?: string[];
        classId?: string;
        subject: string;
        content: string;
        sendWhatsapp?: boolean;
      };
      const userRoles = request.user?.roles || [];
      if (!tenantId || !userId) {
        return reply.status(400).send({ success: false, error: 'Bad Request', message: 'Tenant and user required' });
      }
      if (!userRoles.some((r: string) => ['teacher', 'Enseignant'].includes(r))) {
        return reply.status(403).send({ success: false, error: 'Forbidden', message: 'Teacher role required' });
      }
      let ids = [...(body.studentProfileIds || [])];
      try {
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        if (body.classId) {
          const r = await pool.query(
            `SELECT DISTINCT se.student_id AS id
             FROM student_enrollments se
             JOIN class_courses cc ON cc.class_id = se.class_id AND cc.tenant_id = se.tenant_id
             JOIN teacher_assignments ta ON ta.class_course_id = cc.id AND ta.tenant_id = se.tenant_id
             WHERE se.class_id = $1 AND se.tenant_id = $2
               AND ta.teacher_id = (SELECT id FROM teachers WHERE user_id = $3 AND tenant_id = $2)`,
            [body.classId, tenantId, userId]
          );
          ids = r.rows.map((x: any) => x.id);
        }
        if (ids.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'studentProfileIds ou classId requis',
          });
        }
        let n = 0;
        for (const spid of ids) {
          const ok = await pool.query(
            `SELECT 1 FROM teacher_assignments ta
             JOIN class_courses cc ON ta.class_course_id = cc.id
             JOIN student_enrollments se ON se.class_id = cc.class_id
             WHERE ta.teacher_id = (SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2)
               AND se.student_id = $3 AND ta.tenant_id = $2 LIMIT 1`,
            [userId, tenantId, spid]
          );
          if (ok.rows.length === 0) continue;
          const uq = await pool.query(
            `SELECT user_id FROM student_profiles WHERE id = $1 AND tenant_id = $2`,
            [spid, tenantId]
          );
          const recv = uq.rows[0]?.user_id;
          if (!recv) continue;
          const ins = await pool.query(
            `INSERT INTO teacher_student_messages (
               tenant_id, sender_id, recipient_id, sender_type, recipient_type, subject, content, priority
             ) VALUES ($1, $2, $3, 'teacher', 'student', $4, $5, 'normal')
             RETURNING id`,
            [tenantId, userId, recv, body.subject, body.content]
          );
          const mid = ins.rows[0]?.id;
          if (mid) {
            await logAndMaybeSendWhatsapp({
              pool,
              tenantId,
              sourceType: 'teacher_student_message',
              sourceId: mid,
              recipientUserId: recv,
              text: `${body.subject}\n\n${body.content}`,
              sendWhatsapp: !!body.sendWhatsapp,
              log: fastify.log,
            });
            n++;
          }
        }
        return reply.status(201).send({ success: true, data: { sentTo: n } });
      } catch (error: any) {
        fastify.log.error({ msg: 'to-students', error: error.message });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        });
      }
    },
  });
}
