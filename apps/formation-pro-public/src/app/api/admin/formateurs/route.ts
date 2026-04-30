import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { isPortalAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createFormateurSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!isPortalAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createFormateurSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides." },
      { status: 400 }
    );
  }

  const existing = await prisma.formateur.findFirst({
    where: {
      tenantId: parsed.data.tenantId,
      email: parsed.data.email,
    },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json(
      { error: "Un formateur existe déjà avec cette adresse sur ce tenant." },
      { status: 409 }
    );
  }

  const formateur = await prisma.formateur.create({
    data: {
      tenantId: parsed.data.tenantId,
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      email: parsed.data.email,
      telephone: parsed.data.telephone || null,
      actif: true,
    },
    select: {
      id: true,
      prenom: true,
      nom: true,
      email: true,
    },
  });

  return NextResponse.json({
    success: true,
    formateur,
    message: "Le formateur a été créé et peut maintenant être affecté.",
  });
}
