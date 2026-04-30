"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@ecoledigitale/ui";
import { SessionListItem } from "@ecoledigitale/contracts";
import { Calendar, MapPin, Users, DollarSign, Clock, Eye } from "lucide-react";
import { formatAmountFCFA } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface SessionCardProps {
  session: SessionListItem;
  className?: string;
}

const modeConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  presentiel: { label: "Présentiel", variant: "default" },
  distanciel: { label: "Distanciel", variant: "secondary" },
  hybride: { label: "Hybride", variant: "outline" },
};

const statutConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  planifiee: { label: "Planifiée", variant: "outline" },
  ouverte: { label: "Ouverte", variant: "default" },
  complete: { label: "Complète", variant: "destructive" },
  en_cours: { label: "En cours", variant: "default" },
  terminee: { label: "Terminée", variant: "secondary" },
  annulee: { label: "Annulée", variant: "destructive" },
};

export function SessionCard({ session, className }: SessionCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/formations-professionnelles/sessions/${session.id}`);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/formations-professionnelles/sessions/${session.id}`);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) {
      return "Date non disponible";
    }
    
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return "Date invalide";
    }
    
    return format(date, "d MMM yyyy", { locale: fr });
  };

  const formatDateRange = () => {
    if (!session.date_debut || !session.date_fin) {
      return "Dates non disponibles";
    }
    
    const dateDebut = new Date(session.date_debut);
    const dateFin = new Date(session.date_fin);
    
    if (isNaN(dateDebut.getTime()) || isNaN(dateFin.getTime())) {
      return "Dates invalides";
    }
    
    const debutFormatted = format(dateDebut, "d MMM", { locale: fr });
    const finFormatted = format(dateFin, "d MMM yyyy", { locale: fr });
    
    return `${debutFormatted} au ${finFormatted}`;
  };

  const modeInfo = session.mode_formation ? modeConfig[session.mode_formation] : null;
  const statutInfo = session.statut ? statutConfig[session.statut] : null;
  const placesDisponibles = session.places_disponibles ?? 0;
  const placesReservees = session.places_reservees ?? 0;
  const placesTotales = session.places_totales ?? 0;
  const tauxRemplissage = placesTotales > 0 ? Math.round((placesReservees / placesTotales) * 100) : 0;

  return (
    <Card
      className={cn(
        "hover:shadow-lg transition-all duration-200 cursor-pointer h-full flex flex-col",
        className
      )}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Voir les détails de la session ${session.code_session}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-lg line-clamp-2">
              {session.formation?.titre || "Formation non spécifiée"}
            </CardTitle>
            <CardDescription className="text-sm font-mono">
              {session.code_session}
            </CardDescription>
          </div>
          {statutInfo && (
            <Badge variant={statutInfo.variant} className="shrink-0">
              {statutInfo.label}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex-1 flex flex-col">
        {/* Dates */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate" aria-label={`Dates: ${formatDateRange()}`}>
            {formatDateRange()}
          </span>
        </div>

        {/* Horaires */}
        {session.horaires && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate" aria-label={`Horaires: ${session.horaires}`}>
              {session.horaires}
            </span>
          </div>
        )}

        {/* Mode et Lieu */}
        <div className="flex items-center gap-2 text-sm">
          {modeInfo && (
            <Badge variant={modeInfo.variant} className="text-xs">
              {modeInfo.label}
            </Badge>
          )}
          {session.lieu && (
            <div className="flex items-center gap-1 text-muted-foreground truncate">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate text-xs">{session.lieu}</span>
            </div>
          )}
        </div>

        {/* Formateurs */}
        {session.formateurs && session.formateurs.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate" aria-label={`Formateurs: ${session.formateurs.map(f => `${f.prenom} ${f.nom}`).join(", ")}`}>
              {session.formateurs.map(f => `${f.prenom} ${f.nom}`).join(", ")}
            </span>
          </div>
        )}

        {/* Places et Prix */}
        <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">Places</div>
              <div className="font-semibold text-foreground">
                {placesReservees} / {placesTotales}
              </div>
              {placesTotales > 0 && (
                <div className="text-xs text-muted-foreground">
                  {tauxRemplissage}% rempli
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">Prix</div>
              <div className="font-semibold text-foreground" aria-label={`Prix: ${formatAmountFCFA(session.prix_ttc || 0)}`}>
                {session.prix_ttc ? formatAmountFCFA(session.prix_ttc) : "Non spécifié"}
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full bg-background hover:bg-accent text-foreground border-border hover:border-accent-foreground transition-all duration-200"
            onClick={handleView}
            aria-label={`Voir les détails de ${session.code_session}`}
            title="Voir les détails"
          >
            <Eye className="w-4 h-4 mr-2" aria-hidden="true" />
            Voir les détails
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

