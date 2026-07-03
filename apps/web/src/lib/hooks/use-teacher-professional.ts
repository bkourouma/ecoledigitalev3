"use client";

import { useQuery } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Espace enseignant — Module Professionnel.
 * ECUE (matières) affectées à l'enseignant connecté.
 */

export type TeacherEcue = {
  ecue_id: string;
  ecue_code: string;
  ecue_libelle: string;
  credits: number | null;
  ue_session_id: string;
  session_libelle: string | null;
  date_debut: string | null;
  date_fin: string | null;
  statut: string | null;
  ue_id: string;
  ue_code: string;
  ue_libelle: string;
  filiere_nom: string | null;
  filiere_code: string | null;
  nb_inscrits: number;
  nb_seances: number;
};

async function apiFetch<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: createApiHeaders() });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok || (json && json.success === false)) {
    throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

export function useTeacherEcue() {
  return useQuery<TeacherEcue[]>({
    queryKey: ["teacher-professional-ecue"],
    queryFn: () => apiFetch<TeacherEcue[]>("/api/v1/professional/teacher/ecue"),
  });
}

export type TeacherEmploiTempsSlot = {
  id: string;
  jour: number;
  heure_debut: string;
  heure_fin: string;
  date_debut: string | null;
  date_fin: string | null;
  ecue_id: string;
  ecue_code: string;
  ecue_libelle: string;
  ue_code: string;
  ue_libelle: string;
  filiere_nom: string | null;
  filiere_code: string | null;
  classroom_id: string | null;
  classroom_name: string | null;
  classroom_code: string | null;
};

/** Emploi du temps hebdomadaire de l'enseignant connecté. */
export function useTeacherEmploiTemps() {
  return useQuery<TeacherEmploiTempsSlot[]>({
    queryKey: ["teacher-professional-emploi-temps"],
    queryFn: () =>
      apiFetch<TeacherEmploiTempsSlot[]>("/api/v1/professional/teacher/emploi-temps"),
  });
}
