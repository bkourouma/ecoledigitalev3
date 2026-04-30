"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@ecoledigitale/ui";
import { CalendarEvent } from "@ecoledigitale/contracts";
import { X, Users, MapPin, Video, Calendar as CalendarIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface SessionDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
}

export function SessionDetailModal({
  open,
  onOpenChange,
  event,
}: SessionDetailModalProps) {
  const router = useRouter();

  if (!event || event.extendedProps?.type !== "session") {
    return null;
  }

  const handleViewFullDetails = () => {
    if (event.id) {
      router.push(`/formateur/sessions/${event.id}/details`);
      onOpenChange(false);
    }
  };

  const extendedProps = event.extendedProps;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl mb-2">{event.title}</DialogTitle>
              <DialogDescription>
                {event.start && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      <span>
                        {format(new Date(event.start), "EEEE d MMMM yyyy", { locale: fr })} -{" "}
                        {event.end && format(new Date(event.end), "d MMMM yyyy", { locale: fr })}
                      </span>
                    </div>
                    {extendedProps?.code_session && (
                      <div>
                        <strong>Code session:</strong> {extendedProps.code_session}
                      </div>
                    )}
                  </div>
                )}
              </DialogDescription>
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

        <div className="space-y-4 mt-4">
          {/* Session Info */}
          <div className="space-y-3">
            {extendedProps?.mode_formation && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Mode:</span>
                <span className="capitalize">{extendedProps.mode_formation}</span>
              </div>
            )}
            {extendedProps?.nb_inscrits !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{extendedProps.nb_inscrits} apprenant(s) inscrit(s)</span>
              </div>
            )}
            {extendedProps?.statut && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Statut:</span>
                <span className="capitalize">{extendedProps.statut}</span>
              </div>
            )}
          </div>

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

