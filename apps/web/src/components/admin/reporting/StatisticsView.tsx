/**
 * StatisticsView Component
 * 
 * Component with type selector, date range picker, and dynamic statistics display
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@ecoledigitale/ui";
import { useStatistics } from "@/lib/hooks/use-reporting";
import { Loader2 } from "lucide-react";
import { format, subMonths } from "date-fns";

// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export function StatisticsView() {
  const [type, setType] = useState<"inscriptions" | "formations" | "formateurs" | "entreprises">("inscriptions");
  const [dateDebut, setDateDebut] = useState(format(subMonths(new Date(), 1), "yyyy-MM-dd"));
  const [dateFin, setDateFin] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data, isLoading, error } = useStatistics({
    type,
    date_debut: new Date(dateDebut).toISOString(),
    date_fin: new Date(dateFin + "T23:59:59").toISOString(),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <p className="text-destructive mb-2">Erreur lors du chargement</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Une erreur inattendue s'est produite"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Statistiques Détaillées</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Analyse approfondie par type
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Type</label>
              <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inscriptions">Inscriptions</SelectItem>
                  <SelectItem value="formations">Formations</SelectItem>
                  <SelectItem value="formateurs">Formateurs</SelectItem>
                  <SelectItem value="entreprises">Entreprises</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Date début</label>
              <input
                type="date"
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Date fin</label>
              <input
                type="date"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Display */}
      {data.type === "inscriptions" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Répartition par Statut</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(data.repartition_statut).map(([statut, count]) => (
                  <div key={statut} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="font-medium">{statut}</span>
                    <span className="text-sm font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Évolution Temporelle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.evolution_temporelle.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="font-medium">{item.periode}</span>
                    <span className="text-sm font-semibold">{item.nombre}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {data.type === "formations" && (
        <Card>
          <CardHeader>
            <CardTitle>Statistiques Formations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Nombre de sessions</p>
                <p className="text-2xl font-bold">{data.nb_sessions}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Taux de remplissage moyen</p>
                <p className="text-2xl font-bold">{data.taux_remplissage_moyen.toFixed(1)}%</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Répartition par Mode</p>
              <div className="space-y-2">
                {Object.entries(data.repartition_mode).map(([mode, count]) => (
                  <div key={mode} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="font-medium">{mode}</span>
                    <span className="text-sm font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.type === "formateurs" && (
        <Card>
          <CardHeader>
            <CardTitle>Statistiques Formateurs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Nombre de formateurs</p>
                <p className="text-2xl font-bold">{data.nb_formateurs}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Sessions animées</p>
                <p className="text-2xl font-bold">{data.nb_sessions_animees}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Répartition par Formateur</p>
              <div className="space-y-2">
                {data.repartition_sessions.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="font-medium">{item.formateur}</span>
                    <span className="text-sm font-semibold">{item.nb_sessions} sessions</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.type === "entreprises" && (
        <Card>
          <CardHeader>
            <CardTitle>Statistiques Entreprises</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Nombre d'entreprises</p>
                <p className="text-2xl font-bold">{data.nb_entreprises}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nombre d'inscriptions</p>
                <p className="text-2xl font-bold">{data.nb_inscriptions}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">CA Total</p>
                <p className="text-2xl font-bold">{formatCurrency(data.ca_total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

