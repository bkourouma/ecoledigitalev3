"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@ecoledigitale/ui";
import { RSOActivity } from "@/lib/rso/activities";
import { Calendar, Edit, Trash2, Eye, Building2, Tag } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ActivityCardProps {
  activity: RSOActivity;
  onEdit: (activity: RSOActivity) => void;
  onDelete?: (activity: RSOActivity) => void;
  onView?: (activity: RSOActivity) => void;
  installationName?: string;
  className?: string;
}

const statusLabels: Record<string, string> = {
  planifie: "Planifié",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

const statusColors: Record<string, string> = {
  planifie: "bg-gray-100 text-gray-800 border-gray-200",
  en_cours: "bg-blue-100 text-blue-800 border-blue-200",
  termine: "bg-green-100 text-green-800 border-green-200",
  annule: "bg-red-100 text-red-800 border-red-200",
};

export function ActivityCard({ activity, onEdit, onDelete, onView, installationName, className }: ActivityCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (onDelete) {
      onDelete(activity);
    }
    setShowDeleteDialog(false);
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "PPp", { locale: fr });
    } catch {
      return "Date invalide";
    }
  };

  const formatDateShort = (dateString: string) => {
    try {
      return format(new Date(dateString), "dd MMM yyyy", { locale: fr });
    } catch {
      return "Date invalide";
    }
  };

  return (
    <>
      <Card className={`hover:shadow-lg transition-all duration-200 h-full flex flex-col ${className || ""}`} role="article" aria-labelledby={`activity-title-${activity.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 flex-1 min-w-0">
              <CardTitle className="text-lg line-clamp-2" id={`activity-title-${activity.id}`}>
                {activity.titre}
              </CardTitle>
              <CardDescription className="text-sm line-clamp-1" aria-label={`Type: ${activity.type}`}>
                <Tag className="h-3 w-3 inline mr-1" />
                {activity.type}
              </CardDescription>
            </div>
            <Badge className={`${statusColors[activity.statut] || "bg-gray-100 text-gray-800"} shrink-0`} aria-label={`Statut: ${statusLabels[activity.statut] || activity.statut}`}>
              {statusLabels[activity.statut] || activity.statut}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 flex-1 flex flex-col">
          {/* Activity Info */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{formatDateShort(activity.dateActivite)}</span>
            </div>
            {installationName && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{installationName}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {activity.description && (
            <p className="text-sm text-muted-foreground line-clamp-3">
              {activity.description}
            </p>
          )}

          {/* Dates */}
          <div className="mt-auto pt-3 border-t space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Créée le: {formatDate(activity.createdAt)}</span>
            </div>
            {activity.updatedAt !== activity.createdAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">Modifiée le: {formatDate(activity.updatedAt)}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-3 border-t justify-end" role="toolbar" aria-label="Actions activité">
            {onView && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onView(activity)}
                title="Voir les détails"
                aria-label={`Voir les détails de ${activity.titre}`}
              >
                <Eye className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(activity)}
              title="Modifier"
              aria-label={`Modifier ${activity.titre}`}
            >
              <Edit className="w-4 h-4" aria-hidden="true" />
            </Button>
            {onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                title="Supprimer"
                aria-label={`Supprimer ${activity.titre}`}
                className="text-red-600 hover:text-red-700 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'activité</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer l'activité "{activity.titre}" ?
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

