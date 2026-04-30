import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  createTenant,
  ensureTechnicalAccountsForTenant,
  listTenants,
  setTenantActiveState,
} from "../services/tenant-provisioning.service";

const tenantCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

const tenantPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  isActive: z.boolean().optional(),
});

function requireSuperAdmin(request: any) {
  if (!request.superAdmin) {
    throw new Error("SUPER_ADMIN_REQUIRED");
  }
  return request.superAdmin as { id: string; email: string };
}

export async function superAdminTenantsRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    try {
      requireSuperAdmin(request);
        const client = (await fastify.pg.connect()) as PoolClient;

      try {
        const tenants = await listTenants(client);
        return reply.send({ tenants });
      } finally {
        client.release();
      }
    } catch (error) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Super administrator authentication is required",
      });
    }
  });

  fastify.post("/", async (request, reply) => {
    let client: PoolClient | undefined;
    try {
      const superAdmin = requireSuperAdmin(request);
      const input = tenantCreateSchema.parse(request.body);

      client = (await fastify.pg.connect()) as PoolClient;
      await client.query("BEGIN");

      const tenant = await createTenant(client, {
        name: input.name,
        slug: input.slug,
        createdBySuperAdminId: superAdmin.id,
      });

      await client.query("COMMIT");
      return reply.status(201).send({ tenant });
    } catch (error: any) {
      if (client) {
        await client.query("ROLLBACK");
      }

      const isDuplicate = String(error?.message || "").includes("duplicate key");
      return reply.status(isDuplicate ? 409 : 400).send({
        error: isDuplicate ? "Tenant Exists" : "Tenant Creation Failed",
        message: error instanceof Error ? error.message : "Unable to create tenant",
      });
    } finally {
      if (client) client.release();
    }
  });

  fastify.patch("/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = tenantPatchSchema.parse(request.body);

    let client: PoolClient | undefined;
    try {
      requireSuperAdmin(request);
      client = (await fastify.pg.connect()) as PoolClient;
      await client.query("BEGIN");

      const existing = await client.query<{ id: string; slug: string; is_reference: boolean }>(
        "SELECT id, slug, COALESCE(is_reference, false) AS is_reference FROM tenants WHERE id = $1 FOR UPDATE",
        [params.id]
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({
          error: "Not Found",
          message: "Tenant not found",
        });
      }

      await client.query(
        `
          UPDATE tenants
          SET name = COALESCE($2, name),
              slug = COALESCE($3, slug),
              updated_at = NOW()
          WHERE id = $1
        `,
        [params.id, input.name ?? null, input.slug ?? null]
      );

      if (typeof input.isActive === "boolean") {
        if (existing.rows[0].is_reference && input.isActive === false) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "Reference Tenant",
            message: "The reference tenant cannot be disabled",
          });
        }
        await setTenantActiveState(client, params.id, input.isActive);
      }

      const updated = await client.query(
        "SELECT id, slug, name, COALESCE(is_active, true) AS is_active FROM tenants WHERE id = $1",
        [params.id]
      );

      if (input.slug) {
        await ensureTechnicalAccountsForTenant(client, params.id, input.slug);
      }

      await client.query("COMMIT");
      return reply.send({ tenant: updated.rows[0] });
    } catch (error: any) {
      if (client) {
        await client.query("ROLLBACK");
      }

      return reply.status(400).send({
        error: "Tenant Update Failed",
        message: error instanceof Error ? error.message : "Unable to update tenant",
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

      const existing = await client.query<{ is_reference: boolean }>(
        "SELECT COALESCE(is_reference, false) AS is_reference FROM tenants WHERE id = $1 FOR UPDATE",
        [params.id]
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({
          error: "Not Found",
          message: "Tenant not found",
        });
      }

      if (existing.rows[0].is_reference) {
        await client.query("ROLLBACK");
        return reply.status(400).send({
          error: "Reference Tenant",
          message: "The reference tenant cannot be deleted",
        });
      }

      await client.query("DELETE FROM tenants WHERE id = $1", [params.id]);
      await client.query("COMMIT");

      return reply.send({ message: "Tenant deleted successfully" });
    } catch (error) {
      if (client) {
        await client.query("ROLLBACK");
      }

      return reply.status(500).send({
        error: "Tenant Delete Failed",
        message: error instanceof Error ? error.message : "Unable to delete tenant",
      });
    } finally {
      if (client) client.release();
    }
  });
}
