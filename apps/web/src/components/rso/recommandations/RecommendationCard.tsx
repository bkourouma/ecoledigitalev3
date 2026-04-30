"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Alert, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@ecoledigitale/ui";
import { Calendar, User, AlertCircle, CheckCircle, Clock, XCircle, History } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useState } from "react";
import type { RSORecommendation, RecommendationStatus, RecommendationPriority } from "@ecoledigitale/contracts/rso/recommandations/recommandation.contracts";
import { RecommendationHistory } from "./RecommendationHistory";

interface RecommendationCardProps {
  recommendation: RSORecommendation;
  onEdit?: (recommendation: RSORecommendation) => void;
  onDelete?: (id: number) => void;
  showActions?: boolean;
}

const statusConfig: Record<RecommendationStatus, { label: string; color: string; icon: any }> = {
  en_attente: { label: "En attente", color: "bg-gray-100 text-gray-800", icon: Clock },
  en_cours: { label: "En cours", color: "bg-blue-100 text-blue-800", icon: AlertCircle },
  terminee: { label: "Terminée", color: "bg-green-100 text-green-800", icon: CheckCircle },
  validee: { label: "Validée", color: "bg-purple-100 text-purple-800", icon: CheckCircle },
  annulee: { label: "Annulée", color: "bg-red-100 text-red-800", icon: XCircle },
};

const priorityConfig: Record<RecommendationPriority, { label: string; color: string }> = {
  basse: { label: "Basse", color: "bg-gray-100 text-gray-800" },
  moyenne: { label: "Moyenne", color: "bg-yellow-100 text-yellow-800" },
  haute: { label: "Haute", color: "bg-orange-100 text-orange-800" },
  critique: { label: "Critique", color: "bg-red-100 text-red-800" },
};

export function RecommendationCard({
  recommendation,
  onEdit,
  onDelete,
  showActions = true,
}: RecommendationCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const StatusIcon = statusConfig[recommendation.statut].icon;
  const isOverdue =
    recommendation.dateEcheance &&
    new Date(recommendation.dateEcheance) < new Date() &&
    (recommendation.statut === "en_attente" || recommendation.statut === "en_cours");

  const daysOverdue = isOverdue && recommendation.dateEcheance
    ? Math.floor((new Date().getTime() - new Date(recommendation.dateEcheance).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <Card className={isOverdue ? "border-red-300 border-2" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{recommendation.titre}</CardTitle>
          <div className="flex gap-2">
            <Badge className={statusConfig[recommendation.statut].color}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusConfig[recommendation.statut].label}
            </Badge>
            <Badge className={priorityConfig[recommendation.priorite].color}>
              {priorityConfig[recommendation.priorite].label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-3">{recommendation.description}</p>

        <div className="flex flex-wrap gap-4 text-sm">
          {recommendation.dateEcheance && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Échéance: {format(new Date(recommendation.dateEcheance), "dd MMM yyyy", { locale: fr })}
              </span>
            </div>
          )}

          {recommendation.responsable && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <User className="h-4 w-4" />
              <span>
                {recommendation.responsable.prenoms} {recommendation.responsable.nom}
              </span>
            </div>
          )}
        </div>

        {isOverdue && (
          <Alert variant="destructive" className="mt-2">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">
              En retard de {daysOverdue} jour{daysOverdue > 1 ? "s" : ""}
            </span>
          </Alert>
        )}

        {recommendation.statut === "terminee" && recommendation.actionsPrises && (
          <div className="mt-3 p-3 bg-green-50 rounded-md">
            <p className="text-sm font-medium text-green-900 mb-1">Actions prises:</p>
            <p className="text-sm text-green-800">{recommendation.actionsPrises}</p>
            {recommendation.dateResolution && (
              <p className="text-xs text-green-700 mt-2">
                Résolu le: {format(new Date(recommendation.dateResolution), "dd MMM yyyy", { locale: fr })}
              </p>
            )}
          </div>
        )}

        {showActions && (onEdit || onDelete) && (
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Dialog open={showHistory} onOpenChange={setShowHistory}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <History className="h-4 w-4 mr-1" />
                  Historique
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Historique de la recommandation</DialogTitle>
                </DialogHeader>
                <RecommendationHistory recommendationId={recommendation.id} />
              </DialogContent>
            </Dialog>
            {onEdit && (
              <Button variant="outline" size="sm" onClick={() => onEdit(recommendation)}>
                Modifier
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm("Êtes-vous sûr de vouloir supprimer cette recommandation ?")) {
                    onDelete(recommendation.id);
                  }
                }}
              >
                Supprimer
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

