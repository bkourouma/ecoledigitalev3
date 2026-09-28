"use client";

import { useFormateurDashboard } from "@/lib/hooks/use-formateur-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2, Calendar, Users, BookOpen, Clock, Bell } from "lucide-react";
import { DashboardStats } from "@/components/formateur/DashboardStats";
import { ProchainesSessionsWidget } from "@/components/formateur/ProchainesSessionsWidget";
import { SessionsRecentesWidget } from "@/components/formateur/SessionsRecentesWidget";
import { SupportsRecentsWidget } from "@/components/formateur/SupportsRecentsWidget";
import { NotificationsWidget } from "@/components/formateur/NotificationsWidget";
import { DashboardSkeleton } from "@/components/formateur/DashboardSkeleton";

export default function FormateurDashboardPage() {
  const { data, isLoading, error } = useFormateurDashboard();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data?.data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-4">
                {error instanceof Error ? error.message : "Erreur lors du chargement du tableau de bord"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dashboardData = data.data;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="font-bold mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">Tableau de bord</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Vue d'ensemble de vos activités de formation
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="mb-8">
        <DashboardStats stats={dashboardData.stats} />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Sessions */}
        <div className="lg:col-span-2 space-y-6">
          <ProchainesSessionsWidget sessions={dashboardData.prochaines_sessions} />
          <SessionsRecentesWidget sessions={dashboardData.sessions_recentes} />
        </div>

        {/* Right Column - Materials and Notifications */}
        <div className="space-y-6">
          <SupportsRecentsWidget supports={dashboardData.supports_recents} />
          <NotificationsWidget />
        </div>
      </div>
    </div>
  );
}

