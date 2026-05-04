import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const rows = await prisma.$queryRaw<Array<{ count: string }>>(Prisma.sql`
    SELECT COUNT(*)::text AS count FROM app_notifications
     WHERE subject_kind = 'public_user'
       AND subject_user_id = ${session.user.id}
       AND read_at IS NULL
  `);
  return NextResponse.json({ data: { count: parseInt(rows[0]?.count ?? "0", 10) } });
}
