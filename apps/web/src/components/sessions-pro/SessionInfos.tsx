"use client";

import { SessionDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Globe,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface SessionInfosProps {
  session: SessionDetail;
  className?: string;
}

const modeLabels: Record<string, string> = {
  presentiel: "Présentiel",
  distanciel: "Distanciel",
  hybride: "Hybride",
};

export function SessionInfos({ session, className }: SessionInfosProps) {
  const dateDebut = new Date(session.date_debut);
  const dateFin = new Date(session.date_fin);

  return (
    <Card className={cn("mb-6", className)}>
      <CardHeader>
        <CardTitle>Informations de la session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dates */}
        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div>
            <div className="font-semibold text-foreground mb-1">Dates</div>
            <div className="text-foreground/90">
              Du {format(dateDebut, "d MMMM yyyy", { locale: fr })} au{" "}
              {format(dateFin, "d MMMM yyyy", { locale: fr })}
            </div>
          </div>
        </div>

        {/* Horaires */}
        {session.horaires && (
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <div className="font-semibold text-foreground mb-1">Horaires</div>
              <div className="text-foreground/90">{session.horaires}</div>
            </div>
          </div>
        )}

        {/* Mode */}
        <div className="flex items-start gap-3">
          <Globe className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div>
            <div className="font-semibold text-foreground mb-1">Mode de formation</div>
            <div className="text-foreground/90">
              {modeLabels[session.mode_formation] || session.mode_formation}
            </div>
          </div>
        </div>

        {/* Lieu (si présentiel) */}
        {session.mode_formation === "presentiel" && session.lieu && (
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-foreground mb-1">Lieu</div>
              <div className="text-foreground/90">{session.lieu}</div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(session.lieu)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 hover:underline text-sm mt-1 inline-flex items-center gap-1"
              >
                Voir sur la carte
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Lien visio (si distanciel ou hybride) */}
        {(session.mode_formation === "distanciel" ||
          session.mode_formation === "hybride") &&
          session.lien_visio && (
            <div className="flex items-start gap-3">
              <Video className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-foreground mb-1">
                  Lien de visioconférence
                </div>
                <a
                  href={session.lien_visio}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 hover:underline text-sm break-all inline-flex items-center gap-1"
                >
                  {session.lien_visio}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

