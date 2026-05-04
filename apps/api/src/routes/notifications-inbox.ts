import { FastifyInstance } from "fastify";
import { z } from "zod";

/**
 * In-app notifications inbox routes — mounted at /api/v1/notifications-inbox.
 *
 *   GET  /                  list current user's notifications (paginated, filterable by unread)
 *   GET  /unread-count      cheap counter for the bell badge
 *   POST /:id/read          mark one notification as read
 *   POST /read-all          mark every unread notification as read for the current user
 *
 * Distinct from the existing /api/v1/notifications route (which is payment-reminder specific).
 *
 * All queries are scoped to (tenant_id, user_id) — every authenticated user can only see
 * their own inbox; RLS already isolates by tenant.
 */

const ListQuerySchema = z.object({
  unreadOnly: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().datetime().optional(), // ISO timestamp; returns rows older than cursor
});

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: any;
  action_url: string | null;
  channels_sent: any;
  read_at: string | null;
  created_at: string;
}

function rowToDto(r: NotificationRow) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    payload: r.payload ?? {},
    actionUrl: r.action_url,
    channelsSent: Array.isArray(r.channels_sent) ? r.channels_sent : [],
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

export async function notificationsInboxRoutes(fastify: FastifyInstance) {
  const pg = fastify.pg as any;

  // ===========================================================
  // GET /api/v1/notifications-inbox
  // ===========================================================
  fastify.get("/", async (request: any, reply) => {
    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const parsed = ListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.errors });
    }
    const { unreadOnly, type, limit, cursor } = parsed.data;

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);

      const conditions = ["tenant_id = $1", "subject_kind = 'tenant_user'", "subject_user_id = $2"];
      const params: any[] = [request.tenantId, request.userId];
      let i = 3;
      if (unreadOnly) {
        conditions.push("read_at IS NULL");
      }
      if (type) {
        conditions.push(`type = $${i}`);
        params.push(type);
        i++;
      }
      if (cursor) {
        conditions.push(`created_at < $${i}`);
        params.push(cursor);
        i++;
      }

      params.push(limit);
      const rows = await client.query<NotificationRow>(
        `SELECT id, type, title, body, payload, action_url, channels_sent, read_at, created_at
           FROM app_notifications
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT $${i}`,
        params
      );

      const nextCursor =
        rows.rows.length === limit ? rows.rows[rows.rows.length - 1].created_at : null;

      return reply.send({
        data: rows.rows.map(rowToDto),
        nextCursor,
      });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // GET /api/v1/notifications-inbox/unread-count
  // ===========================================================
  fastify.get("/unread-count", async (request: any, reply) => {
    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM app_notifications
          WHERE tenant_id = $1 AND subject_kind = 'tenant_user' AND subject_user_id = $2
            AND read_at IS NULL`,
        [request.tenantId, request.userId]
      );
      return reply.send({ data: { count: parseInt(r.rows[0].count, 10) } });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // POST /api/v1/notifications-inbox/:id/read
  // ===========================================================
  fastify.post("/:id/read", async (request: any, reply) => {
    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Bad Request" });

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const r = await client.query<NotificationRow>(
        `UPDATE app_notifications
            SET read_at = NOW()
          WHERE id = $1 AND tenant_id = $2
            AND subject_kind = 'tenant_user' AND subject_user_id = $3
            AND read_at IS NULL
          RETURNING id, type, title, body, payload, action_url, channels_sent, read_at, created_at`,
        [parsed.data.id, request.tenantId, request.userId]
      );
      if (r.rows.length === 0) {
        // Either not found, not yours, or already read — return current row state if it exists.
        const existing = await client.query<NotificationRow>(
          `SELECT id, type, title, body, payload, action_url, channels_sent, read_at, created_at
             FROM app_notifications
            WHERE id = $1 AND tenant_id = $2
              AND subject_kind = 'tenant_user' AND subject_user_id = $3`,
          [parsed.data.id, request.tenantId, request.userId]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found" });
        }
        return reply.send({ data: rowToDto(existing.rows[0]) });
      }
      return reply.send({ data: rowToDto(r.rows[0]) });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // POST /api/v1/notifications-inbox/read-all
  // ===========================================================
  fastify.post("/read-all", async (request: any, reply) => {
    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const r = await client.query(
        `UPDATE app_notifications
            SET read_at = NOW()
          WHERE tenant_id = $1 AND subject_kind = 'tenant_user' AND subject_user_id = $2
            AND read_at IS NULL`,
        [request.tenantId, request.userId]
      );
      return reply.send({ data: { markedRead: r.rowCount ?? 0 } });
    } finally {
      client.release();
    }
  });
}
