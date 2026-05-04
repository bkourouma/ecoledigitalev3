import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getLiveKitService, LiveKitService } from "../services/livekit.service";

/**
 * Live session routes (PR 1) — all mounted under /api/v1/live-sessions
 *
 *   POST   /                                         create or fetch (idempotent)
 *   GET    /:id                                      fetch a live session by id
 *   POST   /:id/join-token                           mint a join JWT for the logged-in user
 *   POST   /:id/end                                  end the session (moderator only)
 *   POST   /:id/participants/:identity/mute          mute a participant's mic (moderator only)
 *   DELETE /:id/participants/:identity               kick a participant (moderator only)
 *   GET    /:id/recordings                           list recordings for the session
 *
 * Author/moderator detection is intentionally minimal in PR 1 — the creator + tenant admin
 * count as moderator; richer rules (e.g. assigned formateur for SessionProfessionnelle) can
 * be layered in PR 3/5 once the front-end exposes them.
 */

const ParentTypeSchema = z.enum(["instance", "professionnelle"]);

type ParentType = z.infer<typeof ParentTypeSchema>;

const CreateBodySchema = z.object({
  parentType: ParentTypeSchema,
  parentId: z.string().uuid(),
  recordingEnabled: z.boolean().optional(),
});

const ParamsLiveSessionId = z.object({ id: z.string().uuid() });

