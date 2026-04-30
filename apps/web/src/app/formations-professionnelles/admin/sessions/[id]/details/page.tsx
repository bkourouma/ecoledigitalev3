"use client";

import { useParams } from "next/navigation";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Loader2 } from "lucide-react";
import { useSessionDetail } from "@/lib/hooks/use-sessions-pro";
import { SessionInfoTab } from "@/components/sessions-pro/SessionInfoTab";
import { InscritListsTab } from "@/components/sessions-pro/InscritListsTab";
import { StatsTab } from "@/components/sessions-pro/StatsTab";
import { StatusChangeDialog } from "@/components/sessions-pro/StatusChangeDialog";
import { SessionHeader } from "@/components/sessions-pro/SessionHeader";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function AdminSessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const { data: sessionData, isLoading, error } = useSessionDetail(sessionId);

  const handleStatusChangeSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions-pro", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["sessions-pro", "stats", sessionId] });
  };

  const handleExportEnrollments = () => {
    // Trigger download
    window.location.href = `/api/v1/admin/sessions-pro/${sessionId}/inscrits/export`;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement de la session...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !sessionData?.data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-2">Erreur lors du chargement</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Session introuvable"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const session = sessionData.data;

  // Debug: Log session data to check formation
  console.log('[AdminSessionDetailPage] Session data:', {
    sessionId: session.id,
    codeSession: session.code_session,
    hasFormation: !!session.formation,
    formationId: session.formation?.id,
    formationTitre: session.formation?.titre,
    formationKeys: session.formation ? Object.keys(session.formation) : [],
    formationStringified: session.formation ? JSON.stringify(session.formation) : null,
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <SessionHeader 
        session={session} 
        backHref="/formations-professionnelles/admin/sessions"
      />
      <Tabs defaultValue="informations" className="space-y-6">
        <TabsList>
          <TabsTrigger value="informations">Informations</TabsTrigger>
          <TabsTrigger value="inscrits">Inscrits</TabsTrigger>
          <TabsTrigger value="statistiques">Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="informations">
          <SessionInfoTab
            session={session}
            onStatusChange={() => setStatusDialogOpen(true)}
          />
        </TabsContent>

        <TabsContent value="inscrits">
          <InscritListsTab
            sessionId={sessionId}
            onExport={handleExportEnrollments}
          />
        </TabsContent>

        <TabsContent value="statistiques">
          <StatsTab sessionId={sessionId} />
        </TabsContent>
      </Tabs>

      <StatusChangeDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        currentStatus={session.statut}
        sessionId={session.id}
        sessionCode={session.code_session}
        onSuccess={handleStatusChangeSuccess}
      />
    </div>
  );
}

