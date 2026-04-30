import { notFound } from "next/navigation";
import { PaiementStatus } from "@/components/paiement/PaiementStatus";
import { prisma } from "@/lib/prisma";

export default async function PaiementRetourPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  if (!code) {
    notFound();
  }

  const inscription = await prisma.inscriptionPublic.findUnique({
    where: { codePaiement: code },
    include: { formation: true },
  });

  if (!inscription) {
    notFound();
  }

  return (
    <div className="container py-12">
      <PaiementStatus
        statut={inscription.statut}
        titre={inscription.formation.titre}
        montant={Number(inscription.montantPaye)}
        dateInscription={inscription.dateInscription.toISOString()}
      />
    </div>
  );
}
