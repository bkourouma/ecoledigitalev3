"use client";

import { useQuery } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks de l'espace parent — Module Professionnel (feature 028, US5).
 * Lecture seule : enfants, inscriptions et paiements professionnels.
 */

const BASE = "/api/v1/professional/parent";

async function apiFetch<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: createApiHeaders() });
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

export function useProfessionalChildren() {
  return useQuery({
    queryKey: ["professional-parent-children"],
    queryFn: () => apiFetch(`${BASE}/children`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useChildProfessionalEnrollments(childId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-enrollments", childId],
    queryFn: () => apiFetch(`${BASE}/enrollments?child_id=${childId}`),
    enabled: !!childId,
  });
}

export function useChildProfessionalPayments(childId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-payments", childId],
    queryFn: () => apiFetch(`${BASE}/payments?child_id=${childId}`),
    enabled: !!childId,
  });
}

/* ----------------- Devoirs & notes de l'enfant (feature 030) ----------------- */

/** Devoirs & évaluations de l'enfant (issus de /teacher/courses). */
export function useChildAssignments(childId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-assignments", childId],
    queryFn: () => apiFetch(`${BASE}/assignments?child_id=${childId}`),
    enabled: !!childId,
  });
}

/** Historique de présence/absence de l'enfant (pointages enseignant/admin). */
export function useChildAttendanceHistory(childId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-attendance", childId],
    queryFn: () => apiFetch(`${BASE}/attendance?child_id=${childId}`),
    enabled: !!childId,
  });
}

/** Semestres où l'enfant est inscrit. */
export function useChildBulletinSemestres(childId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-bulletin-semestres", childId],
    queryFn: () => apiFetch(`${BASE}/bulletins/semestres?child_id=${childId}`),
    enabled: !!childId,
  });
}

/** Bulletin (notes de /professionnel/admin/notes) de l'enfant pour un semestre. */
export function useChildBulletin(childId: string | null, semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-bulletin", childId, semestreId],
    queryFn: () => apiFetch(`${BASE}/bulletins/${semestreId}?child_id=${childId}`),
    enabled: !!childId && !!semestreId,
  });
}

/** Notes individuelles (devoirs + examen) de l'enfant pour un semestre. */
export function useChildBulletinNotes(childId: string | null, semestreId: string | null) {
  return useQuery({
    queryKey: ["professional-parent-bulletin-notes", childId, semestreId],
    queryFn: () => apiFetch(`${BASE}/bulletins/${semestreId}/notes?child_id=${childId}`),
    enabled: !!childId && !!semestreId,
  });
}
