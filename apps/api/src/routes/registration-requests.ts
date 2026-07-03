import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { emailService } from "../services/email.service";

const ADMIN_ROLES = ["admin", "owner", "super_admin"];

const LOGIN_URL =
  process.env.WEB_APP_URL ||
  process.env.FRONTEND_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://ecoledigitale.engage-360.net/login"
    : "http://localhost:3000/login");

/** Ensure the caller holds an administrative role. Replies 403 and returns false otherwise. */
function ensureAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = (request as any).user;
  const candidates = new Set<string>(
    [
      user?.activeRole,
      user?.role,
      ...(Array.isArray(user?.availableRoles) ? user.availableRoles : []),
      ...(Array.isArray(user?.roles) ? user.roles : []),
    ].filter(Boolean)
  );

  if (!ADMIN_ROLES.some((role) => candidates.has(role))) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Accès réservé à l'administration",
    });
    return false;
  }
  return true;
}

/** Generate a readable temporary password with mixed character classes. */
function generatePassword(length = 12): string {
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

/** Next sequential 5-digit establishment matricule for the tenant. */
async function getNextEstablishmentMatricule(client: any, tenantId: string): Promise<string> {
  const res = await client.query(
    `
      SELECT COALESCE(
        MAX(CASE WHEN establishment_matricule ~ '^[0-9]{5}$' THEN establishment_matricule::int END),
        10000
      ) + 1 AS next_value
      FROM student_profiles
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  return String(Number(res.rows[0]?.next_value || 10001)).padStart(5, "0");
}

/** Resolve a role id by key, creating the global role if it does not exist. */
async function ensureRole(client: any, key: string, name: string): Promise<string> {
  const existing = await client.query(
    "SELECT id FROM roles WHERE key = $1 AND COALESCE(is_active, true) = true LIMIT 1",
    [key]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await client.query(
    `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
     VALUES ($1, $2, true, true, NOW(), NOW())
     RETURNING id`,
    [key, name]
  );
  return created.rows[0].id;
}

/**
 * Create a full student account (users row + student role + student_profiles row).
 * Used both for a lone student request and for each child of a family request.
 * If no email is supplied, a unique one is derived from the generated matricule.
 */
async function createStudentWithProfile(
  client: any,
  tenantId: string,
  tenantSlug: string,
  hasGender: boolean,
  fields: {
    firstName: string;
    lastName: string;
    email?: string | null;
    password: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    placeOfBirth?: string | null;
    nationality?: string | null;
    address?: string | null;
    phone?: string | null;
    fatherName?: string | null;
    motherName?: string | null;
    currentYear?: number | null;
  }
): Promise<{ userId: string; studentProfileId: string; matricule: string; email: string; name: string }> {
  const matricule = await getNextEstablishmentMatricule(client, tenantId);
  const email = (
    fields.email && fields.email.trim()
      ? fields.email.trim()
      : `eleve.${matricule}@${tenantSlug}.local`
  ).toLowerCase();

  const dup = await client.query(
    "SELECT id FROM users WHERE tenant_id = $1 AND LOWER(email) = $2 LIMIT 1",
    [tenantId, email]
  );
  if (dup.rows.length > 0) {
    throw new Error(`Un compte existe déjà avec l'email ${email}`);
  }

  const name = `${fields.firstName} ${fields.lastName}`.trim();
  const passwordHash = await bcrypt.hash(fields.password, 10);
  const userRes = await client.query(
    `INSERT INTO users (
       tenant_id, email, name, first_name, last_name, password_hash,
       initial_password, active_role_key, created_at, updated_at, role_updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'student', NOW(), NOW(), NOW())
     RETURNING id`,
    [tenantId, email, name, fields.firstName, fields.lastName, passwordHash, fields.password]
  );
  const userId = userRes.rows[0].id;

  const roleId = await ensureRole(client, "student", "Étudiant");
  await client.query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
    [tenantId, userId, roleId]
  );

  const cols = [
    "tenant_id",
    "user_id",
    "student_number",
    "establishment_matricule",
    "current_year",
    "status",
    "date_of_birth",
    "place_of_birth",
    "nationality",
    "address",
    "phone",
    "father_name",
    "mother_name",
    "initial_password",
  ];
  const vals: any[] = [
    tenantId,
    userId,
    matricule,
    matricule,
    fields.currentYear || 1,
    "active",
    fields.dateOfBirth || null,
    fields.placeOfBirth || null,
    fields.nationality || null,
    fields.address || null,
    fields.phone || null,
    fields.fatherName || null,
    fields.motherName || null,
    fields.password,
  ];
  if (hasGender) {
    cols.push("gender");
    vals.push(fields.gender || "masculin");
  }

  const profRes = await client.query(
    `INSERT INTO student_profiles (${cols.join(", ")})
     VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING id`,
    vals
  );

  return { userId, studentProfileId: profRes.rows[0].id, matricule, email, name };
}

