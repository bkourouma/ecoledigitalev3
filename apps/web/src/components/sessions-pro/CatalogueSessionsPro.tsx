"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { SearchBar } from "@/components/formations-pro/SearchBar";
import { SessionCard } from "./SessionCard";
import { SessionsFilters } from "./SessionsFilters";
import { useSessionsList } from "@/lib/hooks/use-sessions-pro";
import { SessionListItem, SessionListQuery } from "@ecoledigitale/contracts";
import { Search, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CatalogueSessionsProProps {
  className?: string;
}

// Skeleton loader for session cards
function SessionCardSkeleton() {
  return (
    <Card className="h-full">
      <CardContent className="p-6 space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="flex gap-4 pt-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

// Empty state component
function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Search className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Aucune session trouvée</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {searchQuery
          ? `Aucune session ne correspond à votre recherche "${searchQuery}". Essayez avec d'autres mots-clés.`
          : "Aucune session de formation n'est disponible pour le moment."}
      </p>
    </div>
  );
}

// Error state component
function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Erreur de chargement</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">{error.message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}

// Helper function to parse URL params into SessionListQuery
function parseFiltersFromURL(searchParams: URLSearchParams): SessionListQuery {
  const search = searchParams.get("search");
  
  const filters: SessionListQuery = {
    page: parseInt(searchParams.get("page") || "1", 10),
    limit: parseInt(searchParams.get("limit") || "12", 10),
  };

  if (search) filters.search = search;

  const formation_id = searchParams.get("formation_id");
  if (formation_id) filters.formation_id = formation_id;

  const mode = searchParams.get("mode");
  if (mode) {
    filters.mode = mode.split(",").filter(Boolean) as any;
  }

  const statut = searchParams.get("statut");
  if (statut) {
    filters.statut = statut.split(",").filter(Boolean) as any;
  }

  const date_debut = searchParams.get("date_debut");
  if (date_debut) filters.date_debut = date_debut;

  const date_fin = searchParams.get("date_fin");
  if (date_fin) filters.date_fin = date_fin;

  return filters;
}

// Helper function to build URL params from filters
function buildURLFromFilters(filters: SessionListQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.page && filters.page > 1) params.set("page", filters.page.toString());
  if (filters.limit && filters.limit !== 12) params.set("limit", filters.limit.toString());
  if (filters.formation_id) params.set("formation_id", filters.formation_id);
  if (filters.mode && filters.mode.length > 0) params.set("mode", filters.mode.join(","));
  if (filters.statut && filters.statut.length > 0) params.set("statut", filters.statut.join(","));
  if (filters.date_debut) params.set("date_debut", filters.date_debut);
  if (filters.date_fin) params.set("date_fin", filters.date_fin);

  return params;
}

export function CatalogueSessionsPro({ className }: CatalogueSessionsProProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Initialize filters from URL
  const [filters, setFilters] = useState<SessionListQuery>(() => {
    return parseFiltersFromURL(searchParams);
  });

  // Local state for search (will be synced to URL via debounce)
  const [searchQuery, setSearchQuery] = useState(filters.search || "");

  // Build query object for API
  const query: SessionListQuery = useMemo(
    () => ({
      ...filters,
      search: searchQuery || undefined,
    }),
    [filters, searchQuery]
  );

  // Fetch sessions
  const { data, isLoading, error, refetch } = useSessionsList(query);

  // Sync URL when filters or search change
  useEffect(() => {
    const updatedFilters = { ...filters, search: searchQuery || undefined };
    const params = buildURLFromFilters(updatedFilters);
    const newUrl = params.toString() ? `?${params.toString()}` : "";
    const currentUrl = searchParams.toString() ? `?${searchParams.toString()}` : "";

    if (newUrl !== currentUrl) {
      router.replace(`/formations-professionnelles/sessions${newUrl}`, { scroll: false });
    }
  }, [filters, searchQuery, router, searchParams]);

  // Sync local state with URL on mount and URL changes
  useEffect(() => {
    const urlFilters = parseFiltersFromURL(searchParams);
    const urlSearch = urlFilters.search || "";

    if (urlSearch !== searchQuery) {
      setSearchQuery(urlSearch);
    }

    // Update filters if URL changed (but preserve search from local state)
    setFilters((prev) => {
      const updated = { ...urlFilters, search: prev.search || urlFilters.search };
      return updated;
    });
  }, [searchParams]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFiltersChange = (newFilters: Partial<SessionListQuery>) => {
    setFilters((prev) => ({
      ...prev,
      ...newFilters,
    }));
  };

  const sessions: SessionListItem[] = data?.data?.sessions || [];
  const pagination = data?.data?.pagination;
  const currentPage = filters.page || 1;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex-1 w-full">
          <SearchBar 
            value={searchQuery} 
            onChange={handleSearchChange}
            placeholder="Rechercher par code session ou formation..."
          />
        </div>
      </div>

      {/* Filters */}
      <SessionsFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      {/* Results count */}
      {!isLoading && !error && sessions.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {pagination?.total ? (
            <>
              {pagination.total} session{pagination.total > 1 ? "s" : ""} trouvée
              {pagination.total > 1 ? "s" : ""}
              {searchQuery && ` pour "${searchQuery}"`}
            </>
          ) : (
            "Sessions trouvées"
          )}
        </div>
      )}

      {/* Results Section */}
      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <SessionCardSkeleton key={index} />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      )}

      {/* Results */}
      {!isLoading && !error && (
        <>
          {sessions.length > 0 ? (
            <>
              {/* Sessions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sessions.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>

              {/* Pagination */}
              {pagination && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6">
                  <div className="text-sm text-muted-foreground">
                    Affichage de {(currentPage - 1) * (pagination.limit || 12) + 1} à {Math.min(currentPage * (pagination.limit || 12), pagination.total)} sur {pagination.total} session{pagination.total > 1 ? "s" : ""}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      aria-label="Page précédente"
                    >
                      Précédent
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {currentPage} sur {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= pagination.totalPages}
                      aria-label="Page suivante"
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <EmptyState searchQuery={searchQuery} />
          )}
        </>
      )}
    </div>
  );
}

