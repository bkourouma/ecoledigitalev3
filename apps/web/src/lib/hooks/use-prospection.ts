"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import type {
  CommercialDto,
  LigneCommissionDto,
  ProspectionDashboardDto,
  ProvenanceCanal,
  ProvenanceInput,
  ProvenanceRowDto,
} from "@ecoledigitale/contracts";

/**
 * Prospection — provenance des étudiants, commerciaux et commissions.
 * Surface `/api/v1/prospection/*` (routes admin).
 */

const BASE = "/api/v1/prospection";

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...createApiHeaders(),
    ...((init?.headers as Record<string, string>) || {}),
  };
  // Pas de Content-Type sur une requête sans corps : Fastify rejette sinon le
  // corps vide (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (init?.body == null) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

/** Toutes les vues dépendent des mêmes chiffres : une mutation les rafraîchit en bloc. */
function useInvalidateProspection() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["prospection"], exact: false });
}

// ---------------------------------------------------------------- Commerciaux

export function useCommerciaux() {
  return useQuery<CommercialDto[]>({
    queryKey: ["prospection", "commerciaux"],
    queryFn: () => apiFetch(`${BASE}/commerciaux`),
    staleTime: 60_000,
  });
}

export function useCreateCommercial() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: (input: {
      nom: string;
      telephone?: string | null;
      email?: string | null;
      taux_commission: number;
      note?: string | null;
    }) =>
      apiFetch<CommercialDto>(`${BASE}/commerciaux`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    // La fenêtre de saisie se ferme dès que le serveur a répondu : elle
    // n'attend pas le rechargement des listes, qui suit en arrière-plan.
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateCommercial() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) =>
      apiFetch<CommercialDto>(`${BASE}/commerciaux/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    // La fenêtre de saisie se ferme dès que le serveur a répondu : elle
    // n'attend pas le rechargement des listes, qui suit en arrière-plan.
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDeleteCommercial() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/commerciaux/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- Provenances

export interface ProvenanceQueryArgs {
  search?: string;
  canal?: ProvenanceCanal | "non_renseigne";
  commercial_id?: string;
  limit?: number;
  offset?: number;
}

export interface ProvenanceListResult {
  items: ProvenanceRowDto[];
  total: number;
  limit: number;
  offset: number;
}

export function useProvenances(query: ProvenanceQueryArgs = {}) {
  return useQuery<ProvenanceListResult>({
    queryKey: ["prospection", "provenances", query],
    queryFn: () => apiFetch(`${BASE}/provenances${buildQueryString(query as any)}`),
  });
}

/** Provenance d'un étudiant précis — `null` si elle n'a jamais été renseignée. */
export function useStudentProvenance(studentId: string | null) {
  return useQuery<ProvenanceRowDto | null>({
    queryKey: ["prospection", "provenance-etudiant", studentId],
    queryFn: () => apiFetch(`${BASE}/provenances/${studentId}`),
    enabled: Boolean(studentId),
  });
}

export function useSetProvenance() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: ({ studentId, provenance }: { studentId: string; provenance: ProvenanceInput }) =>
      apiFetch(`${BASE}/provenances/${studentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provenance),
      }),
    onSuccess: invalidate,
  });
}

export function useSetProvenancesBulk() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: (entrees: Array<{ student_id: string; provenance: ProvenanceInput }>) =>
      apiFetch<{ enregistrees: number; erreurs: Array<{ student_id: string; message: string }> }>(
        `${BASE}/provenances/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entrees }),
        }
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteProvenance() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: (studentId: string) =>
      apiFetch(`${BASE}/provenances/${studentId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- Commissions

/**
 * Lignes de commission : une par paiement de scolarité d'un étudiant amené par
 * un commercial. C'est la maille de règlement.
 */
export function useLignesCommission(
  query: { commercial_id?: string; statut?: "regle" | "impaye" } = {}
) {
  return useQuery<LigneCommissionDto[]>({
    queryKey: ["prospection", "lignes-commission", query],
    queryFn: () => apiFetch(`${BASE}/commissions/lignes${buildQueryString(query as any)}`),
  });
}

/** Marque des lignes comme payées. Le montant est recalculé par le serveur. */
export function useReglerCommissions() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: (input: {
      payment_ids: string[];
      mode: string;
      reference?: string | null;
      paid_at?: string;
    }) =>
      apiFetch<{ reglees: number; ignorees: number; montant: number }>(
        `${BASE}/commissions/regler`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      ),
    onSuccess: invalidate,
  });
}

/** Annule un règlement : la commission repart dans les impayées. */
export function useDeleteVersement() {
  const invalidate = useInvalidateProspection();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/versements/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- Tableau de bord

export function useProspectionDashboard(query: { date_debut?: string; date_fin?: string } = {}) {
  return useQuery<ProspectionDashboardDto>({
    queryKey: ["prospection", "dashboard", query],
    queryFn: () => apiFetch(`${BASE}/dashboard${buildQueryString(query as any)}`),
  });
}
