"use client";

import Link from "next/link";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from "@ecoledigitale/ui";
import { Loader2, ArrowRight } from "lucide-react";

export default function PublicFormationsPage() {
  const { data, isLoading, error } = useFormations({ limit: 30, sort: "pertinence" });
  const formations = data?.data?.formations || [];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Catalogue Public Imhotep Data</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Decouvrez les formations, creez votre compte, puis achetez en ligne pour debloquer les videos.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des formations...
        </div>
      )}

      {error && !isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            {(error as Error).message || "Impossible de charger les formations"}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {formations.map((formation: any) => (
            <Card key={formation.id} className="h-full">
              <CardHeader>
                <CardTitle className="text-lg">{formation.titre}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {formation.description_courte || "Aucune description"}
                </p>
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{formation.niveau || "Tous niveaux"}</Badge>
                  <span className="text-sm font-semibold">{formation.prix_ttc} FCFA</span>
                </div>
                <Link href={`/formations-professionnelles/public/${formation.slug}`}>
                  <Button className="w-full">
                    Voir la page publique
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
