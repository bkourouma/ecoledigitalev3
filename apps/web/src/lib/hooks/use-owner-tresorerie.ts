"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type {
  OwnerCashRegisterResponse,
  OwnerTresorerieResponse,
} from "@ecoledigitale/contracts";

export type TresorerieFilters = {
  dateDebut?: string;
  dateFin?: string;
  granularity?: "day" | "week" | "month";
  filiereIds?: string[];
};

export function buildTresorerieQuery(f: TresorerieFilters): string {
  const p = new URLSearchParams();
  if (f.dateDebut) p.set("dateDebut", f.dateDebut);
  if (f.dateFin) p.set("dateFin", f.dateFin);
  if (f.granularity) p.set("granularity", f.granularity);
  if (f.filiereIds?.length) p.set("filiereIds", f.filiereIds.join(","));
  return p.toString();
}

export function useOwnerTresorerie(filters: TresorerieFilters) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildTresorerieQuery(filters);

  return useQuery<OwnerTresorerieResponse>({
    queryKey: ["owner-tresorerie", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/tresorerie${qs ? `?${qs}` : ""}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Chargement impossible");
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    // Le bloc de filtres ne doit pas disparaître pendant qu'on change un filtre :
    // on garde l'ancien résultat à l'écran jusqu'à l'arrivée du nouveau.
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

export type CashRegisterFilters = TresorerieFilters & {
  mode?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export function buildCashRegisterQuery(f: CashRegisterFilters): string {
  const p = new URLSearchParams();
  if (f.dateDebut) p.set("dateDebut", f.dateDebut);
  if (f.dateFin) p.set("dateFin", f.dateFin);
  if (f.mode) p.set("mode", f.mode);
  if (f.search) p.set("search", f.search);
  if (f.page) p.set("page", String(f.page));
  if (f.pageSize) p.set("pageSize", String(f.pageSize));
  return p.toString();
}

export function useOwnerCashRegister(filters: CashRegisterFilters) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildCashRegisterQuery(filters);

  return useQuery<OwnerCashRegisterResponse>({
    queryKey: ["owner-cash-register", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/tresorerie/journal${qs ? `?${qs}` : ""}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Chargement impossible");
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}
