/**
 * POST /api/apprenant/live-sessions/[id]/join-token
 *
 * Mints a LiveKit join JWT for the currently signed-in PublicUser.
 * The Fastify API has its own /api/v1/live-sessions/:id/join-token but it's gated by tenant
 * user JWTs — public users live in a different auth realm so we sign tokens here in-process
 * using the same livekit-server-sdk + secrets.
 *
 * Authorization: the user must hold a CONFIRME inscription that points at the same parent
 * SessionProfessionnelle as this live_session.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const liveSessionId = params.id;
  if (!liveSessionId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LiveKit not configured" },
      { status: 503 }
    );
  }

  // Resolve the live session + parent SessionProfessionnelle id directly via the shared schema.
  // We can't use the Prisma Client (no live_sessions model) — fall back to $queryRaw.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tenant_id: string;
      session_professionnelle_id: string | null;
      session_instance_id: string | null;
      room_name: string;
      status: string;
    }>
  >(Prisma.sql`
    SELECT id, tenant_id, session_professionnelle_id, session_instance_id, room_name, status
      FROM live_sessions
     WHERE id = ${liveSessionId}::uuid
     LIMIT 1
  `);
  const liveSession = rows[0];
  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found" }, { status: 404 });
  }
  if (liveSession.status === "ended") {
    return NextResponse.json(
      { error: "Live session has ended" },
      { status: 409 }
    );
  }
  if (!liveSession.session_professionnelle_id) {
    // School session — the public learner has no business joining.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Enrollment check: PublicUser must have a CONFIRME inscription on this session.
  const inscription = await prisma.inscriptionPublic.findFirst({
    where: {
      userId: session.user.id,
      sessionId: liveSession.session_professionnelle_id,
      statut: "CONFIRME",
    },
    select: { id: true },
  });
  if (!inscription) {
    return NextResponse.json(
      { error: "Inscription confirmée requise pour rejoindre la séance." },
      { status: 403 }
    );
  }

  // Mint a participant-only JWT. Identity is prefixed `pu_` so the LiveKit webhook in
  // apps/api routes the attendance row into subject_kind='public_user'.
  const identity = `pu_${session.user.id}`;
  const displayName =
    session.user.name ?? session.user.email ?? session.user.id;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    ttl: `${6 * 60 * 60}s`,
    metadata: JSON.stringify({
      tenantId: liveSession.tenant_id,
      liveSessionId: liveSession.id,
      subjectKind: "public_user",
    }),
  });
  at.addGrant({
    room: liveSession.room_name,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  const token = await at.toJwt();

  return NextResponse.json({
    data: {
      url: livekitUrl,
      token,
      role: "participant",
      roomName: liveSession.room_name,
      identity,
    },
  });
}
