import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export function FormationAcheteeCard({
  item,
}: {
  item: {
    statut: "EN_ATTENTE" | "CONFIRME" | "ANNULE";
    dateInscription: string;
    montantPaye: number;
    formation: { titre: string; slug: string; descriptionCourte: string };
    session: { codeSession: string | null; dateDebut: string } | null;
  };
}) {
  const tone =
    item.statut === "CONFIRME"
      ? "success"
      : item.statut === "ANNULE"
        ? "danger"
        : "warning";

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge tone={tone}>{item.statut}</Badge>
          <span className="text-sm text-muted-foreground">
            Inscription du {formatDate(item.dateInscription)}
          </span>
        </div>
        <div>
          <h3 className="font-display text-xl font-semibold">{item.formation.titre}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.formation.descriptionCourte}
          </p>
        </div>
        <div className="rounded-[1.25rem] bg-muted p-4 text-sm text-muted-foreground">
          <p>Montant réglé : {formatCurrency(item.montantPaye)}</p>
          <p>
            Session :{" "}
            {item.session
              ? `${item.session.codeSession || "À venir"} - ${formatDate(item.session.dateDebut)}`
              : "Affectation en cours"}
          </p>
        </div>
        {item.statut === "CONFIRME" ? (
          <Button asChild>
            <Link href={`/mes-formations/${item.formation.slug}`}>Accéder aux contenus</Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={`/catalogue/${item.formation.slug}`}>Voir la fiche formation</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
