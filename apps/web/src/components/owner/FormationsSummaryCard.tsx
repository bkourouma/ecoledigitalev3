"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  activeSessions: number;
  totalEnrollments: number;
  revenueFormations: number;
  clientCompanies: number;
};

export function FormationsSummaryCard({
  activeSessions,
  totalEnrollments,
  revenueFormations,
  clientCompanies,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Formations professionnelles</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Sessions (catalogue)</span>
          <span className="font-medium">{activeSessions}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Inscriptions</span>
          <span className="font-medium">{totalEnrollments}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Revenus (paiements validés)</span>
          <span className="font-medium">
            {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(revenueFormations)} FCFA
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entreprises clientes</span>
          <span className="font-medium">{clientCompanies}</span>
        </div>
      </CardContent>
    </Card>
  );
}
