import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";

export async function usersRoutes(fastify: FastifyInstance) {
  // POST /api/v1/users - Create user
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["firstName", "lastName", "email", "password"],
        properties: {
          firstName: { type: "string", minLength: 1, maxLength: 100 },
          lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },

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

      const { firstName, lastName, email, password } = request.body as any;
      const client = await fastify.pg.connect();

      try {
        // Check if email already exists for this tenant
        const existingUserQuery = `
          SELECT id FROM users
          WHERE tenant_id = $1 AND email = $2
        `;
        const existingUserResult = await client.query(existingUserQuery, [request.tenantId, email]);

        if (existingUserResult.rows.length > 0) {
          return reply.status(409).send({
            error: "Conflict",
            message: "A user with this email already exists",
          });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user
        const fullName = `${firstName} ${lastName}`;
        const createUserQuery = `
          INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING id, email, first_name, last_name, created_at, updated_at
        `;
        const userResult = await client.query(createUserQuery, [
          request.tenantId,
          email,
          fullName,
          firstName,
          lastName,
          passwordHash
        ]);

        const user = userResult.rows[0];

        return reply.status(201).send({
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        });
      } catch (error) {
        console.error("Error creating user:", error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create user",
        });
      } finally {
        client.release();
      }
    },
  });
}
