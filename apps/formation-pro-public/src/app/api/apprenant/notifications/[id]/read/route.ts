import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  _req: Request,
  { params }: RouteContext
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE app_notifications
       SET read_at = NOW()
     WHERE id = ${id}::uuid
       AND subject_kind = 'public_user'
       AND subject_user_id = ${session.user.id}
       AND read_at IS NULL
  `);
  return NextResponse.json({ data: { ok: true } });
}
