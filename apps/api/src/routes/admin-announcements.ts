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

// Schema for creating an announcement
const CreateAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

// Schema for updating an announcement
const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export async function adminAnnouncementsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // POST /api/v1/admin/announcements - Create a new announcement
  fastify.post('/', {
    schema: {
      tags: ['Admin Announcements'],
      summary: 'Create a new school announcement',
      body: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
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
                title: { type: 'string' },
                content: { type: 'string' },
                priorityLevel: { type: 'string', nullable: true },
                authorId: { type: 'string', format: 'uuid' },
                authorName: { type: 'string' },
                postedAt: { type: 'string' },
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

      // Validate request body
      const parsed = CreateAnnouncementSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: parsed.error.errors.map(e => e.message).join(', '),
        });
      }

      const { title, content, priorityLevel } = parsed.data;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get author name
        const authorInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as author_name
          FROM users
          WHERE id = $1 AND tenant_id = $2
        `, [userId, tenantId]);

        if (authorInfo.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'User not found',
          });
        }

        const authorName = authorInfo.rows[0].author_name;

        // Insert announcement
        const insertResult = await pool.query(`
          INSERT INTO school_announcements (
            tenant_id,
            author_id,
            title,
            content,
            priority_level
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING 
            id,
            title,
            content,
            priority_level,
            author_id,
            posted_at
        `, [
          tenantId,
          userId,
          title,
          content,
          priorityLevel || null,
        ]);

        const announcement = insertResult.rows[0];

        fastify.log.info({
          msg: 'School announcement created successfully',
          userId,
          tenantId,
          announcementId: announcement.id,
        });

        return reply.status(201).send({
          success: true,
          data: {
            id: announcement.id,
            title: announcement.title,
            content: announcement.content,
            priorityLevel: announcement.priority_level,
            authorId: announcement.author_id,
            authorName,
            postedAt: announcement.posted_at,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error creating school announcement',
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

  // GET /api/v1/admin/announcements - List all announcements
  fastify.get('/', {
    schema: {
      tags: ['Admin Announcements'],
      summary: 'List all school announcements',
      querystring: {
        type: 'object',
        properties: {
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
                announcements: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      title: { type: 'string' },
                      content: { type: 'string' },
                      priorityLevel: { type: 'string', nullable: true },
                      authorId: { type: 'string', format: 'uuid' },
                      authorName: { type: 'string' },
                      postedAt: { type: 'string' },
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

        // Always include tenant_id
        whereConditions.push(`sa.tenant_id = $${paramIndex}`);
        queryParams.push(tenantId);
        paramIndex++;

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

        if (priorityLevel) {
          whereConditions.push(`sa.priority_level = $${paramIndex}`);
          queryParams.push(priorityLevel);
          paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Count total announcements
        const countQuery = `
          SELECT COUNT(*) as total
          FROM school_announcements sa
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

        // Add limit and offset to query params
        const limitParamIndex = paramIndex;
        const offsetParamIndex = paramIndex + 1;
        const announcementsQueryParams = [...queryParams, limit, offset];

        // Query announcements with pagination
        const announcementsQuery = `
          SELECT 
            sa.id,
            sa.title,
            sa.content,
            sa.priority_level,
            sa.author_id,
            sa.posted_at,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as author_name
          FROM school_announcements sa
          JOIN users u ON sa.author_id = u.id
          ${whereClause}
          ORDER BY sa.posted_at DESC
          LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
        `;
        const announcementsResult = await pool.query(announcementsQuery, announcementsQueryParams);

        const announcements = announcementsResult.rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          priorityLevel: row.priority_level,
          authorId: row.author_id,
          authorName: row.author_name,
          postedAt: row.posted_at,
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
        fastify.log.error({
          msg: 'Error fetching school announcements',
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

  // PUT /api/v1/admin/announcements/:id - Update an announcement
  fastify.put('/:id', {
    schema: {
      tags: ['Admin Announcements'],
      summary: 'Update a school announcement',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 255 },
          content: { type: 'string', minLength: 1 },
          priorityLevel: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
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
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                content: { type: 'string' },
                priorityLevel: { type: 'string', nullable: true },
                authorId: { type: 'string', format: 'uuid' },
                authorName: { type: 'string' },
                postedAt: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { id } = request.params as { id: string };

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

      // Validate request body
      const parsed = UpdateAnnouncementSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: parsed.error.errors.map(e => e.message).join(', '),
        });
      }

      const updateData = parsed.data;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if announcement exists
        const existingAnnouncement = await pool.query(`
          SELECT id, author_id FROM school_announcements
          WHERE id = $1 AND tenant_id = $2
        `, [id, tenantId]);

        if (existingAnnouncement.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Announcement not found',
          });
        }

        // Build update query
        const updateFields: string[] = [];
        const updateParams: any[] = [];
        let paramIndex = 1;

        if (updateData.title !== undefined) {
          updateFields.push(`title = $${paramIndex}`);
          updateParams.push(updateData.title);
          paramIndex++;
        }

        if (updateData.content !== undefined) {
          updateFields.push(`content = $${paramIndex}`);
          updateParams.push(updateData.content);
          paramIndex++;
        }

        if (updateData.priorityLevel !== undefined) {
          updateFields.push(`priority_level = $${paramIndex}`);
          updateParams.push(updateData.priorityLevel || null);
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'No fields to update',
          });
        }

        // Update announcement
        const updateQuery = `
          UPDATE school_announcements
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING 
            id,
            title,
            content,
            priority_level,
            author_id,
            posted_at
        `;
        const updateResult = await pool.query(updateQuery, [...updateParams, id, tenantId]);

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Announcement not found',
          });
        }

        const announcement = updateResult.rows[0];

        // Get author name
        const authorInfo = await pool.query(`
          SELECT COALESCE(first_name || ' ' || last_name, name) as author_name
          FROM users
          WHERE id = $1
        `, [announcement.author_id]);

        const authorName = authorInfo.rows[0]?.author_name || 'Unknown';

        return reply.send({
          success: true,
          data: {
            id: announcement.id,
            title: announcement.title,
            content: announcement.content,
            priorityLevel: announcement.priority_level,
            authorId: announcement.author_id,
            authorName,
            postedAt: announcement.posted_at,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error updating school announcement',
          userId,
          tenantId,
          announcementId: id,
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

  // DELETE /api/v1/admin/announcements/:id - Delete an announcement
  fastify.delete('/:id', {
    schema: {
      tags: ['Admin Announcements'],
      summary: 'Delete a school announcement',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { id } = request.params as { id: string };

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

        // Delete announcement
        const deleteResult = await pool.query(`
          DELETE FROM school_announcements
          WHERE id = $1 AND tenant_id = $2
        `, [id, tenantId]);

        if (deleteResult.rowCount === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Announcement not found',
          });
        }

        return reply.send({
          success: true,
          message: 'Announcement deleted successfully',
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error deleting school announcement',
          userId,
          tenantId,
          announcementId: id,
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

