"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { UploadCloud, Loader2, Plus } from "lucide-react";
import { useFormateurSupports } from "@/lib/hooks/use-formateur-supports";
import { SupportsListQuerySchema } from "@ecoledigitale/contracts/src/formateurs";
import { z } from "zod";
import { FormateurSupportsFilters } from "@/components/formateur/FormateurSupportsFilters";
import { FormateurSupportsList } from "@/components/formateur/FormateurSupportsList";
import { UploadSupportModal } from "@/components/formateur/UploadSupportModal";
import ErrorBoundary from "@/components/ErrorBoundary";

type SupportsListQuery = z.infer<typeof SupportsListQuerySchema>;

export default function FormateurSupportsPage() {
  const [filters, setFilters] = useState<SupportsListQuery>({
    page: 1,
    limit: 20,
  });
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const { data, isLoading, error } = useFormateurSupports(filters);

  const handleFiltersChange = (newFilters: Partial<SupportsListQuery>) => {
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

  if (isLoading && !data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement des supports...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-4">
                {error instanceof Error ? error.message : "Erreur lors du chargement des supports"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const supports = data?.data?.supports || [];
  const pagination = data?.data?.pagination || {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-3">
                  <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Mes Supports de Cours</CardTitle>
                  <p className="text-muted-foreground text-sm mt-1">
                    Gérez vos supports de cours et suivez les téléchargements
                  </p>
                </div>
              </div>
              <button
                onClick={() => setUploadModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Ajouter un support
              </button>
            </div>
          </CardHeader>
        </Card>
      </div>

      <ErrorBoundary>
        <div className="space-y-6">
          {/* Filters Top */}
          <FormateurSupportsFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />

          {/* Supports List */}
          <FormateurSupportsList
            supports={supports}
            pagination={pagination}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      </ErrorBoundary>

      {/* Upload Modal */}
      <UploadSupportModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
      />
    </div>
  );
}
