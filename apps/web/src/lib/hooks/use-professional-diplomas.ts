"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DiplomaCreateInput,
  DiplomaUpdateInput,
  DiplomaRequirementInput,
} from "@ecoledigitale/contracts";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hooks — Diplômes Professionnels (feature 029), via le proxy Next.js
 * `/api/v1/professional/*`. Conventions de cache alignées sur
 * use-professional-catalog-admin.ts (feature 028).
 */

const BASE = "/api/v1/professional";

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...createApiHeaders(),
    ...((init?.headers as Record<string, string>) || {}),
  };
  // Pas de Content-Type sur une requête sans corps (sinon Fastify rejette).
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

/* ------------------------------ Diplômes ------------------------------ */

export interface DiplomasQuery {
  filiere_id?: string;
  statut?: string;
  q?: string;
}

export function useDiplomas(query: DiplomasQuery = {}) {
  return useQuery({
    queryKey: ["professional-diplomas", query],
    queryFn: () => apiFetch(`${BASE}/diplomas${buildQueryString(query as any)}`),
    staleTime: 60 * 1000,
  });
}

export function useDiploma(id: string | null) {
  return useQuery({
    queryKey: ["professional-diploma", id],
    queryFn: () => apiFetch(`${BASE}/diplomas/${id}`),
    enabled: !!id,
  });
}

export function useCreateDiploma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: DiplomaCreateInput) =>
      apiFetch(`${BASE}/diplomas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-diplomas"], exact: false }),
  });
}

export function useUpdateDiploma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DiplomaUpdateInput }) =>
      apiFetch(`${BASE}/diplomas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["professional-diplomas"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-diploma", vars.id] });
    },
  });
}

export function useDeleteDiploma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/diplomas/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-diplomas"], exact: false }),
  });
}

/* ------------------------------ Exigences ----------------------------- */

export function useDiplomaRequirements(diplomaId: string | null) {
  return useQuery({
    queryKey: ["professional-diploma-requirements", diplomaId],
    queryFn: () => apiFetch(`${BASE}/diplomas/${diplomaId}/requirements`),
    enabled: !!diplomaId,
  });
}

export function useReplaceDiplomaRequirements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      requirements,
    }: {
      id: string;
      requirements: DiplomaRequirementInput[];
    }) =>
      apiFetch(`${BASE}/diplomas/${id}/requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["professional-diploma-requirements", vars.id] });
      qc.invalidateQueries({ queryKey: ["professional-diploma", vars.id] });
    },
  });
}

/* ---------------------------- Recomputation --------------------------- */

/** Recalcule l'éligibilité de tous les étudiants pour un diplôme (US2). */
export function useRecomputeDiploma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ awarded: number }>(`${BASE}/diplomas/${id}/recompute`, { method: "POST" }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["professional-diploma", id] });
      qc.invalidateQueries({ queryKey: ["professional-diplomas"], exact: false });
    },
  });
}

/* ------------------------- Espace étudiant (US3) ---------------------- */

/** Diplômes des programmes de l'étudiant + progression résumée. */
export function useStudentDiplomas() {
  return useQuery({
    queryKey: ["professional-student-diplomas"],
    queryFn: () => apiFetch(`${BASE}/student/diplomas`),
    staleTime: 60 * 1000,
  });
}

/** Progression détaillée de l'étudiant vers un diplôme. */
export function useStudentDiplomaProgress(id: string | null) {
  return useQuery({
    queryKey: ["professional-student-diploma-progress", id],
    queryFn: () => apiFetch(`${BASE}/student/diplomas/${id}/progress`),
    enabled: !!id,
  });
}

/** Données structurées de l'attestation d'un diplôme obtenu. */
export function useStudentDiplomaAttestation(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["professional-student-diploma-attestation", id],
    queryFn: () => apiFetch(`${BASE}/student/diplomas/${id}/attestation`),
    enabled: !!id && enabled,
    retry: false,
  });
}

/* --------------------- Octroi / révocation (US4) ---------------------- */

/** Étudiants ayant obtenu (ou ayant eu) un diplôme. */
export function useDiplomaAwarded(diplomaId: string | null, statut?: string) {
  return useQuery({
    queryKey: ["professional-diploma-awarded", diplomaId, statut ?? "all"],
    queryFn: () =>
      apiFetch(
        `${BASE}/diplomas/${diplomaId}/awarded${buildQueryString(
          (statut ? { statut } : {}) as any
        )}`
      ),
    enabled: !!diplomaId,
  });
}

/** Étudiants candidats à l'octroi manuel (programme du diplôme). */
export function useDiplomaCandidates(diplomaId: string | null) {
  return useQuery({
    queryKey: ["professional-diploma-candidates", diplomaId],
    queryFn: () => apiFetch(`${BASE}/diplomas/${diplomaId}/candidates`),
    enabled: !!diplomaId,
    staleTime: 60 * 1000,
  });
}

/** Octroi manuel d'un diplôme à un étudiant (avec option `force`). */
export function useAwardDiploma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      student_id,
      force,
    }: {
      id: string;
      student_id: string;
      force?: boolean;
    }) =>
      apiFetch(`${BASE}/diplomas/${id}/award`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id, force: !!force }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["professional-diploma-awarded", vars.id], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-diploma", vars.id] });
    },
  });
}

/** Révocation d'un diplôme obtenu (motif obligatoire). */
export function useRevokeDiploma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      student_id,
      motif,
    }: {
      id: string;
      student_id: string;
      motif: string;
    }) =>
      apiFetch(`${BASE}/diplomas/${id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id, motif }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["professional-diploma-awarded", vars.id], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-diploma", vars.id] });
    },
  });
}

/* -------------------------- Espace parent (US5) ----------------------- */

/** Diplômes d'un enfant (lecture seule), pour un parent. */
export function useParentChildDiplomas(childId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-child-diplomas", childId],
    queryFn: () =>
      apiFetch(
        `${BASE}/parent/diplomas${buildQueryString(
          (childId ? { child_id: childId } : {}) as any
        )}`
      ),
    enabled: !!childId,
  });
}
