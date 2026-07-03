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
import { emailService } from "../services/email.service";

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

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

// One child in a family registration (parent registers their children).
// Each child must provide their own login email.
const registerChildSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  dateOfBirth: optionalString(20),
  gender: z.enum(["masculin", "feminin"]).optional(),
  placeOfBirth: optionalString(255),
  nationality: optionalString(100),
});

const registerRequestSchema = z.object({
  accountType: z.enum(["student", "parent"]),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().email(),
  phone: optionalString(40),
  dateOfBirth: optionalString(20),
  gender: z.enum(["masculin", "feminin"]).optional(),
  address: optionalString(2000),
  // Student-specific
  placeOfBirth: optionalString(255),
  nationality: optionalString(100),
  currentYear: z.coerce.number().int().min(1).max(10).optional(),
  fatherName: optionalString(255),
  motherName: optionalString(255),
  // Parent-specific
  relationship: optionalString(50),
  childMatricule: optionalString(50),
  profession: optionalString(255),
  // Family registration: a parent registering one or more children at once.
  children: z.array(registerChildSchema).max(20).optional(),
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

  // Public self-registration request. Creates NO account — only a pending
  // registration_requests row that an administrator must approve.
  fastify.post("/register-request", {
    handler: async (request, reply) => {
      const parsed = registerRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation Error",
          message: "Données d'inscription invalides",
          details: parsed.error.flatten(),
        });
      }

      const data = parsed.data;
      const normalizedEmail = data.email.trim().toLowerCase();

      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "L'établissement n'a pas pu être identifié pour cette inscription",
        });
      }

      setRlsContext({ tenantId: request.tenantId, isSuperAdmin: true });

      const children = data.children ?? [];
      // A family registration (1 parent + 1..N children) is always parent-led:
      // the parent row carries the children inside `details.children`, and an
      // administrator validates the whole family in a single action.
      const isFamily = children.length > 0;
      const accountType: "student" | "parent" = isFamily ? "parent" : data.accountType;

      const details: Record<string, unknown> = {};
      if (isFamily) {
        if (data.relationship) details.relationship = data.relationship;
        if (data.profession) details.profession = data.profession;
        details.children = children.map((child) => {
          const entry: Record<string, unknown> = {
            firstName: child.firstName,
            lastName: child.lastName,
          };
          if (child.email) entry.email = child.email;
          if (child.dateOfBirth) entry.dateOfBirth = child.dateOfBirth;
          if (child.gender) entry.gender = child.gender;
          if (child.placeOfBirth) entry.placeOfBirth = child.placeOfBirth;
          if (child.nationality) entry.nationality = child.nationality;
          return entry;
        });
      } else if (accountType === "student") {
        if (data.placeOfBirth) details.placeOfBirth = data.placeOfBirth;
        if (data.nationality) details.nationality = data.nationality;
        if (data.currentYear) details.currentYear = data.currentYear;
        if (data.fatherName) details.fatherName = data.fatherName;
        if (data.motherName) details.motherName = data.motherName;
      } else {
        if (data.relationship) details.relationship = data.relationship;
        if (data.childMatricule) details.childMatricule = data.childMatricule;
        if (data.profession) details.profession = data.profession;
      }

      let client;
      try {
        client = await fastify.pg.connect();

        const existingUser = await client.query(
          "SELECT id FROM users WHERE tenant_id = $1 AND LOWER(email) = $2 LIMIT 1",
          [request.tenantId, normalizedEmail]
        );
        if (existingUser.rows.length > 0) {
          return reply.status(409).send({
            error: "Account Exists",
            message: "Un compte existe déjà avec cet email",
          });
        }

        const existingPending = await client.query(
          `SELECT id FROM registration_requests
           WHERE tenant_id = $1 AND LOWER(email) = $2 AND status = 'pending' LIMIT 1`,
          [request.tenantId, normalizedEmail]
        );
        if (existingPending.rows.length > 0) {
          return reply.status(409).send({
            error: "Request Pending",
            message: "Une demande d'inscription est déjà en cours de traitement pour cet email",
          });
        }

        // Reject family registrations whose provided child emails already exist.
        if (isFamily) {
          const childEmails = children
            .map((child) => child.email)
            .filter((email): email is string => Boolean(email));
          if (childEmails.length > 0) {
            const dup = await client.query(
              "SELECT LOWER(email) AS email FROM users WHERE tenant_id = $1 AND LOWER(email) = ANY($2::text[])",
              [request.tenantId, childEmails]
            );
            if (dup.rows.length > 0) {
              return reply.status(409).send({
                error: "Account Exists",
                message: `Un compte existe déjà avec l'email enfant : ${dup.rows[0].email}`,
              });
            }
          }
        }

        const inserted = await client.query(
          `
            INSERT INTO registration_requests (
              tenant_id, account_type, first_name, last_name, email, phone,
              date_of_birth, gender, address, details, status, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW(), NOW())
            RETURNING id
          `,
          [
            request.tenantId,
            accountType,
            data.firstName,
            data.lastName,
            normalizedEmail,
            data.phone ?? null,
            isFamily ? null : data.dateOfBirth ?? null,
            isFamily ? null : data.gender ?? null,
            data.address ?? null,
            JSON.stringify(details),
          ]
        );

        let tenantName: string | undefined;
        try {
          const tenantRow = await client.query("SELECT name FROM tenants WHERE id = $1", [
            request.tenantId,
          ]);
          tenantName = tenantRow.rows[0]?.name;
        } catch {
          // Non-blocking — tenant name is only used to personalise the email.
        }

        // Acknowledgement email is best-effort: never fail the request on it.
        emailService
          .sendRegistrationReceived(normalizedEmail, {
            firstName: data.firstName,
            accountType,
            tenantName,
          })
          .catch((err) => fastify.log.warn({ err }, "registration ack email failed"));

        return reply.status(201).send({
          success: true,
          id: inserted.rows[0].id,
          message: isFamily
            ? "Votre demande d'inscription a été enregistrée. Après validation, vous recevrez par email vos identifiants ainsi que ceux de vos enfants."
            : "Votre demande d'inscription a été enregistrée. Vous recevrez vos identifiants par email après validation.",
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error?.message || "Échec de l'enregistrement de la demande",
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
