"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOwnerFormations } from "@/lib/hooks/use-owner-formations";

export default function OwnerFormationsPage() {
  const { data, isLoading, error } = useOwnerFormations();

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des formations professionnelles…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {error instanceof Error ? error.message : "Chargement impossible."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Formations professionnelles</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Synthèse lecture seule : tables tenant (base ou suffixe ASPCI selon l’identifiant tenant).
        </p>
        <div className="mt-2">
          <Badge variant={data.usesSessionBasedProfessionalTraining ? "default" : "secondary"}>
            {data.usesSessionBasedProfessionalTraining
              ? "Mode sessions & formateurs (ASPCI)"
              : "Mode catalogue (sessions non exposées sur ce tenant)"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sessions (lignes)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{data.activeSessions}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Inscriptions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{data.enrollments}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Paiements validés</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{fmt(data.revenue)} FCFA</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Entreprises clientes</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{data.companies}</CardContent>
        </Card>
      </div>

      {typeof data.activeFormateurs === "number" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Formateurs actifs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{data.activeFormateurs}</CardContent>
        </Card>
      ) : null}
    </div>
  );
}
