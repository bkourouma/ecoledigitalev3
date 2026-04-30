import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { syncTechnicalAccountsForAllTenants } from "../services/tenant-provisioning.service";

const roleCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_:-]+$/),
  name: z.string().min(1).max(255),
  isActive: z.boolean().default(true),
});

const rolePatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

function requireSuperAdmin(request: any) {
  if (!request.superAdmin) {
    throw new Error("SUPER_ADMIN_REQUIRED");
  }
}

export async function superAdminRolesRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    try {
      requireSuperAdmin(request);
      const client = (await fastify.pg.connect()) as PoolClient;

      try {
        const roles = await client.query(
          `
            SELECT id, key, name, COALESCE(is_active, true) AS is_active, COALESCE(is_system, false) AS is_system
            FROM roles
            ORDER BY key ASC
          `
        );

        return reply.send({ roles: roles.rows });
      } finally {
        client.release();
      }
    } catch {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Super administrator authentication is required",
      });
    }
  });

  fastify.post("/", async (request, reply) => {
    let client: PoolClient | undefined;
    try {
      requireSuperAdmin(request);
      const input = roleCreateSchema.parse(request.body);
      const key = input.key.trim().toLowerCase();

      client = (await fastify.pg.connect()) as PoolClient;
      await client.query("BEGIN");

      const existing = await client.query("SELECT id FROM roles WHERE key = $1 LIMIT 1", [key]);
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          error: "Role Exists",
          message: "A role already exists with this key",
        });
      }

      const created = await client.query(
        `
          INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
          VALUES ($1, $2, $3, false, NOW(), NOW())
          RETURNING id, key, name, is_active, is_system
        `,
        [key, input.name, input.isActive]
      );

      await syncTechnicalAccountsForAllTenants(client);
      await client.query("COMMIT");

      return reply.status(201).send({ role: created.rows[0] });
    } catch (error) {
      if (client) {
        await client.query("ROLLBACK");
      }

      return reply.status(400).send({
        error: "Role Creation Failed",
        message: error instanceof Error ? error.message : "Unable to create role",
      });
    } finally {
      if (client) client.release();
    }
  });

  fastify.patch("/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = rolePatchSchema.parse(request.body);

    let client: PoolClient | undefined;
    try {
      requireSuperAdmin(request);
      client = (await fastify.pg.connect()) as PoolClient;
      await client.query("BEGIN");

      const updated = await client.query(
        `
          UPDATE roles
          SET name = COALESCE($2, name),
              is_active = COALESCE($3, is_active),
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, key, name, COALESCE(is_active, true) AS is_active, COALESCE(is_system, false) AS is_system
        `,
        [params.id, input.name ?? null, input.isActive ?? null]
      );

      if (updated.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({
          error: "Not Found",
          message: "Role not found",
        });
      }

      if (typeof input.isActive === "boolean") {
        await syncTechnicalAccountsForAllTenants(client);
      }

      await client.query("COMMIT");
      return reply.send({ role: updated.rows[0] });
    } catch (error) {
      if (client) {
        await client.query("ROLLBACK");
      }

      return reply.status(400).send({
        error: "Role Update Failed",
        message: error instanceof Error ? error.message : "Unable to update role",
      });
    } finally {
      if (client) client.release();
    }
  });

  fastify.delete("/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    let client: PoolClient | undefined;
    try {
      requireSuperAdmin(request);
      client = (await fastify.pg.connect()) as PoolClient;
      await client.query("BEGIN");

      const updated = await client.query(
        `
          UPDATE roles
          SET is_active = false,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, key, name, is_active
        `,
        [params.id]
      );

      if (updated.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({
          error: "Not Found",
          message: "Role not found",
        });
      }

      await syncTechnicalAccountsForAllTenants(client);
      await client.query("COMMIT");

      return reply.send({
        message: "Role disabled successfully",
        role: updated.rows[0],
      });
    } catch (error) {
      if (client) {
        await client.query("ROLLBACK");
      }

      return reply.status(500).send({
        error: "Role Disable Failed",
        message: error instanceof Error ? error.message : "Unable to disable role",
      });
    } finally {
      if (client) client.release();
    }
  });
}
