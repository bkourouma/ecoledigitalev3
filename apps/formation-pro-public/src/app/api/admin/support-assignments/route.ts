import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { isPortalAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supportAssignmentSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!isPortalAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = supportAssignmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides." },
      { status: 400 }
    );
  }

  const support = await prisma.supportCours.findUnique({
    where: { id: parsed.data.supportId },
    select: {
      id: true,
      tenantId: true,
      formationId: true,
    },
  });

  if (!support) {
    return NextResponse.json({ error: "Support introuvable." }, { status: 404 });
  }

  const formateur = await prisma.formateur.findFirst({
    where: {
      id: parsed.data.formateurId,
      tenantId: support.tenantId,
    },
    select: { id: true },
  });

  if (!formateur) {
    return NextResponse.json(
      { error: "Le formateur choisi ne correspond pas à ce tenant." },
      { status: 400 }
    );
  }

  let sessionRecord: { id: string } | null = null;

  if (parsed.data.sessionId) {
    sessionRecord = await prisma.sessionProfessionnelle.findFirst({
      where: {
        id: parsed.data.sessionId,
        tenantId: support.tenantId,
        ...(support.formationId ? { formationId: support.formationId } : {}),
      },
      select: { id: true },
    });

    if (!sessionRecord) {
      return NextResponse.json(
        { error: "La session choisie ne correspond pas à cette formation." },
        { status: 400 }
      );
    }
  }

  await prisma.supportCours.update({
    where: { id: support.id },
    data: {
      formateurId: formateur.id,
      sessionId: sessionRecord?.id || null,
    },
  });

  return NextResponse.json({
    success: true,
    message: "Le support a été affecté avec succès.",
  });
}
