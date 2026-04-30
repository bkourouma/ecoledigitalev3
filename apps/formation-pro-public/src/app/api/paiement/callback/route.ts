import { NextResponse } from "next/server";
import { StatutInscription } from "@prisma/client";
import { sendEnrollmentConfirmationEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/utils";

export async function POST(request: Request) {
  const payload = await request.json();
  const { codePaiement, referencePaiement, code, moyenPaiement } = payload;

  if (!codePaiement) {
    return NextResponse.json({ error: "codePaiement manquant" }, { status: 400 });
  }

  if (Number(code) === 200) {
    const enrollment = await prisma.inscriptionPublic.update({
      where: { codePaiement },
      data: {
        statut: StatutInscription.CONFIRME,
        referencePaiement,
        moyenPaiement,
        dateConfirmation: new Date(),
      },
      include: {
        formation: true,
        session: true,
        user: true,
      },
    });

    if (enrollment.user.email) {
      try {
        await sendEnrollmentConfirmationEmail({
          to: enrollment.user.email,
          firstName: enrollment.user.prenom,
          formationTitle: enrollment.formation.titre,
          amount: Number(enrollment.montantPaye),
          dashboardUrl: absoluteUrl(`/mes-formations/${enrollment.formation.slug || enrollment.formation.id}`),
          sessionLabel: enrollment.session?.codeSession || null,
        });
      } catch (emailError) {
        console.error("[formation-pro-public] Enrollment confirmation email error", emailError);
      }
    }
  } else {
    await prisma.inscriptionPublic.update({
      where: { codePaiement },
      data: { statut: StatutInscription.ANNULE },
    });
  }

  return NextResponse.json({ received: true });
}
