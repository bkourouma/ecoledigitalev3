import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import {
  TeacherSchema,
  CreateTeacherSchema,
  UpdateTeacherSchema,
  TeacherQuerySchema
} from "@ecoledigitale/contracts";

function generateTemporaryPassword(length = 12): string {
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
}

function serializeTeacherRow(
  row: Record<string, any>,
  overrides?: { initialPassword?: string | null }
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id ?? null,
    initialPassword: overrides?.initialPassword ?? row.initial_password ?? null,
    ...(row.employee_number != null ? { employeeNumber: row.employee_number } : {}),
    firstName: row.first_name,
    lastName: row.last_name,
    ...(row.email != null ? { email: row.email } : {}),
    ...(row.phone != null ? { phone: row.phone } : {}),
    specialties: row.specialties || [],
    ...(row.bio != null ? { bio: row.bio } : {}),
    qualifications: row.qualifications || [],
    ...(row.hire_date != null ? { hireDate: row.hire_date } : {}),
    contractType: row.contract_type,
    ...(row.hourly_rate != null ? { hourlyRate: Number(row.hourly_rate) } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): error is { code?: string } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export async function teachersRoutes(fastify: FastifyInstance) {
  // GET /api/v1/teachers - List teachers
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "suspended"] },
          contractType: { type: "string", enum: ["permanent", "temporary", "freelance"] },
          email: { type: "string", format: "email" },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tenantId: { type: "string" },
                  userId: { type: ["string", "null"] },
                  initialPassword: { type: ["string", "null"] },
                  employeeNumber: { type: "string" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  email: { type: "string" },
                  phone: { type: "string" },
                  specialties: { type: "array", items: { type: "string" } },
                  bio: { type: "string" },
                  qualifications: { type: "array", items: { type: "string" } },
                  hireDate: { type: "string" },
                  contractType: { type: "string" },
                  hourlyRate: { type: "number" },
                  status: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
            pagination: {
              type: "object",
              properties: {
                page: { type: "number" },
                limit: { type: "number" },
                total: { type: "number" },
                totalPages: { type: "number" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const query = TeacherQuerySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause (alias t for JOIN users)
        let whereClause = "WHERE t.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.status) {
          whereClause += ` AND t.status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        if (query.contractType) {
          whereClause += ` AND t.contract_type = $${paramIndex}`;
          params.push(query.contractType);
          paramIndex++;
        }

        if (query.email) {
          whereClause += ` AND (LOWER(t.email) = LOWER($${paramIndex}) OR LOWER(u.email) = LOWER($${paramIndex}))`;
          params.push(query.email);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*)
          FROM teachers t
          LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = t.tenant_id
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get teachers (+ mot de passe initial admin si compte lié)
        const teachersQuery = `
          SELECT t.id, t.tenant_id, t.user_id, t.employee_number, t.first_name, t.last_name,
                 t.email, t.phone, t.specialties, t.bio, t.qualifications, t.hire_date,
                 t.contract_type, t.hourly_rate, t.status, t.created_at, t.updated_at,
                 u.initial_password
          FROM teachers t
          LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = t.tenant_id
          ${whereClause}
          ORDER BY t.last_name, t.first_name
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const teachersResult = await client.query(teachersQuery, [...params, query.limit, offset]);

        const teachers = teachersResult.rows.map((row) => serializeTeacherRow(row));

        reply.send({
          data: teachers,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching teachers: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching teachers",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teachers - Create teacher
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["firstName", "lastName", "contractType"],
        properties: {
          userId: { type: "string", format: "uuid" },
          employeeNumber: { type: "string", maxLength: 20 },
          firstName: { type: "string", minLength: 1, maxLength: 100 },
          lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
          phone: { type: "string", maxLength: 20 },
          specialties: { type: "array", items: { type: "string" } },
          bio: { type: "string" },
          qualifications: { type: "array", items: { type: "string" } },
          hireDate: { type: "string", format: "date" },
          contractType: { type: "string", enum: ["permanent", "temporary", "freelance"] },
          hourlyRate: { type: "number", minimum: 0 },
          password: { type: "string", minLength: 8 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            tenantId: { type: "string" },
            userId: { type: ["string", "null"] },
            initialPassword: { type: ["string", "null"] },
            employeeNumber: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            specialties: { type: "array", items: { type: "string" } },
            bio: { type: "string" },
            qualifications: { type: "array", items: { type: "string" } },
            hireDate: { type: "string" },
            contractType: { type: "string" },
            hourlyRate: { type: "number" },
            status: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const teacherData = CreateTeacherSchema.parse(request.body as unknown);
      const plainPassword = teacherData.password;
      const normalizedEmail = teacherData.email
        ? String(teacherData.email).trim().toLowerCase()
        : "";

      const client = await fastify.pg.connect();
      try {
        await client.query("BEGIN");

        if (teacherData.email) {
          const existingResult = await client.query(
            `SELECT id FROM teachers WHERE tenant_id = $1 AND LOWER(TRIM(email)) = $2`,
            [request.tenantId, normalizedEmail]
          );
          if (existingResult.rows.length > 0) {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              error: "Conflict",
              message: "Un enseignant avec cet email existe déjà",
            });
          }
        }

        if (teacherData.userId) {
          const userResult = await client.query(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2`, [
            teacherData.userId,
            request.tenantId,
          ]);
          if (userResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(404).send({
              error: "Not Found",
              message: "User not found",
            });
          }
        }

        let userIdToLink: string | null = teacherData.userId ?? null;
        let createdNewUser = false;

        if (!userIdToLink && normalizedEmail) {
          if (!plainPassword) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "Validation Error",
              message: "Mot de passe requis lorsque l'email est renseigné (compte de connexion).",
            });
          }

          const existingUser = await client.query(
            `SELECT id, tenant_id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
            [normalizedEmail]
          );
          if (existingUser.rows.length > 0) {
            await client.query("ROLLBACK");
            const sameTenant = existingUser.rows[0].tenant_id === request.tenantId;
            return reply.status(409).send({
              error: "Conflict",
              message: sameTenant
                ? "Un compte utilisateur avec cet email existe deja pour ce client"
                : "Cet email est deja utilise dans un autre tenant",
            });
            return reply.status(409).send({
              error: "Conflict",
              message: "Un compte utilisateur avec cet email existe déjà pour ce client",
            });
          }

          let teacherRoleId: string;
          const roleRes = await client.query(
            `SELECT id FROM roles WHERE key = 'teacher' AND COALESCE(is_active, true) = true LIMIT 1`
          );
          if (roleRes.rows.length === 0) {
            const insRole = await client.query(
              `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
               VALUES ('teacher', 'Enseignant', true, true, NOW(), NOW()) RETURNING id`
            );
            teacherRoleId = insRole.rows[0].id;
          } else {
            teacherRoleId = roleRes.rows[0].id;
          }

          const passwordHash = await bcrypt.hash(plainPassword, 10);
          const fullName = `${teacherData.firstName} ${teacherData.lastName}`;
          const userIns = await client.query(
            `INSERT INTO users (
              tenant_id, email, name, first_name, last_name, password_hash, initial_password,
              is_active, active_role_key, created_at, updated_at, role_updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'teacher', NOW(), NOW(), NOW())
            RETURNING id`,
            [
              request.tenantId,
              normalizedEmail,
              fullName,
              teacherData.firstName,
              teacherData.lastName,
              passwordHash,
              plainPassword,
            ]
          );
          userIdToLink = userIns.rows[0].id;
          await client.query(
            `INSERT INTO user_roles (tenant_id, user_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
            [request.tenantId, userIdToLink, teacherRoleId]
          );
          createdNewUser = true;
        }

        const insertQuery = `
          INSERT INTO teachers (tenant_id, user_id, employee_number, first_name, last_name,
                              email, phone, specialties, bio, qualifications, hire_date,
                              contract_type, hourly_rate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id, tenant_id, user_id, employee_number, first_name, last_name,
                    email, phone, specialties, bio, qualifications, hire_date,
                    contract_type, hourly_rate, status, created_at, updated_at
        `;

        const emailForRow = normalizedEmail || teacherData.email || null;

        const insertResult = await client.query(insertQuery, [
          request.tenantId,
          userIdToLink,
          teacherData.employeeNumber || null,
          teacherData.firstName,
          teacherData.lastName,
          emailForRow,
          teacherData.phone || null,
          teacherData.specialties || [],
          teacherData.bio || null,
          teacherData.qualifications || [],
          teacherData.hireDate || null,
          teacherData.contractType,
          teacherData.hourlyRate || null,
        ]);

        const teacher = insertResult.rows[0];

        await client.query("COMMIT");

        reply.status(201).send(
          serializeTeacherRow(teacher, {
            initialPassword: createdNewUser && plainPassword ? plainPassword : null,
          })
        );
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        fastify.log.error(`Error creating teacher: ${error}`);
        if (isUniqueViolation(error)) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Cet email est deja utilise",
          });
        }
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while creating the teacher",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/teachers/:id/reset-password — Réinitialise le mot de passe (compte lié, admin)
  fastify.post("/:id/reset-password", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
    handler: async (request: any, reply) => {
      const tenantId = request.tenantId;
      const teacherTableId = (request.params as { id: string }).id;
      const userRoles: string[] = request.user?.roles || [];

      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }
      if (!userRoles.includes("admin") && !userRoles.includes("super_admin")) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "This endpoint requires admin role",
        });
      }

      const client = await fastify.pg.connect();
      try {
        await client.query("BEGIN");

        const tRes = await client.query(
          `SELECT user_id FROM teachers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [teacherTableId, tenantId]
        );
        if (tRes.rows.length === 0 || !tRes.rows[0].user_id) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "Not Found",
            message: "Enseignant introuvable ou sans compte de connexion",
          });
        }
        const userId = tRes.rows[0].user_id as string;

        const newPassword = generateTemporaryPassword();
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        await client.query(
          `UPDATE users
           SET password_hash = $1, initial_password = $2, updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [newPasswordHash, newPassword, userId, tenantId]
        );

        await client.query("COMMIT");

        return reply.send({
          teacherId: teacherTableId,
          initialPassword: newPassword,
          message: "Mot de passe réinitialisé avec succès",
        });
      } catch (error: any) {
        await client.query("ROLLBACK").catch(() => {});
        fastify.log.error("Error resetting teacher password:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to reset teacher password",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teachers/:id - Get teacher by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            tenantId: { type: "string" },
            userId: { type: ["string", "null"] },
            initialPassword: { type: ["string", "null"] },
            employeeNumber: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            specialties: { type: "array", items: { type: "string" } },
            bio: { type: "string" },
            qualifications: { type: "array", items: { type: "string" } },
            hireDate: { type: "string" },
            contractType: { type: "string" },
            hourlyRate: { type: "number" },
            status: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        const teacherQuery = `
          SELECT t.id, t.tenant_id, t.user_id, t.employee_number, t.first_name, t.last_name,
                 t.email, t.phone, t.specialties, t.bio, t.qualifications, t.hire_date,
                 t.contract_type, t.hourly_rate, t.status, t.created_at, t.updated_at,
                 u.initial_password
          FROM teachers t
          LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = t.tenant_id
          WHERE t.id = $1 AND t.tenant_id = $2
        `;

        const teacherResult = await client.query(teacherQuery, [id, request.tenantId]);

        if (teacherResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher not found",
          });
        }

        const row = teacherResult.rows[0];
        const teacher = serializeTeacherRow(row);

        reply.send(teacher);
      } catch (error) {
        fastify.log.error(`Error fetching teacher: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while fetching the teacher",
        });
      } finally {
        client.release();
      }
    },
  });

  // PUT /api/v1/teachers/:id - Update teacher
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          userId: { type: "string", format: "uuid" },
          employeeNumber: { type: "string", maxLength: 20 },
          firstName: { type: "string", minLength: 1, maxLength: 100 },
          lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
          phone: { type: "string", maxLength: 20 },
          specialties: { type: "array", items: { type: "string" } },
          bio: { type: "string" },
          qualifications: { type: "array", items: { type: "string" } },
          hireDate: { type: "string", format: "date" },
          contractType: { type: "string", enum: ["permanent", "temporary", "freelance"] },
          hourlyRate: { type: "number", minimum: 0 },
          status: { type: "string", enum: ["active", "inactive", "suspended"] },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            tenantId: { type: "string" },
            userId: { type: ["string", "null"] },
            initialPassword: { type: ["string", "null"] },
            employeeNumber: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            specialties: { type: "array", items: { type: "string" } },
            bio: { type: "string" },
            qualifications: { type: "array", items: { type: "string" } },
            hireDate: { type: "string" },
            contractType: { type: "string" },
            hourlyRate: { type: "number" },
            status: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        409: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const updateData = UpdateTeacherSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if teacher exists and belongs to tenant
        const existingQuery = `
          SELECT id, email, user_id, first_name, last_name
          FROM teachers
          WHERE id = $1 AND tenant_id = $2
        `;
        const existingResult = await client.query(existingQuery, [id, request.tenantId]);

        if (existingResult.rows.length === 0) {
          await client.query("ROLLBACK").catch(() => {});
          return reply.status(404).send({
            error: "Not Found",
            message: "Teacher not found",
          });
        }

        const existingTeacher = existingResult.rows[0];

        // If userId is being updated, check if user exists
        if (updateData.userId) {
          const userQuery = `
            SELECT id FROM users
            WHERE id = $1 AND tenant_id = $2
          `;
          const userResult = await client.query(userQuery, [updateData.userId, request.tenantId]);

          if (userResult.rows.length === 0) {
            return reply.status(404).send({
              error: "Not Found",
              message: "User not found",
            });
          }
        }

        // If email is being updated, check for conflicts
        if (updateData.email && updateData.email !== existingTeacher.email) {
          const conflictQuery = `
            SELECT id FROM teachers
            WHERE tenant_id = $1 AND email = $2 AND id != $3
          `;
          const conflictResult = await client.query(conflictQuery, [
            request.tenantId,
            updateData.email,
            id
          ]);

          if (conflictResult.rows.length > 0) {
            return reply.status(409).send({
              error: "Conflict",
              message: "A teacher with this email already exists",
            });
          }
        }

        // Build dynamic update query
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (updateData.userId !== undefined) {
          updateFields.push(`user_id = $${paramIndex}`);
          updateValues.push(updateData.userId);
          paramIndex++;
        }
        if (updateData.employeeNumber !== undefined) {
          updateFields.push(`employee_number = $${paramIndex}`);
          updateValues.push(updateData.employeeNumber);
          paramIndex++;
        }
        if (updateData.firstName !== undefined) {
          updateFields.push(`first_name = $${paramIndex}`);
          updateValues.push(updateData.firstName);
          paramIndex++;
        }
        if (updateData.lastName !== undefined) {
          updateFields.push(`last_name = $${paramIndex}`);
          updateValues.push(updateData.lastName);
          paramIndex++;
        }
        if (updateData.email !== undefined) {
          updateFields.push(`email = $${paramIndex}`);
          updateValues.push(updateData.email);
          paramIndex++;
        }
        if (updateData.phone !== undefined) {
          updateFields.push(`phone = $${paramIndex}`);
          updateValues.push(updateData.phone);
          paramIndex++;
        }
        if (updateData.specialties !== undefined) {
          updateFields.push(`specialties = $${paramIndex}`);
          updateValues.push(updateData.specialties);
          paramIndex++;
        }
        if (updateData.bio !== undefined) {
          updateFields.push(`bio = $${paramIndex}`);
          updateValues.push(updateData.bio);
          paramIndex++;
        }
        if (updateData.qualifications !== undefined) {
          updateFields.push(`qualifications = $${paramIndex}`);
          updateValues.push(updateData.qualifications);
          paramIndex++;
        }
        if (updateData.hireDate !== undefined) {
          updateFields.push(`hire_date = $${paramIndex}`);
          updateValues.push(updateData.hireDate);
          paramIndex++;
        }
        if (updateData.contractType !== undefined) {
          updateFields.push(`contract_type = $${paramIndex}`);
          updateValues.push(updateData.contractType);
          paramIndex++;
        }
        if (updateData.hourlyRate !== undefined) {
          updateFields.push(`hourly_rate = $${paramIndex}`);
          updateValues.push(updateData.hourlyRate);
          paramIndex++;
        }
        if (updateData.status !== undefined) {
          updateFields.push(`status = $${paramIndex}`);
          updateValues.push(updateData.status);
          paramIndex++;
        }

        /** Anciennes fiches : e-mail renseigné mais pas de user_id → création du compte (comme à la création). */
        let linkedInitialPassword: string | null = null;
        const mergedFirstName =
          updateData.firstName !== undefined ? updateData.firstName : existingTeacher.first_name;
        const mergedLastName =
          updateData.lastName !== undefined ? updateData.lastName : existingTeacher.last_name;
        const rawMergedEmail =
          updateData.email !== undefined ? updateData.email : existingTeacher.email;
        const normalizedMergedEmail = rawMergedEmail
          ? String(rawMergedEmail).trim().toLowerCase()
          : "";

        if (
          !existingTeacher.user_id &&
          updateData.userId === undefined &&
          normalizedMergedEmail
        ) {
          const dupTeacher = await client.query(
            `SELECT id FROM teachers
             WHERE tenant_id = $1 AND id != $2 AND LOWER(TRIM(email)) = $3`,
            [request.tenantId, id, normalizedMergedEmail]
          );
          if (dupTeacher.rows.length > 0) {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              error: "Conflict",
              message: "Un enseignant avec cet email existe déjà",
            });
          }

          const existingUser = await client.query(
            `SELECT id, tenant_id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
            [normalizedMergedEmail]
          );
          if (existingUser.rows.length > 0) {
            await client.query("ROLLBACK");
            const sameTenant = existingUser.rows[0].tenant_id === request.tenantId;
            return reply.status(409).send({
              error: "Conflict",
              message: sameTenant
                ? "Un compte utilisateur avec cet email existe deja pour ce client"
                : "Cet email est deja utilise dans un autre tenant",
            });
            return reply.status(409).send({
              error: "Conflict",
              message: "Un compte utilisateur avec cet email existe déjà pour ce client",
            });
          }

          let teacherRoleId: string;
          const roleRes = await client.query(
            `SELECT id FROM roles WHERE key = 'teacher' AND COALESCE(is_active, true) = true LIMIT 1`
          );
          if (roleRes.rows.length === 0) {
            const insRole = await client.query(
              `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
               VALUES ('teacher', 'Enseignant', true, true, NOW(), NOW()) RETURNING id`
            );
            teacherRoleId = insRole.rows[0].id;
          } else {
            teacherRoleId = roleRes.rows[0].id;
          }

          const plainPassword = generateTemporaryPassword();
          const passwordHash = await bcrypt.hash(plainPassword, 10);
          const fullName = `${mergedFirstName} ${mergedLastName}`;
          const userIns = await client.query(
            `INSERT INTO users (
              tenant_id, email, name, first_name, last_name, password_hash, initial_password,
              is_active, active_role_key, created_at, updated_at, role_updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'teacher', NOW(), NOW(), NOW())
            RETURNING id`,
            [
              request.tenantId,
              normalizedMergedEmail,
              fullName,
              mergedFirstName,
              mergedLastName,
              passwordHash,
              plainPassword,
            ]
          );
          const newUserId = userIns.rows[0].id as string;
          await client.query(
            `INSERT INTO user_roles (tenant_id, user_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
            [request.tenantId, newUserId, teacherRoleId]
          );

          updateFields.push(`user_id = $${paramIndex}`);
          updateValues.push(newUserId);
          paramIndex++;
          linkedInitialPassword = plainPassword;
        }

        // Always update the updated_at timestamp
        updateFields.push(`updated_at = NOW()`);

        if (updateFields.length === 1) {
          // Only updated_at was added
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        // Execute update
        const updateQuery = `
          UPDATE teachers
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, tenant_id, user_id, employee_number, first_name, last_name,
                    email, phone, specialties, bio, qualifications, hire_date,
                    contract_type, hourly_rate, status, created_at, updated_at
        `;

        updateValues.push(id, request.tenantId);
        const updateResult = await client.query(updateQuery, updateValues);

        await client.query('COMMIT');

        const teacher = updateResult.rows[0];
        const response = serializeTeacherRow(teacher, {
          initialPassword: linkedInitialPassword,
        });

        reply.send(response);
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error updating teacher: ${error}`);
        if (isUniqueViolation(error)) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Cet email est deja utilise",
          });
        }
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while updating the teacher",
        });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/teachers/:id - Delete teacher
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        204: { type: "null" },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        409: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Ensure teacher exists in this tenant
        const existsRes = await client.query(
          `SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        if (existsRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Teacher not found',
          });
        }

        // Attempt delete (will fail with FK violation if referenced)
        try {
          const delRes = await client.query(
            `DELETE FROM teachers WHERE id = $1 AND tenant_id = $2`,
            [id, request.tenantId]
          );
          await client.query('COMMIT');
          return reply.status(204).send();
        } catch (err: any) {
          await client.query('ROLLBACK');
          // 23503 = foreign_key_violation in Postgres
          if (err && err.code === '23503') {
            return reply.status(409).send({
              error: 'Conflict',
              message: 'Impossible de supprimer cet enseignant car il est référencé par d\'autres enregistrements.',
            });
          }
          fastify.log.error(`Error deleting teacher: ${err}`);
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: 'An error occurred while deleting the teacher',
          });
        }
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/teachers/me/classes - List classes assigned to authenticated teacher
  fastify.get("/me/classes", {
    schema: {
      description: "Classes list for the authenticated teacher (based on x-user-id or request.user)",
      tags: ["Teachers"],
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  code: { type: "string" },
                  capacity: { type: "number" },
                  programmeName: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  }, async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }

    try {
      // Set tenant context for RLS
      await fastify.pg.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

      // Resolve teacher id from user
      const userIdHeader = request.headers['x-user-id'] as string;
      const userId = userIdHeader || request.user?.id;
      if (!userId) {
        return reply.status(401).send({ error: "Authentication Required", message: "User ID is required" });
      }

      const teacherRes = await fastify.pg.query(
        'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
        [userId, request.tenantId]
      );
      if (teacherRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Teacher Not Found', message: 'No teacher profile found for this user' });
      }
      const teacherId = teacherRes.rows[0].id;

      // Fetch distinct classes from teacher_assignments
      // Note: scheduled_sessions table might not exist, so we only use teacher_assignments
      const classesRes = await fastify.pg.query(`
        SELECT DISTINCT
          cl.id,
          cl.name,
          cl.code,
          cl.max_students AS capacity,
          p.name AS programme_name
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN programmes p ON cl.programme_id = p.id
        WHERE ta.teacher_id = $1 
          AND ta.tenant_id = $2
          AND cl.tenant_id = $2
        ORDER BY cl.name ASC
      `, [teacherId, request.tenantId]);

      const data = classesRes.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        capacity: row.capacity,
        programmeName: row.programme_name
      }));

      return reply.send({ data });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error fetching teacher classes');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch teacher classes' });
    }
  });

}
