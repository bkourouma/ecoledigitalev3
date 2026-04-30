import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resendVerificationSchema } from "@/lib/schemas";
import { issueVerificationToken } from "@/lib/verification";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = resendVerificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Adresse email invalide." },
      { status: 400 }
    );
  }

  const user = await prisma.publicUser.findUnique({
    where: { email: parsed.data.email },
  });

  if (!user) {
    return NextResponse.json({
      success: true,
      message:
        "Si un compte en attente existe, un nouveau lien de vérification vient d'être envoyé.",
    });
  }

  if (user.emailVerified) {
    return NextResponse.json({
      success: true,
      message: "Cette adresse est déjà vérifiée. Vous pouvez vous connecter.",
    });
  }

  await issueVerificationToken({
    email: user.email,
    firstName: user.prenom,
  });

  return NextResponse.json({
    success: true,
    message:
      "Un nouveau lien de vérification vient d'être envoyé. Pensez à vérifier vos spams.",
  });
}
