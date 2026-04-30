"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { useRecommendationHistory } from "@/lib/rso/recommandations";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { History, User, Clock, CheckCircle, Edit, MessageSquare, Award, XCircle } from "lucide-react";
import { Loader2 } from "lucide-react";

interface RecommendationHistoryProps {
  recommendationId: number;
}

const actionLabels: Record<string, string> = {
  creation: "Création",
  modification: "Modification",
  changement_statut: "Changement de statut",
  commentaire: "Commentaire",
  validation: "Validation",
  cloture: "Clôture",
};

const actionIcons: Record<string, any> = {
  creation: History,
  modification: Edit,
  changement_statut: CheckCircle,
  commentaire: MessageSquare,
  validation: Award,
  cloture: XCircle,
};

export function RecommendationHistory({ recommendationId }: RecommendationHistoryProps) {
  const { data, isLoading, error } = useRecommendationHistory(recommendationId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historique
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historique
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Erreur lors du chargement de l'historique
          </p>
        </CardContent>
      </Card>
    );
  }

  const history = data?.history || [];

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historique
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aucun historique disponible pour cette recommandation
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Historique ({history.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {history.map((entry) => {
            const ActionIcon = actionIcons[entry.action] || History;
            return (
              <div
                key={entry.id}
                className="flex gap-4 pb-4 border-b last:border-b-0 last:pb-0"
              >
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <ActionIcon className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">
                          {actionLabels[entry.action] || entry.action}
                        </span>
                        {entry.user && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {entry.user.prenoms} {entry.user.nom}
                          </span>
                        )}
                      </div>
                      {entry.ancienStatut && entry.nouveauStatut && (
                        <div className="text-sm text-muted-foreground mb-1">
                          Statut: <span className="line-through">{entry.ancienStatut}</span> →{" "}
                          <span className="font-medium">{entry.nouveauStatut}</span>
                        </div>
                      )}
                      {entry.commentaire && (
                        <p className="text-sm text-muted-foreground mb-1">{entry.commentaire}</p>
                      )}
                      {entry.donneesModifiees && Object.keys(entry.donneesModifiees).length > 0 && (
                        <div className="text-xs text-muted-foreground mt-2 space-y-1">
                          {Object.entries(entry.donneesModifiees).map(([key, change]: [string, any]) => (
                            <div key={key}>
                              <span className="font-medium">{key}:</span>{" "}
                              <span className="line-through">{String(change.old || "N/A")}</span> →{" "}
                              <span className="font-medium">{String(change.new || "N/A")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(entry.createdAt), "dd MMM yyyy à HH:mm", { locale: fr })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}









