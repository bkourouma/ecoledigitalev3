/**
 * Composition et envoi d'emails depuis l'espace administrateur.
 *
 * La page « Messages » de l'administration ne gère plus de conversations : elle
 * se comporte comme un client de messagerie. L'administrateur choisit ses
 * destinataires parmi les parents, enseignants et étudiants de l'établissement
 * — leurs adresses sont lues dans la base, jamais saisies à la main — puis
 * rédige un objet, un corps et joint des fichiers.
 *
 * Chaque envoi laisse une trace consultable dans l'application : le message tel
 * qu'il a été rédigé, et le résultat destinataire par destinataire.
 */

import { FastifyInstance } from "fastify";
import { emailService } from "../services/email.service";
import { emailLogoAttachments } from "../services/brand-assets";
import { resolveTenantName } from "../services/teacher-credentials-email";
import { resolveDisplayName } from "../services/message-delivery";
import { IPAM_GREEN, wrapMessageEmailHtml } from "../services/message-email-templates";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: { id: string; email: string; roles?: string[] };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

const ADMIN_ROLES = ["admin", "super_admin", "Administrateur"];

function isAdmin(roles?: string[]): boolean {
  return (roles || []).some((role) => ADMIN_ROLES.includes(role));
}

/** Taille cumulée maximale des pièces jointes d'un envoi. */
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export type RecipientType = "parent" | "teacher" | "student";

interface Recipient {
  userId: string;
  type: RecipientType;
  name: string;
  email: string;
  detail: string | null;
}

/** Crée les tables de traçabilité si la migration 0103 n'a pas encore été jouée. */
async function ensureEmailTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_email_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
      sender_name VARCHAR(255),
      subject VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_email_recipients (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES admin_email_messages(id) ON DELETE CASCADE,
      recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      recipient_type VARCHAR(16) NOT NULL,
      recipient_name VARCHAR(255),
      recipient_email VARCHAR(320) NOT NULL,
      status VARCHAR(16) NOT NULL,
      error_message TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_admin_email_messages_tenant_created
       ON admin_email_messages(tenant_id, created_at DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_admin_email_recipients_message
       ON admin_email_recipients(message_id)`
  );
}

/**
 * Annuaire des destinataires : parents, enseignants et étudiants du tenant qui
 * disposent d'une adresse email exploitable. Les trois sources sont réunies par
 * UNION pour que la recherche et le tri portent sur l'ensemble.
 */
async function loadRecipients(
  pool: any,
  tenantId: string,
  options: { search?: string; types?: RecipientType[] }
): Promise<Recipient[]> {
  const types = options.types?.length
    ? options.types
    : (["parent", "teacher", "student"] as RecipientType[]);
  const search = options.search?.trim();

  const params: any[] = [tenantId, types];
  let searchClause = "";
  if (search) {
    params.push(`%${search}%`);
    searchClause = ` AND (r.name ILIKE $3 OR r.email ILIKE $3 OR COALESCE(r.detail, '') ILIKE $3)`;
  }

  const result = await pool.query(
    `WITH recipients AS (
       SELECT u.id AS user_id,
              'parent'::text AS type,
              COALESCE(u.first_name || ' ' || u.last_name, u.name) AS name,
              NULLIF(TRIM(u.email), '') AS email,
              NULLIF(STRING_AGG(DISTINCT COALESCE(cu.first_name || ' ' || cu.last_name, cu.name), ', '), '') AS detail
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         JOIN roles ro ON ro.id = ur.role_id AND ro.key = 'parent'
         LEFT JOIN student_parents sp_rel ON sp_rel.parent_id = u.id AND sp_rel.tenant_id = u.tenant_id
         LEFT JOIN student_profiles sp ON sp.id = sp_rel.student_id
         LEFT JOIN users cu ON cu.id = sp.user_id
        WHERE u.tenant_id = $1
        GROUP BY u.id, u.first_name, u.last_name, u.name, u.email

       UNION ALL

       SELECT u.id,
              'teacher'::text,
              COALESCE(u.first_name || ' ' || u.last_name, u.name),
              NULLIF(TRIM(COALESCE(NULLIF(TRIM(t.email), ''), u.email)), ''),
              NULLIF(TRIM(t.employee_number), '')
         FROM teachers t
         JOIN users u ON u.id = t.user_id
        WHERE t.tenant_id = $1 AND t.user_id IS NOT NULL

       UNION ALL

       SELECT u.id,
              'student'::text,
              COALESCE(u.first_name || ' ' || u.last_name, u.name),
              NULLIF(TRIM(u.email), ''),
              MAX(cl.name)
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN student_enrollments se ON se.student_id = sp.id AND se.tenant_id = sp.tenant_id
         LEFT JOIN classes cl ON cl.id = se.class_id
        WHERE sp.tenant_id = $1
        GROUP BY u.id, u.first_name, u.last_name, u.name, u.email
     )
     SELECT r.user_id, r.type, r.name, r.email, r.detail
       FROM recipients r
      WHERE r.email IS NOT NULL
        AND r.email LIKE '%@%'
        AND r.type = ANY($2::text[])
        ${searchClause}
      ORDER BY r.type, r.name`,
    params
  );

  return result.rows.map((row: any) => ({
    userId: row.user_id,
    type: row.type as RecipientType,
    name: row.name || row.email,
    email: row.email,
    detail: row.detail || null,
  }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Le corps est saisi en texte simple dans le composeur : il est échappé, ses
 * lignes vides deviennent des paragraphes, et les `{{recipientName}}` /
 * `{{schoolName}}` éventuels sont remplacés destinataire par destinataire.
 */
function renderComposedBody(
  body: string,
  variables: { recipientName: string; schoolName: string }
): string {
  const substituted = body.replace(
    /\{\{\s*(recipientName|schoolName)\s*\}\}/g,
    (_match, key: string) => (key === "recipientName" ? variables.recipientName : variables.schoolName)
  );
  return substituted
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`)
    .join("\n");
}

