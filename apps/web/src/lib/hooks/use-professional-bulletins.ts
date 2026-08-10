"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks — Notes, moyennes & bulletins (Module Professionnel, feature 030).
 * Via `/api/v1/professional/*`.
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

/* --------------------------- Bulletins --------------------------- */

/** Tableau récapitulatif des étudiants d'un semestre (moyenne + décision). */
export function useBulletinRoster(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-bulletin-roster", semestreId],
    queryFn: () => apiFetch(`${BASE}/semestres/${semestreId}/bulletins`),
    enabled: !!semestreId,
  });
}

/** Bulletin détaillé d'un étudiant pour un semestre. */
export function useBulletin(semestreId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ["professional-bulletin", semestreId, studentId],
    queryFn: () => apiFetch(`${BASE}/semestres/${semestreId}/bulletins/${studentId}`),
    enabled: !!semestreId && !!studentId,
  });
}

<<<<<<< HEAD
=======
/** Récupère le bulletin détaillé d'un étudiant (appel imperatif, hors hook). */
export async function fetchBulletin(semestreId: string, studentId: string): Promise<any> {
  return apiFetch(`${BASE}/semestres/${semestreId}/bulletins/${studentId}`);
}

/** Récupère le bulletin de style BTS d'un étudiant (Licence 1/2 uniquement). */
export async function fetchBulletinBts(semestreId: string, studentId: string): Promise<any> {
  return apiFetch(`${BASE}/semestres/${semestreId}/bulletins/${studentId}/bts`);
}

/** Génère les bulletins officiels de tous les étudiants du semestre. */
export function useGenerateBulletins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (semestreId: string) =>
      apiFetch(`${BASE}/semestres/${semestreId}/bulletins/generate`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-bulletin-roster"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletins-history"], exact: false });
    },
  });
}

/** Récupère les bulletins COMPLETS d'un semestre (pour le PDF combiné). */
export async function fetchFullBulletins(semestreId: string): Promise<any[]> {
  return apiFetch<any[]>(`${BASE}/semestres/${semestreId}/bulletins-full`);
}

/** Historique complet des présences d'une filière (séances + récap étudiants). */
export function usePresencesHistory(params: {
  filiereId: string | null;
  semestreId?: string;
  statut?: string;
}) {
  const { filiereId, semestreId, statut } = params;
  const qs = new URLSearchParams({ filiere_id: filiereId ?? "" });
  if (semestreId) qs.set("semestre_id", semestreId);
  if (statut && statut !== "all") qs.set("statut", statut);
  return useQuery({
    queryKey: ["professional-presences-history", filiereId, semestreId ?? "", statut ?? ""],
    queryFn: () => apiFetch(`${BASE}/presences/history?${qs.toString()}`),
    enabled: !!filiereId,
  });
}

/** Historique des bulletins d'une filière (semestres, étudiants, bulletins générés). */
export function useBulletinHistory(filiereId: string | null) {
  return useQuery({
    queryKey: ["professional-bulletins-history", filiereId],
    queryFn: () => apiFetch(`${BASE}/bulletins/history?filiere_id=${filiereId}`),
    enabled: !!filiereId,
  });
}

>>>>>>> 030-pedagogie-ue-ecue
/** Recalcule tous les résultats des cohortes du semestre. */
export function useRecomputeBulletins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (semestreId: string) =>
      apiFetch(`${BASE}/semestres/${semestreId}/bulletins/recompute`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-bulletin-roster"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-session-grid"], exact: false });
    },
  });
}

/* ----------------- Saisie des notes par cohorte ----------------- */

/** Filières accessibles à la saisie (scopées par rôle enseignant). */
export function useNotesFilieres() {
  return useQuery({
    queryKey: ["professional-notes-filieres"],
    queryFn: () => apiFetch(`${BASE}/notes/filieres`),
  });
}

/** Semestres (avec sessions) d'une filière — scopés par rôle enseignant. */
export function useNotesSemestres(filiereId: string | null) {
  return useQuery({
    queryKey: ["professional-notes-semestres", filiereId],
    queryFn: () => apiFetch(`${BASE}/notes/semestres?filiere_id=${filiereId}`),
    enabled: !!filiereId,
  });
}

/** Sessions (cohortes UE) d'un semestre — pour le sélecteur de saisie. */
export function useSemestreSessions(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-semestre-sessions", semestreId],
    queryFn: () => apiFetch(`${BASE}/semestres/${semestreId}/sessions`),
    enabled: !!semestreId,
  });
}

/** Grille de saisie d'une cohorte : ECUE × étudiants + notes existantes. */
export function useSessionGrid(ueSessionId: string | null) {
  return useQuery({
    queryKey: ["professional-session-grid", ueSessionId],
    queryFn: () => apiFetch(`${BASE}/ue-sessions/${ueSessionId}/grid`),
    enabled: !!ueSessionId,
  });
}

/** Conduite d'un semestre : ECUE dédiée + étudiants + note de conduite. */
export function useSemestreConduite(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-semestre-conduite", semestreId],
    queryFn: () => apiFetch(`${BASE}/semestres/${semestreId}/conduite`),
    enabled: !!semestreId,
  });
}

/** Recalcule les résultats d'une cohorte. */
export function useRecomputeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ueSessionId: string) =>
      apiFetch(`${BASE}/ue-sessions/${ueSessionId}/results/recompute`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-session-grid"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin-roster"], exact: false });
    },
  });
}

interface ManualNoteInput {
  ecueId: string;
  student_id: string;
  ue_session_id: string;
  nature: "devoir" | "examen";
  note: number;
  note_max?: number;
  libelle?: string | null;
<<<<<<< HEAD
=======
  /** 1 = session normale, 2 = rattrapage (LMD). */
  session?: number;
>>>>>>> 030-pedagogie-ue-ecue
}

/** Crée (devoir) ou met à jour (examen unique) une note manuelle. */
export function useUpsertManualNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ecueId, ...body }: ManualNoteInput) =>
      apiFetch(`${BASE}/ecue/${ecueId}/manual-notes`, jsonInit("POST", body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-session-grid"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-semestre-conduite"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin-roster"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
    },
  });
}

/** Modifie une note manuelle. */
export function useUpdateManualNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; note?: number; note_max?: number; libelle?: string | null }) =>
      apiFetch(`${BASE}/manual-notes/${id}`, jsonInit("PATCH", body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-session-grid"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-semestre-conduite"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
    },
  });
}

/** Supprime une note manuelle. */
export function useDeleteManualNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/manual-notes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-session-grid"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-semestre-conduite"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
    },
  });
}

/* -------------------- Bulletin côté étudiant -------------------- */

export function useMyBulletin(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-my-bulletin", semestreId],
    queryFn: () => apiFetch(`${BASE}/student/bulletins/${semestreId}`),
    enabled: !!semestreId,
  });
}

<<<<<<< HEAD
=======
/** Détail des notes individuelles (devoirs + examen) de l'étudiant, par semestre. */
export function useMyBulletinNotes(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-my-bulletin-notes", semestreId],
    queryFn: () => apiFetch(`${BASE}/student/bulletins/${semestreId}/notes`),
    enabled: !!semestreId,
  });
}

>>>>>>> 030-pedagogie-ue-ecue
/** Semestres où l'étudiant connecté est inscrit. */
export function useMyBulletinSemestres() {
  return useQuery({
    queryKey: ["professional-my-bulletin-semestres"],
    queryFn: () => apiFetch(`${BASE}/student/semestres`),
  });
}
