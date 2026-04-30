"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@ecoledigitale/ui";
import { X, BarChart3, Download, Calendar } from "lucide-react";
import { useFormateurSupportDetail } from "@/lib/hooks/use-formateur-supports";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface MaterialStatsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supportId: string | null;
}

export function MaterialStatsModal({
  open,
  onOpenChange,
  supportId,
}: MaterialStatsModalProps) {
  const { data, isLoading, error } = useFormateurSupportDetail(supportId);

  if (!supportId) {
    return null;
  }

  const statistics = data?.data?.statistiques;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Statistiques de Téléchargement
              </DialogTitle>
              <DialogDescription className="mt-2">
                {data?.data?.support?.titre}
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

        <div className="mt-4 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive">
                {error instanceof Error ? error.message : "Erreur lors du chargement"}
              </p>
            </div>
          ) : statistics ? (
            <>
              {/* Overall Statistics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Download className="h-4 w-4" />
                    <span className="text-sm">Total téléchargements</span>
                  </div>
                  <p className="text-2xl font-bold">{statistics.nb_telechargements}</p>
                </div>
                {statistics.dernier_telechargement && (
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">Dernier téléchargement</span>
                    </div>
                    <p className="text-sm font-medium">
                      {format(new Date(statistics.dernier_telechargement), "d MMM yyyy à HH:mm", { locale: fr })}
                    </p>
                  </div>
                )}
              </div>

              {/* Downloads by Session */}
              {statistics.telechargements_par_session && statistics.telechargements_par_session.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Téléchargements par session</h4>
                  <div className="space-y-2">
                    {statistics.telechargements_par_session.map((stat: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <span className="text-sm font-medium">{stat.session_code}</span>
                        <span className="text-sm text-muted-foreground">
                          {stat.nb_telechargements} téléchargement(s)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {statistics.nb_telechargements === 0 && (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Aucun téléchargement pour le moment</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

