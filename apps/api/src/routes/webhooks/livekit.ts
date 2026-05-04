import { FastifyInstance } from "fastify";
import { getLiveKitService, LiveKitService } from "../../services/livekit.service";

/**
 * LiveKit webhook receiver.
 *
 * Mounted at POST /api/v1/webhooks/livekit. The LiveKit cloud project is configured to
 * send the following events here:
 *   room_started, room_finished, participant_joined, participant_left,
 *   egress_started, egress_updated, egress_ended.
 *
 * Auth: LiveKit signs each delivery with the project's API secret (Authorization header).
 * `LiveKitService.verifyWebhook` checks the signature; the route is added to the auth-middleware
 * skip list since LiveKit does not have a tenant JWT.
 *
 * Idempotency: each event has a unique id which we record in live_session_webhook_events.
 * If we have already processed an id we ack 200 and skip the body.
 *
 * Tenant scoping: the webhook is unauthenticated, so we resolve the tenant from the
 * live_sessions row identified by the room_name (which is built from tenant_id at create time).
 *
 * Attendance rule: on room_finished we compute total_seconds per attendance row and
 * flip counted_present = true when total_seconds >= 50% of the parent session's duration.
 * Bridging counted_present rows back to the school student_attendance table is PR 3.
 */

interface LiveSessionRow {
  id: string;
  tenant_id: string;
  session_instance_id: string | null;
  session_professionnelle_id: string | null;
  room_name: string;
  status: "created" | "live" | "ended";
}

async function findLiveSessionByRoom(client: any, roomName: string): Promise<LiveSessionRow | null> {
  const res = await client.query<LiveSessionRow>(
    `SELECT id, tenant_id, session_instance_id, session_professionnelle_id, room_name, status
       FROM live_sessions WHERE room_name = $1`,
    [roomName]
  );
  return res.rows[0] ?? null;
}

async function setTenantContext(client: any, tenantId: string): Promise<void> {
  await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);
}

