/**
 * AdminEntreprises Component
 * 
 * Main component for enterprise management with filters, sorting, and enterprise grid/list
 */

"use client";

import { useState } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Card, CardContent } from "@ecoledigitale/ui";
import { Plus, Download, Grid, List } from "lucide-react";
import { EntrepriseCard } from "./EntrepriseCard";
import { EntrepriseFormModal } from "./EntrepriseFormModal";
import { useEntreprisesList, exportEntreprisesToExcel } from "@/lib/hooks/use-entreprises";
import { Loader2 } from "lucide-react";
import { EntrepriseWithStats } from "@ecoledigitale/contracts/src/entreprises";

export function AdminEntreprises() {
  const [search, setSearch] = useState("");
  const [secteur, setSecteur] = useState<string | undefined>(undefined);
  const [actif, setActif] = useState<boolean | undefined>(undefined);
  const [sort, setSort] = useState<"nb_inscriptions" | "ca_total" | "raison_sociale">("ca_total");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingEnterprise, setEditingEnterprise] = useState<EntrepriseWithStats | null>(null);

  const { data, isLoading, error } = useEntreprisesList({
    search: search || undefined,
    secteur: secteur || undefined,
    actif,
    sort,
    page,
    limit: 12,
  });

  const handleCreate = () => {
    setEditingEnterprise(null);
    setFormModalOpen(true);
  };

  const handleEdit = (enterprise: EntrepriseWithStats) => {
    setEditingEnterprise(enterprise);
    setFormModalOpen(true);
  };

  const handleExport = async () => {
    try {
      await exportEntreprisesToExcel();
    } catch (error) {
      // Error already handled in the hook
    }
  };

  if (isLoading && !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement des entreprises...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <p className="text-destructive mb-2">Erreur lors du chargement</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Une erreur inattendue s'est produite"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestion des Entreprises</h1>
          <p className="text-muted-foreground mt-1">
            Gérez vos clients entreprises B2B
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Ajouter une entreprise
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <Input
          placeholder="Rechercher par raison sociale, SIRET, email..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
        <Select value={secteur || "all"} onValueChange={(value) => {
          setSecteur(value === "all" ? undefined : value);
          setPage(1);
        }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Secteur" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les secteurs</SelectItem>
            <SelectItem value="Technologie">Technologie</SelectItem>
            <SelectItem value="Finance">Finance</SelectItem>
            <SelectItem value="Santé">Santé</SelectItem>
            <SelectItem value="Éducation">Éducation</SelectItem>
            <SelectItem value="Autre">Autre</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actif === undefined ? "all" : actif ? "true" : "false"} onValueChange={(value) => {
          setActif(value === "all" ? undefined : value === "true");
          setPage(1);
        }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="true">Actif</SelectItem>
            <SelectItem value="false">Inactif</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => {
          setSort(value as typeof sort);
          setPage(1);
        }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Trier par" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ca_total">CA Total</SelectItem>
            <SelectItem value="nb_inscriptions">Nb inscriptions</SelectItem>
            <SelectItem value="raison_sociale">Raison sociale</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2 ml-auto">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Enterprise grid/list */}
      {data && (
        <>
          {data.entreprises.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <p className="text-muted-foreground">Aucune entreprise trouvée</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-4"}>
              {data.entreprises.map((enterprise) => (
                <EntrepriseCard
                  key={enterprise.id}
                  enterprise={enterprise}
                  onEdit={handleEdit}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {data.page} sur {data.totalPages} ({data.total} entreprises)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= data.totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Form Modal */}
      <EntrepriseFormModal
        open={formModalOpen}
        onOpenChange={setFormModalOpen}
        enterprise={editingEnterprise}
      />
    </div>
  );
}

