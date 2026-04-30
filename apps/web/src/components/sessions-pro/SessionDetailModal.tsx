"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@ecoledigitale/ui";
import { CalendarEvent } from "@ecoledigitale/contracts";
import { SessionInfos } from "./SessionInfos";
import { SessionFormateurs } from "./SessionFormateurs";
import { SessionStatusBanner } from "./SessionStatusBanner";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface SessionDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  session?: any; // SessionDetail if available
}

export function SessionDetailModal({
  open,
  onOpenChange,
  event,
  session,
}: SessionDetailModalProps) {
  const router = useRouter();

  if (!event) {
    return null;
  }

  const handleViewFullDetails = () => {
    if (event.extendedProps?.sessionId) {
      router.push(`/formations-professionnelles/sessions/${event.extendedProps.sessionId}`);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl mb-2">{event.title}</DialogTitle>
              {event.start && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>
                    <strong>Date de début:</strong>{" "}
                    {format(new Date(event.start), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                  </div>
                  {event.end && (
                    <div>
                      <strong>Date de fin:</strong>{" "}
                      {format(new Date(event.end), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                    </div>
                  )}
                  {event.extendedProps?.code_session && (
                    <div>
                      <strong>Code session:</strong> {event.extendedProps.code_session}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Status Banner */}
          {event.extendedProps?.statut && (
            <SessionStatusBanner statut={event.extendedProps.statut} />
          )}

          {/* Session Info */}
          {session ? (
            <>
              <SessionInfos session={session} />
              <SessionFormateurs session={session} />
            </>
          ) : (
            <div className="space-y-4">
              {event.extendedProps?.mode_formation && (
                <div>
                  <strong>Mode:</strong> {event.extendedProps.mode_formation}
                </div>
              )}
              {event.extendedProps?.lieu && (
                <div>
                  <strong>Lieu:</strong> {event.extendedProps.lieu}
                </div>
              )}
              {event.extendedProps?.places_disponibles !== undefined && (
                <div>
                  <strong>Places disponibles:</strong> {event.extendedProps.places_disponibles}
                </div>
              )}
              {event.extendedProps?.prix_ttc && (
                <div>
                  <strong>Prix TTC:</strong> {event.extendedProps.prix_ttc.toLocaleString("fr-FR")} FCFA
                </div>
              )}
            </div>
          )}

          {/* Action Button */}
          {event.id && (
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleViewFullDetails}>
                Voir les détails complets
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