async function recordEventOrSkip(client: any, eventId: string | undefined, eventType: string): Promise<boolean> {
  if (!eventId) return true; // No id → can't dedupe; process and accept the (rare) double-write risk.
  const res = await client.query(
    `INSERT INTO live_session_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
    [eventId, eventType]
  );
  return res.rows.length > 0;
}

/**
 * The LiveKit identity carries the user kind as a prefix so we can route the row to the right
 * subject_kind without re-querying. Identities are minted in the form:
 *   tu_<uuid>      (tenant_user — apps/web)
 *   pu_<cuid>      (public_user — apps/formation-pro-public)
 * Anything else falls back to 'tenant_user' for back-compat.
 */
function parseIdentity(identity: string): { kind: "tenant_user" | "public_user"; userId: string } {
  if (identity.startsWith("pu_")) return { kind: "public_user", userId: identity.slice(3) };
  if (identity.startsWith("tu_")) return { kind: "tenant_user", userId: identity.slice(3) };
  return { kind: "tenant_user", userId: identity };
}

async function ensureAttendanceRow(
  client: any,
  liveSession: LiveSessionRow,
  identity: string
): Promise<void> {
  const { kind, userId } = parseIdentity(identity);
  await client.query(
    `INSERT INTO live_session_attendances (
        tenant_id, live_session_id, subject_kind, subject_user_id, participant_identity
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (live_session_id, subject_kind, subject_user_id) DO NOTHING`,
    [liveSession.tenant_id, liveSession.id, kind, userId, identity]
  );
}

async function handleParticipantJoined(
  client: any,
  liveSession: LiveSessionRow,
  identity: string,
  joinedAt: Date
): Promise<void> {
  await ensureAttendanceRow(client, liveSession, identity);
  const { kind, userId } = parseIdentity(identity);
  await client.query(
    `UPDATE live_session_attendances
        SET first_joined_at = COALESCE(first_joined_at, $4),
            last_session_join_at = $4,
            join_count = join_count + 1,
            updated_at = NOW()
      WHERE live_session_id = $1 AND subject_kind = $2 AND subject_user_id = $3`,
    [liveSession.id, kind, userId, joinedAt.toISOString()]
  );

  // Bump the parent live_session into 'live' on first join.
  await client.query(
    `UPDATE live_sessions
        SET status = 'live',
            started_at = COALESCE(started_at, $2),
            updated_at = NOW()
      WHERE id = $1 AND status = 'created'`,
    [liveSession.id, joinedAt.toISOString()]
  );
}

async function handleParticipantLeft(
  client: any,
  liveSession: LiveSessionRow,
  identity: string,
  leftAt: Date
): Promise<void> {
  const { kind, userId } = parseIdentity(identity);
  // Add the elapsed seconds since last_session_join_at, then clear it.
  await client.query(
    `UPDATE live_session_attendances
        SET total_seconds = total_seconds + GREATEST(
              0,
              EXTRACT(EPOCH FROM ($4::timestamptz - COALESCE(last_session_join_at, $4::timestamptz)))::int
            ),
            last_left_at = $4,
            last_session_join_at = NULL,
            updated_at = NOW()
      WHERE live_session_id = $1 AND subject_kind = $2 AND subject_user_id = $3`,
    [liveSession.id, kind, userId, leftAt.toISOString()]
  );
}

/**
 * On room_finished: close any still-open attendance rows (last_session_join_at is set),
 * compute the session's effective duration and flip counted_present where the user
 * accumulated >= 50% of that duration.
 */
async function handleRoomFinished(
  client: any,
  liveSession: LiveSessionRow,
  finishedAt: Date
): Promise<void> {
  // Close any participant whose leave event we missed.
  await client.query(
    `UPDATE live_session_attendances
        SET total_seconds = total_seconds + GREATEST(
              0,
              EXTRACT(EPOCH FROM ($2::timestamptz - last_session_join_at))::int
            ),
            last_left_at = $2,
            last_session_join_at = NULL,
            updated_at = NOW()
      WHERE live_session_id = $1 AND last_session_join_at IS NOT NULL`,
    [liveSession.id, finishedAt.toISOString()]
  );

  // Resolve the parent session's scheduled duration to anchor the 50% threshold.
  let scheduledSeconds: number | null = null;
  if (liveSession.session_instance_id) {
    const r = await client.query(
      `SELECT EXTRACT(EPOCH FROM (end_datetime - start_datetime))::int AS seconds
         FROM session_instances WHERE id = $1`,
      [liveSession.session_instance_id]
    );
    scheduledSeconds = r.rows[0]?.seconds ?? null;
  } else if (liveSession.session_professionnelle_id) {
    // sessions_professionnelles store dates rather than datetimes, so fall back to actual room
    // duration when no horaires are present.
    const r = await client.query(
      `SELECT EXTRACT(EPOCH FROM (
                (date_fin::timestamp + interval '1 day') - date_debut::timestamp
              ))::int AS seconds
         FROM sessions_professionnelles WHERE id = $1`,
      [liveSession.session_professionnelle_id]
    );
    scheduledSeconds = r.rows[0]?.seconds ?? null;
  }

  // Fallback: if we don't have a scheduled duration, compute from observed room lifetime.
  if (!scheduledSeconds || scheduledSeconds <= 0) {
    const r = await client.query(
      `SELECT EXTRACT(EPOCH FROM ($2::timestamptz - COALESCE(started_at, $2::timestamptz)))::int AS seconds
         FROM live_sessions WHERE id = $1`,
      [liveSession.id, finishedAt.toISOString()]
    );
    scheduledSeconds = r.rows[0]?.seconds ?? null;
  }

  const threshold = scheduledSeconds && scheduledSeconds > 0 ? Math.floor(scheduledSeconds * 0.5) : 0;

  await client.query(
    `UPDATE live_session_attendances
        SET counted_present = (total_seconds >= $2),
            updated_at = NOW()
      WHERE live_session_id = $1`,
    [liveSession.id, threshold]
  );

  await client.query(
    `UPDATE live_sessions
        SET status = 'ended',
            ended_at = COALESCE(ended_at, $2),
            updated_at = NOW()
      WHERE id = $1`,
    [liveSession.id, finishedAt.toISOString()]
  );

  // PR 3 will add a school_attendance bridge here that turns counted_present rows
  // into student_attendance entries for the matching session_instance.
}

async function handleEgressStarted(
  client: any,
  liveSession: LiveSessionRow,
  egressId: string,
  startedAt: Date
): Promise<void> {
  await client.query(
    `INSERT INTO live_session_recordings (
        tenant_id, live_session_id, egress_id, status, started_at
     )
     VALUES ($1, $2, $3, 'processing', $4)
     ON CONFLICT (egress_id) DO NOTHING`,
    [liveSession.tenant_id, liveSession.id, egressId, startedAt.toISOString()]
  );
}

async function handleEgressEnded(
  client: any,
  egressId: string,
  payload: any
): Promise<void> {
  // LiveKit Egress payloads vary; pull whatever we can identify.
  const fileResult = payload?.fileResults?.[0] ?? payload?.egressInfo?.fileResults?.[0];
  const status = payload?.egressInfo?.status === "EGRESS_COMPLETE" || payload?.status === "EGRESS_COMPLETE"
    ? "ready"
    : payload?.egressInfo?.status === "EGRESS_FAILED" || payload?.status === "EGRESS_FAILED"
      ? "failed"
      : payload?.egressInfo?.status === "EGRESS_ABORTED" || payload?.status === "EGRESS_ABORTED"
        ? "aborted"
        : "processing";
  const duration = fileResult?.duration ? Math.round(Number(fileResult.duration) / 1_000_000_000) : null;
  const sizeBytes = fileResult?.size ? Number(fileResult.size) : null;
  const filename = fileResult?.filename ?? fileResult?.location ?? null;
  const errorMessage = payload?.egressInfo?.error ?? payload?.error ?? null;

  await client.query(
    `UPDATE live_session_recordings
        SET status = $2,
            duration_sec = COALESCE($3, duration_sec),
            file_size_bytes = COALESCE($4, file_size_bytes),
            s3_key = COALESCE($5, s3_key),
            error_message = $6,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE egress_id = $1`,
    [egressId, status, duration, sizeBytes, filename, errorMessage]
  );
}

export async function livekitWebhookRoutes(fastify: FastifyInstance) {
  const pg = fastify.pg as any;

  let service: LiveKitService | null = null;
  try {
    service = getLiveKitService();
  } catch (err) {
    fastify.log.warn({ err }, "LiveKit webhook route registered but service is not configured");
  }

  // We need the raw body for signature verification, so register a content parser
  // that preserves the request body as a string.
  fastify.addContentTypeParser(
    "application/webhook+json",
    { parseAs: "string" },
    (_req, body, done) => done(null, body)
  );

  fastify.post("/livekit", async (request, reply) => {
    if (!service) {
      return reply.status(503).send({ error: "LiveKit not configured" });
    }

    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    const authHeader = request.headers.authorization;

    let event: any;
    try {
      event = await service.verifyWebhook(rawBody, authHeader);
    } catch (err: any) {
      fastify.log.warn({ err }, "Rejected LiveKit webhook with invalid signature");
      return reply.status(401).send({ error: "Invalid signature" });
    }

    const eventType: string = event?.event ?? "unknown";
    const eventId: string | undefined = event?.id;
    const occurredAtMs: number = Number(event?.createdAt) * 1000 || Date.now();
    const occurredAt = new Date(occurredAtMs);

    const client = await pg.connect();
    try {
      const fresh = await recordEventOrSkip(client, eventId, eventType);
      if (!fresh) {
        return reply.status(200).send({ ok: true, deduped: true });
      }

      const roomName: string | undefined =
        event?.room?.name ?? event?.participant?.room ?? event?.egressInfo?.roomName;
      if (!roomName && eventType !== "egress_ended") {
        // No room name to map to a tenant — ack and move on.
        return reply.status(200).send({ ok: true, ignored: "no room name" });
      }

      let liveSession: LiveSessionRow | null = roomName
        ? await findLiveSessionByRoom(client, roomName)
        : null;

      if (liveSession) {
        await setTenantContext(client, liveSession.tenant_id);
      }

      switch (eventType) {
        case "participant_joined": {
          if (!liveSession) break;
          const identity = event?.participant?.identity;
          if (!identity) break;
          await handleParticipantJoined(client, liveSession, identity, occurredAt);
          break;
        }
        case "participant_left": {
          if (!liveSession) break;
          const identity = event?.participant?.identity;
          if (!identity) break;
          await handleParticipantLeft(client, liveSession, identity, occurredAt);
          break;
        }
        case "room_started": {
          if (!liveSession) break;
          await client.query(
            `UPDATE live_sessions
                SET status = CASE WHEN status = 'created' THEN 'live' ELSE status END,
                    started_at = COALESCE(started_at, $2),
                    updated_at = NOW()
              WHERE id = $1`,
            [liveSession.id, occurredAt.toISOString()]
          );
          break;
        }
        case "room_finished": {
          if (!liveSession) break;
          await handleRoomFinished(client, liveSession, occurredAt);
          break;
        }
        case "egress_started": {
          const egressId = event?.egressInfo?.egressId;
          if (!liveSession || !egressId) break;
          await handleEgressStarted(client, liveSession, egressId, occurredAt);
          break;
        }
        case "egress_updated":
        case "egress_ended": {
          const egressId = event?.egressInfo?.egressId;
          if (!egressId) break;
          // Recording rows are global by egress_id; tenant context already applied above when
          // we resolved the live session, but for egress_ended we may not have one yet — that's fine
          // since live_session_recordings is RLS-scoped via tenant_id which we already inserted.
          await handleEgressEnded(client, egressId, event);
          break;
        }
        default:
          fastify.log.debug({ eventType }, "LiveKit webhook event ignored");
      }

      return reply.status(200).send({ ok: true });
    } catch (err: any) {
      fastify.log.error({ err, eventType }, "LiveKit webhook handler error");
      return reply.status(500).send({ error: "Internal Server Error" });
    } finally {
      client.release();
    }
  });
}
