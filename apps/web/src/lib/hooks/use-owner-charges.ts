"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type {
  OwnerCharge,
  OwnerChargeCreateInput,
  OwnerChargePatchBody,
  OwnerChargesResponse,
} from "@ecoledigitale/contracts";

/**
 * Charges de l'établissement — lecture et saisie.
 *
 * SEUL HOOK DE L'ESPACE PROPRIÉTAIRE QUI ÉCRIVE. La raison est que les charges
 * n'ont aucun autre écran dans l'application : sans cette saisie, la Rentabilité
 * ne peut afficher qu'un chiffre d'affaires et refuse d'employer le mot
 * « marge ».
 *
 * TOUTE MUTATION INVALIDE AUSSI `owner-economie`. Saisir une charge change la
 * marge affichée sur l'onglet d'à côté : ne rafraîchir que la liste laisserait
 * les deux moitiés du même écran se contredire, l'une comptant une charge que
 * l'autre ignore encore.
 */

export type ChargesFilters = {
  anneeScolaire?: string | null;
  filiereIds?: string[];
  nomClasse?: string | null;
  categorieId?: string | null;
  paye?: "tous" | "paye" | "engage";
  page?: number;
  pageSize?: number;
};

export function buildChargesQuery(f: ChargesFilters): string {
  const p = new URLSearchParams();
  if (f.anneeScolaire) p.set("anneeScolaire", f.anneeScolaire);
  if (f.filiereIds?.length) p.set("filiereIds", f.filiereIds.join(","));
  // `URLSearchParams` encode la barre verticale de la clé de classe ; la
  // construire à la main la laisserait telle quelle et l'API ne la retrouverait pas.
  if (f.nomClasse) p.set("nomClasse", f.nomClasse);
  if (f.categorieId) p.set("categorieId", f.categorieId);
  if (f.paye && f.paye !== "tous") p.set("paye", f.paye);
  if (f.page) p.set("page", String(f.page));
  if (f.pageSize) p.set("pageSize", String(f.pageSize));
  return p.toString();
}

export function useOwnerCharges(filters: ChargesFilters) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildChargesQuery(filters);

  return useQuery<OwnerChargesResponse>({
    queryKey: ["owner-charges", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/charges${qs ? `?${qs}` : ""}`, {
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

export type ChargeCategorie = {
  id: string;
  code: string;
  libelle: string;
  estFixe: boolean;
};

export function useOwnerChargeCategories() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<{ categories: ChargeCategorie[] }>({
    queryKey: ["owner-charge-categories", tenantId],
    queryFn: async () => {
      const res = await fetch("/api/v1/owner/charges/categories", {
        headers: createApiHeaders(session),
      });
      if (!res.ok) throw new Error("Chargement des catégories impossible");
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    // Huit lignes seedées par la migration 0098 : elles ne bougent pas.
    staleTime: 10 * 60 * 1000,
  });
}

/* -------------------------------------------------------------------------- */
/*  Mutations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rafraîchit ce qu'une écriture de charge rend périmé.
 *
 * Deux clés, jamais une seule : la liste des charges ET la Rentabilité, qui
 * partage l'écran et dont la marge vient de changer.
 */
function useInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["owner-charges"] });
    void qc.invalidateQueries({ queryKey: ["owner-economie"] });
  };
}

/** Message d'erreur du serveur, qui est déjà rédigé pour être lu tel quel. */
async function erreurDe(res: Response, defaut: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  throw new Error(body.message || defaut);
}

export function useCreateOwnerCharge() {
  const { data: session } = useSession();
  const invalider = useInvalidation();

  return useMutation<OwnerCharge, Error, OwnerChargeCreateInput>({
    mutationFn: async (body) => {
      const res = await fetch("/api/v1/owner/charges", {
        method: "POST",
        headers: { ...createApiHeaders(session), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) await erreurDe(res, "Enregistrement impossible");
      return (await res.json()).charge;
    },
    onSuccess: invalider,
  });
}

export function useUpdateOwnerCharge() {
  const { data: session } = useSession();
  const invalider = useInvalidation();

  return useMutation<OwnerCharge, Error, { id: string; body: OwnerChargePatchBody }>({
    mutationFn: async ({ id, body }) => {
      const res = await fetch(`/api/v1/owner/charges/${id}`, {
        method: "PATCH",
        headers: { ...createApiHeaders(session), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) await erreurDe(res, "Mise à jour impossible");
      return (await res.json()).charge;
    },
    onSuccess: invalider,
  });
}

export function useDeleteOwnerCharge() {
  const { data: session } = useSession();
  const invalider = useInvalidation();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/v1/owner/charges/${id}`, {
        method: "DELETE",
        headers: createApiHeaders(session),
      });
      if (!res.ok) await erreurDe(res, "Suppression impossible");
    },
    onSuccess: invalider,
  });
}

/* -------------------------------------------------------------------------- */
/*  Cohortes rattachables                                                      */
/* -------------------------------------------------------------------------- */

export type ChargeCohorte = { id: string; nom: string; programmeId: string };

/**
 * Cohortes d'une classe, pour le sélecteur du formulaire.
 *
 * `professional_classe_noms` est DÉCLARATIVE : sur cette base, trois lignes
 * pour quarante et une classes. Une liste vide n'est donc pas une anomalie —
 * c'est le cas courant — et l'écran doit l'expliquer plutôt que de laisser un
 * champ inerte.
 */
export function useOwnerChargeCohortes(programmeId: string | null) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<{ cohortes: ChargeCohorte[] }>({
    queryKey: ["owner-charge-cohortes", tenantId, programmeId],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/owner/charges/cohortes?programmeId=${encodeURIComponent(programmeId ?? "")}`,
        { headers: createApiHeaders(session) }
      );
      if (!res.ok) throw new Error("Chargement des cohortes impossible");
      return res.json();
    },
    // Sans classe choisie, il n'y a rien à demander : le champ est encore vide.
    enabled: !!session && tenantId !== "no-tenant" && !!programmeId,
    staleTime: 5 * 60 * 1000,
  });
}
