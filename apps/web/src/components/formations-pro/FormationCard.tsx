"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@ecoledigitale/ui";
import { FormationListItem } from "@ecoledigitale/contracts";
import { Clock, DollarSign, Award, Calendar, MapPin, Eye, Edit, Trash2, FileText } from "lucide-react";
import { formatAmountFCFA } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useDeleteFormation } from "@/lib/hooks/use-formations-pro";
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
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { usesSessionBasedProfessionalCatalogue } from "@/lib/pro-tenants";

interface FormationCardProps {
  formation: FormationListItem;
  className?: string;
}

const niveauConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  Débutant: { label: "Débutant", variant: "outline" },
  Intermédiaire: { label: "Intermédiaire", variant: "secondary" },
  Avancé: { label: "Avancé", variant: "default" },
};

const modeConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  presentiel: { label: "Présentiel", icon: <MapPin className="h-3 w-3" /> },
  distanciel: { label: "Distanciel", icon: <Calendar className="h-3 w-3" /> },
  hybride: { label: "Hybride", icon: <Calendar className="h-3 w-3" /> },
};

export function FormationCard({ formation, className }: FormationCardProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId;
  const sessionBasedCatalogue = usesSessionBasedProfessionalCatalogue(tenantId);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const deleteFormationMutation = useDeleteFormation();

  const handleClick = () => {
    router.push(`/formations-professionnelles/catalogue/${formation.slug}`);
  };

  const handleView = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/formations-professionnelles/catalogue/${formation.slug}`);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Use slug for edit page since we need to fetch the formation first
    router.push(`/formations-professionnelles/catalogue/${formation.slug}/edit`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    try {
      await deleteFormationMutation.mutateAsync(formation.id);
      toast.success("Formation supprimée avec succès");
      setShowDeleteDialog(false);
    } catch (error: any) {
      setShowDeleteDialog(false);
      
      // Extract error message from response - prioritize readable message from backend
      let message = "Erreur lors de la suppression de la formation";
      
      // Backend returns error in error.data.message (from the hook)
      if (error.data?.message) {
        message = error.data.message;
      } else if (error.message && !error.message.includes('FORMATION_HAS_ACTIVE_SESSIONS') && !error.message.includes('FORMATION_HAS_ENROLLMENTS')) {
        // If message exists and is not just an error code, use it
        message = error.message;
      } else if (error.message) {
        // Fallback to error.message
        message = error.message;
      } else if (typeof error === 'string') {
        message = error;
      }
      
      // Check if it's a specific error that should be shown in a dialog
      const isFormationError = 
          error.data?.error === 'FORMATION_HAS_ACTIVE_SESSIONS' ||
          error.data?.error === 'FORMATION_HAS_ENROLLMENTS' ||
          error.error === 'FORMATION_HAS_ACTIVE_SESSIONS' ||
          error.error === 'FORMATION_HAS_ENROLLMENTS' ||
          error.message?.includes('FORMATION_HAS_ACTIVE_SESSIONS') || 
          error.message?.includes('FORMATION_HAS_ENROLLMENTS');
      
      if (isFormationError) {
        // If message is just the error code, use a user-friendly message
        if (message === 'FORMATION_HAS_ACTIVE_SESSIONS' || message.includes('FORMATION_HAS_ACTIVE_SESSIONS') && !message.includes('Impossible')) {
          message = "Impossible de supprimer cette formation car elle possède des sessions actives. Veuillez d'abord annuler ou terminer toutes les sessions associées avant de supprimer la formation.";
        } else if (message === 'FORMATION_HAS_ENROLLMENTS' || (message.includes('FORMATION_HAS_ENROLLMENTS') && !message.includes('Impossible'))) {
          message = "Impossible de supprimer cette formation car elle possède des inscriptions en cours. Veuillez d'abord traiter toutes les inscriptions avant de supprimer la formation.";
        }
        setErrorMessage(message);
        setShowErrorDialog(true);
      } else {
        toast.error(message);
      }
    }
  };

  const formatDuration = () => {
    if (formation.duree_jours && formation.duree_heures) {
      return `${formation.duree_jours} jours / ${formation.duree_heures}h`;
    } else if (formation.duree_jours) {
      return `${formation.duree_jours} jours`;
    } else if (formation.duree_heures) {
      return `${formation.duree_heures} heures`;
    }
    return "Non spécifié";
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) {
      return "Date non disponible";
    }
    
    const date = new Date(dateString);
    
    // Vérifier si la date est valide
    if (isNaN(date.getTime())) {
      return "Date invalide";
    }
    
    return date.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const niveauInfo = formation.niveau ? niveauConfig[formation.niveau] : null;
  const prochaineSession = formation.prochaine_session;
  const modeInfo = prochaineSession?.mode_formation
    ? modeConfig[prochaineSession.mode_formation]
    : null;

  return (
    <Card
      className={cn(
        "hover:shadow-lg transition-all duration-200 cursor-pointer h-full flex flex-col",
        className
      )}
      onClick={(e) => {
        // Don't navigate if clicking on action buttons or their container
        const target = e.target as HTMLElement;
        const isActionButton = target.closest('[data-action-buttons]') || 
                               target.closest('button') ||
                               target.closest('[role="button"]:not([aria-label*="Voir les détails"])');
        if (!isActionButton) {
          handleClick();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Voir les détails de la formation ${formation.titre}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-lg line-clamp-2">{formation.titre}</CardTitle>
            {formation.description_courte && (
              <CardDescription className="text-sm line-clamp-2">
                {formation.description_courte}
              </CardDescription>
            )}
          </div>
          {niveauInfo && (
            <Badge variant={niveauInfo.variant} className="shrink-0">
              {niveauInfo.label}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex-1 flex flex-col">
        {/* Themes */}
        {formation.themes && formation.themes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {formation.themes.slice(0, 3).map((theme, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {theme}
              </Badge>
            ))}
            {formation.themes.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{formation.themes.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Duration and Price */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate" aria-label={`Durée: ${formatDuration()}`}>
              {formatDuration()}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-foreground" aria-label={`Prix: ${formatAmountFCFA(formation.prix_ttc)}`}>
              {formatAmountFCFA(formation.prix_ttc)}
            </span>
          </div>
        </div>

        {/* Certification */}
        {formation.type_certification && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Award className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate" aria-label={`Certification: ${formation.type_certification}`}>
              {formation.type_certification}
            </span>
          </div>
        )}

        {/* ASPCI : prochaine session ; catalogue formation (Imhotep, etc.) : message inscription */}
        {sessionBasedCatalogue ? (
          <>
            {prochaineSession && (
              <div className="mt-auto pt-3 border-t space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Prochaine session :</span>
                  <span className="font-medium text-foreground">
                    {formatDate(prochaineSession.date_debut)}
                  </span>
                </div>
                {modeInfo && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {modeInfo.icon}
                    <span>{modeInfo.label}</span>
                  </div>
                )}
              </div>
            )}
            {!prochaineSession && (
              <div className="mt-auto pt-3 border-t">
                <p className="text-xs text-muted-foreground italic">
                  Aucune session planifiée pour le moment
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="mt-auto pt-3 border-t space-y-2">
            {formation.catalogue_support ? (
              <div className="flex items-start gap-2 text-xs">
                <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="text-foreground">
                    <span className="text-muted-foreground">Titre :</span>{" "}
                    <span className="font-medium break-words">{formation.catalogue_support.titre}</span>
                  </p>
                  <p className="text-foreground">
                    <span className="text-muted-foreground">Type :</span>{" "}
                    <span className="font-medium">{formation.catalogue_support.type_fichier}</span>
                  </p>
                </div>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Inscription sur la formation au tarif affiché. Ouvrez la fiche (icône œil) pour le détail et
              l&apos;inscription.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div 
          className="flex gap-2 pt-3 border-t"
          data-action-buttons
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-background hover:bg-accent text-foreground border-border hover:border-accent-foreground transition-all duration-200"
            onClick={handleView}
            aria-label={`Voir les détails de ${formation.titre}`}
            title="Voir les détails"
          >
            <Eye className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-background hover:bg-accent text-foreground border-border hover:border-accent-foreground transition-all duration-200"
            onClick={handleEdit}
            aria-label={`Modifier la formation ${formation.titre}`}
            title="Modifier"
          >
            <Edit className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-background hover:bg-destructive hover:text-destructive-foreground text-foreground border-border hover:border-destructive transition-all duration-200"
            onClick={handleDelete}
            aria-label={`Supprimer la formation ${formation.titre}`}
            title="Supprimer"
            disabled={deleteFormationMutation.isPending}
            type="button"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la formation</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer la formation "{formation.titre}" ? 
              Cette action est irréversible. La formation sera désactivée et ne sera plus visible dans le catalogue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFormationMutation.isPending}
            >
              {deleteFormationMutation.isPending ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error Dialog */}
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Impossible de supprimer la formation</AlertDialogTitle>
            <AlertDialogDescription>
              {errorMessage || "Une erreur est survenue lors de la tentative de suppression."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowErrorDialog(false)}>
              Compris
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

