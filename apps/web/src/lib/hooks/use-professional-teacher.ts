"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks de l'espace enseignant — Module Professionnel (feature 030).
 * Sessions affectées, séances et présence (par séance).
 */

const BASE = "/api/v1/professional/teacher";

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

/** Sessions (cohortes d'UE) affectées à l'enseignant connecté. */
export function useTeacherSessions() {
  return useQuery({
    queryKey: ["professional-teacher-sessions"],
    queryFn: () => apiFetch(`${BASE}/sessions`),
  });
}

/** Étudiants de l'enseignant (par filière / session, selon ses ECUE). */
export function useTeacherStudents() {
  return useQuery({
    queryKey: ["professional-teacher-students"],
    queryFn: () => apiFetch(`${BASE}/students`),
  });
}

/** Historique complet des évaluations créées par l'enseignant (ses ECUE). */
export function useTeacherAssignments() {
  return useQuery({
    queryKey: ["professional-teacher-assignments"],
    queryFn: () => apiFetch(`${BASE}/assignments`),
  });
}

/** Historique des présences effectuées par l'enseignant. */
export function useTeacherAttendanceHistory() {
  return useQuery({
    queryKey: ["professional-teacher-attendance-history"],
    queryFn: () => apiFetch(`${BASE}/attendance-history`),
  });
}

/** ECUE composant l'UE de la session (pour rattacher les évaluations). */
export function useTeacherSessionEcue(sessionId: string | null) {
  return useQuery({
    queryKey: ["professional-teacher-session-ecue", sessionId],
    queryFn: () => apiFetch(`${BASE}/sessions/${sessionId}/ecue`),
    enabled: !!sessionId,
  });
}

/** Séances d'une session que l'enseignant anime. */
export function useTeacherSessionSeances(sessionId: string | null) {
  return useQuery({
    queryKey: ["professional-teacher-seances", sessionId],
    queryFn: () => apiFetch(`${BASE}/sessions/${sessionId}/seances`),
    enabled: !!sessionId,
  });
}

/** Crée une séance dans une session de l'enseignant (rattachée à un ECUE). */
export function useCreateTeacherSeance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      data,
    }: {
      sessionId: string;
      data: {
        ecue_id: string;
        date: string;
        heure_debut?: string | null;
        heure_fin?: string | null;
        libelle?: string | null;
      };
    }) =>
      apiFetch(`${BASE}/sessions/${sessionId}/seances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["professional-teacher-seances", vars.sessionId] }),
  });
}

/** Supprime une séance de l'enseignant. */
export function useDeleteTeacherSeance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seanceId }: { seanceId: string; sessionId: string }) =>
      apiFetch(`${BASE}/seances/${seanceId}`, { method: "DELETE" }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["professional-teacher-seances", vars.sessionId] });
      qc.invalidateQueries({ queryKey: ["professional-teacher-attendance-history"] });
    },
  });
}

/** Détail d'une séance : contexte (ECUE, UE, session, filière) + décompte de présence. */
export function useTeacherSeanceDetail(seanceId: string | null) {
  return useQuery({
    queryKey: ["professional-teacher-seance", seanceId],
    queryFn: () => apiFetch(`${BASE}/seances/${seanceId}`),
    enabled: !!seanceId,
  });
}

/** Feuille de présence d'une séance (inscrits confirmés + statut de présence). */
export function useTeacherSeanceAttendance(seanceId: string | null) {
  return useQuery({
    queryKey: ["professional-teacher-attendance", seanceId],
    queryFn: () => apiFetch(`${BASE}/seances/${seanceId}/attendance`),
    enabled: !!seanceId,
  });
}

/** Saisie (upsert) de la présence des étudiants pour une séance. */
export function useMarkTeacherSeanceAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      seanceId,
      records,
    }: {
      seanceId: string;
      records: Array<{ student_id: string; statut: string }>;
    }) =>
      apiFetch(`${BASE}/seances/${seanceId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["professional-teacher-attendance", vars.seanceId] });
      qc.invalidateQueries({ queryKey: ["professional-teacher-seance", vars.seanceId] });
      // Rafraîchit l'état « Appel effectué » des listes de séances.
      qc.invalidateQueries({ queryKey: ["professional-teacher-seances"] });
      qc.invalidateQueries({ queryKey: ["professional-teacher-attendance-history"] });
    },
  });
}

/**
 * Télécharge un support via l'authentification courante puis l'ouvre dans un
 * nouvel onglet via un Blob URL (compatible header-based auth).
 */
export async function openProtectedMaterial(url: string): Promise<void> {
  const headers = createApiHeaders();
  delete (headers as any)["Content-Type"];
  delete (headers as any)["content-type"];
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Erreur HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
