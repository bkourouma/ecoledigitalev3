/**
 * AdminExports Component
 * 
 * Main component for export management with export type cards
 */

"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { FileSpreadsheet, Users, DollarSign, Calendar, TrendingUp, Settings } from "lucide-react";
import Link from "next/link";

export function AdminExports() {
  const exportTypes = [
    {
      id: "inscriptions",
      title: "Export des Inscriptions",
      description: "Exporter les inscriptions avec filtres et sélection de colonnes",
      icon: Users,
      href: "/formations-professionnelles/admin/exports/inscriptions",
      color: "text-blue-600",
    },
    {
      id: "paiements",
      title: "Export des Paiements",
      description: "Exporter les paiements avec regroupement optionnel",
      icon: DollarSign,
      href: "/formations-professionnelles/admin/exports/paiements",
      color: "text-green-600",
    },
    {
      id: "presences",
      title: "Export des Présences",
      description: "Exporter les présences pour une session avec statistiques",
      icon: Calendar,
      href: "/formations-professionnelles/admin/exports/presences",
      color: "text-purple-600",
    },
    {
      id: "ca-formation",
      title: "Export CA par Formation",
      description: "Exporter le chiffre d'affaires par formation pour une année",
      icon: TrendingUp,
      href: "/formations-professionnelles/admin/exports/ca-formation",
      color: "text-orange-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Exports de Données</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Exportez vos données en Excel ou CSV avec des filtres personnalisables
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exportTypes.map((type) => {
          const Icon = type.icon;
          return (
            <Link key={type.id} href={type.href}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Icon className={`h-8 w-8 ${type.color}`} />
                    <div>
                      <CardTitle>{type.title}</CardTitle>
                      <CardDescription>{type.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

