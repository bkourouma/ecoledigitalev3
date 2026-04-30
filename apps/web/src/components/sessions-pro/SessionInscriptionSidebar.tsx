"use client";

import { SessionDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import { Users, DollarSign, Mail, Phone, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAmountFCFA } from "@/lib/utils";

interface SessionInscriptionSidebarProps {
  session: SessionDetail;
  availability?: {
    places_disponibles: number;
    places_reservees: number;
    places_totales: number;
    peut_inscrire: boolean;
    message?: string | null;
  };
  isLoadingAvailability?: boolean;
  onInscriptionClick?: () => void;
  className?: string;
}

export function SessionInscriptionSidebar({
  session,
  availability,
  isLoadingAvailability = false,
  onInscriptionClick,
  className,
}: SessionInscriptionSidebarProps) {
  // Use availability data if available, otherwise fallback to session data
  const placesDisponibles =
    availability?.places_disponibles ?? session.places_disponibles ?? 0;
  const placesReservees =
    availability?.places_reservees ?? session.places_reservees ?? 0;
  const placesTotales =
    availability?.places_totales ?? session.places_totales ?? 0;
  const message = availability?.message;
  
  // Calculate if session is full
  const isFull = placesDisponibles === 0 && placesReservees > 0;
  
  // Determine if enrollment is possible
  // Priority: if there are available places, allow enrollment unless there's a clear blocking reason
  const sessionStatut = session.statut;
  
  // Check if there's a blocking reason from the message or status
  const blockingMessage = message?.toLowerCase() || "";
  const hasBlockingReason = 
    blockingMessage.includes("annulée") ||
    blockingMessage.includes("terminée") ||
    blockingMessage.includes("en cours") ||
    blockingMessage.includes("pas encore ouvertes") ||
    sessionStatut === "annulee" ||
    sessionStatut === "terminee" ||
    sessionStatut === "en_cours";
  
  // Allow enrollment if:
  // 1. There are available places AND
  // 2. No blocking reason (status or message)
  // This ensures that if places are available, users can enroll even if backend says otherwise
  // (unless there's a clear blocking reason like session cancelled/ended)
  const peutInscrire = placesDisponibles > 0 && !hasBlockingReason;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Pricing Card */}
      {(session.prix_ht || session.prix_ttc) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Tarification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {session.prix_ht && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-foreground/80 font-medium">Prix HT</span>
                  <span className="font-semibold text-foreground">
                    {formatAmountFCFA(session.prix_ht)}
                  </span>
                </div>
              )}
              {session.prix_ttc && (
                <div className="flex justify-between items-center text-lg pt-2 border-t border-border">
                  <span className="text-foreground font-semibold">Prix TTC</span>
                  <span className="text-primary font-bold text-xl">
                    {formatAmountFCFA(session.prix_ttc)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Availability Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Disponibilité
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingAvailability ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-primary mb-2">
                  {placesDisponibles}
                </div>
                <div className="text-sm text-foreground font-semibold">
                  {isFull 
                    ? "Session complète" 
                    : `place${placesDisponibles > 1 ? "s" : ""} disponible${placesDisponibles > 1 ? "s" : ""}`}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {placesReservees > 0 && (
                    <span className="block">
                      {placesReservees} / {placesTotales} places réservées
                    </span>
                  )}
                  {placesReservees === 0 && (
                    <span>sur {placesTotales} places</span>
                  )}
                </div>
              </div>

              {message && (
                <div className="text-sm text-center text-foreground/90 bg-muted p-2 rounded">
                  {message}
                </div>
              )}
              
              {isFull && !message && (
                <div className="text-sm text-center text-foreground/90 bg-muted p-2 rounded">
                  Toutes les places ont été réservées
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                disabled={!peutInscrire}
                onClick={onInscriptionClick}
              >
                {peutInscrire 
                  ? "S'inscrire" 
                  : isFull 
                    ? "Session complète" 
                    : "Inscription non disponible"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Card */}
      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <a
              href="mailto:contact@imhotepdata.com"
              className="text-primary hover:text-primary/80 hover:underline font-semibold"
            >
              contact@imhotepdata.com
            </a>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Phone className="w-4 h-4 text-muted-foreground" />
            <a
              href="tel:+221771234567"
              className="text-primary hover:text-primary/80 hover:underline font-semibold"
            >
              +221 77 123 45 67
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

