"use client";

import { useQuery } from "@tanstack/react-query";
import type { CatalogueResponse } from "@/types/formation";

export interface UseFormationsFilters {
  search?: string;
  categorie?: string;
  niveau?: string;
  mode?: string;
  prixMin?: number;
  prixMax?: number;
  page?: number;
  pageSize?: number;
}

function toSearchParams(filters: UseFormationsFilters) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });

  return params.toString();
}

export function useFormations(
  filters: UseFormationsFilters,
  initialData?: CatalogueResponse
) {
  return useQuery<CatalogueResponse>({
    queryKey: ["catalogue-formations", filters],
    queryFn: async () => {
      const response = await fetch(`/api/formations?${toSearchParams(filters)}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Impossible de charger le catalogue.");
      }

      return response.json();
    },
    initialData,
  });
}
