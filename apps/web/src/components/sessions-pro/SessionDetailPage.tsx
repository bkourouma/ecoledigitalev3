"use client";

import { SessionDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { SessionHeader } from "./SessionHeader";
import { SessionStatusBanner } from "./SessionStatusBanner";
import { SessionInfos } from "./SessionInfos";
import { SessionFormateurs } from "./SessionFormateurs";
import { SessionInscriptionSidebar } from "./SessionInscriptionSidebar";
import { OtherSessionsCarousel } from "./OtherSessionsCarousel";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";

interface SessionDetailPageProps {
  session: SessionDetail | null;
  availability?: {
    places_disponibles: number;
    places_reservees: number;
    places_totales: number;
    peut_inscrire: boolean;
    message?: string | null;
  };
  otherSessions?: Array<{
    id: string;
    code_session: string;
    date_debut: string;
    date_fin: string;
    mode_formation: string;
    places_disponibles: number;
  }>;
  isLoading?: boolean;
  isLoadingAvailability?: boolean;
  onInscriptionClick?: () => void;
  className?: string;
}

export function SessionDetailPage({
  session,
  availability,
  otherSessions = [],
  isLoading = false,
  isLoadingAvailability = false,
  onInscriptionClick,
  className,
}: SessionDetailPageProps) {
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement de la session...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-2">Session introuvable</p>
              <p className="text-sm text-muted-foreground">
                La session demandée n'existe pas ou n'est plus disponible.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <SessionHeader session={session} />

        {/* Status Banner */}
        <SessionStatusBanner statut={session.statut} />

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Session Info */}
            <SessionInfos session={session} />


            {/* Formateurs */}
            <SessionFormateurs session={session} />

            {/* Other Sessions */}
            {otherSessions.length > 0 && (
              <OtherSessionsCarousel
                sessions={otherSessions as any}
                currentSessionId={session.id}
                formationSlug={session.formation.slug}
              />
            )}
          </div>

          {/* Right Column - Sidebar */}
          <div className="lg:col-span-1">
            <SessionInscriptionSidebar
              session={session}
              availability={availability}
              isLoadingAvailability={isLoadingAvailability}
              onInscriptionClick={onInscriptionClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