interface LiveSessionRow {
  id: string;
  tenant_id: string;
  session_instance_id: string | null;
  session_professionnelle_id: string | null;
  room_name: string;
  status: "created" | "live" | "ended";
  recording_enabled: boolean;
  created_by_user_id: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDto(row: LiveSessionRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionInstanceId: row.session_instance_id,
    sessionProfessionnelleId: row.session_professionnelle_id,
    roomName: row.room_name,
    status: row.status,
    recordingEnabled: row.recording_enabled,
    createdByUserId: row.created_by_user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parentColumn(type: ParentType): "session_instance_id" | "session_professionnelle_id" {
  return type === "instance" ? "session_instance_id" : "session_professionnelle_id";
}

function parentTable(type: ParentType): "session_instances" | "sessions_professionnelles" {
  return type === "instance" ? "session_instances" : "sessions_professionnelles";
}

async function loadLiveSession(client: any, tenantId: string, id: string): Promise<LiveSessionRow | null> {
  const res = await client.query<LiveSessionRow>(
    `SELECT * FROM live_sessions WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return res.rows[0] ?? null;
}

function isModerator(row: LiveSessionRow, requestUserId: string | undefined, isAdmin: boolean): boolean {
  if (!requestUserId) return false;
  if (isAdmin) return true;
  return row.created_by_user_id === requestUserId;
}

export async function liveSessionsRoutes(fastify: FastifyInstance) {
  const pg = fastify.pg as any;

  // Eagerly construct the service once at registration so a misconfiguration
  // surfaces at boot, not on the first call.
  let service: LiveKitService | null = null;
  try {
    service = getLiveKitService();
  } catch (err) {
    fastify.log.warn(
      { err },
      "LiveKit env not set — live-session routes will respond with 503 until LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET are configured"
    );
  }

  function ensureService(reply: any): LiveKitService | null {
    if (!service) {
      reply.status(503).send({
        error: "Service Unavailable",
        message: "LiveKit is not configured on this server",
        code: "LIVEKIT_NOT_CONFIGURED",
      });
      return null;
    }
    return service;
  }

  // ===========================================================
  // POST /api/v1/live-sessions
  // Body: { parentType: 'instance' | 'professionnelle', parentId, recordingEnabled? }
  // Idempotent: returns the existing live session if one already exists for this parent.
  // ===========================================================
  fastify.post("/", async (request: any, reply) => {
    const lk = ensureService(reply);
    if (!lk) return;

    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "Tenant context required" });
    }
    if (!request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }

    const parsedBody = CreateBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsedBody.error.errors });
    }

    const { parentType: type, parentId } = parsedBody.data;
    const recordingEnabled = parsedBody.data.recordingEnabled ?? true;

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);

      const parentExists = await client.query(
        `SELECT 1 FROM ${parentTable(type)} WHERE id = $1 AND tenant_id = $2`,
        [parentId, request.tenantId]
      );
      if (parentExists.rows.length === 0) {
        return reply.status(404).send({ error: "Not Found", message: `Parent ${type} session not found` });
      }

      const existing = await client.query<LiveSessionRow>(
        `SELECT * FROM live_sessions WHERE ${parentColumn(type)} = $1 AND tenant_id = $2`,
        [parentId, request.tenantId]
      );
      if (existing.rows.length > 0) {
        return reply.send({ data: rowToDto(existing.rows[0]), created: false });
      }

      // Pre-allocate the id so we can derive a deterministic LiveKit room name from it.
      const newIdRes = await client.query<{ id: string }>("SELECT uuid_generate_v4() AS id");
      const newId = newIdRes.rows[0].id;
      const roomName = LiveKitService.buildRoomName(request.tenantId, newId);

      const insertRes = await client.query<LiveSessionRow>(
        `INSERT INTO live_sessions (
            id, tenant_id, ${parentColumn(type)}, room_name, status,
            recording_enabled, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, 'created', $5, $6)
         RETURNING *`,
        [newId, request.tenantId, parentId, roomName, recordingEnabled, request.userId]
      );

      // Provision the room on LiveKit so participants can join immediately. If LiveKit
      // is unreachable we surface the error and rollback the row so retries are clean.
      try {
        await lk.createRoom(roomName);
      } catch (err) {
        await client.query(`DELETE FROM live_sessions WHERE id = $1`, [newId]);
        fastify.log.error({ err }, "Failed to create LiveKit room");
        return reply.status(502).send({
          error: "Bad Gateway",
          message: "Failed to provision LiveKit room",
          code: "LIVEKIT_UPSTREAM_ERROR",
        });
      }

      return reply.status(201).send({ data: rowToDto(insertRes.rows[0]), created: true });
    } catch (err: any) {
      fastify.log.error({ err }, "Error creating live session");
      return reply.status(500).send({ error: "Internal Server Error", message: err?.message });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // GET /api/v1/live-sessions/:id
  // ===========================================================
  fastify.get("/:id", async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required" });
    }
    const parsed = ParamsLiveSessionId.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request" });
    }
    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const row = await loadLiveSession(client, request.tenantId, parsed.data.id);
      if (!row) {
        return reply.status(404).send({ error: "Not Found" });
      }
      return reply.send({ data: rowToDto(row) });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // POST /api/v1/live-sessions/:id/join-token
  // Returns { url, token, role }. Any logged-in tenant user can join (per chosen scope).
  // ===========================================================
  fastify.post("/:id/join-token", async (request: any, reply) => {
    const lk = ensureService(reply);
    if (!lk) return;

    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required" });
    }
    if (!request.userId || !request.user) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const parsed = ParamsLiveSessionId.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request" });
    }

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const row = await loadLiveSession(client, request.tenantId, parsed.data.id);
      if (!row) {
        return reply.status(404).send({ error: "Not Found" });
      }
      if (row.status === "ended") {
        return reply.status(409).send({
          error: "Session Ended",
          message: "This live session has ended and cannot be rejoined",
          code: "LIVE_SESSION_ENDED",
        });
      }

      const moderator = isModerator(row, request.userId, Boolean(request.isAdmin));
      const displayName =
        [request.user.email, request.user.activeRole].filter(Boolean).join(" · ") ||
        request.user.email ||
        request.userId;

      const token = await lk.mintToken({
        roomName: row.room_name,
        identity: request.userId,
        displayName,
        role: moderator ? "moderator" : "participant",
        metadata: {
          tenantId: request.tenantId,
          liveSessionId: row.id,
          activeRole: request.user.activeRole,
        },
      });

      return reply.send({
        data: {
          url: lk.publicUrl(),
          token,
          role: moderator ? "moderator" : "participant",
          roomName: row.room_name,
          identity: request.userId,
        },
      });
    } catch (err: any) {
      fastify.log.error({ err }, "Error minting LiveKit join token");
      return reply.status(500).send({ error: "Internal Server Error", message: err?.message });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // POST /api/v1/live-sessions/:id/end
  // ===========================================================
  fastify.post("/:id/end", async (request: any, reply) => {
    const lk = ensureService(reply);
    if (!lk) return;

    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const parsed = ParamsLiveSessionId.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request" });
    }

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const row = await loadLiveSession(client, request.tenantId, parsed.data.id);
      if (!row) {
        return reply.status(404).send({ error: "Not Found" });
      }
      if (!isModerator(row, request.userId, Boolean(request.isAdmin))) {
        return reply.status(403).send({ error: "Forbidden", message: "Only the session moderator can end" });
      }

      try {
        await lk.deleteRoom(row.room_name);
      } catch (err) {
        // Swallow — room may already be gone if the last participant left. Webhook will reconcile.
        fastify.log.warn({ err, roomName: row.room_name }, "deleteRoom failed (likely already gone)");
      }

      const updated = await client.query<LiveSessionRow>(
        `UPDATE live_sessions
            SET status = 'ended',
                ended_at = COALESCE(ended_at, NOW()),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [row.id, request.tenantId]
      );
      return reply.send({ data: rowToDto(updated.rows[0]) });
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // POST /api/v1/live-sessions/:id/participants/:identity/mute
  // ===========================================================
  fastify.post("/:id/participants/:identity/mute", async (request: any, reply) => {
    const lk = ensureService(reply);
    if (!lk) return;

    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const parsed = z
      .object({ id: z.string().uuid(), identity: z.string().min(1) })
      .safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request" });
    }

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const row = await loadLiveSession(client, request.tenantId, parsed.data.id);
      if (!row) return reply.status(404).send({ error: "Not Found" });
      if (!isModerator(row, request.userId, Boolean(request.isAdmin))) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      try {
        await lk.muteParticipant(row.room_name, parsed.data.identity);
      } catch (err: any) {
        fastify.log.error({ err }, "Failed to mute participant");
        return reply.status(502).send({ error: "Bad Gateway", message: err?.message });
      }
      return reply.status(204).send();
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // DELETE /api/v1/live-sessions/:id/participants/:identity
  // ===========================================================
  fastify.delete("/:id/participants/:identity", async (request: any, reply) => {
    const lk = ensureService(reply);
    if (!lk) return;

    if (!request.tenantId || !request.userId) {
      return reply.status(401).send({ error: "Authentication Required" });
    }
    const parsed = z
      .object({ id: z.string().uuid(), identity: z.string().min(1) })
      .safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request" });
    }

    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const row = await loadLiveSession(client, request.tenantId, parsed.data.id);
      if (!row) return reply.status(404).send({ error: "Not Found" });
      if (!isModerator(row, request.userId, Boolean(request.isAdmin))) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      try {
        await lk.removeParticipant(row.room_name, parsed.data.identity);
      } catch (err: any) {
        fastify.log.error({ err }, "Failed to remove participant");
        return reply.status(502).send({ error: "Bad Gateway", message: err?.message });
      }
      return reply.status(204).send();
    } finally {
      client.release();
    }
  });

  // ===========================================================
  // GET /api/v1/live-sessions/:id/recordings
  // ===========================================================
  fastify.get("/:id/recordings", async (request: any, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required" });
    }
    const parsed = ParamsLiveSessionId.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request" });
    }
    const client = await pg.connect();
    try {
      await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", request.tenantId]);
      const exists = await loadLiveSession(client, request.tenantId, parsed.data.id);
      if (!exists) return reply.status(404).send({ error: "Not Found" });

      const recRes = await client.query(
        `SELECT id, egress_id, s3_key, status, duration_sec, file_size_bytes,
                started_at, completed_at, error_message
           FROM live_session_recordings
          WHERE live_session_id = $1 AND tenant_id = $2
          ORDER BY started_at ASC`,
        [parsed.data.id, request.tenantId]
      );

      return reply.send({
        data: recRes.rows.map((r: any) => ({
          id: r.id,
          egressId: r.egress_id,
          s3Key: r.s3_key,
          status: r.status,
          durationSec: r.duration_sec,
          fileSizeBytes: r.file_size_bytes ? Number(r.file_size_bytes) : null,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          errorMessage: r.error_message,
        })),
      });
    } finally {
      client.release();
    }
  });
}
