"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Trash2, Calendar as CalendarIcon } from "lucide-react";
import { useFormateurIndisponibilites, useDeleteIndisponibilite } from "@/lib/hooks/use-formateur-schedule";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export function IndisponibiliteList() {
  const { data, isLoading, error } = useFormateurIndisponibilites();
  const deleteIndispo = useDeleteIndisponibilite();

  const indisponibilites = data?.data?.indisponibilites || [];

  const handleDelete = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette indisponibilité ?")) {
      return;
    }

    try {
      await deleteIndispo.mutateAsync(id);
      toast.success("Indisponibilité supprimée avec succès");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de la suppression"
      );
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-destructive text-sm">
            {error instanceof Error ? error.message : "Erreur lors du chargement"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5" />
          Mes indisponibilités
        </CardTitle>
      </CardHeader>
      <CardContent>
        {indisponibilites.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune indisponibilité enregistrée</p>
        ) : (
          <div className="space-y-3">
            {indisponibilites.map((indispo) => (
              <div
                key={indispo.id}
                className="flex items-start justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">
                      {format(new Date(indispo.date_debut), "d MMM yyyy", { locale: fr })}
                    </span>
                    <span>-</span>
                    <span>
                      {format(new Date(indispo.date_fin), "d MMM yyyy", { locale: fr })}
                    </span>
                  </div>
                  {indispo.raison && (
                    <p className="text-xs text-muted-foreground mt-1">{indispo.raison}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(indispo.id)}
                  disabled={deleteIndispo.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

