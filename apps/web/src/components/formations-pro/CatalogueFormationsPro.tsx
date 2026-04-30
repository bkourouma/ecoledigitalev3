"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { SearchBar } from "./SearchBar";
import { FormationCard } from "./FormationCard";
import { FiltersSidebar } from "./FiltersSidebar";
import { SortDropdown, SortOption } from "./SortDropdown";
import { Pagination } from "./Pagination";
import { useFormations, FormationListQuery } from "@/lib/hooks/use-formations-pro";
import { FormationListItem } from "@ecoledigitale/contracts";
import { Search, AlertCircle, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CatalogueFormationsProProps {
  className?: string;
}

// Skeleton loader for formation cards
function FormationCardSkeleton() {
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
      <h3 className="text-lg font-semibold mb-2">Aucune formation trouvée</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {searchQuery
          ? `Aucune formation ne correspond à votre recherche "${searchQuery}". Essayez avec d'autres mots-clés.`
          : "Aucune formation professionnelle n'est disponible pour le moment."}
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

// Helper function to parse URL params into FormationListQuery
function parseFiltersFromURL(searchParams: URLSearchParams): FormationListQuery {
  const search = searchParams.get("search");
  // T074: Use "pertinence" if search is active, otherwise default to "date_asc"
  const defaultSort = search ? "pertinence" : "date_asc";
  
  const filters: FormationListQuery = {
    page: parseInt(searchParams.get("page") || "1", 10),
    limit: 20,
    sort: (searchParams.get("sort") as any) || defaultSort,
  };

  if (search) filters.search = search;

  const themes = searchParams.get("themes");
  if (themes) filters.themes = themes.split(",").filter(Boolean);

  const dureeMin = searchParams.get("duree_min");
  if (dureeMin) filters.duree_min = parseInt(dureeMin, 10);

  const dureeMax = searchParams.get("duree_max");
  if (dureeMax) filters.duree_max = parseInt(dureeMax, 10);

  const prixMin = searchParams.get("prix_min");
  if (prixMin) filters.prix_min = parseFloat(prixMin);

  const prixMax = searchParams.get("prix_max");
  if (prixMax) filters.prix_max = parseFloat(prixMax);

  const niveau = searchParams.get("niveau");
  if (niveau && ["Débutant", "Intermédiaire", "Avancé"].includes(niveau)) {
    filters.niveau = niveau as any;
  }

  const mode = searchParams.get("mode");
  if (mode) {
    filters.mode = mode.split(",").filter(Boolean) as any;
  }

  const certification = searchParams.get("certification");
  if (certification === "true") filters.certification = true;
  else if (certification === "false") filters.certification = false;

  return filters;
}

// Helper function to build URL params from filters
function buildURLFromFilters(filters: FormationListQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.page && filters.page > 1) params.set("page", filters.page.toString());
  // Always include sort in URL if it's not the default for the current state
  // T074: If search is active, default is "pertinence", otherwise "date_asc"
  const defaultSort = filters.search ? "pertinence" : "date_asc";
  if (filters.sort && filters.sort !== defaultSort) {
    params.set("sort", filters.sort);
  }
  if (filters.themes && filters.themes.length > 0) params.set("themes", filters.themes.join(","));
  if (filters.duree_min !== undefined) params.set("duree_min", filters.duree_min.toString());
  if (filters.duree_max !== undefined) params.set("duree_max", filters.duree_max.toString());
  if (filters.prix_min !== undefined) params.set("prix_min", filters.prix_min.toString());
  if (filters.prix_max !== undefined) params.set("prix_max", filters.prix_max.toString());
  if (filters.niveau) params.set("niveau", filters.niveau);
  if (filters.mode && filters.mode.length > 0) params.set("mode", filters.mode.join(","));
  if (filters.certification !== undefined) params.set("certification", filters.certification.toString());

  return params;
}

// Session storage key for filter state
const FILTER_STORAGE_KEY = "formations-pro-filters";

export function CatalogueFormationsPro({ className }: CatalogueFormationsProProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Track if we're updating from URL to avoid loops
  const isUpdatingFromURL = useRef(false);
  // Track the last URL we set to avoid unnecessary updates
  const lastSetUrl = useRef<string>(searchParams.toString() ? `?${searchParams.toString()}` : "");
  // Track the expected page from our state to prevent reset
  // Initialize from URL params since filters isn't available yet
  const initialPage = parseInt(searchParams.get("page") || "1", 10);
  const expectedPageRef = useRef<number>(initialPage);
  
  // Create a stable string representation of searchParams for comparison
  const searchParamsString = searchParams.toString();
  
  // Initialize filters from URL or session storage
  const [filters, setFilters] = useState<FormationListQuery>(() => {
    // First try URL params
    const urlFilters = parseFiltersFromURL(searchParams);
    
    // If URL has minimal params, try session storage
    if (Object.keys(urlFilters).length <= 2 && typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(FILTER_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Merge with URL params (URL takes precedence)
          return { ...parsed, ...urlFilters };
        }
      } catch (e) {
        console.warn("Failed to parse stored filters", e);
      }
    }
    
    return urlFilters;
  });

  // Local state for search (will be synced to URL via debounce)
  const [searchQuery, setSearchQuery] = useState(filters.search || "");

  // Build query object for API
  const query: FormationListQuery = useMemo(
    () => ({
      ...filters,
      search: searchQuery || undefined,
    }),
    [filters, searchQuery]
  );

  // Fetch formations
  const { data, isLoading, error, refetch } = useFormations(query);

  // Initialize lastSetUrl and expectedPageRef on mount to match current URL
  useEffect(() => {
    const currentUrl = searchParams.toString() ? `?${searchParams.toString()}` : "";
    lastSetUrl.current = currentUrl;
    const urlFilters = parseFiltersFromURL(searchParams);
    expectedPageRef.current = urlFilters.page || 1;
  }, []); // Only run on mount

  // Sync URL when filters or search change (but not when updating from URL)
  useEffect(() => {
    // Skip if we're currently updating from URL to avoid loops
    if (isUpdatingFromURL.current) {
      console.log("[URL Sync] Skipping - isUpdatingFromURL is true");
      return;
    }

    const updatedFilters = { ...filters, search: searchQuery || undefined };
    const params = buildURLFromFilters(updatedFilters);
    const newUrl = params.toString() ? `?${params.toString()}` : "";
    
    console.log("[URL Sync] Filters changed:", {
      currentPage: filters.page,
      newPage: updatedFilters.page,
      newUrl,
      lastSetUrl: lastSetUrl.current,
      expectedPage: expectedPageRef.current,
      isDifferent: newUrl !== lastSetUrl.current
    });
    
    // IMPORTANT: If the page in filters doesn't match expectedPageRef, it means something
    // reset the filters incorrectly. In this case, we should restore the expected page.
    if (updatedFilters.page !== expectedPageRef.current && expectedPageRef.current > 1) {
      console.log("[URL Sync] Page mismatch detected! Restoring expected page:", {
        filtersPage: updatedFilters.page,
        expectedPage: expectedPageRef.current
      });
      // Restore the expected page
      setFilters((prev) => ({ ...prev, page: expectedPageRef.current }));
      return;
    }
    
    // Compare with the last URL we set to avoid unnecessary updates
    if (newUrl !== lastSetUrl.current) {
      console.log("[URL Sync] Updating URL:", {
        from: lastSetUrl.current,
        to: newUrl,
        page: updatedFilters.page
      });
      isUpdatingFromURL.current = true;
      lastSetUrl.current = newUrl; // Update immediately so second useEffect can compare correctly
      expectedPageRef.current = updatedFilters.page || 1; // Track expected page
      router.replace(`/formations-professionnelles/catalogue${newUrl}`, { scroll: false });
      // Reset flag after navigation completes
      // This delay allows searchParams to update and prevents second useEffect from running
      setTimeout(() => {
        console.log("[URL Sync] Resetting isUpdatingFromURL flag");
        isUpdatingFromURL.current = false;
      }, 300);
    } else {
      console.log("[URL Sync] URL unchanged, skipping update");
    }

    // Store complex filter state in session storage
    if (typeof window !== "undefined") {
      try {
        const filterState = { ...updatedFilters };
        // Remove simple params that are always in URL
        delete filterState.search;
        delete filterState.page;
        delete filterState.limit;
        sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterState));
      } catch (e) {
        console.warn("Failed to store filters in session storage", e);
      }
    }
  }, [filters, searchQuery, router]);

  // Sync local state with URL on mount and URL changes (but only when URL actually changes externally)
  useEffect(() => {
    console.log("[URL Change] Effect triggered", {
      isUpdatingFromURL: isUpdatingFromURL.current,
      searchParamsString
    });

    // Skip if we're currently updating URL from state to avoid loops
    if (isUpdatingFromURL.current) {
      console.log("[URL Change] Skipping - isUpdatingFromURL is true");
      return;
    }

    const urlFilters = parseFiltersFromURL(searchParams);
    const urlSearch = urlFilters.search || "";
    const urlPage = urlFilters.page || 1;
    const actualUrl = searchParams.toString() ? `?${searchParams.toString()}` : "";

    console.log("[URL Change] Parsed URL:", {
      urlPage,
      urlSearch,
      actualUrl,
      lastSetUrl: lastSetUrl.current,
      currentFiltersPage: filters.page
    });

    // Skip if this is the URL we just set
    if (actualUrl === lastSetUrl.current) {
      console.log("[URL Change] URL matches lastSetUrl, skipping");
      return;
    }

    // Build what the URL should be from current filters to check if URL matches our state
    const currentStateFilters = { ...filters, search: searchQuery || undefined };
    const expectedParams = buildURLFromFilters(currentStateFilters);
    const expectedUrl = expectedParams.toString() ? `?${expectedParams.toString()}` : "";

    // Normalize URLs for comparison (sort params to handle different orders)
    const normalizeUrl = (url: string) => {
      if (!url || !url.startsWith("?")) return "";
      const params = new URLSearchParams(url.substring(1));
      const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
      return new URLSearchParams(sorted).toString();
    };

    const normalizedActual = normalizeUrl(actualUrl);
    const normalizedExpected = normalizeUrl(expectedUrl);

    console.log("[URL Change] URL comparison:", {
      actualUrl,
      expectedUrl,
      normalizedActual,
      normalizedExpected,
      matches: normalizedActual === normalizedExpected,
      expectedPage: expectedPageRef.current
    });

    // Skip if URL matches what we expect from current state (means we just updated it)
    if (normalizedActual === normalizedExpected) {
      console.log("[URL Change] URL matches expected state, updating lastSetUrl and skipping");
      lastSetUrl.current = actualUrl;
      return;
    }

    // IMPORTANT: Check if the page in URL matches what we expect (we just set it)
    // This prevents resetting the page when we navigate programmatically
    if (urlPage === expectedPageRef.current) {
      console.log("[URL Change] URL page matches expectedPageRef, updating lastSetUrl and skipping");
      lastSetUrl.current = actualUrl;
      return;
    }

    // URL changed externally (browser back/forward, direct navigation, etc.)
    // Use functional updates to access current state without adding to dependencies
    console.log("[URL Change] URL changed externally, updating filters");
    setFilters((prevFilters) => {
      const currentPage = prevFilters.page || 1;
      const currentSearch = searchQuery || "";

      // Check if URL actually changed by comparing key values
      const urlChanged = 
        urlPage !== currentPage || 
        urlSearch !== currentSearch || 
        JSON.stringify(urlFilters.themes || []) !== JSON.stringify(prevFilters.themes || []) ||
        urlFilters.niveau !== prevFilters.niveau ||
        urlFilters.sort !== prevFilters.sort ||
        urlFilters.duree_min !== prevFilters.duree_min ||
        urlFilters.duree_max !== prevFilters.duree_max ||
        urlFilters.prix_min !== prevFilters.prix_min ||
        urlFilters.prix_max !== prevFilters.prix_max ||
        JSON.stringify(urlFilters.mode || []) !== JSON.stringify(prevFilters.mode || []) ||
        urlFilters.certification !== prevFilters.certification;

      console.log("[URL Change] setFilters callback:", {
        currentPage,
        urlPage,
        urlChanged,
        pageChanged: urlPage !== currentPage,
        expectedPage: expectedPageRef.current
      });

      // If the page in URL matches what we expect, don't update filters
      if (urlPage === expectedPageRef.current) {
        console.log("[URL Change] URL page matches expectedPageRef in callback, keeping previous filters");
        return prevFilters;
      }

      if (urlChanged) {
        console.log("[URL Change] Updating filters from URL:", {
          from: { page: currentPage },
          to: { page: urlPage }
        });
        
        // Update search if different
        if (urlSearch !== currentSearch) {
          setSearchQuery(urlSearch);
        }

        // Update lastSetUrl and expectedPageRef to match the new URL
        lastSetUrl.current = actualUrl;
        expectedPageRef.current = urlPage;

        // Merge URL filters with current state, URL takes precedence
        return { ...prevFilters, ...urlFilters, search: urlSearch || prevFilters.search };
      }

      // No change, return previous filters
      console.log("[URL Change] No change detected, keeping previous filters");
      return prevFilters;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsString]);

  const handleFiltersChange = (newFilters: FormationListQuery) => {
    // Check if filters other than page changed
    const filtersChanged = 
      JSON.stringify(newFilters.themes || []) !== JSON.stringify(filters.themes || []) ||
      newFilters.niveau !== filters.niveau ||
      newFilters.duree_min !== filters.duree_min ||
      newFilters.duree_max !== filters.duree_max ||
      newFilters.prix_min !== filters.prix_min ||
      newFilters.prix_max !== filters.prix_max ||
      JSON.stringify(newFilters.mode || []) !== JSON.stringify(filters.mode || []) ||
      newFilters.certification !== filters.certification;

    // Reset to page 1 only if filters (other than page) changed
    if (filtersChanged) {
      setFilters({ ...newFilters, page: 1 });
    } else {
      // If only page changed, keep the new page
      setFilters(newFilters);
    }
    setSearchQuery(newFilters.search || "");
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    // T074: When search changes, update sort to "pertinence" if search is active, otherwise "date_asc"
    const newSort: SortOption = value.trim() ? "pertinence" : "date_asc";
    setFilters((prev) => ({ ...prev, page: 1, sort: newSort }));
  };

  const handleSortChange = (sort: SortOption) => {
    setFilters((prev) => ({ ...prev, sort, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    console.log("[handlePageChange] Called:", {
      newPage: page,
      currentPage: filters.page,
      expectedPageBefore: expectedPageRef.current
    });
    expectedPageRef.current = page; // Track the page we're setting
    setFilters((prev) => {
      console.log("[handlePageChange] setFilters callback:", {
        prevPage: prev.page,
        newPage: page
      });
      return { ...prev, page };
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const formations: FormationListItem[] = data?.data?.formations || [];
  const pagination = data?.data?.pagination;
  const currentPage = filters.page || 1;

  const handleCreateNew = () => {
    router.push("/formations-professionnelles/catalogue/new");
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with Create Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex-1">
          <SearchBar value={searchQuery} onChange={handleSearchChange} />
        </div>
        <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 whitespace-nowrap"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle formation
        </Button>
      </div>

      {/* Filters Section - Top */}
      <FiltersSidebar filters={filters} onFiltersChange={handleFiltersChange} />

      {/* Sort and Results Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        {/* Results count */}
        {!isLoading && !error && formations.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {pagination?.total ? (
              <>
                {pagination.total} formation{pagination.total > 1 ? "s" : ""} trouvée
                {pagination.total > 1 ? "s" : ""}
                {searchQuery && ` pour "${searchQuery}"`}
              </>
            ) : (
              "Formations trouvées"
            )}
          </div>
        )}
        {/* Sort Dropdown */}
        {!isLoading && !error && (
          <SortDropdown
            value={filters.sort || "date_asc"}
            onChange={handleSortChange}
          />
        )}
      </div>

      {/* Results Section */}

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <FormationCardSkeleton key={index} />
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
          {formations.length > 0 ? (
            <>
              {/* Formation Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {formations.map((formation) => (
                  <FormationCard key={formation.id} formation={formation} />
                ))}
              </div>

              {/* Pagination */}
              {pagination && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  limit={pagination.limit || 20}
                  onPageChange={handlePageChange}
                />
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

