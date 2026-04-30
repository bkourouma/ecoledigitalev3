"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Calendar, TrendingUp, Users, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickStatsCardsProps {
  statistics: {
    sessions_actives: number;
    sessions_ce_mois: number;
    taux_remplissage: number;
    ca_previsionnel: number;
  };
  className?: string;
}

export function QuickStatsCards({ statistics, className }: QuickStatsCardsProps) {
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full min-w-0", className)}>
      {/* Sessions Actives */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-4 md:px-6 pt-4 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-foreground/80 truncate pr-2">
            Sessions actives
          </CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </CardHeader>
        <CardContent className="px-3 sm:px-4 md:px-6 pb-4 sm:pb-6">
          <div className="text-xl sm:text-2xl font-bold text-foreground">{statistics.sessions_actives}</div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            Planifiées, ouvertes, complètes ou en cours
          </p>
        </CardContent>
      </Card>

      {/* Sessions ce mois */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-4 md:px-6 pt-4 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-foreground/80 truncate pr-2">
            Sessions ce mois
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </CardHeader>
        <CardContent className="px-3 sm:px-4 md:px-6 pb-4 sm:pb-6">
          <div className="text-xl sm:text-2xl font-bold text-foreground">{statistics.sessions_ce_mois}</div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            Sessions démarrant ce mois-ci
          </p>
        </CardContent>
      </Card>

      {/* Taux de remplissage */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-4 md:px-6 pt-4 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-foreground/80 truncate pr-2">
            Taux de remplissage
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </CardHeader>
        <CardContent className="px-3 sm:px-4 md:px-6 pb-4 sm:pb-6">
          <div className="text-xl sm:text-2xl font-bold text-foreground">
            {statistics.taux_remplissage.toFixed(1)}%
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            Moyenne toutes sessions confondues
          </p>
        </CardContent>
      </Card>

      {/* CA prévisionnel */}
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 sm:px-4 md:px-6 pt-4 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-foreground/80 truncate pr-2">
            CA prévisionnel
          </CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </CardHeader>
        <CardContent className="px-3 sm:px-4 md:px-6 pb-4 sm:pb-6">
          <div className="text-lg sm:text-xl md:text-2xl font-bold text-foreground break-words overflow-hidden text-ellipsis">
            {statistics.ca_previsionnel > 0 
              ? (() => {
                  const formatted = new Intl.NumberFormat("fr-FR", {
                    style: "currency",
                    currency: "XOF",
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  }).format(statistics.ca_previsionnel);
                  // Si le montant est trop long, utiliser un format compact
                  return formatted.length > 15 
                    ? new Intl.NumberFormat("fr-FR", {
                        notation: "compact",
                        style: "currency",
                        currency: "XOF",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 1,
                      }).format(statistics.ca_previsionnel)
                    : formatted;
                })()
              : "0 FCFA"}
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            Basé sur les inscriptions confirmées
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

