"use client";

import { Button } from "@ecoledigitale/ui";
import { Plus, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { QuickStatsCards } from "./QuickStatsCards";
import { cn } from "@/lib/utils";

interface AdminSessionsHeaderProps {
  statistics: {
    sessions_actives: number;
    sessions_ce_mois: number;
    taux_remplissage: number;
    ca_previsionnel: number;
  };
  onExport?: () => void;
  className?: string;
}

export function AdminSessionsHeader({
  statistics,
  onExport,
  className,
}: AdminSessionsHeaderProps) {
  const router = useRouter();

  return (
    <div className={cn("space-y-4 sm:space-y-6 w-full min-w-0", className)}>
      {/* Header with title and actions */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <h1 className="font-bold text-foreground whitespace-nowrap text-2xl leading-tight md:text-3xl">Gestion des Sessions</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez toutes vos sessions de formation professionnelle
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto flex-shrink-0">
          <Button
            variant="outline"
            onClick={onExport}
            className="flex items-center justify-center gap-2 w-full sm:w-auto"
            size="sm"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Exporter Excel</span>
            <span className="sm:hidden">Exporter</span>
          </Button>
          <Button
            onClick={() => router.push("/formations-professionnelles/admin/sessions/creer")}
            className="flex items-center justify-center gap-2 w-full sm:w-auto"
            size="sm"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Créer une session</span>
            <span className="sm:hidden">Créer</span>
          </Button>
        </div>
      </div>

      {/* Quick Stats Cards */}
      <QuickStatsCards statistics={statistics} />
    </div>
  );
}

