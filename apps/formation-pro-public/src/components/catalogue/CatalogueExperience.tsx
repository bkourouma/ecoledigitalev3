"use client";

import { startTransition, useDeferredValue, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogueResponse } from "@/types/formation";
import { CatalogueGrid } from "@/components/catalogue/CatalogueGrid";
import { FiltersSidebar, type CatalogueFilterState } from "@/components/catalogue/FiltersSidebar";
import { SearchBar } from "@/components/catalogue/SearchBar";
import { useFormations } from "@/hooks/useFormations";
import { Button } from "@/components/ui/button";

type InitialFilters = {
  search?: string;
  categorie?: string;
  niveau?: string;
  mode?: string;
  prixMin?: number;
  prixMax?: number;
  page?: number;
  pageSize?: number;
};

export function CatalogueExperience({
  initialFilters,
  initialData,
}: {
  initialFilters: InitialFilters;
  initialData: CatalogueResponse;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(initialFilters.search || "");
  const [filters, setFilters] = useState<CatalogueFilterState>({
    categorie: initialFilters.categorie || "",
    niveau: initialFilters.niveau || "",
    mode: initialFilters.mode || "",
    prixMin: initialFilters.prixMin ? String(initialFilters.prixMin) : "",
    prixMax: initialFilters.prixMax ? String(initialFilters.prixMax) : "",
  });
  const deferredSearch = useDeferredValue(search);
  const page = Number(searchParams.get("page") || initialFilters.page || 1);

  const query = useMemo(
    () => ({
      search: deferredSearch || undefined,
      categorie: filters.categorie || undefined,
      niveau: filters.niveau || undefined,
      mode: filters.mode || undefined,
      prixMin: filters.prixMin ? Number(filters.prixMin) : undefined,
      prixMax: filters.prixMax ? Number(filters.prixMax) : undefined,
      page,
      pageSize: initialFilters.pageSize || 9,
    }),
    [deferredSearch, filters, initialFilters.pageSize, page]
  );

  const { data, isFetching } = useFormations(query, initialData);

  function syncUrl(nextPage = 1) {
    const params = new URLSearchParams();

    if (search.trim()) params.set("search", search.trim());
    if (filters.categorie) params.set("categorie", filters.categorie);
    if (filters.niveau) params.set("niveau", filters.niveau);
    if (filters.mode) params.set("mode", filters.mode);
    if (filters.prixMin) params.set("prixMin", filters.prixMin);
    if (filters.prixMax) params.set("prixMax", filters.prixMax);
    if (nextPage > 1) params.set("page", String(nextPage));

    startTransition(() => {
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }

  function updateFilter(key: keyof CatalogueFilterState, value: string) {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }

  function handleSearch(value: string) {
    setSearch(value);
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("search", value.trim());
      } else {
        params.delete("search");
      }
      params.delete("page");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }

  function resetFilters() {
    setSearch("");
    setFilters({
      categorie: "",
      niveau: "",
      mode: "",
      prixMin: "",
      prixMax: "",
    });
    startTransition(() => router.replace(pathname));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
      <FiltersSidebar filters={filters} onChange={updateFilter} onReset={resetFilters} />

      <section className="space-y-5">
        <div className="rounded-[1.75rem] border border-border/70 bg-white/80 p-5 shadow-soft">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
            <SearchBar value={search} onChange={handleSearch} />
            <div className="flex items-center justify-between gap-3 rounded-[1.25rem] bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span>{data?.pagination.total || 0} formations</span>
              <span>{isFetching ? "Mise à jour..." : "Résultats synchronisés"}</span>
            </div>
          </div>
        </div>

        <CatalogueGrid formations={data?.data || []} loading={isFetching && !data} />

        <div className="flex items-center justify-between rounded-[1.5rem] border border-border/70 bg-white/80 p-4 shadow-soft">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => syncUrl(page - 1)}
          >
            Précédent
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data?.pagination.page || 1} / {data?.pagination.totalPages || 1}
          </span>
          <Button
            variant="outline"
            disabled={page >= (data?.pagination.totalPages || 1)}
            onClick={() => syncUrl(page + 1)}
          >
            Suivant
          </Button>
        </div>
      </section>
    </div>
  );
}
