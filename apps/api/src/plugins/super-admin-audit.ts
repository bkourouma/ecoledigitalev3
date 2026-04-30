import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import fp from "fastify-plugin";

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

async function superAdminAuditPlugin(fastify: FastifyInstance) {
  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.superAdmin) {
      return;
    }

    const client = (await fastify.pg.connect()) as PoolClient;
    try {
      await client.query(
        `
          INSERT INTO super_admin_audit_logs (
            super_admin_id,
            selected_tenant_id,
            selected_tenant_slug,
            impersonated_user_id,
            action,
            method,
            path,
            status_code,
            ip_address,
            user_agent,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        `,
        [
          request.superAdmin.id,
          request.superAdmin.selectedTenantId ?? null,
          request.superAdmin.selectedTenantSlug ?? null,
          request.superAdmin.impersonatedUserId ?? null,
          `${request.method} ${(request as any).routerPath || request.url}`,
          request.method,
          request.url,
          reply.statusCode,
          request.ip,
          getHeaderValue(request.headers["user-agent"]),
        ]
      );
    } catch (error) {
      fastify.log.error({ err: error }, "failed to write super-admin audit log");
    } finally {
      client.release();
    }
  });
}

export default fp(superAdminAuditPlugin, {
  name: "super-admin-audit",
});
