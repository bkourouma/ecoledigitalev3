import { StatutInscription } from "@prisma/client";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { FormationAcheteeCard } from "@/components/dashboard/FormationAcheteeCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";
import { getPurchasedFormations } from "@/lib/catalogue";

export default async function MesFormationsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  const { statut: rawStatut } = await searchParams;
  const statut = rawStatut as StatutInscription | undefined;
  const formations = await getPurchasedFormations(session.user.id, statut);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Mes formations</p>
        <h1 className="font-display text-4xl font-semibold">Vos inscriptions et accès</h1>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant={!statut ? "primary" : "outline"}>
          <Link href="/mes-formations">Toutes</Link>
        </Button>
        <Button asChild variant={statut === StatutInscription.CONFIRME ? "primary" : "outline"}>
          <Link href="/mes-formations?statut=CONFIRME">
            Confirmées
          </Link>
        </Button>
        <Button asChild variant={statut === StatutInscription.EN_ATTENTE ? "primary" : "outline"}>
          <Link href="/mes-formations?statut=EN_ATTENTE">
            En attente
          </Link>
        </Button>
      </div>
      {formations.length ? (
        <div className="grid gap-5">
          {formations.map((item) => (
            <FormationAcheteeCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Aucune formation achetée pour le moment"
          description="Vos achats et confirmations apparaîtront ici dès qu'une transaction sera validée."
        />
      )}
    </section>
  );
}
