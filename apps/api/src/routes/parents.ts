import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
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

export async function parentsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;
  const nonTechnicalParentFilter = "COALESCE(u.is_technical_account, false) = false";

  const generateTemporaryPassword = (length = 12): string => {
    const lowercase = "abcdefghjkmnpqrstuvwxyz";
    const uppercase = "ABCDEFGHJKMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const symbols = "@#$%!?";
    const all = lowercase + uppercase + numbers + symbols;
    const seed = [
      lowercase[Math.floor(Math.random() * lowercase.length)],
      uppercase[Math.floor(Math.random() * uppercase.length)],
      numbers[Math.floor(Math.random() * numbers.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
    ];
    for (let i = seed.length; i < length; i++) {
      seed.push(all[Math.floor(Math.random() * all.length)]);
    }
    return seed.sort(() => Math.random() - 0.5).join("");
  };

  // GET /api/v1/parents - List all parents (admin only)
  fastify.get('/', {
    schema: {
      tags: ['Parents'],
      summary: 'List all parents (admin only)',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          academicYearId: { type: 'string', format: 'uuid' },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 1000, default: 20 },
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
                      email: { type: 'string' },
                      firstName: { type: 'string' },
                      lastName: { type: 'string' },
                      name: { type: 'string' },
                      childrenCount: { type: 'number' },
                      createdAt: { type: 'string' },
                    },
                  },
                },
                total: { type: 'number' },
                page: { type: 'number' },
                limit: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const query = request.query as any;
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = query.search || '';
        // The parents directory is a global people-management view.
        // Only filter by academic year when the client explicitly requests it.
        const academicYearId = query.academicYearId;

        // Build WHERE clause for search
        let whereClause = `WHERE u.tenant_id = $1 AND ${nonTechnicalParentFilter}`;
        const params: any[] = [tenantId];
        let paramIndex = 2;

        if (search) {
          whereClause += ` AND (
            u.first_name ILIKE $${paramIndex} OR
            u.last_name ILIKE $${paramIndex} OR
            u.email ILIKE $${paramIndex} OR
            u.name ILIKE $${paramIndex}
          )`;
          params.push(`%${search}%`);
          paramIndex++;
        }

        if (academicYearId) {
          whereClause += ` AND EXISTS (
            SELECT 1
            FROM student_parents spr_filter
            JOIN student_enrollments se_filter
              ON se_filter.student_id = spr_filter.student_id
             AND se_filter.tenant_id = spr_filter.tenant_id
            WHERE spr_filter.parent_id = u.id
              AND spr_filter.tenant_id = u.tenant_id
              AND se_filter.academic_year_id = $${paramIndex}
          )`;
          params.push(academicYearId);
          paramIndex++;
        }

        // Count total parents (users with parent role)
        const countQuery = `
          SELECT COUNT(DISTINCT u.id) as total
          FROM users u
          INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          ${whereClause}
        `;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        // Get parents with children count
        const parentsQuery = `
          SELECT 
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            u.name,
            u.created_at,
            u.initial_password,
            COUNT(DISTINCT sp.id) as children_count
          FROM users u
          INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          LEFT JOIN student_parents sp_rel ON sp_rel.parent_id = u.id AND sp_rel.tenant_id = u.tenant_id
          LEFT JOIN student_profiles sp ON sp.id = sp_rel.student_id AND sp.tenant_id = u.tenant_id
          ${whereClause}
          GROUP BY u.id, u.email, u.first_name, u.last_name, u.name, u.created_at, u.initial_password
          ORDER BY u.last_name, u.first_name
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);
        const parentsResult = await pool.query(parentsQuery, params);

        const parents = parentsResult.rows.map((row: any) => ({
          id: row.id,
          email: row.email,
          firstName: row.first_name,
          lastName: row.last_name,
          name: row.name || `${row.first_name} ${row.last_name}`,
          childrenCount: parseInt(row.children_count || '0'),
          createdAt: row.created_at,
          initialPassword: row.initial_password ?? null,
        }));

        return reply.send({
          success: true,
          data: {
            parents,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error: any) {
        fastify.log.error('Error fetching parents:', error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching parents list',
        });
      }
    },
  });

  // POST /api/v1/parents/:id/reset-password — Réinitialise le mot de passe (admin uniquement)
  fastify.post('/:id/reset-password', {
    schema: {
      tags: ['Parents'],
      summary: 'Reset parent password (admin only)',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const parentId = (request.params as any)?.id;
      const userRoles = request.user?.roles || [];

      if (!tenantId) {
        return reply.status(400).send({
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const check = await client.query(
          `
            SELECT u.id
            FROM users u
            INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
            INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
            WHERE u.id = $1 AND u.tenant_id = $2 AND ${nonTechnicalParentFilter}
            LIMIT 1
          `,
          [parentId, tenantId]
        );

        if (check.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        const newPassword = generateTemporaryPassword();
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        await client.query(
          `
            UPDATE users
            SET password_hash = $1,
                initial_password = $2,
                updated_at = NOW()
            WHERE id = $3 AND tenant_id = $4
          `,
          [newPasswordHash, newPassword, parentId, tenantId]
        );

        await client.query('COMMIT');

        return reply.send({
          parentId,
          initialPassword: newPassword,
          message: 'Mot de passe réinitialisé avec succès',
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        fastify.log.error('Error resetting parent password:', error);
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to reset parent password',
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/parents/:id - Get a specific parent by ID (admin only)
  fastify.get('/:id', {
    schema: {
      tags: ['Parents'],
      summary: 'Get a specific parent by ID (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
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
                email: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                name: { type: 'string' },
                childrenCount: { type: 'number' },
                createdAt: { type: 'string' },
              },
            },
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
      const parentId = (request.params as any)?.id;

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
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get parent with children count
        const parentQuery = `
          SELECT 
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            u.name,
            u.created_at,
            u.initial_password,
            COUNT(DISTINCT sp.id) as children_count
          FROM users u
          INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          LEFT JOIN student_parents sp_rel ON sp_rel.parent_id = u.id AND sp_rel.tenant_id = u.tenant_id
          LEFT JOIN student_profiles sp ON sp.id = sp_rel.student_id AND sp.tenant_id = u.tenant_id
          WHERE u.id = $1 AND u.tenant_id = $2 AND ${nonTechnicalParentFilter}
          GROUP BY u.id, u.email, u.first_name, u.last_name, u.name, u.created_at, u.initial_password
        `;
        const parentResult = await pool.query(parentQuery, [parentId, tenantId]);

        if (parentResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        const parent = parentResult.rows[0];

        return reply.send({
          success: true,
          data: {
            id: parent.id,
            email: parent.email,
            firstName: parent.first_name,
            lastName: parent.last_name,
            name: parent.name || `${parent.first_name} ${parent.last_name}`,
            childrenCount: parseInt(parent.children_count || '0'),
            createdAt: parent.created_at,
            initialPassword: parent.initial_password ?? null,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error fetching parent:', error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching parent',
        });
      }
    },
  });

  // POST /api/v1/parents - Create parent user (admin only)
  fastify.post('/', {
    schema: {
      tags: ['Parents'],
      summary: 'Create parent user (admin only)',
      body: {
        type: 'object',
        required: ['firstName', 'lastName', 'email', 'password'],
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          phone: { type: 'string' },
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
                email: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                name: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
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
        409: {
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

      // Check if user has admin role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const client = await fastify.pg.connect();
      try {
        const body = request.body as any;
        const { firstName, lastName, email, password, phone } = body;
        const normalizedEmail = String(email || '').trim().toLowerCase();

        await client.query('BEGIN');
        // Set tenant context for RLS
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if email already exists in tenant
        const existingUserQuery = `
          SELECT id, email, first_name, last_name, name
          FROM users
          WHERE tenant_id = $1 AND email = $2
        `;
        const existingUserResult = await client.query(existingUserQuery, [tenantId, normalizedEmail]);

        // Ensure parent role exists (needed both for create and recovery path)
        const roleQuery = `
          SELECT id FROM roles WHERE key = 'parent' AND COALESCE(is_active, true) = true
        `;
        let roleResult = await client.query(roleQuery);
        if (roleResult.rows.length === 0) {
          roleResult = await client.query(
            `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
             VALUES ('parent', 'Parent', true, true, NOW(), NOW())
             RETURNING id`
          );
        }
        const roleId = roleResult.rows[0].id;

        if (existingUserResult.rows.length > 0) {
          const existingUser = existingUserResult.rows[0];
          const existingRolesResult = await client.query(
            `
              SELECT r.key
              FROM user_roles ur
              INNER JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = $1 AND ur.tenant_id = $2
            `,
            [existingUser.id, tenantId]
          );
          const existingRoleKeys = existingRolesResult.rows.map((row: any) => row.key);

          // If orphan user exists (no roles), recover it as a valid parent account
          if (existingRoleKeys.length === 0) {
            const passwordHash = await bcrypt.hash(password, 10);
            const fullName = `${firstName} ${lastName}`;

            await client.query(
              `
                UPDATE users
                SET email = $1,
                    first_name = $2,
                    last_name = $3,
                    name = $4,
                    password_hash = $5,
                    initial_password = $6,
                    updated_at = NOW(),
                    role_updated_at = NOW()
                WHERE id = $7 AND tenant_id = $8
              `,
              [normalizedEmail, firstName, lastName, fullName, passwordHash, password, existingUser.id, tenantId]
            );

            await client.query(
              `INSERT INTO user_roles (tenant_id, user_id, role_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
              [tenantId, existingUser.id, roleId]
            );

            const recoveredUserResult = await client.query(
              `
                SELECT id, email, first_name, last_name, name, created_at
                FROM users
                WHERE id = $1
              `,
              [existingUser.id]
            );
            const recoveredUser = recoveredUserResult.rows[0];

            await client.query('COMMIT');
            return reply.status(201).send({
              success: true,
              data: {
                id: recoveredUser.id,
                email: recoveredUser.email,
                firstName: recoveredUser.first_name,
                lastName: recoveredUser.last_name,
                name: recoveredUser.name,
                createdAt: recoveredUser.created_at,
              },
            });
          }
          
          if (!existingRoleKeys.includes('parent')) {
            // Existing account with other roles: attach parent role instead of blocking creation
            await client.query(
              `INSERT INTO user_roles (tenant_id, user_id, role_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
              [tenantId, existingUser.id, roleId]
            );
            await client.query(
              "UPDATE users SET role_updated_at = NOW(), updated_at = NOW() WHERE id = $1",
              [existingUser.id]
            );

            const promotedUserResult = await client.query(
              `
                SELECT id, email, first_name, last_name, name, created_at
                FROM users
                WHERE id = $1
              `,
              [existingUser.id]
            );
            const promotedUser = promotedUserResult.rows[0];

            await client.query('COMMIT');
            return reply.status(201).send({
              success: true,
              data: {
                id: promotedUser.id,
                email: promotedUser.email,
                firstName: promotedUser.first_name,
                lastName: promotedUser.last_name,
                name: promotedUser.name,
                createdAt: promotedUser.created_at,
              },
            });
          }

          await client.query('ROLLBACK');
          return reply.status(409).send({
            success: false,
            error: 'Conflict',
            message: 'A parent with this email already exists',
          });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user with role_updated_at initialized
        const fullName = `${firstName} ${lastName}`;
        const createUserQuery = `
          INSERT INTO users (
            tenant_id, email, name, first_name, last_name, password_hash, initial_password, created_at, updated_at, role_updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
          RETURNING id, email, first_name, last_name, name, created_at
        `;
        const userResult = await client.query(createUserQuery, [
          tenantId,
          normalizedEmail,
          fullName,
          firstName,
          lastName,
          passwordHash,
          password,
        ]);

        const user = userResult.rows[0];

        // Assign parent role to user
        await client.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
          [tenantId, user.id, roleId]
        );
        // The trigger should update role_updated_at, but we'll also update it explicitly to be sure
        await client.query(
          "UPDATE users SET role_updated_at = NOW() WHERE id = $1",
          [user.id]
        );
        await client.query('COMMIT');

        return reply.status(201).send({
          success: true,
          data: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            name: user.name,
            createdAt: user.created_at,
          },
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        fastify.log.error('Error creating parent:', error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while creating parent',
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/parents/:id - Update parent user (admin only)
  fastify.put('/:id', {
    schema: {
      tags: ['Parents'],
      summary: 'Update parent user (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
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
                email: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                name: { type: 'string' },
                updatedAt: { type: 'string' },
              },
            },
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
      const parentId = (request.params as any)?.id;

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
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        const body = request.body as any;
        const { firstName, lastName, email, phone } = body;

        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if parent exists and has parent role
        const checkQuery = `
          SELECT u.id, u.email, u.first_name, u.last_name, u.name
          FROM users u
          INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          WHERE u.id = $1 AND u.tenant_id = $2 AND ${nonTechnicalParentFilter}
        `;
        const checkResult = await pool.query(checkQuery, [parentId, tenantId]);

        if (checkResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        // If email is being updated, check if new email already exists
        if (email && email !== checkResult.rows[0].email) {
          const existingUserQuery = `
            SELECT id FROM users
            WHERE tenant_id = $1 AND email = $2 AND id != $3
          `;
          const existingUserResult = await pool.query(existingUserQuery, [tenantId, email, parentId]);

          if (existingUserResult.rows.length > 0) {
            return reply.status(409).send({
              success: false,
              error: 'Conflict',
              message: 'A user with this email already exists',
            });
          }
        }

        // Build update query dynamically based on provided fields
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (firstName !== undefined) {
          updateFields.push(`first_name = $${paramIndex}`);
          updateValues.push(firstName);
          paramIndex++;
        }

        if (lastName !== undefined) {
          updateFields.push(`last_name = $${paramIndex}`);
          updateValues.push(lastName);
          paramIndex++;
        }

        if (email !== undefined) {
          updateFields.push(`email = $${paramIndex}`);
          updateValues.push(email);
          paramIndex++;
        }

        // Update name if firstName or lastName changed
        if (firstName !== undefined || lastName !== undefined) {
          const currentFirstName = firstName !== undefined ? firstName : checkResult.rows[0].first_name;
          const currentLastName = lastName !== undefined ? lastName : checkResult.rows[0].last_name;
          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(`${currentFirstName} ${currentLastName}`);
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'Bad Request',
            message: 'No fields to update',
          });
        }

        // Add updated_at
        updateFields.push(`updated_at = NOW()`);

        // Add WHERE clause parameters
        updateValues.push(parentId, tenantId);

        const updateQuery = `
          UPDATE users
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, email, first_name, last_name, name, updated_at
        `;

        const updateResult = await pool.query(updateQuery, updateValues);

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        const updatedUser = updateResult.rows[0];

        return reply.send({
          success: true,
          data: {
            id: updatedUser.id,
            email: updatedUser.email,
            firstName: updatedUser.first_name,
            lastName: updatedUser.last_name,
            name: updatedUser.name,
            updatedAt: updatedUser.updated_at,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error updating parent:', error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while updating parent',
        });
      }
    },
  });

  // DELETE /api/v1/parents/:id - Delete parent user (admin only)
  fastify.delete('/:id', {
    schema: {
      tags: ['Parents'],
      summary: 'Delete parent user (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
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
        409: {
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
      const parentId = (request.params as any)?.id;

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
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        // Set tenant context for RLS
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if parent exists and has parent role
        const checkQuery = `
          SELECT u.id, u.email, u.first_name, u.last_name, u.name
          FROM users u
          INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          WHERE u.id = $1 AND u.tenant_id = $2 AND ${nonTechnicalParentFilter}
        `;
        const checkResult = await client.query(checkQuery, [parentId, tenantId]);

        if (checkResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        // Check if parent has associated students
        const studentsQuery = `
          SELECT COUNT(*) as count
          FROM student_parents
          WHERE parent_id = $1 AND tenant_id = $2
        `;
        const studentsResult = await client.query(studentsQuery, [parentId, tenantId]);
        const studentsCount = parseInt(studentsResult.rows[0].count || '0');

        if (studentsCount > 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            success: false,
            error: 'Conflict',
            message: `Cannot delete parent with associated students. Please unassign all students from this parent before deleting.`,
          });
        }

        // Delete user directly (user_roles is ON DELETE CASCADE)
        const deleteQuery = `
          DELETE FROM users
          WHERE id = $1 AND tenant_id = $2
          RETURNING id
        `;
        const deleteResult = await client.query(deleteQuery, [parentId, tenantId]);

        if (deleteResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }
        await client.query('COMMIT');

        return reply.send({
          success: true,
          message: 'Parent deleted successfully',
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        if (error?.code === '23503') {
          return reply.status(409).send({
            success: false,
            error: 'Conflict',
            message: 'Cannot delete parent because related records still exist',
          });
        }
        fastify.log.error('Error deleting parent:', error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while deleting parent',
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/parents/:id/children - Get children of a specific parent (admin only)
  fastify.get('/:id/children', {
    schema: {
      tags: ['Parents'],
      summary: 'Get children of a specific parent (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                children: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      currentYear: { type: 'number' },
                      status: { type: 'string' },
                      studentNumber: { type: 'string' },
                    },
                  },
                },
                total: { type: 'number' },
              },
            },
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
      const parentId = (request.params as any)?.id;

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
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires admin role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Check if parent exists
        const parentCheckQuery = `
          SELECT u.id, u.email, u.first_name, u.last_name, u.name
          FROM users u
          INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
          INNER JOIN roles r ON ur.role_id = r.id AND r.key = 'parent'
          WHERE u.id = $1 AND u.tenant_id = $2 AND ${nonTechnicalParentFilter}
        `;
        const parentCheckResult = await pool.query(parentCheckQuery, [parentId, tenantId]);

        if (parentCheckResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent not found',
          });
        }

        // Get children linked to this parent via student_parents table
        // Use DISTINCT ON to ensure unique students even if multiple relationships exist
        const childrenQuery = `
          SELECT DISTINCT ON (sp.id)
            sp.id,
            sp_rel.id as relationship_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name, 'Nom inconnu') as name,
            u.email,
            sp.current_year as currentYear,
            sp.status,
            sp.student_number as studentNumber
          FROM student_parents sp_rel
          INNER JOIN student_profiles sp ON sp_rel.student_id = sp.id AND sp.tenant_id = $1
          INNER JOIN users u ON sp.user_id = u.id AND u.tenant_id = $1
          WHERE sp_rel.parent_id = $2 AND sp_rel.tenant_id = $1
          ORDER BY sp.id, sp_rel.id, u.last_name, u.first_name
        `;

        const childrenResult = await pool.query(childrenQuery, [tenantId, parentId]);

        const children = childrenResult.rows.map((row: any) => ({
          id: row.id,
          relationshipId: row.relationship_id,
          name: row.name,
          email: row.email || '',
          currentYear: row.currentyear || 1,
          status: row.status || 'active',
          studentNumber: row.studentnumber || '',
        }));

        return reply.send({
          success: true,
          data: {
            children,
            total: children.length,
          },
        });
      } catch (error: any) {
        fastify.log.error('Error fetching parent children:', error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching parent children',
        });
      }
    },
  });
}
