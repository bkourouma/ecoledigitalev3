import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export function OrderCard({
  order,
}: {
  order: {
    id: string;
    statut: "EN_ATTENTE" | "CONFIRME" | "ANNULE";
    codePaiement: string;
    montantPaye: number;
    dateInscription: string;
    dateConfirmation: string | null;
    moyenPaiement: string | null;
    referencePaiement: string | null;
    formation: {
      titre: string;
      slug: string;
    };
    session: {
      codeSession: string | null;
      dateDebut: string;
    } | null;
  };
}) {
  const tone =
    order.statut === "CONFIRME"
      ? "success"
      : order.statut === "ANNULE"
        ? "danger"
        : "warning";

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge tone={tone}>{order.statut}</Badge>
          <p className="text-sm text-muted-foreground">
            Commande du {formatDate(order.dateInscription)}
          </p>
        </div>
        <div>
          <CardTitle className="text-2xl">{order.formation.titre}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Référence interne : {order.codePaiement}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Montant : {formatCurrency(order.montantPaye)}</p>
          <p>Moyen de paiement : {order.moyenPaiement || "Non renseigné"}</p>
          <p>Référence paiement : {order.referencePaiement || "En attente de confirmation"}</p>
          <p>
            Session :{" "}
            {order.session
              ? `${order.session.codeSession || "À venir"} - ${formatDate(order.session.dateDebut)}`
              : "Affectation en cours"}
          </p>
          <p>
            Date de confirmation :{" "}
            {order.dateConfirmation ? formatDate(order.dateConfirmation) : "Non confirmée"}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {order.statut === "CONFIRME" ? (
            <Button asChild>
              <Link href={`/mes-formations/${order.formation.slug}`}>Voir les contenus</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={`/catalogue/${order.formation.slug}`}>Voir la fiche formation</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
