"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input } from "@ecoledigitale/ui";
import { Plus, Loader2, Filter } from "lucide-react";
import { useRecommendations, useDeleteRecommendation } from "@/lib/rso/recommandations";
import { RecommendationCard } from "./RecommendationCard";
import { RecommendationForm } from "./RecommendationForm";
import type { RSORecommendation, RecommendationStatus, RecommendationPriority } from "@ecoledigitale/contracts/rso/recommandations/recommandation.contracts";

interface RecommendationListProps {
  activiteId?: number;
  installationId?: number;
  showCreateButton?: boolean;
  onRecommendationClick?: (recommendation: RSORecommendation) => void;
}

export function RecommendationList({
  activiteId,
  installationId,
  showCreateButton = true,
  onRecommendationClick,
}: RecommendationListProps) {
  const [filters, setFilters] = useState<{
    statut?: RecommendationStatus;
    priorite?: RecommendationPriority;
    enRetard?: boolean;
    page?: number;
  }>({ page: 1 });
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingRecommendation, setEditingRecommendation] = useState<RSORecommendation | null>(null);

  const { data, isLoading, error } = useRecommendations({
    activiteId,
    installationId,
    ...filters,
    limit: 20,
  });

  const deleteMutation = useDeleteRecommendation();

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
    } catch (error: any) {
      alert(error.message || "Erreur lors de la suppression");
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-red-600">Erreur: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtres
            </CardTitle>
            {showCreateButton && activiteId && installationId && (
              <Button onClick={() => setCreateModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Nouvelle Recommandation
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Statut</label>
              <Select
                value={filters.statut || "all"}
                onValueChange={(value) =>
                  setFilters({ ...filters, statut: value === "all" ? undefined : (value as RecommendationStatus) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="en_attente">En attente</SelectItem>
                  <SelectItem value="en_cours">En cours</SelectItem>
                  <SelectItem value="terminee">Terminée</SelectItem>
                  <SelectItem value="validee">Validée</SelectItem>
                  <SelectItem value="annulee">Annulée</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Priorité</label>
              <Select
                value={filters.priorite || "all"}
                onValueChange={(value) =>
                  setFilters({ ...filters, priorite: value === "all" ? undefined : (value as RecommendationPriority) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les priorités</SelectItem>
                  <SelectItem value="basse">Basse</SelectItem>
                  <SelectItem value="moyenne">Moyenne</SelectItem>
                  <SelectItem value="haute">Haute</SelectItem>
                  <SelectItem value="critique">Critique</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.enRetard || false}
                  onChange={(e) => setFilters({ ...filters, enRetard: e.target.checked || undefined })}
                  className="rounded"
                />
                <span className="text-sm">En retard uniquement</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : data && data.recommandations.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.recommandations.map((recommendation) => (
            <RecommendationCard
              key={recommendation.id}
              recommendation={recommendation}
              onEdit={setEditingRecommendation}
              onDelete={handleDelete}
              showActions={showCreateButton}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Aucune recommandation trouvée
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {data && data.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.pagination.page} sur {data.pagination.totalPages} ({data.pagination.total} recommandations)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.pagination.page === 1}
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {activiteId && installationId && (
        <>
          <RecommendationForm
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            activiteId={activiteId}
            installationId={installationId}
            onSuccess={() => {
              setCreateModalOpen(false);
            }}
          />
          <RecommendationForm
            open={!!editingRecommendation}
            onClose={() => setEditingRecommendation(null)}
            activiteId={activiteId}
            installationId={installationId}
            recommendation={editingRecommendation}
            onSuccess={() => {
              setEditingRecommendation(null);
            }}
          />
        </>
      )}
    </div>
  );
}

