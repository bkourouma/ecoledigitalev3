/**
 * GET /api/apprenant/notifications
 *
 * List notifications for the signed-in PublicUser. Mirrors the Fastify route at
 * /api/v1/notifications-inbox but scoped to subject_kind='public_user' since the
 * formation-pro-public app authenticates against the public_users table.
 *
 * Querystring: ?unreadOnly=true&type=...&limit=50&cursor=<iso-timestamp>
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

interface Row {
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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const type = url.searchParams.get("type");
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50)
  );
  const cursor = url.searchParams.get("cursor");

  // Build the WHERE clause incrementally; fall back to $queryRaw since notifications isn't a Prisma model.
  const filters: Prisma.Sql[] = [
    Prisma.sql`subject_kind = 'public_user'`,
    Prisma.sql`subject_user_id = ${session.user.id}`,
  ];
  if (unreadOnly) filters.push(Prisma.sql`read_at IS NULL`);
  if (type) filters.push(Prisma.sql`type = ${type}`);
  if (cursor) filters.push(Prisma.sql`created_at < ${new Date(cursor)}`);

  const where = Prisma.join(filters, " AND ");
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT id, type, title, body, payload, action_url, channels_sent, read_at, created_at
      FROM app_notifications
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `);

  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      payload: r.payload ?? {},
      actionUrl: r.action_url,
      channelsSent: Array.isArray(r.channels_sent) ? r.channels_sent : [],
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
    nextCursor,
  });
}
