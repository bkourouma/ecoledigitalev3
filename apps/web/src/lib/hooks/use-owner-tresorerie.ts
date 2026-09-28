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
  /**
   * Périmètre — même contrat que le reste de l'espace propriétaire.
   *
   * Le type ne portait que la filière, et l'écran Impayés devait donc dégrader
   * la classe en filière avant d'appeler ce hook. Les quatre dimensions
   * voyagent désormais jusqu'au service.
   */
  anneeScolaire?: string;
  /** Clé « filiereId|nom » de l'ouverture de classe. */
  nomClasse?: string;
  semestreId?: string;
};

export function buildTresorerieQuery(f: TresorerieFilters): string {
  const p = new URLSearchParams();
  if (f.dateDebut) p.set("dateDebut", f.dateDebut);
  if (f.dateFin) p.set("dateFin", f.dateFin);
  if (f.granularity) p.set("granularity", f.granularity);
  if (f.filiereIds?.length) p.set("filiereIds", f.filiereIds.join(","));
  if (f.anneeScolaire) p.set("anneeScolaire", f.anneeScolaire);
  // URLSearchParams encode la barre verticale de la clé de classe : la
  // construire à la main la laisserait telle quelle et l'API ne la retrouverait
  // pas.
  if (f.nomClasse) p.set("nomClasse", f.nomClasse);
  if (f.semestreId) p.set("semestreId", f.semestreId);
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
  /*
     LE PÉRIMÈTRE, QUI NE VOYAGEAIT PAS DU TOUT.

     Ce constructeur ne transmettait ni la filière ni rien d'autre : le journal
     de caisse listait TOUS les encaissements de l'établissement quel que soit
     le filtre affiché au-dessus de lui. Son total ne se rapprochait donc
     d'aucun chiffre de la page — pour une pièce comptable, c'est rédhibitoire.
  */
  if (f.filiereIds?.length) p.set("filiereIds", f.filiereIds.join(","));
  if (f.anneeScolaire) p.set("anneeScolaire", f.anneeScolaire);
  if (f.nomClasse) p.set("nomClasse", f.nomClasse);
  if (f.semestreId) p.set("semestreId", f.semestreId);
  if (f.mode) p.set("mode", f.mode);
  if (f.search) p.set("search", f.search);
  if (f.page) p.set("page", String(f.page));
  if (f.pageSize) p.set("pageSize", String(f.pageSize));
  return p.toString();
}

/**
 * Le journal ENTIER du périmètre, pour le rapport imprimé.
 *
 * L'écran pagine à 25 lignes ; un PDF qui s'arrêterait là serait une pièce
 * comptable tronquée, c'est-à-dire pire qu'une pièce absente. Mais précharger
 * l'intégralité à chaque visite coûterait cher pour un bouton parfois jamais
 * pressé : cette fonction n'est appelée qu'au clic.
 *
 * Le plafond est celui que le schéma Zod de l'endpoint accepte : 500 lignes,
 * pas une de plus — au-delà la requête serait rejetée en 400 et le bouton
 * échouerait sans rien dire. Quand le journal dépasse ce plafond, le rapport le
 * DIT au lieu de laisser croire qu'il est complet : d'où le drapeau renvoyé.
 */
export async function fetchCashRegisterPourRapport(
  session: unknown,
  filters: CashRegisterFilters
): Promise<{ rows: OwnerCashRegisterResponse["rows"]; totalCount: number; complet: boolean }> {
  const PLAFOND = 500;
  const qs = buildCashRegisterQuery({ ...filters, page: 1, pageSize: PLAFOND });
  const res = await fetch(`/api/v1/owner/tresorerie/journal?${qs}`, {
    headers: createApiHeaders(session as never),
  });
  if (!res.ok) throw new Error("Journal de caisse indisponible");
  const data = (await res.json()) as OwnerCashRegisterResponse;
  return {
    rows: data.rows,
    totalCount: data.totalCount,
    complet: data.rows.length >= data.totalCount,
  };
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
