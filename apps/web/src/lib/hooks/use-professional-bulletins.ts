"use client";

import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
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

/**
 * Clôture les bulletins d'un semestre : il quitte la page « Bulletins &
 * moyennes » pour l'historique, en lecture seule.
 *
 * À ne pas confondre avec `useCloturerSemestre`, qui clôture les NOTES en
 * passant les cohortes d'UE en « terminé ». La liste des semestres est
 * invalidée : le semestre disparaît du sélecteur de la page de travail.
 */
export function useCloturerBulletins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (semestreId: string) =>
      apiFetch(`${BASE}/semestres/${semestreId}/bulletins/cloturer`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-semestres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin-roster"], exact: false });
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

/** Détail de présence d'un étudiant (toutes ses séances sur le périmètre choisi). */
export function useStudentPresences(params: {
  studentId: string | null;
  filiereId: string | null;
  semestreId?: string;
  statut?: string;
}) {
  const { studentId, filiereId, semestreId, statut } = params;
  const qs = new URLSearchParams({ filiere_id: filiereId ?? "" });
  if (semestreId) qs.set("semestre_id", semestreId);
  if (statut && statut !== "all") qs.set("statut", statut);
  return useQuery({
    queryKey: ["professional-student-presences", studentId, filiereId, semestreId ?? "", statut ?? ""],
    queryFn: () => apiFetch(`${BASE}/presences/students/${studentId}?${qs.toString()}`),
    enabled: !!studentId && !!filiereId,
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
/**
 * Portée des écrans de notes :
 *  - `actives`   → cohortes encore ouvertes (page de saisie) ;
 *  - `terminees` → cohortes terminées ou annulées (page historique) ;
 *  - omise       → aucune restriction.
 */
export type NotesScope = "actives" | "terminees";

export function useNotesFilieres(scope?: NotesScope) {
  return useQuery({
    queryKey: ["professional-notes-filieres", scope ?? "all"],
    queryFn: () => apiFetch(`${BASE}/notes/filieres${scope ? `?scope=${scope}` : ""}`),
  });
}

/** Semestres (avec sessions) d'une filière — scopés par rôle enseignant. */
export function useNotesSemestres(filiereId: string | null, scope?: NotesScope) {
  return useQuery({
    queryKey: ["professional-notes-semestres", filiereId, scope ?? "all"],
    queryFn: () =>
      apiFetch(
        `${BASE}/notes/semestres?filiere_id=${filiereId}${scope ? `&scope=${scope}` : ""}`
      ),
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

/**
 * Grilles de PLUSIEURS cohortes en parallèle — pour les vues qui affichent
 * toutes les UE d'un semestre côte à côte (historique des notes). Même clé de
 * cache que `useSessionGrid` : les deux hooks se partagent les résultats.
 */
export function useSessionGrids(ueSessionIds: string[]) {
  return useQueries({
    queries: ueSessionIds.map((id) => ({
      queryKey: ["professional-session-grid", id],
      queryFn: () => apiFetch(`${BASE}/ue-sessions/${id}/grid`),
      enabled: !!id,
    })),
  });
}

/**
 * Filières ayant au moins un rattrapage en attente. Distinct de
 * `useNotesFilieres` : ici on ne propose que des filières où il reste
 * effectivement quelque chose à repasser.
 */
export function useRattrapageFilieres() {
  return useQuery({
    queryKey: ["professional-rattrapage-filieres"],
    queryFn: () => apiFetch(`${BASE}/rattrapages/filieres`),
  });
}

/** Semestres d'une filière ayant au moins un rattrapage (avec le compte). */
export function useRattrapageSemestres(filiereId: string | null) {
  return useQuery({
    queryKey: ["professional-rattrapage-semestres", filiereId],
    queryFn: () => apiFetch(`${BASE}/rattrapages/semestres?filiere_id=${filiereId}`),
    enabled: !!filiereId,
  });
}

/**
 * Étudiants en rattrapage (Session 2) d'un semestre : une ligne par couple
 * (étudiant, ECUE) non validé en Session 1. Une ligne disparaît dès que la
 * note de rattrapage saisie fait valider l'ECUE.
 */
export function useSemestreRattrapages(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-semestre-rattrapages", semestreId],
    queryFn: () => apiFetch(`${BASE}/semestres/${semestreId}/rattrapages`),
    enabled: !!semestreId,
  });
}

/**
 * Filières encore concernées par la saisie des conduites : celles ayant au
 * moins un semestre avec une cohorte active, ou avec une conduite à finaliser.
 * Une filière dont aucun semestre n'a de session n'y figure pas.
 */
export function useConduiteFilieres() {
  return useQuery({
    queryKey: ["professional-conduite-filieres"],
    queryFn: () => apiFetch(`${BASE}/conduite/filieres`),
  });
}

/** Semestres d'une filière ouverts à la saisie des conduites (même règle). */
export function useConduiteSemestres(filiereId: string | null) {
  return useQuery({
    queryKey: ["professional-conduite-semestres", filiereId],
    queryFn: () => apiFetch(`${BASE}/conduite/semestres?filiere_id=${filiereId}`),
    enabled: !!filiereId,
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

/**
 * Clôture les notes d'un semestre : ses cohortes passent à « terminé », donc
 * le semestre quitte l'écran de saisie pour l'historique.
 *
 * Les listes de filières et de semestres sont invalidées des deux portées
 * (« actives » et « terminees ») : le semestre disparaît de l'une et apparaît
 * dans l'autre.
 */
export function useCloturerSemestre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (semestreId: string) =>
      apiFetch(`${BASE}/semestres/${semestreId}/cloturer`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-notes-filieres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-notes-semestres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-semestre-sessions"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-session-grid"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
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
  /** 1 = session normale, 2 = rattrapage (LMD). */
  session?: number;
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
      // Saisir la dernière conduite peut faire sortir le semestre (et sa
      // filière) de la liste « à finaliser » : on rafraîchit ces sélecteurs.
      qc.invalidateQueries({ queryKey: ["professional-conduite-filieres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-conduite-semestres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin-roster"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
      // Une note de rattrapage validante fait sortir l'ECUE de la liste — et,
      // si c'était la dernière, le semestre puis la filière des sélecteurs.
      qc.invalidateQueries({ queryKey: ["professional-semestre-rattrapages"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-rattrapage-filieres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-rattrapage-semestres"], exact: false });
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
      // Supprimer une conduite peut faire réapparaître le semestre à finaliser.
      qc.invalidateQueries({ queryKey: ["professional-conduite-filieres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-conduite-semestres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-bulletin"], exact: false });
      // Supprimer une note de rattrapage peut faire réapparaître l'ECUE.
      qc.invalidateQueries({ queryKey: ["professional-semestre-rattrapages"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-rattrapage-filieres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-rattrapage-semestres"], exact: false });
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

/** Détail des notes individuelles (devoirs + examen) de l'étudiant, par semestre. */
export function useMyBulletinNotes(semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-my-bulletin-notes", semestreId],
    queryFn: () => apiFetch(`${BASE}/student/bulletins/${semestreId}/notes`),
    enabled: !!semestreId,
  });
}

/** Semestres où l'étudiant connecté est inscrit. */
export function useMyBulletinSemestres() {
  return useQuery({
    queryKey: ["professional-my-bulletin-semestres"],
    queryFn: () => apiFetch(`${BASE}/student/semestres`),
  });
}
