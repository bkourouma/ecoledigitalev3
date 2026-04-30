"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  averageGrade: number;
  successRate: number;
  assignmentsGradedRate: number;
};

export function AcademicSummaryCard({ averageGrade, successRate, assignmentsGradedRate }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Synthèse académique</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Moyenne générale (indic.)</span>
          <span className="font-medium">{averageGrade.toFixed(2)} / 20</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Taux de réussite (≥10/20)</span>
          <span className="font-medium">{successRate.toFixed(1)} %</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Devoirs corrigés</span>
          <span className="font-medium">{assignmentsGradedRate.toFixed(1)} %</span>
        </div>
      </CardContent>
    </Card>
  );
}