async function getTenantName(client: any, tenantId: string): Promise<string | undefined> {
  try {
    const res = await client.query("SELECT name FROM tenants WHERE id = $1", [tenantId]);
    return res.rows[0]?.name;
  } catch {
    return undefined;
  }
}

function mapRequestRow(row: any) {
  return {
    id: row.id,
    accountType: row.account_type,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    address: row.address,
    details: row.details || {},
    status: row.status,
    reviewNotes: row.review_notes,
    rejectionReason: row.rejection_reason,
    reviewedAt: row.reviewed_at,
    createdUserId: row.created_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function registrationRequestsRoutes(fastify: FastifyInstance) {
  // GET / - list registration requests
  fastify.get("/", async (request, reply) => {
    if (!ensureAdmin(request, reply)) return;
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "Tenant context required" });
    }

    const query = request.query as Record<string, string>;
    const status = query.status && query.status !== "all" ? query.status : null;
    const accountType =
      query.accountType && query.accountType !== "all" ? query.accountType : null;
    const search = query.search?.trim();
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "20", 10)));
    const offset = (page - 1) * limit;

    const client = await fastify.pg.connect();
    try {
      const conditions = ["tenant_id = $1"];
      const params: any[] = [request.tenantId];

      if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (accountType) {
        params.push(accountType);
        conditions.push(`account_type = $${params.length}`);
      }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        conditions.push(
          `(LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`
        );
      }

      const where = conditions.join(" AND ");
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM registration_requests WHERE ${where}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;

      const listRes = await client.query(
        `SELECT * FROM registration_requests WHERE ${where}
         ORDER BY created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      const pendingRes = await client.query(
        "SELECT COUNT(*)::int AS c FROM registration_requests WHERE tenant_id = $1 AND status = 'pending'",
        [request.tenantId]
      );

      return reply.send({
        success: true,
        data: {
          requests: listRes.rows.map(mapRequestRow),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          pendingCount: pendingRes.rows[0]?.c || 0,
        },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, "list registration requests failed");
      return reply.status(500).send({ error: "Internal Server Error", message: error.message });
    } finally {
      client.release();
    }
  });

  // GET /:id - single registration request
  fastify.get("/:id", async (request, reply) => {
    if (!ensureAdmin(request, reply)) return;
    const { id } = request.params as { id: string };

    const client = await fastify.pg.connect();
    try {
      const res = await client.query(
        "SELECT * FROM registration_requests WHERE id = $1 AND tenant_id = $2",
        [id, request.tenantId]
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Demande introuvable" });
      }
      return reply.send({ success: true, data: mapRequestRow(res.rows[0]) });
    } finally {
      client.release();
    }
  });

  // POST /:id/approve - validate the request and create the real account
  fastify.post("/:id/approve", async (request, reply) => {
    if (!ensureAdmin(request, reply)) return;
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "Tenant context required" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { currentYear?: number; notes?: string };
    const reviewerId = (request as any).user?.id || null;
    const client = await fastify.pg.connect();

    try {
      await client.query("BEGIN");

      const reqRes = await client.query(
        "SELECT * FROM registration_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
        [id, request.tenantId]
      );
      if (reqRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ error: "Not Found", message: "Demande introuvable" });
      }

      const reg = reqRes.rows[0];
      if (reg.status !== "pending") {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          error: "Already Processed",
          message: "Cette demande a déjà été traitée",
        });
      }

      const normalizedEmail = String(reg.email).trim().toLowerCase();
      const existingUser = await client.query(
        "SELECT id FROM users WHERE tenant_id = $1 AND LOWER(email) = $2 LIMIT 1",
        [request.tenantId, normalizedEmail]
      );
      if (existingUser.rows.length > 0) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          error: "Account Exists",
          message: "Un compte existe déjà avec cet email",
        });
      }

      const details = reg.details || {};
      const familyChildren: any[] = Array.isArray(details.children) ? details.children : [];
      const isFamily = reg.account_type === "parent" && familyChildren.length > 0;
      const tenantSlug = String(request.tenantSlug || "ecole").toLowerCase();

      const genderCheck = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'student_profiles' AND column_name = 'gender'`
      );
      const hasGender = genderCheck.rows.length > 0;

      const mainPassword = generatePassword();
      const fullName = `${reg.first_name} ${reg.last_name}`;
      let matricule: string | null = null;
      let userId: string;
      const childResults: Array<{
        name: string;
        email: string;
        matricule: string;
        password: string;
      }> = [];

      if (reg.account_type === "student") {
        // Lone student request: the applicant is the student.
        const created = await createStudentWithProfile(
          client,
          request.tenantId,
          tenantSlug,
          hasGender,
          {
            firstName: reg.first_name,
            lastName: reg.last_name,
            email: normalizedEmail,
            password: mainPassword,
            dateOfBirth: reg.date_of_birth,
            gender: reg.gender,
            placeOfBirth: details.placeOfBirth,
            nationality: details.nationality,
            address: reg.address,
            phone: reg.phone,
            fatherName: details.fatherName,
            motherName: details.motherName,
            currentYear: body.currentYear || details.currentYear || 1,
          }
        );
        userId = created.userId;
        matricule = created.matricule;
      } else {
        // Parent account (lone parent or family head).
        const passwordHash = await bcrypt.hash(mainPassword, 10);
        const userRes = await client.query(
          `INSERT INTO users (
             tenant_id, email, name, first_name, last_name, password_hash,
             initial_password, active_role_key, created_at, updated_at, role_updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'parent', NOW(), NOW(), NOW())
           RETURNING id`,
          [
            request.tenantId,
            normalizedEmail,
            fullName,
            reg.first_name,
            reg.last_name,
            passwordHash,
            mainPassword,
          ]
        );
        userId = userRes.rows[0].id;

        const parentRoleId = await ensureRole(client, "parent", "Parent");
        await client.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
          [request.tenantId, userId, parentRoleId]
        );

        if (isFamily) {
          // Create every child as a student and link them to the parent.
          for (const child of familyChildren) {
            const childPassword = generatePassword();
            const created = await createStudentWithProfile(
              client,
              request.tenantId,
              tenantSlug,
              hasGender,
              {
                firstName: String(child.firstName || "").trim(),
                lastName: String(child.lastName || "").trim(),
                email: child.email,
                password: childPassword,
                dateOfBirth: child.dateOfBirth,
                gender: child.gender,
                placeOfBirth: child.placeOfBirth,
                nationality: child.nationality,
                address: reg.address,
                phone: null,
                currentYear: child.currentYear || 1,
              }
            );
            await client.query(
              `INSERT INTO student_parents (tenant_id, student_id, parent_id, is_primary_contact, created_at)
               VALUES ($1, $2, $3, true, NOW())
               ON CONFLICT DO NOTHING`,
              [request.tenantId, created.studentProfileId, userId]
            );
            childResults.push({
              name: created.name,
              email: created.email,
              matricule: created.matricule,
              password: childPassword,
            });
          }
        } else {
          // Legacy lone-parent request: optionally link to an existing student.
          const childMatricule = String(details.childMatricule || "").trim();
          if (childMatricule) {
            const childRes = await client.query(
              `SELECT id FROM student_profiles
               WHERE tenant_id = $1
                 AND (establishment_matricule = $2 OR student_number = $2)
               LIMIT 1`,
              [request.tenantId, childMatricule]
            );
            if (childRes.rows.length > 0) {
              await client.query(
                `INSERT INTO student_parents (tenant_id, student_id, parent_id, is_primary_contact, created_at)
                 VALUES ($1, $2, $3, true, NOW())
                 ON CONFLICT DO NOTHING`,
                [request.tenantId, childRes.rows[0].id, userId]
              );
            }
          }
        }
      }

      await client.query(
        `UPDATE registration_requests
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
             created_user_id = $2, review_notes = $3, updated_at = NOW()
         WHERE id = $4`,
        [reviewerId, userId, body.notes || null, id]
      );

      await client.query("COMMIT");

      // Credentials email is best-effort: the accounts already exist and the
      // admin can read the generated passwords from the response.
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const tenantName = await getTenantName(client, request.tenantId);
        if (isFamily) {
          await emailService.sendFamilyCredentials(normalizedEmail, {
            parentFirstName: reg.first_name,
            parentLoginEmail: normalizedEmail,
            parentPassword: mainPassword,
            children: childResults.map((c) => ({
              name: c.name,
              loginEmail: c.email,
              password: c.password,
              matricule: c.matricule,
            })),
            tenantName,
            loginUrl: LOGIN_URL,
          });
        } else {
          await emailService.sendAccountCredentials(normalizedEmail, {
            firstName: reg.first_name,
            lastName: reg.last_name,
            loginEmail: normalizedEmail,
            password: mainPassword,
            accountType: reg.account_type,
            tenantName,
            loginUrl: LOGIN_URL,
            matricule,
          });
        }
        emailSent = true;
      } catch (err: any) {
        emailError = err?.message || "Échec de l'envoi de l'email";
        fastify.log.warn({ err }, "credentials email failed after approval");
      }

      return reply.send({
        success: true,
        data: {
          userId,
          email: normalizedEmail,
          matricule,
          password: mainPassword,
          emailSent,
          emailError,
          children: childResults,
        },
      });
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      fastify.log.error({ err: error }, "approve registration request failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message: error?.message || "Échec de la validation",
      });
    } finally {
      client.release();
    }
  });

  // POST /:id/reject - reject the request
  fastify.post("/:id/reject", async (request, reply) => {
    if (!ensureAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { rejectionReason?: string };
    const reviewerId = (request as any).user?.id || null;

    const client = await fastify.pg.connect();
    try {
      const res = await client.query(
        `UPDATE registration_requests
         SET status = 'rejected', rejection_reason = $1, reviewed_by = $2,
             reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
         RETURNING *`,
        [body.rejectionReason || null, reviewerId, id, request.tenantId]
      );

      if (res.rows.length === 0) {
        const exists = await client.query(
          "SELECT status FROM registration_requests WHERE id = $1 AND tenant_id = $2",
          [id, request.tenantId]
        );
        if (exists.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Demande introuvable" });
        }
        return reply.status(409).send({
          error: "Already Processed",
          message: "Cette demande a déjà été traitée",
        });
      }

      const reg = res.rows[0];
      emailService
        .sendRegistrationRejected(reg.email, {
          firstName: reg.first_name,
          reason: body.rejectionReason,
          tenantName: await getTenantName(client, request.tenantId!),
        })
        .catch((err) => fastify.log.warn({ err }, "rejection email failed"));

      return reply.send({ success: true, data: mapRequestRow(reg) });
    } catch (error: any) {
      fastify.log.error({ err: error }, "reject registration request failed");
      return reply.status(500).send({ error: "Internal Server Error", message: error.message });
    } finally {
      client.release();
    }
  });

  // GET /accounts - students and parents eligible for credential emails
  fastify.get("/accounts", async (request, reply) => {
    if (!ensureAdmin(request, reply)) return;
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "Tenant context required" });
    }

    const query = request.query as Record<string, string>;
    const search = query.search?.trim().toLowerCase();
    const client = await fastify.pg.connect();

    try {
      const searchClause = search
        ? "AND (LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2)"
        : "";
      const searchParam = search ? [`%${search}%`] : [];

      const students = await client.query(
        `SELECT u.id AS user_id, u.name, u.email,
                sp.establishment_matricule AS matricule,
                COALESCE(u.initial_password, sp.initial_password) IS NOT NULL AS has_password
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.tenant_id = $1 ${searchClause}
         ORDER BY u.name ASC`,
        [request.tenantId, ...searchParam]
      );

      const parents = await client.query(
        `SELECT DISTINCT u.id AS user_id, u.name, u.email,
                u.initial_password IS NOT NULL AS has_password
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1 AND r.key = 'parent' ${searchClause}
         ORDER BY u.name ASC`,
        [request.tenantId, ...searchParam]
      );

      return reply.send({
        success: true,
        data: {
          students: students.rows.map((r) => ({
            userId: r.user_id,
            name: r.name,
            email: r.email,
            matricule: r.matricule,
            hasPassword: r.has_password,
            accountType: "student",
          })),
          parents: parents.rows.map((r) => ({
            userId: r.user_id,
            name: r.name,
            email: r.email,
            hasPassword: r.has_password,
            accountType: "parent",
          })),
        },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, "list accounts failed");
      return reply.status(500).send({ error: "Internal Server Error", message: error.message });
    } finally {
      client.release();
    }
  });

  // POST /send-credentials - email login credentials to one or many accounts
  fastify.post("/send-credentials", async (request, reply) => {
    if (!ensureAdmin(request, reply)) return;
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "Tenant context required" });
    }

    const body = (request.body || {}) as { userIds?: string[] };
    const userIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : [];
    if (userIds.length === 0) {
      return reply.status(400).send({
        error: "Validation Error",
        message: "Aucun compte sélectionné",
      });
    }

    if (!emailService.isConfigured()) {
      return reply.status(503).send({
        error: "Email Not Configured",
        message: "Le service d'envoi d'emails n'est pas configuré sur le serveur",
      });
    }

    const client = await fastify.pg.connect();
    try {
      const tenantName = await getTenantName(client, request.tenantId);

      const usersRes = await client.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.name,
                COALESCE(u.initial_password, sp.initial_password) AS initial_password,
                sp.id AS student_profile_id,
                sp.establishment_matricule AS matricule,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.key), NULL) AS role_keys
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id AND sp.tenant_id = u.tenant_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])
         GROUP BY u.id, sp.id, sp.establishment_matricule, sp.initial_password`,
        [request.tenantId, userIds]
      );

      const results: Array<{
        userId: string;
        email: string | null;
        status: "sent" | "failed" | "no_email";
        passwordReset: boolean;
        error?: string;
      }> = [];

      for (const row of usersRes.rows) {
        if (!row.email) {
          results.push({ userId: row.id, email: null, status: "no_email", passwordReset: false });
          continue;
        }

        const roleKeys: string[] = row.role_keys || [];
        const accountType: "student" | "parent" = roleKeys.includes("parent")
          ? "parent"
          : "student";

        let password: string | null = row.initial_password;
        let passwordReset = false;

        // No plaintext password on record — reset it so the email is usable.
        if (!password) {
          password = generatePassword();
          const newHash = await bcrypt.hash(password, 10);
          await client.query(
            "UPDATE users SET password_hash = $1, initial_password = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4",
            [newHash, password, row.id, request.tenantId]
          );
          if (row.student_profile_id) {
            await client.query(
              "UPDATE student_profiles SET initial_password = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3",
              [password, row.student_profile_id, request.tenantId]
            );
          }
          passwordReset = true;
        }

        try {
          await emailService.sendAccountCredentials(row.email, {
            firstName: row.first_name || row.name || "",
            lastName: row.last_name || "",
            loginEmail: row.email,
            password: password!,
            accountType,
            tenantName,
            loginUrl: LOGIN_URL,
            matricule: row.matricule,
          });
          results.push({ userId: row.id, email: row.email, status: "sent", passwordReset });
        } catch (err: any) {
          results.push({
            userId: row.id,
            email: row.email,
            status: "failed",
            passwordReset,
            error: err?.message || "Échec de l'envoi",
          });
        }
      }

      const sent = results.filter((r) => r.status === "sent").length;
      const failed = results.length - sent;

      return reply.send({
        success: true,
        data: { results, sent, failed, total: results.length },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, "send credentials failed");
      return reply.status(500).send({ error: "Internal Server Error", message: error.message });
    } finally {
      client.release();
    }
  });
}
