"use client";

import { CalendarEvent } from "@ecoledigitale/contracts/src/sessions-pro";
import { MapPin, Users, Video, Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@ecoledigitale/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface SessionEventCardProps {
  event: CalendarEvent;
  view: string;
  onClick?: () => void;
  className?: string;
}

const modeLabels: Record<string, string> = {
  presentiel: "Présentiel",
  distanciel: "Distanciel",
  hybride: "Hybride",
};

const statutLabels: Record<string, string> = {
  planifiee: "Planifiée",
  ouverte: "Ouverte",
  complete: "Complète",
  en_cours: "En cours",
  terminee: "Terminée",
};

const statutColors: Record<string, string> = {
  planifiee: "bg-gray-100 text-gray-700",
  ouverte: "bg-green-100 text-green-700",
  complete: "bg-red-100 text-red-700",
  en_cours: "bg-blue-100 text-blue-700",
  terminee: "bg-gray-100 text-gray-700",
};

export function SessionEventCard({
  event,
  view,
  onClick,
  className,
}: SessionEventCardProps) {
  const { extendedProps } = event;
  const isCompact = view === "dayGridMonth" || view === "listWeek";

  // Format time from event start
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return format(date, "HH:mm", { locale: fr });
    } catch {
      return "";
    }
  };

  // Build tooltip content for title attribute
  const buildTooltipText = () => {
    const parts: string[] = [event.title];
    if (extendedProps.code_session) {
      parts.push(`Code: ${extendedProps.code_session}`);
    }
    if (event.start) {
      parts.push(`Début: ${format(new Date(event.start), "d MMMM yyyy 'à' HH:mm", { locale: fr })}`);
    }
    if (event.end) {
      parts.push(`Fin: ${format(new Date(event.end), "d MMMM yyyy 'à' HH:mm", { locale: fr })}`);
    }
    if (extendedProps.mode) {
      parts.push(`Mode: ${modeLabels[extendedProps.mode] || extendedProps.mode}`);
    }
    if (extendedProps.lieu) {
      parts.push(`Lieu: ${extendedProps.lieu}`);
    }
    if (extendedProps.places_disponibles !== undefined) {
      parts.push(`${extendedProps.places_disponibles} places disponibles`);
    }
    return parts.join("\n");
  };

  if (isCompact) {
    // Compact view for month/list
    return (
      <div
        className={cn(
          "flex flex-col gap-1 p-1 rounded text-xs",
          onClick && "cursor-pointer hover:opacity-80",
          className
        )}
        onClick={onClick}
        title={buildTooltipText()}
        style={{
          backgroundColor: event.backgroundColor,
          borderColor: event.borderColor,
          borderWidth: "2px",
          borderStyle: "solid",
        }}
      >
        <div className="font-semibold truncate">{event.title}</div>
        {event.start && (
          <div className="flex items-center gap-1 text-xs opacity-90">
            <Clock className="w-3 h-3" />
            <span>{formatTime(event.start)}</span>
            {event.end && (
              <>
                <span>-</span>
                <span>{formatTime(event.end)}</span>
              </>
            )}
          </div>
        )}
        {extendedProps.code_session && (
          <div className="text-xs opacity-75">{extendedProps.code_session}</div>
        )}
        {extendedProps.places_disponibles !== undefined && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{extendedProps.places_disponibles} places</span>
          </div>
        )}
      </div>
    );
  }

  // Detailed view for week/day
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-2 rounded-lg",
        onClick && "cursor-pointer hover:opacity-90",
        className
      )}
      onClick={onClick}
      style={{
        backgroundColor: event.backgroundColor,
        borderColor: event.borderColor,
        borderWidth: "2px",
        borderStyle: "solid",
      }}
    >
      <div className="font-semibold text-sm">{event.title}</div>
      {extendedProps.code_session && (
        <div className="text-xs opacity-75">{extendedProps.code_session}</div>
      )}
      <div className="flex flex-wrap gap-1">
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            statutColors[extendedProps.statut] || statutColors.planifiee
          )}
        >
          {statutLabels[extendedProps.statut] || extendedProps.statut}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {modeLabels[extendedProps.mode] || extendedProps.mode}
        </Badge>
      </div>
      {extendedProps.lieu && (
        <div className="flex items-center gap-1 text-xs">
          <MapPin className="w-3 h-3" />
          <span className="truncate">{extendedProps.lieu}</span>
        </div>
      )}
      {extendedProps.mode !== "presentiel" && (
        <div className="flex items-center gap-1 text-xs">
          <Video className="w-3 h-3" />
          <span>Visio</span>
        </div>
      )}
      {extendedProps.formateurs && (
        <div className="text-xs opacity-75 truncate">
          {extendedProps.formateurs}
        </div>
      )}
      {extendedProps.places_disponibles !== undefined && (
        <div className="flex items-center gap-1 text-xs">
          <Users className="w-3 h-3" />
          <span>{extendedProps.places_disponibles} places disponibles</span>
        </div>
      )}
    </div>
  );
}

