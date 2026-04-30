import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

function readBootstrapConfig() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const fullName = process.env.SUPER_ADMIN_NAME?.trim() || "Super Administrateur";

  if (!email || !password) {
    return null;
  }

  return { email, password, fullName };
}

export async function bootstrapSuperAdmin(fastify: FastifyInstance): Promise<void> {
  const config = readBootstrapConfig();

  if (!config) {
    fastify.log.warn(
      "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are not configured. Super-admin bootstrap skipped."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(config.password, 12);
  const client = await fastify.pg.connect();

  try {
    await client.query(
      `
        INSERT INTO super_admin_users (
          singleton_key,
          email,
          full_name,
          password_hash,
          is_active,
          created_at,
          updated_at,
          last_bootstrapped_at
        )
        VALUES ('primary', $1, $2, $3, true, NOW(), NOW(), NOW())
        ON CONFLICT (singleton_key)
        DO UPDATE SET
          email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          password_hash = EXCLUDED.password_hash,
          is_active = true,
          updated_at = NOW(),
          last_bootstrapped_at = NOW()
      `,
      [config.email, config.fullName, passwordHash]
    );
  } finally {
    client.release();
  }
}
