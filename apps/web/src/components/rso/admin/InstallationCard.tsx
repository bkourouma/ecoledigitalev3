"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@ecoledigitale/ui";
import { RSOInstallation } from "@/lib/rso/installations";
import { Building2, MapPin, Calendar, Edit, Trash2, Eye } from "lucide-react";
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

interface InstallationCardProps {
  installation: RSOInstallation;
  onEdit: (installation: RSOInstallation) => void;
  onDelete?: (installation: RSOInstallation) => void;
  onView?: (installation: RSOInstallation) => void;
  className?: string;
}

export function InstallationCard({ installation, onEdit, onDelete, onView, className }: InstallationCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (onDelete) {
      onDelete(installation);
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

  return (
    <>
      <Card className={`hover:shadow-lg transition-all duration-200 h-full flex flex-col ${className || ""}`} role="article" aria-labelledby={`installation-name-${installation.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 flex-1 min-w-0">
              <CardTitle className="text-lg line-clamp-1" id={`installation-name-${installation.id}`}>
                {installation.nom}
              </CardTitle>
              <CardDescription className="text-sm line-clamp-1" aria-label={`Code: ${installation.code}`}>
                {installation.code}
              </CardDescription>
            </div>
            <Badge className="bg-blue-100 text-blue-800 border-blue-200 shrink-0" aria-label="Installation">
              <Building2 className="h-3 w-3 mr-1" />
              Installation
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 flex-1 flex flex-col">
          {/* Location Info */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {installation.ville}, {installation.pays}
              </span>
            </div>
          </div>

          {/* Dates */}
          <div className="mt-auto pt-3 border-t space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Créée le: {formatDate(installation.createdAt)}</span>
            </div>
            {installation.updatedAt !== installation.createdAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">Modifiée le: {formatDate(installation.updatedAt)}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-3 border-t justify-end" role="toolbar" aria-label="Actions installation">
            {onView && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onView(installation)}
                title="Voir les détails"
                aria-label={`Voir les détails de ${installation.nom}`}
              >
                <Eye className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(installation)}
              title="Modifier"
              aria-label={`Modifier ${installation.nom}`}
            >
              <Edit className="w-4 h-4" aria-hidden="true" />
            </Button>
            {onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                title="Supprimer"
                aria-label={`Supprimer ${installation.nom}`}
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
            <AlertDialogTitle>Supprimer l'installation</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer l'installation "{installation.nom}" ({installation.code}) ?
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

