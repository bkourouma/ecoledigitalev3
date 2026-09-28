/**
 * TauxConversion Component
 * 
 * Component displaying conversion rates (global, by formation, by payment method, monthly trends)
 */

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { useTauxConversion } from "@/lib/hooks/use-reporting";
import { Loader2 } from "lucide-react";

export function TauxConversion() {
  const { data, isLoading, error } = useTauxConversion();

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
      <div>
        <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Taux de Conversion</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Analyse des taux de conversion inscriptions → paiements
        </p>
      </div>

      {/* Global Rate */}
      <Card>
        <CardHeader>
          <CardTitle>Taux Global</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold text-primary">{data.taux_global}</div>
          <p className="text-sm text-muted-foreground mt-2">
            Pourcentage d'inscriptions converties en paiements validés
          </p>
        </CardContent>
      </Card>

      {/* By Formation */}
      <Card>
        <CardHeader>
          <CardTitle>Par Formation</CardTitle>
        </CardHeader>
        <CardContent>
          {data.par_formation.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-3">
              {data.par_formation.map((item, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="font-medium">{item.formation}</span>
                  <span className="text-lg font-semibold text-primary">{item.taux}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Par Méthode de Paiement</CardTitle>
        </CardHeader>
        <CardContent>
          {data.par_methode_paiement.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-3">
              {data.par_methode_paiement.map((item, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.methode}</span>
                    <span className="text-sm font-semibold">{item.pourcentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{ width: `${item.pourcentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Évolution Mensuelle (12 derniers mois)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.par_mois.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-2">
              {data.par_mois.map((item, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="font-medium">{item.mois}</span>
                  <span className="text-lg font-semibold text-primary">{item.taux}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

