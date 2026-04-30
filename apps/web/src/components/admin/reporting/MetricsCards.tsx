/**
 * MetricsCards Component
 * 
 * Displays key metrics (inscriptions, CA, sessions) with evolution indicators
 */

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Users, DollarSign, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { DashboardMetricsResponse } from "@ecoledigitale/contracts/src/reporting";

// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

interface MetricsCardsProps {
  data: DashboardMetricsResponse;
}

export function MetricsCards({ data }: MetricsCardsProps) {
  const getEvolutionIcon = (evolution: string) => {
    const isPositive = evolution.startsWith("+") || parseFloat(evolution) > 0;
    return isPositive ? (
      <TrendingUp className="h-4 w-4 text-green-600" />
    ) : (
      <TrendingDown className="h-4 w-4 text-red-600" />
    );
  };

  const getEvolutionColor = (evolution: string) => {
    const isPositive = evolution.startsWith("+") || parseFloat(evolution) > 0;
    return isPositive ? "text-green-600" : "text-red-600";
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Inscriptions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Inscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <div className="text-2xl font-bold">{data.inscriptions.total}</div>
            </div>
            <div className={`flex items-center gap-1 ${getEvolutionColor(data.inscriptions.evolution)}`}>
              {getEvolutionIcon(data.inscriptions.evolution)}
              <span className="text-sm font-medium">{data.inscriptions.evolution}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CA */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Chiffre d'Affaires</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <div className="text-2xl font-bold">{formatCurrency(data.ca.total)}</div>
            </div>
            <div className={`flex items-center gap-1 ${getEvolutionColor(data.ca.evolution)}`}>
              {getEvolutionIcon(data.ca.evolution)}
              <span className="text-sm font-medium">{data.ca.evolution}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sessions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{data.sessions.total}</div>
                <div className="text-xs text-muted-foreground">Taux remplissage: {data.sessions.taux_remplissage}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

