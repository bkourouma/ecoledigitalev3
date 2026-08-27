"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateEmploiTempsSlot,
  UpdateEmploiTempsSlot,
} from "@ecoledigitale/contracts";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks — Emploi du temps hebdomadaire (Module Professionnel).
 * Via le proxy Next.js `/api/v1/professional/emploi-temps/*`.
 */

const BASE = "/api/v1/professional";

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...createApiHeaders(),
    ...((init?.headers as Record<string, string>) || {}),
  };
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

const jsonInit = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

/** Grille d'un semestre : en-tête (filière, période) + créneaux. Filtrable par période. */
export function useEmploiTemps(
  semestreId: string | null,
  period?: { date_debut?: string; date_fin?: string } | null
) {
  const dd = period?.date_debut || "";
  const df = period?.date_fin || "";
  return useQuery({
    queryKey: ["emploi-temps", semestreId, dd, df],
    queryFn: () => {
      const qs = dd && df ? `?date_debut=${encodeURIComponent(dd)}&date_fin=${encodeURIComponent(df)}` : "";
      return apiFetch(`${BASE}/emploi-temps/semestre/${semestreId}${qs}`);
    },
    enabled: !!semestreId,
  });
}

/** Filières ayant au moins une session encore ouverte (création de planning). */
export interface ConsultationOption {
  classe_id: string;
  classe_nom: string;
  classe_code: string | null;
  nom: string;
  semestre_id: string;
  semestre_libelle: string;
  annee_scolaire: string;
}

/** Année → nom de classe → semestre, pour la page de consultation. */
export function useConsultationOptions() {
  return useQuery<ConsultationOption[]>({
    queryKey: ["emploi-temps-consultation-options"],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/consultation-options`),
  });
}

/** Noms de classe ayant au moins une session encore ouverte. */
export function useNomsWithOpenSessions() {
  return useQuery({
    queryKey: ["emploi-temps-noms-open"],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/noms-open-sessions`),
  });
}

export function useFilieresWithOpenSessions() {
  return useQuery({
    queryKey: ["emploi-temps-filieres-open"],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/filieres-open-sessions`),
  });
}

/** Semestres d'une filière ayant au moins une session encore ouverte. */
export function useSemestresWithOpenSessions(filiereId: string | null) {
  return useQuery({
    queryKey: ["emploi-temps-semestres-open", filiereId],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/filieres/${filiereId}/semestres-open-sessions`),
    enabled: !!filiereId,
  });
}

/** Filières ayant déjà un emploi du temps. */
export function useFilieresWithEmploiTemps() {
  return useQuery({
    queryKey: ["emploi-temps-filieres"],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/filieres`),
  });
}

/** Semestres d'une filière ayant déjà un emploi du temps. */
export function useSemestresWithEmploiTemps(filiereId: string | null) {
  return useQuery({
    queryKey: ["emploi-temps-semestres", filiereId],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/filieres/${filiereId}/semestres`),
    enabled: !!filiereId,
  });
}

/** Liste des emplois du temps (périodes distinctes) d'un semestre. */
export function useEmploisDuTempsList(semestreId: string | null) {
  return useQuery({
    queryKey: ["emplois-du-temps-list", semestreId],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/semestre/${semestreId}/list`),
    enabled: !!semestreId,
  });
}

/** ECUE programmables d'un semestre (avec enseignant affecté). */
export function useEmploiTempsEcue(semestreId: string | null) {
  return useQuery({
    queryKey: ["emploi-temps-ecue", semestreId],
    queryFn: () => apiFetch(`${BASE}/emploi-temps/semestre/${semestreId}/ecue`),
    enabled: !!semestreId,
  });
}

/** Emploi du temps de l'étudiant connecté (créneaux de ses sessions inscrites). */
export function useStudentEmploiTemps() {
  return useQuery({
    queryKey: ["student-professional-emploi-temps"],
    queryFn: () => apiFetch(`${BASE}/student/emploi-temps`),
  });
}

/** Emploi du temps d'un enfant, côté parent : même grille que l'espace étudiant. */
export function useChildEmploiTemps(childId?: string | null) {
  return useQuery({
    queryKey: ["parent-child-professional-emploi-temps", childId],
    queryFn: () =>
      apiFetch(`${BASE}/parent/emploi-temps?child_id=${encodeURIComponent(childId!)}`),
    enabled: !!childId,
  });
}

export function useCreateEmploiTempsSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateEmploiTempsSlot) =>
      apiFetch(`${BASE}/emploi-temps`, jsonInit("POST", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emploi-temps"], exact: false }),
  });
}

export function useUpdateEmploiTempsSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEmploiTempsSlot }) =>
      apiFetch(`${BASE}/emploi-temps/${id}`, jsonInit("PATCH", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emploi-temps"], exact: false }),
  });
}

export function useDeleteEmploiTempsSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/emploi-temps/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emploi-temps"], exact: false }),
  });
}
