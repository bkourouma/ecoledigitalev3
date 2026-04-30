"use client";

import { Badge } from "@ecoledigitale/ui";
import { X, User, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormateurAvailability {
  id: string;
  nom: string;
  prenom: string;
  disponible: boolean;
  conflits?: Array<{
    session_id: string;
    code_session: string;
    formation: string;
    date_debut: string;
    date_fin: string;
  }>;
}

interface SelectedFormateursListProps {
  formateurs: FormateurAvailability[];
  onRemove: (formateurId: string) => void;
  className?: string;
}

export function SelectedFormateursList({
  formateurs,
  onRemove,
  className,
}: SelectedFormateursListProps) {
  const getAvailabilityBadge = (formateur: FormateurAvailability) => {
    if (!formateur.disponible && formateur.conflits && formateur.conflits.length > 0) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Conflit
        </Badge>
      );
    }
    if (formateur.disponible) {
      return (
        <Badge variant="default" className="flex items-center gap-1 bg-green-500">
          <CheckCircle className="w-3 h-3" />
          Disponible
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Indisponible
      </Badge>
    );
  };

  if (formateurs.length === 0) {
    return (
      <div className={cn("text-center py-8 text-gray-500", className)}>
        Aucun formateur sélectionné
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {formateurs.map((formateur) => (
        <div
          key={formateur.id}
          className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate">
                  {formateur.prenom} {formateur.nom}
                </p>
                {getAvailabilityBadge(formateur)}
              </div>
              {formateur.conflits && formateur.conflits.length > 0 && (
                <div className="mt-1 text-xs text-red-600">
                  {formateur.conflits.length} conflit(s) détecté(s)
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => onRemove(formateur.id)}
            className="flex-shrink-0 ml-2 p-1 hover:bg-red-50 rounded-full transition-colors"
            aria-label="Retirer le formateur"
          >
            <X className="w-4 h-4 text-red-500" />
          </button>
        </div>
      ))}
    </div>
  );
}


