import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/schemas";
import { issueVerificationToken } from "@/lib/verification";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides." },
      { status: 400 }
    );
  }

  const existingUser = await prisma.publicUser.findUnique({
    where: { email: parsed.data.email },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "Un compte existe déjà avec cette adresse email." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  const user = await prisma.publicUser.create({
    data: {
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      email: parsed.data.email,
      telephone: parsed.data.telephone,
      motDePasseHash: passwordHash,
    },
  });

  await issueVerificationToken({
    email: user.email,
    firstName: user.prenom,
  });

  return NextResponse.json({
    success: true,
    message:
      "Compte créé. Vérifiez votre boîte email pour activer votre espace apprenant.",
  });
}
