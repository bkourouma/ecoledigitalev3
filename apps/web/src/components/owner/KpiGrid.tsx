"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type KpiGridProps = {
  revenueMonth: number;
  recoveryRate: number;
  totalStudents: number;
  attendanceRate: number;
};

function formatMoney(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " FCFA";
}

function formatPct(n: number) {
  return `${n.toFixed(1)} %`;
}

export function KpiGrid({ revenueMonth, recoveryRate, totalStudents, attendanceRate }: KpiGridProps) {
  const items = [
    { title: "Revenus du mois", value: formatMoney(revenueMonth), hint: "Paiements élèves complétés" },
    { title: "Taux de recouvrement", value: formatPct(recoveryRate), hint: "Échéanciers scolarité" },
    { title: "Élèves inscrits", value: String(totalStudents), hint: "Profils élèves actifs" },
    { title: "Taux d'assiduité (30 j.)", value: formatPct(attendanceRate), hint: "Présences / séances" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{item.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
