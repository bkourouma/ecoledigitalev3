/**
 * ReportingDashboard Component
 * 
 * Main dashboard component with period selector, metrics cards, charts, and top lists
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { useDashboardMetrics } from "@/lib/hooks/use-reporting";
import { MetricsCards } from "./MetricsCards";
import { Loader2 } from "lucide-react";
import { ReportingPeriod } from "@ecoledigitale/contracts/src/reporting";

export function ReportingDashboard() {
  const [period, setPeriod] = useState<ReportingPeriod>("mois");

  const { data, isLoading, error } = useDashboardMetrics({ periode: period });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement des métriques...</span>
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
      {/* Header with period selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Tableau de Bord</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Vue d'ensemble des métriques clés
          </p>
        </div>
        <Select value={period} onValueChange={(value) => setPeriod(value as ReportingPeriod)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="jour">Aujourd'hui</SelectItem>
            <SelectItem value="semaine">Cette semaine</SelectItem>
            <SelectItem value="mois">Ce mois</SelectItem>
            <SelectItem value="annee">Cette année</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Metrics Cards */}
      <MetricsCards data={data} />

      {/* Top Lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Formations */}
        <Card>
          <CardHeader>
            <CardTitle>Top 5 Formations</CardTitle>
          </CardHeader>
          <CardContent>
            {data.top_formations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
            ) : (
              <div className="space-y-3">
                {data.top_formations.map((formation, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold">
                        {index + 1}
                      </div>
                      <span className="font-medium">{formation.formation}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{formation.nb_inscriptions} inscriptions</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Enterprises */}
        <Card>
          <CardHeader>
            <CardTitle>Top 5 Entreprises</CardTitle>
          </CardHeader>
          <CardContent>
            {data.top_entreprises.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
            ) : (
              <div className="space-y-3">
                {data.top_entreprises.map((entreprise, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold">
                        {index + 1}
                      </div>
                      <div>
                        <span className="font-medium">{entreprise.entreprise}</span>
                        <p className="text-xs text-muted-foreground">{entreprise.nb_inscriptions} inscriptions</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(entreprise.ca)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

