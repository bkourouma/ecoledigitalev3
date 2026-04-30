import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { addToBlacklist } from "../services/blacklist.service";
import { extractTokenFromHeader } from "../services/jwt.service";
import {
  decodeSuperAdminToken,
  generateSuperAdminToken,
  verifySuperAdminToken,
} from "../services/super-admin-jwt.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function superAdminAuthRoutes(fastify: FastifyInstance) {
  fastify.post("/login", async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);
    const client = (await fastify.pg.connect()) as PoolClient;

    try {
      const result = await client.query<{
        id: string;
        email: string;
        full_name: string;
        password_hash: string;
        is_active: boolean;
      }>(
        `
          SELECT id, email, full_name, password_hash, COALESCE(is_active, true) AS is_active
          FROM super_admin_users
          WHERE singleton_key = 'primary'
            AND LOWER(email) = LOWER($1)
          LIMIT 1
        `,
        [email]
      );

      const superAdmin = result.rows[0];
      if (!superAdmin || !superAdmin.is_active) {
        return reply.status(401).send({
          error: "Invalid Credentials",
          message: "Email or password is incorrect",
        });
      }

      const valid = await bcrypt.compare(password, superAdmin.password_hash);
      if (!valid) {
        return reply.status(401).send({
          error: "Invalid Credentials",
          message: "Email or password is incorrect",
        });
      }

      const token = generateSuperAdminToken(superAdmin.id, superAdmin.email);
      const decoded = decodeSuperAdminToken(token);

      await client.query("UPDATE super_admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [
        superAdmin.id,
      ]);

      return reply.send({
        superAdmin: {
          id: superAdmin.id,
          email: superAdmin.email,
          fullName: superAdmin.full_name,
        },
        token,
        expiresAt: decoded ? new Date(decoded.exp * 1000).toISOString() : null,
      });
    } catch (error) {
      fastify.log.error({ err: error }, "super-admin login failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Unable to login super administrator",
      });
    } finally {
      client.release();
    }
  });

  fastify.post("/logout", async (request, reply) => {
    const token = extractTokenFromHeader(request.headers.authorization as string | undefined);
    if (!token) {
      return reply.status(401).send({
        error: "Authentication Required",
        message: "No token provided",
      });
    }

    try {
      const payload = verifySuperAdminToken(token);
      await addToBlacklist(fastify, {
        scope: "super_admin",
        superAdminId: payload.superAdminId,
        tokenJti: payload.jti,
        expiresAt: new Date(payload.exp * 1000),
        reason: "forced_logout",
      });

      return reply.send({ message: "Logged out successfully" });
    } catch (error) {
      return reply.status(401).send({
        error: "Authentication Failed",
        message: error instanceof Error ? error.message : "Invalid token",
      });
    }
  });
}
