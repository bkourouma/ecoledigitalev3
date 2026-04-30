"use client";

import { useState, useEffect } from "react";
import { AdminSessionsHeader } from "@/components/sessions-pro/AdminSessionsHeader";
import { AdminSessionsFilters } from "@/components/sessions-pro/AdminSessionsFilters";
import { AdminSessionsList } from "@/components/sessions-pro/AdminSessionsList";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useAdminSessionsList } from "@/lib/hooks/use-sessions-pro";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { AdminSessionListQuerySchema } from "@ecoledigitale/contracts/src/sessions-pro/admin.schema";
import { z } from "zod";

type AdminSessionListQuery = z.infer<typeof AdminSessionListQuerySchema>;

export default function AdminSessionsPage() {
  const [filters, setFilters] = useState<AdminSessionListQuery>({
    page: 1,
    limit: 20,
  });
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [currentSort, setCurrentSort] = useState<"date_asc" | "date_desc" | "prix_asc" | "prix_desc">("date_asc");

  const { data, isLoading, error } = useAdminSessionsList({
    ...filters,
    sort: currentSort,
  });

  // Debug: Log first session to see structure (moved to useEffect to avoid setState during render)
  // Must be called before any conditional returns to follow Rules of Hooks
  useEffect(() => {
    if (data?.data?.sessions && data.data.sessions.length > 0) {
      console.log('🔍 [AdminSessionsPage] First session:', {
        id: data.data.sessions[0].id,
        code_session: data.data.sessions[0].code_session,
        formation: data.data.sessions[0].formation,
        formationType: typeof data.data.sessions[0].formation,
        formationKeys: data.data.sessions[0].formation ? Object.keys(data.data.sessions[0].formation) : null,
        formationTitre: data.data.sessions[0].formation?.titre,
        fullSession: data.data.sessions[0],
      });
    }
  }, [data]);

  const handleFiltersChange = (newFilters: {
    search?: string;
    formation_id?: string;
    statut?: string[];
    mode?: string[];
    date_debut?: string;
    date_fin?: string;
  }) => {
    setFilters((prev) => ({
      ...prev,
      ...newFilters,
      page: 1, // Reset to first page when filters change
    }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  const handlePageSizeChange = (size: number) => {
    setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
  };

  const handleSortChange = (sort: "date_asc" | "date_desc" | "prix_asc" | "prix_desc") => {
    setCurrentSort(sort);
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const handleExport = () => {
    // TODO: Implement export functionality (T072, T073)
    console.log("Export sessions", selectedSessions.length > 0 ? selectedSessions : "all");
  };

  const handleBulkStatusChange = () => {
    // TODO: Implement bulk status change
    console.log("Change status for sessions:", selectedSessions);
  };

  const handleBulkDelete = () => {
    // TODO: Implement bulk delete with confirmation
    console.log("Delete sessions:", selectedSessions);
  };

  if (isLoading && !data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement des sessions...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : "Une erreur inattendue s'est produite";
    const isAuthError = errorMessage.toLowerCase().includes("authentication") || 
                       errorMessage.toLowerCase().includes("authentification") ||
                       errorMessage.toLowerCase().includes("required");
    
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-2">
                {isAuthError ? "Authentification requise" : "Erreur lors du chargement"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                {errorMessage}
              </p>
              {isAuthError && (
                <p className="text-xs text-muted-foreground">
                  Veuillez vous connecter pour accéder à cette page.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sessions = data?.data?.sessions || [];
  const pagination = data?.data?.pagination || {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  };
  const statistics = data?.data?.statistics || {
    sessions_actives: 0,
    sessions_ce_mois: 0,
    taux_remplissage: 0,
    ca_previsionnel: 0,
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Breadcrumb
          items={[
            { label: "Administration", href: "/formations-professionnelles/admin/sessions" },
            { label: "Gestion des Sessions" },
          ]}
          className="mb-4 sm:mb-6"
        />
        <div className="space-y-4 sm:space-y-6 w-full min-w-0">
        {/* Header with stats */}
        <AdminSessionsHeader
          statistics={statistics}
          onExport={handleExport}
        />

        {/* Filters */}
        <AdminSessionsFilters
          filters={{
            search: filters.search,
            formation_id: filters.formation_id,
            statut: filters.statut,
            mode: filters.mode,
            date_debut: filters.date_debut,
            date_fin: filters.date_fin,
          }}
          onFiltersChange={handleFiltersChange}
        />

        {/* Sessions List */}
        <AdminSessionsList
          sessions={sessions}
          pagination={pagination}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onSortChange={handleSortChange}
          currentSort={currentSort}
          selectedSessions={selectedSessions}
          onSelectionChange={setSelectedSessions}
          onExport={handleExport}
          onBulkStatusChange={handleBulkStatusChange}
          onBulkDelete={handleBulkDelete}
        />
        </div>
    </div>
  );
}