export async function adminEmailRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/admin/email/recipients — annuaire des destinataires joignables
  fastify.get("/recipients", {
    schema: {
      tags: ["Admin Email"],
      summary: "Parents, enseignants et étudiants joignables par email",
      querystring: {
        type: "object",
        properties: {
          search: { type: "string" },
          type: { type: "string", enum: ["parent", "teacher", "student"] },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: "Tenant Required", message: "Contexte tenant requis" });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: "Forbidden", message: "Rôle administrateur requis" });
      }

      const { search, type } = request.query as { search?: string; type?: RecipientType };
      try {
        await pool.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);
        const recipients = await loadRecipients(pool, tenantId, {
          search,
          types: type ? [type] : undefined,
        });

        const counts = recipients.reduce<Record<string, number>>((acc, recipient) => {
          acc[recipient.type] = (acc[recipient.type] || 0) + 1;
          return acc;
        }, {});

        return reply.send({ success: true, data: { recipients, counts, total: recipients.length } });
      } catch (error: any) {
        fastify.log.error({ msg: "admin-email recipients", error: error.message });
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" ? "Something went wrong" : error.message,
        });
      }
    },
  });

  // POST /api/v1/admin/email/send — composition (multipart : champs + fichiers)
  fastify.post("/send", {
    schema: {
      tags: ["Admin Email"],
      summary: "Envoie un email composé, avec pièces jointes",
      // Corps multipart : lu en flux via parts(), donc pas de schéma de body.
      querystring: { type: "object", properties: {} },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.["x-user-id"]) as string;
      if (!tenantId || !userId) {
        return reply
          .status(400)
          .send({ success: false, error: "Bad Request", message: "Tenant et utilisateur requis" });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: "Forbidden", message: "Rôle administrateur requis" });
      }
      if (!emailService.isConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Email Not Configured",
          message: "Service email non configuré (SMTP_HOST / SMTP_USER / SMTP_PASSWORD manquants).",
        });
      }

      let subject = "";
      let body = "";
      let recipientUserIds: string[] = [];
      const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
      let totalBytes = 0;

      try {
        for await (const part of (request as any).parts()) {
          if (part.type === "file") {
            const content = await part.toBuffer();
            totalBytes += content.length;
            if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
              return reply.status(413).send({
                success: false,
                error: "Payload Too Large",
                message: `Les pièces jointes dépassent ${Math.round(
                  MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024
                )} Mo au total.`,
              });
            }
            attachments.push({
              filename: part.filename || "piece-jointe",
              content,
              contentType: part.mimetype || "application/octet-stream",
            });
          } else if (part.type === "field") {
            if (part.fieldname === "subject") subject = String(part.value || "");
            if (part.fieldname === "body") body = String(part.value || "");
            if (part.fieldname === "recipientIds") {
              // Le composeur envoie un JSON ; on tolère aussi un champ répété.
              const raw = String(part.value || "");
              try {
                const parsed = JSON.parse(raw);
                recipientUserIds = Array.isArray(parsed) ? parsed.map(String) : [];
              } catch {
                recipientUserIds.push(raw);
              }
            }
          }
        }
      } catch (error: any) {
        fastify.log.error({ msg: "admin-email send parse", error: error.message });
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Formulaire illisible (pièce jointe trop volumineuse ?)",
        });
      }

      subject = subject.trim();
      body = body.trim();
      recipientUserIds = Array.from(new Set(recipientUserIds.filter(Boolean)));

      if (!subject) {
        return reply.status(400).send({ success: false, error: "Bad Request", message: "L'objet est requis" });
      }
      if (!body) {
        return reply
          .status(400)
          .send({ success: false, error: "Bad Request", message: "Le corps du message est requis" });
      }
      if (recipientUserIds.length === 0) {
        return reply
          .status(400)
          .send({ success: false, error: "Bad Request", message: "Aucun destinataire sélectionné" });
      }

      try {
        await pool.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);
        await ensureEmailTables(pool);

        // On repart de l'annuaire plutôt que de faire confiance aux adresses
        // transmises : un client ne peut pas faire écrire à une adresse tierce.
        const directory = await loadRecipients(pool, tenantId, {});
        const selected = directory.filter((recipient) => recipientUserIds.includes(recipient.userId));

        if (selected.length === 0) {
          return reply.status(400).send({
            success: false,
            error: "Bad Request",
            message: "Aucun destinataire joignable parmi la sélection",
          });
        }

        const [schoolName, senderName] = await Promise.all([
          resolveTenantName(pool, tenantId),
          resolveDisplayName(pool, userId, "Administration"),
        ]);

        const messageInsert = await pool.query(
          `INSERT INTO admin_email_messages
             (tenant_id, sender_id, sender_name, subject, body, attachments, recipient_count)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
           RETURNING id, created_at`,
          [
            tenantId,
            userId,
            senderName,
            subject,
            body,
            JSON.stringify(
              attachments.map((file) => ({
                filename: file.filename,
                contentType: file.contentType,
                size: file.content.length,
              }))
            ),
            selected.length,
          ]
        );
        const messageId = messageInsert.rows[0].id;

        const logoAttachments = emailLogoAttachments();
        const logoCid = logoAttachments[0]?.cid;
        let sent = 0;
        let failed = 0;

        for (const recipient of selected) {
          let status = "sent";
          let errorMessage: string | null = null;
          try {
            const html = wrapMessageEmailHtml({
              bodyHtml: renderComposedBody(body, { recipientName: recipient.name, schoolName }),
              accent: IPAM_GREEN,
              // Sans logo résolu, on évite un `cid:` mort qui afficherait une
              // image cassée : l'en-tête textuel suffit.
              logoSrc: logoCid ? `cid:${logoCid}` : "",
              showPriorityBadge: false,
            });

            await emailService.sendEmail({
              to: recipient.email,
              subject,
              html,
              text: body,
              attachments: [...logoAttachments, ...attachments],
            });
            sent++;
          } catch (error: any) {
            status = "failed";
            errorMessage = error?.message || "send_failed";
            failed++;
            fastify.log.warn({
              msg: "admin-email recipient failed",
              to: recipient.email,
              err: errorMessage,
            });
          }

          await pool.query(
            `INSERT INTO admin_email_recipients
               (tenant_id, message_id, recipient_user_id, recipient_type, recipient_name,
                recipient_email, status, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              tenantId,
              messageId,
              recipient.userId,
              recipient.type,
              recipient.name,
              recipient.email,
              status,
              errorMessage,
            ]
          );
        }

        await pool.query(`UPDATE admin_email_messages SET sent_count = $2, failed_count = $3 WHERE id = $1`, [
          messageId,
          sent,
          failed,
        ]);

        return reply.status(201).send({
          success: true,
          data: {
            id: messageId,
            recipientCount: selected.length,
            sent,
            failed,
            attachmentCount: attachments.length,
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: "admin-email send", error: error.message });
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" ? "Something went wrong" : error.message,
        });
      }
    },
  });

  // GET /api/v1/admin/email/history — traçabilité des envois
  fastify.get("/history", {
    schema: {
      tags: ["Admin Email"],
      summary: "Historique des emails envoyés depuis l'administration",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: "Tenant Required", message: "Contexte tenant requis" });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: "Forbidden", message: "Rôle administrateur requis" });
      }

      try {
        await pool.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);
        await ensureEmailTables(pool);

        const countResult = await pool.query(
          `SELECT COUNT(*)::int AS total FROM admin_email_messages WHERE tenant_id = $1`,
          [tenantId]
        );
        const total = countResult.rows[0]?.total ?? 0;
        const offset = (page - 1) * limit;

        const result = await pool.query(
          `SELECT id, sender_name, subject, body, attachments,
                  recipient_count, sent_count, failed_count, created_at
             FROM admin_email_messages
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3`,
          [tenantId, limit, offset]
        );

        return reply.send({
          success: true,
          data: {
            messages: result.rows.map((row: any) => ({
              id: row.id,
              senderName: row.sender_name,
              subject: row.subject,
              body: row.body,
              attachments: row.attachments || [],
              recipientCount: row.recipient_count,
              sentCount: row.sent_count,
              failedCount: row.failed_count,
              createdAt: row.created_at,
            })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: "admin-email history", error: error.message });
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" ? "Something went wrong" : error.message,
        });
      }
    },
  });

  // GET /api/v1/admin/email/history/:id — détail destinataire par destinataire
  fastify.get("/history/:id", {
    schema: {
      tags: ["Admin Email"],
      summary: "Détail d'un envoi et statut de chaque destinataire",
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const { id } = request.params as { id: string };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: "Tenant Required", message: "Contexte tenant requis" });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: "Forbidden", message: "Rôle administrateur requis" });
      }

      try {
        await pool.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);
        await ensureEmailTables(pool);

        const message = await pool.query(
          `SELECT id, sender_name, subject, body, attachments,
                  recipient_count, sent_count, failed_count, created_at
             FROM admin_email_messages
            WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (message.rows.length === 0) {
          return reply.status(404).send({ success: false, error: "Not Found", message: "Envoi introuvable" });
        }

        const recipients = await pool.query(
          `SELECT recipient_type, recipient_name, recipient_email, status, error_message, sent_at
             FROM admin_email_recipients
            WHERE message_id = $1 AND tenant_id = $2
            ORDER BY status DESC, recipient_name`,
          [id, tenantId]
        );

        const row = message.rows[0];
        return reply.send({
          success: true,
          data: {
            message: {
              id: row.id,
              senderName: row.sender_name,
              subject: row.subject,
              body: row.body,
              attachments: row.attachments || [],
              recipientCount: row.recipient_count,
              sentCount: row.sent_count,
              failedCount: row.failed_count,
              createdAt: row.created_at,
            },
            recipients: recipients.rows.map((recipient: any) => ({
              type: recipient.recipient_type,
              name: recipient.recipient_name,
              email: recipient.recipient_email,
              status: recipient.status,
              errorMessage: recipient.error_message,
              sentAt: recipient.sent_at,
            })),
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: "admin-email history detail", error: error.message });
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" ? "Something went wrong" : error.message,
        });
      }
    },
  });

  // GET /api/v1/admin/email/inbox — messages reçus par l'établissement
  //
  // Deux sources alimentent cette boîte : les messages « à l'établissement »
  // envoyés par les enseignants et les étudiants (`establishment_inbound_messages`)
  // et les conversations ouvertes par les parents (`parent_school_conversations`).
  // Elles sont réunies par UNION pour un tri chronologique commun.
  fastify.get("/inbox", {
    schema: {
      tags: ["Admin Email"],
      summary: "Messages reçus par l'établissement (parents, enseignants, étudiants)",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 50, default: 20 },
          from: { type: "string", enum: ["parent", "teacher", "student"] },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const { page = 1, limit = 20, from } = request.query as {
        page?: number;
        limit?: number;
        from?: RecipientType;
      };
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: "Tenant Required", message: "Contexte tenant requis" });
      }
      if (!isAdmin(request.user?.roles)) {
        return reply.status(403).send({ success: false, error: "Forbidden", message: "Rôle administrateur requis" });
      }

      try {
        await pool.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);

        // Les deux tables sont créées à la volée par d'autres routes : une
        // installation neuve peut n'en avoir aucune, la boîte est alors vide.
        const presence = await pool.query(
          `SELECT to_regclass('public.establishment_inbound_messages') IS NOT NULL AS has_inbound,
                  to_regclass('public.parent_school_conversation_messages') IS NOT NULL AS has_parent`
        );
        const { has_inbound: hasInbound, has_parent: hasParent } = presence.rows[0];

        const sources: string[] = [];
        if (hasInbound) {
          sources.push(`
            SELECT eim.id,
                   'establishment'::text AS source,
                   eim.from_user_id AS sender_id,
                   COALESCE(u.first_name || ' ' || u.last_name, u.name) AS sender_name,
                   eim.from_role AS sender_role,
                   NULLIF(TRIM(u.email), '') AS sender_email,
                   eim.subject,
                   eim.content,
                   COALESCE(cu.first_name || ' ' || cu.last_name, cu.name) AS child_name,
                   eim.sent_at
              FROM establishment_inbound_messages eim
              LEFT JOIN users u ON u.id = eim.from_user_id
              LEFT JOIN student_profiles sp ON sp.id = eim.context_student_profile_id
              LEFT JOIN users cu ON cu.id = sp.user_id
             WHERE eim.tenant_id = $1`);
        }
        if (hasParent) {
          // `m.sender_id = c.parent_id` écarte les réponses de l'administration :
          // seuls les messages écrits par le parent entrent dans la boîte.
          sources.push(`
            SELECT m.id,
                   'parent_conversation'::text,
                   m.sender_id,
                   COALESCE(u.first_name || ' ' || u.last_name, u.name),
                   'parent'::text,
                   NULLIF(TRIM(u.email), ''),
                   c.subject,
                   m.content,
                   COALESCE(cu.first_name || ' ' || cu.last_name, cu.name),
                   m.sent_at
              FROM parent_school_conversation_messages m
              JOIN parent_school_conversations c ON c.id = m.conversation_id
              JOIN users u ON u.id = m.sender_id
              LEFT JOIN student_profiles sp ON sp.id = c.student_id
              LEFT JOIN users cu ON cu.id = sp.user_id
             WHERE m.tenant_id = $1 AND m.sender_id = c.parent_id`);
        }

        if (sources.length === 0) {
          return reply.send({
            success: true,
            data: { messages: [], counts: {}, pagination: { page, limit, total: 0, totalPages: 1 } },
          });
        }

        const union = sources.join("\n UNION ALL \n");
        const params: any[] = [tenantId];
        let filter = "";
        if (from) {
          params.push(from);
          filter = ` WHERE inbox.sender_role = $${params.length}`;
        }

        const countResult = await pool.query(
          `SELECT COUNT(*)::int AS total FROM (${union}) inbox${filter}`,
          params
        );
        const total = countResult.rows[0]?.total ?? 0;

        const countsResult = await pool.query(
          `SELECT inbox.sender_role, COUNT(*)::int AS total FROM (${union}) inbox GROUP BY inbox.sender_role`,
          [tenantId]
        );

        const listParams = [...params, limit, (page - 1) * limit];
        const result = await pool.query(
          `SELECT * FROM (${union}) inbox${filter}
            ORDER BY inbox.sent_at DESC
            LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
          listParams
        );

        return reply.send({
          success: true,
          data: {
            messages: result.rows.map((row: any) => ({
              id: row.id,
              source: row.source,
              senderId: row.sender_id,
              senderName: row.sender_name,
              senderRole: row.sender_role,
              senderEmail: row.sender_email,
              subject: row.subject,
              content: row.content,
              childName: row.child_name,
              sentAt: row.sent_at,
            })),
            counts: countsResult.rows.reduce((acc: Record<string, number>, row: any) => {
              acc[row.sender_role] = row.total;
              return acc;
            }, {}),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
          },
        });
      } catch (error: any) {
        fastify.log.error({ msg: "admin-email inbox", error: error.message });
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" ? "Something went wrong" : error.message,
        });
      }
    },
  });
}
