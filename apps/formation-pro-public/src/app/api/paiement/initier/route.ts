import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { StatutInscription } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { sendEnrollmentConfirmationEmail } from "@/lib/email";
import { initierPaiement } from "@/lib/payhubsecure";
import { prisma } from "@/lib/prisma";
import { paymentInitSchema } from "@/lib/schemas";
import { absoluteUrl } from "@/lib/utils";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = paymentInitSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Requête invalide." },
      { status: 400 }
    );
  }

  const formation = await prisma.formationProfessionnelle.findUnique({
    where: { id: parsed.data.formationId },
    select: {
      id: true,
      titre: true,
      prixTtc: true,
    },
  });

  if (!formation) {
    return NextResponse.json({ error: "Formation introuvable" }, { status: 404 });
  }

  const codePaiement = `pay_${randomUUID().replace(/-/g, "")}`;
  const amount = formation.prixTtc ? Number(formation.prixTtc) : 0;

  await prisma.inscriptionPublic.create({
    data: {
      userId: session.user.id,
      formationId: formation.id,
      sessionId: parsed.data.sessionId || null,
      montantPaye: amount,
      codePaiement,
    },
  });

  const paymentResponse = await initierPaiement({
    code_paiement: codePaiement,
    nom_usager: session.user.nom || "Apprenant",
    prenom_usager: session.user.prenom || "",
    telephone: parsed.data.telephone || session.user.telephone || undefined,
    email: session.user.email || undefined,
    libelle_article: formation.titre,
    quantite: 1,
    montant: amount.toFixed(0),
    lib_order: `Inscription - ${formation.titre}`,
    Url_Retour: absoluteUrl(`/paiement/retour?code=${codePaiement}`),
    Url_Callback: absoluteUrl("/api/paiement/callback"),
  });

  if (paymentResponse.message === "Mock payment session created") {
    const confirmedEnrollment = await prisma.inscriptionPublic.update({
      where: { codePaiement },
      data: {
        statut: StatutInscription.CONFIRME,
        moyenPaiement: "simulation",
        referencePaiement: `mock_${codePaiement}`,
        dateConfirmation: new Date(),
      },
      include: {
        formation: true,
        session: true,
        user: true,
      },
    });

    if (confirmedEnrollment.user.email) {
      try {
        await sendEnrollmentConfirmationEmail({
          to: confirmedEnrollment.user.email,
          firstName: confirmedEnrollment.user.prenom,
          formationTitle: confirmedEnrollment.formation.titre,
          amount,
          dashboardUrl: absoluteUrl(`/mes-formations/${confirmedEnrollment.formation.slug || confirmedEnrollment.formation.id}`),
          sessionLabel: confirmedEnrollment.session?.codeSession || null,
        });
      } catch (emailError) {
        console.error("[formation-pro-public] Mock confirmation email error", emailError);
      }
    }
  }

  return NextResponse.json({
    url: paymentResponse.url,
    codePaiement,
  });
}
