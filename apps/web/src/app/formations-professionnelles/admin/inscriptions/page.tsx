"use client";

import { useState, useMemo } from "react";
import { useAllEnrollments } from "@/lib/hooks/use-inscriptions-pro";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { useSessionsList } from "@/lib/hooks/use-sessions-pro";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Input } from "@ecoledigitale/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Loader2, Search, Download, FileText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { AdminInscriptionCard } from "@/components/inscriptions-pro/AdminInscriptionCard";

export default function AdminInscriptionsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState({
    search: "",
    statut: undefined as 'en_attente' | 'confirmee' | 'annulee' | 'terminee' | undefined,
    session_id: undefined as string | undefined,
    page: 1,
    limit: 20,
  });
  
  const [selectedFormationId, setSelectedFormationId] = useState<string | undefined>(undefined);

  // Fetch formations for filter
  const { data: formationsData } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];

  // Fetch sessions for selected formation
  const sessionsQuery = useMemo(() => {
    if (selectedFormationId) {
      return { formation_id: selectedFormationId, limit: 100 };
    }
    return {};
  }, [selectedFormationId]);
  
  const { data: sessionsData } = useSessionsList(sessionsQuery);
  const sessions = sessionsData?.data?.sessions || [];

  const { data, isLoading, error } = useAllEnrollments(filters);

  const handleSearchChange = (value: string) => {
    setFilters((prev) => ({ ...prev, search: value, page: 1 }));
  };

  const handleStatutChange = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      statut: value === "toutes" ? undefined : (value as any),
      page: 1,
    }));
  };

  const handleFormationChange = (value: string) => {
    setSelectedFormationId(value === "toutes" ? undefined : value);
    setFilters((prev) => ({
      ...prev,
      session_id: undefined, // Reset session when formation changes
      page: 1,
    }));
  };

  const handleSessionChange = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      session_id: value === "toutes" ? undefined : value,
      page: 1,
    }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  const inscriptions = data?.inscriptions || [];
  const pagination = data?.pagination;

  console.log('[AdminInscriptionsPage] Data:', {
    hasData: !!data,
    inscriptionsCount: inscriptions.length,
    firstInscriptionId: inscriptions[0]?.id || null,
    firstInscriptionHasApprenant: !!inscriptions[0]?.apprenant,
    firstInscriptionApprenant: inscriptions[0]?.apprenant ? {
      id: inscriptions[0].apprenant.id,
      nom: inscriptions[0].apprenant.nom,
      prenom: inscriptions[0].apprenant.prenom,
    } : null,
    firstInscriptionKeys: inscriptions[0] ? Object.keys(inscriptions[0]) : [],
    fullFirstInscription: inscriptions[0] ? JSON.stringify(inscriptions[0], null, 2) : null,
    isLoading,
    error,
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin/sessions" },
          { label: "Gestion des Inscriptions" },
        ]}
        className="mb-4 sm:mb-6"
      />

      <div className="space-y-4 sm:space-y-6 w-full min-w-0">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Gestion des Inscriptions</h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-1">
                Gérez toutes les inscriptions aux formations professionnelles
              </p>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => router.push('/formations-professionnelles/admin/inscriptions/creer')}
                size="sm" 
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Créer une inscription</span>
                <span className="sm:hidden">Créer</span>
              </Button>
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Exporter Excel</span>
                <span className="sm:hidden">Exporter</span>
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Rechercher par nom, email, code session..."
                    value={filters.search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-10"
                  />
                </div>
                
                {/* Filters Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Select 
                    value={selectedFormationId || "toutes"} 
                    onValueChange={handleFormationChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Formation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toutes">Toutes les formations</SelectItem>
                      {formations.map((formation) => (
                        <SelectItem key={formation.id} value={formation.id}>
                          {formation.titre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select 
                    value={filters.session_id || "toutes"} 
                    onValueChange={handleSessionChange}
                    disabled={!selectedFormationId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toutes">Toutes les sessions</SelectItem>
                      {sessions.map((session) => (
                        <SelectItem key={session.id} value={session.id}>
                          {session.code_session}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={filters.statut || "toutes"} onValueChange={handleStatutChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Statut" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toutes">Tous les statuts</SelectItem>
                      <SelectItem value="en_attente">En attente</SelectItem>
                      <SelectItem value="confirmee">Confirmée</SelectItem>
                      <SelectItem value="annulee">Annulée</SelectItem>
                      <SelectItem value="terminee">Terminée</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {isLoading ? (
            <Card>
              <CardContent className="py-12">
                <div className="flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span className="ml-3 text-muted-foreground">Chargement des inscriptions...</span>
                </div>
              </CardContent>
            </Card>
          ) : error ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <p className="text-destructive mb-2">Erreur de chargement</p>
                  <p className="text-sm text-muted-foreground">
                    {error instanceof Error ? error.message : "Une erreur est survenue"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : inscriptions.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-semibold mb-2">Aucune inscription trouvée</p>
                  <p className="text-sm text-muted-foreground">
                    {filters.search || filters.statut
                      ? "Aucune inscription ne correspond à vos critères de recherche."
                      : "Il n'y a pas encore d'inscriptions."}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Results count */}
              <div className="text-sm text-muted-foreground">
                {pagination?.total ? (
                  <>
                    {pagination.total} inscription{pagination.total > 1 ? "s" : ""} trouvée
                    {pagination.total > 1 ? "s" : ""}
                  </>
                ) : (
                  "Inscriptions trouvées"
                )}
              </div>

              {/* Inscriptions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {inscriptions
                  .filter((inscription) => {
                    const isValid = inscription && inscription.id;
                    if (!isValid) {
                      console.warn('[AdminInscriptionsPage] Filtered out inscription:', inscription);
                    }
                    return isValid;
                  })
                  .map((inscription) => (
                    <AdminInscriptionCard
                      key={inscription.id}
                      inscription={inscription}
                    />
                  ))}
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {pagination.page} sur {pagination.totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page === 1}
                    >
                      Précédent
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages}
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}

