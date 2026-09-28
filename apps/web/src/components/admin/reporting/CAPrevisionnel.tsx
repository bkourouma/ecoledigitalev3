/**
 * CAPrevisionnel Component
 * 
 * Component displaying revenue forecast with year/quarter selector, breakdown, and charts
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { useCAPrevisionnel } from "@/lib/hooks/use-reporting";
import { Loader2 } from "lucide-react";

// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export function CAPrevisionnel() {
  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [trimestre, setTrimestre] = useState<number | undefined>(undefined);

  const { data, isLoading, error } = useCAPrevisionnel({ annee, trimestre });

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
      {/* Header with selectors */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">CA Prévisionnel</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Prévisions de chiffre d'affaires pour l'année {annee}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={annee.toString()} onValueChange={(value) => setAnnee(parseInt(value))}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={trimestre?.toString() || "all"}
            onValueChange={(value) => setTrimestre(value === "all" ? undefined : parseInt(value))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Tous les trimestres" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les trimestres</SelectItem>
              <SelectItem value="1">T1</SelectItem>
              <SelectItem value="2">T2</SelectItem>
              <SelectItem value="3">T3</SelectItem>
              <SelectItem value="4">T4</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">CA Réalisé</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(data.ca_realise)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">CA Prévisionnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(data.ca_previsionnel)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">CA Potentiel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(data.ca_potentiel)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">CA Total Estimé</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.ca_total_estime)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Répartition par Mois</CardTitle>
        </CardHeader>
        <CardContent>
          {data.par_mois.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-2">
              {data.par_mois.map((mois, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="font-medium">{mois.mois}</span>
                  <div className="flex gap-4">
                    <span className="text-sm text-green-600">
                      Réalisé: {formatCurrency(mois.ca_realise)}
                    </span>
                    <span className="text-sm text-blue-600">
                      Prévisionnel: {formatCurrency(mois.ca_previsionnel)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Formation */}
      <Card>
        <CardHeader>
          <CardTitle>Répartition par Formation</CardTitle>
        </CardHeader>
        <CardContent>
          {data.par_formation.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-2">
              {data.par_formation.map((formation, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="font-medium">{formation.formation}</span>
                  <span className="text-sm font-semibold">{formatCurrency(formation.ca)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

