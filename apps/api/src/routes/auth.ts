import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { LoginResponseSchema, LogoutResponseSchema } from "@ecoledigitale/contracts";
import { addToBlacklist, isBlacklisted } from "../services/blacklist.service";
import { decodeToken, extractTokenFromHeader, verifyToken } from "../services/jwt.service";
import {
  buildUserLoginResponse,
  loadUserAuthContextByEmail,
  loadUserAuthContextById,
  persistActiveRolePreference,
  verifyUserPassword,
} from "../services/user-auth.service";
import { setRlsContext } from "../services/rls-context.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  activeRole: z.string().min(1).optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

const socialLoginSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  provider: z.enum(["google"]),
});

const switchRoleSchema = z.object({
  activeRole: z.string().min(1),
});

async function ensureGlobalRole(
  client: any,
  key: string,
  name: string
): Promise<string> {
  const existing = await client.query("SELECT id FROM roles WHERE key = $1 LIMIT 1", [key]);
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const created = await client.query(
    `
      INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
      VALUES ($1, $2, true, true, NOW(), NOW())
      RETURNING id
    `,
    [key, name]
  );
  return created.rows[0].id;
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/register", {
    handler: async (request, reply) => {
      const { email, password, firstName, lastName } = registerSchema.parse(request.body);
      const normalizedEmail = email.trim().toLowerCase();

      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "Register requires tenant context",
        });
      }

      setRlsContext({
        tenantId: request.tenantId,
        isSuperAdmin: true,
      });

      let client;
      try {
        client = await fastify.pg.connect();
        await client.query("BEGIN");

        const existing = await client.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [normalizedEmail]);
        if (existing.rows.length > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "Account Exists",
            message: "Un compte existe déjà avec cet email",
          });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const userResult = await client.query(
          `
            INSERT INTO users (
              tenant_id,
              email,
              name,
              first_name,
              last_name,
              password_hash,
              active_role_key,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'student', NOW(), NOW())
            RETURNING id
          `,
          [request.tenantId, normalizedEmail, `${firstName} ${lastName}`, firstName, lastName, passwordHash]
        );

        const roleId = await ensureGlobalRole(client, "student", "Étudiant");
        await client.query(
          `
            INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
          `,
          [request.tenantId, userResult.rows[0].id, roleId]
        );

        const context = await loadUserAuthContextById(client, userResult.rows[0].id, "student");
        if (!context) {
          throw new Error("Failed to load newly created account");
        }

        await client.query("COMMIT");
        return reply.send(buildUserLoginResponse(context));
      } catch (error: any) {
        if (client) {
          await client.query("ROLLBACK");
        }
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error.message || "Failed to register account",
        });
      } finally {
        if (client) client.release();
      }
    },
  });

  fastify.post("/social-login", {
    handler: async (request, reply) => {
      const { email, firstName, lastName } = socialLoginSchema.parse(request.body);
      const normalizedEmail = email.trim().toLowerCase();

      setRlsContext({
        tenantId: request.tenantId ?? null,
        isSuperAdmin: true,
      });

      let client;
      try {
        client = await fastify.pg.connect();
        await client.query("BEGIN");

        let context = await loadUserAuthContextByEmail(client, normalizedEmail);

        if (!context) {
          if (!request.tenantId) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "Tenant Required",
              message: "First social login requires tenant context",
            });
          }

          const roleId = await ensureGlobalRole(client, "student", "Étudiant");
          const createdUser = await client.query(
            `
              INSERT INTO users (
                tenant_id,
                email,
                name,
                first_name,
                last_name,
                password_hash,
                active_role_key,
                created_at,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, '', 'student', NOW(), NOW())
              RETURNING id
            `,
            [
              request.tenantId,
              normalizedEmail,
              `${firstName || normalizedEmail.split("@")[0]} ${lastName || "Client"}`,
              firstName || normalizedEmail.split("@")[0],
              lastName || "Client",
            ]
          );

          await client.query(
            `
              INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
            `,
            [request.tenantId, createdUser.rows[0].id, roleId]
          );

          context = await loadUserAuthContextById(client, createdUser.rows[0].id, "student");
        }

        if (!context) {
          throw new Error("Failed social login");
        }

        if (!context.tenantIsActive || !context.userIsActive) {
          await client.query("ROLLBACK");
          return reply.status(403).send({
            error: "Account Disabled",
            message: "This account is disabled",
          });
        }

        await client.query("COMMIT");
        return reply.send(buildUserLoginResponse(context));
      } catch (error: any) {
        if (client) {
          await client.query("ROLLBACK");
        }
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error.message || "Failed social login",
        });
      } finally {
        if (client) client.release();
      }
    },
  });

  fastify.post("/login", {
    handler: async (request, reply) => {
      const { email, password, activeRole } = loginSchema.parse(request.body);
      const normalizedEmail = email.trim().toLowerCase();

      setRlsContext({
        tenantId: null,
        isSuperAdmin: true,
      });

      const client = await fastify.pg.connect();
      try {
        const context = await loadUserAuthContextByEmail(client, normalizedEmail, activeRole);
        if (!context) {
          return reply.status(401).send({
            error: "Invalid Credentials",
            message: "Email or password is incorrect",
          });
        }

        const valid = await verifyUserPassword(context, password);
        if (!valid) {
          return reply.status(401).send({
            error: "Invalid Credentials",
            message: "Email or password is incorrect",
          });
        }

        if (!context.tenantIsActive) {
          return reply.status(403).send({
            error: "Tenant Disabled",
            message: "This tenant is disabled",
            code: "TENANT_DISABLED",
          });
        }

        if (!context.userIsActive) {
          return reply.status(403).send({
            error: "Account Disabled",
            message: "This account is disabled",
            code: "ACCOUNT_DISABLED",
          });
        }

        await persistActiveRolePreference(client, context.userId, context.activeRole);
        return reply.send(buildUserLoginResponse(context));
      } catch (error) {
        fastify.log.error({ err: error }, "login failed");
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "An error occurred during login",
          code: "AUTH_LOGIN_FAILED",
        });
      } finally {
        client.release();
      }
    },
  });

  fastify.post("/switch-role", {
    handler: async (request, reply) => {
      const token = extractTokenFromHeader(request.headers.authorization as string | undefined);
      if (!token) {
        return reply.status(401).send({
          error: "Authentication Required",
          message: "User must be authenticated",
          code: "TOKEN_MISSING",
        });
      }

      const { activeRole } = switchRoleSchema.parse(request.body);
      let client: any;

      try {
        const payload = verifyToken(token);
        setRlsContext({
          tenantId: payload.tenantId,
          isSuperAdmin: false,
        });

        client = await fastify.pg.connect();
        if (
          await isBlacklisted(fastify, {
            scope: "tenant_user",
            tenantId: payload.tenantId,
            tokenJti: payload.jti,
          })
        ) {
          return reply.status(401).send({
            error: "Token Revoked",
            message: "Token has been revoked",
            code: "TOKEN_REVOKED",
          });
        }

        const context = await loadUserAuthContextById(client, payload.userId, activeRole);
        if (!context || context.tenantId !== payload.tenantId) {
          return reply.status(404).send({
            error: "Not Found",
            message: "User account not found",
          });
        }

        if (!context.availableRoles.includes(activeRole)) {
          return reply.status(403).send({
            error: "Forbidden",
            message: "This role is not assigned to the current user",
            code: "ROLE_NOT_ASSIGNED",
          });
        }

        await persistActiveRolePreference(client, context.userId, activeRole);
        const refreshed = await loadUserAuthContextById(client, context.userId, activeRole);
        if (!refreshed) {
          throw new Error("Failed to reload user after role switch");
        }

        return reply.send(buildUserLoginResponse(refreshed));
      } catch (error) {
        fastify.log.error({ err: error }, "role switch failed");
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unable to switch role",
          code: "ROLE_SWITCH_FAILED",
        });
      } finally {
        if (client) client.release();
      }
    },
  });

  fastify.post("/logout", {
    handler: async (request, reply) => {
      try {
        const authHeader = request.headers.authorization as string | undefined;
        const token = extractTokenFromHeader(authHeader);
        if (!token) {
          return reply.status(401).send({
            error: "Authentication Required",
            message: "No token provided",
            code: "TOKEN_MISSING",
          });
        }

        const decoded = decodeToken(token);
        if (!decoded) {
          return reply.status(401).send({
            error: "Invalid Token",
            message: "Token could not be decoded",
            code: "TOKEN_INVALID",
          });
        }

        await addToBlacklist(fastify, {
          scope: "tenant_user",
          tenantId: decoded.tenantId,
          userId: decoded.userId,
          tokenJti: decoded.jti,
          expiresAt: new Date(decoded.exp * 1000),
          reason: "forced_logout",
        });

        const response = LogoutResponseSchema.parse({ message: "Logged out successfully" });
        return reply.send(response);
      } catch (error) {
        fastify.log.error({ err: error }, "logout failed");
        return reply.status(500).send({
          error: "Internal Error",
          message: "Logout failed",
          code: "INTERNAL_ERROR",
        });
      }
    },
  });

  fastify.post("/refresh", {
    handler: async (request, reply) => {
      try {
        const authHeader = request.headers.authorization as string | undefined;
        const token = extractTokenFromHeader(authHeader);
        if (!token) {
          return reply.status(401).send({
            error: "Authentication Required",
            message: "No token provided for refresh",
            code: "TOKEN_MISSING",
          });
        }

        const decoded = decodeToken(token);
        if (!decoded) {
          return reply.status(401).send({
            error: "Invalid Token",
            message: "Token could not be decoded",
            code: "TOKEN_INVALID",
          });
        }

        if (
          await isBlacklisted(fastify, {
            scope: "tenant_user",
            tenantId: decoded.tenantId,
            tokenJti: decoded.jti,
          })
        ) {
          return reply.status(401).send({
            error: "Token Revoked",
            message: "Token has been revoked",
            code: "TOKEN_REVOKED",
          });
        }

        const verified = verifyToken(token);
        setRlsContext({
          tenantId: verified.tenantId,
          isSuperAdmin: false,
        });

        const client = await fastify.pg.connect();
        try {
          const context = await loadUserAuthContextById(client, verified.userId, verified.activeRole);
          if (!context) {
            return reply.status(401).send({
              error: "Authentication Failed",
              message: "User not found",
              code: "USER_NOT_FOUND",
            });
          }
          return reply.send(buildUserLoginResponse(context));
        } finally {
          client.release();
        }
      } catch (error) {
        return reply.status(401).send({
          error: "Token Refresh Failed",
          message: error instanceof Error ? error.message : "Failed to refresh token",
          code: "TOKEN_INVALID",
        });
      }
    },
  });
}
