import type { FastifyInstance } from "fastify";

export type BlacklistScope = "tenant_user" | "super_admin";
export type TokenRevocationReason =
  | "role_change"
  | "account_deleted"
  | "forced_logout"
  | "admin_revoked";

export interface BlacklistInsertInput {
  scope: BlacklistScope;
  tokenJti: string;
  expiresAt: Date;
  tenantId?: string | null;
  userId?: string | null;
  superAdminId?: string | null;
  reason?: TokenRevocationReason | null;
  revokedBy?: string | null;
}

export interface BlacklistLookupInput {
  scope: BlacklistScope;
  tokenJti: string;
  tenantId?: string | null;
}

export async function addToBlacklist(
  fastify: FastifyInstance,
  input: BlacklistInsertInput
): Promise<void> {
  const client = await fastify.pg.connect();

  try {
    await client.query(
      `
        INSERT INTO token_blacklist (
          scope,
          tenant_id,
          token_jti,
          user_id,
          super_admin_id,
          expires_at,
          reason,
          revoked_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (scope, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), token_jti)
        DO NOTHING
      `,
      [
        input.scope,
        input.tenantId ?? null,
        input.tokenJti,
        input.userId ?? null,
        input.superAdminId ?? null,
        input.expiresAt,
        input.reason ?? null,
        input.revokedBy ?? null,
      ]
    );
  } finally {
    client.release();
  }
}

export async function isBlacklisted(
  fastify: FastifyInstance,
  input: BlacklistLookupInput
): Promise<boolean> {
  const client = await fastify.pg.connect();

  try {
    const result = await client.query<{ is_blacklisted: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM token_blacklist
          WHERE scope = $1
            AND token_jti = $2
            AND (
              ($3::uuid IS NULL AND tenant_id IS NULL)
              OR tenant_id = $3::uuid
            )
            AND expires_at > NOW()
        ) AS is_blacklisted
      `,
      [input.scope, input.tokenJti, input.tenantId ?? null]
    );

    return Boolean(result.rows[0]?.is_blacklisted);
  } catch (error) {
    fastify.log.error({ err: error }, "blacklist lookup failed");
    return false;
  } finally {
    client.release();
  }
}

export async function cleanupExpiredTokens(fastify: FastifyInstance): Promise<number> {
  const client = await fastify.pg.connect();

  try {
    const result = await client.query(
      `
        DELETE FROM token_blacklist
        WHERE expires_at < NOW()
        RETURNING id
      `
    );

    return result.rowCount || 0;
  } finally {
    client.release();
  }
}
