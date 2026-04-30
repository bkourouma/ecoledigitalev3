"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { BookOpen, Loader2, Search, Filter } from "lucide-react";
import { useFormateurSessions } from "@/lib/hooks/use-formateur-sessions";
import { SessionListQuerySchema } from "@ecoledigitale/contracts/src/formateurs";
import { z } from "zod";
import { FormateurSessionsFilters } from "@/components/formateur/FormateurSessionsFilters";
import { FormateurSessionsList } from "@/components/formateur/FormateurSessionsList";
import ErrorBoundary from "@/components/ErrorBoundary";

type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

export default function FormateurSessionsPage() {
  const [filters, setFilters] = useState<SessionListQuery>({
    page: 1,
    limit: 20,
  });

  const { data, isLoading, error } = useFormateurSessions(filters);

  const handleFiltersChange = (newFilters: Partial<SessionListQuery>) => {
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
            <span className="ml-3 text-foreground/80">Chargement des sessions...</span>
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
                {error instanceof Error ? error.message : "Erreur lors du chargement des sessions"}
              </p>
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

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-3">
                <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-2xl">Mes Sessions</CardTitle>
                <p className="text-muted-foreground text-sm mt-1">
                  Consultez et gérez toutes vos sessions assignées
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      <ErrorBoundary>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Filters Sidebar */}
          <div className="lg:col-span-1">
            <FormateurSessionsFilters
              filters={filters}
              onFiltersChange={handleFiltersChange}
            />
          </div>

          {/* Sessions List */}
          <div className="lg:col-span-3">
            <FormateurSessionsList
              sessions={sessions}
              pagination={pagination}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}

