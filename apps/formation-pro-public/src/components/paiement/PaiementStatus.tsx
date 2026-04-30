"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export function PaiementStatus({
  statut,
  titre,
  montant,
  dateInscription,
}: {
  statut: "EN_ATTENTE" | "CONFIRME" | "ANNULE";
  titre: string;
  montant: number;
  dateInscription: string;
}) {
  const router = useRouter();
  const config = {
    CONFIRME: {
      icon: <CheckCircle2 className="h-10 w-10 text-emerald-600" />,
      title: "Paiement confirmé",
      description:
        "Votre inscription est active. Vous allez pouvoir retrouver cette formation dans votre espace apprenant.",
    },
    EN_ATTENTE: {
      icon: <Clock3 className="h-10 w-10 text-amber-600" />,
      title: "Paiement en attente",
      description:
        "Nous attendons encore la confirmation du prestataire de paiement. Cette page se mettra à jour dès réception.",
    },
    ANNULE: {
      icon: <XCircle className="h-10 w-10 text-rose-600" />,
      title: "Paiement non abouti",
      description:
        "La transaction n'a pas pu être finalisée. Vous pouvez relancer le paiement depuis la page formation.",
    },
  }[statut];

  useEffect(() => {
    if (statut !== "CONFIRME") return;

    const timeout = window.setTimeout(() => {
      router.push("/mes-formations");
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [router, statut]);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader className="items-center text-center">
        {config.icon}
        <CardTitle className="text-3xl">{config.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        <p className="text-muted-foreground">{config.description}</p>
        <div className="rounded-[1.5rem] bg-muted p-5 text-left">
          <p className="font-semibold">{titre}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Montant : {formatCurrency(montant)}
          </p>
          <p className="text-sm text-muted-foreground">
            Date : {formatDate(dateInscription)}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/mes-formations">Voir mes formations</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/catalogue">Retour au catalogue</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
