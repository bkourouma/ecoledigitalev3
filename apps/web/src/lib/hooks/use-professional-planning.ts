"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProfessionalCoursePlanning,
  UpdateProfessionalCoursePlanning,
} from "@ecoledigitale/contracts";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hooks — Planning des cours (Module Professionnel).
 * Sessions ouvertes → ECUE → créneau (date_debut/date_fin), visualisé en calendrier.
 * Accessible admin ou enseignant. Via le proxy Next.js `/api/v1/professional/planning/*`.
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

/** Sessions ouvertes sélectionnables pour planifier un cours. */
export function usePlannableSessions() {
  return useQuery({
    queryKey: ["planning-sessions"],
    queryFn: () => apiFetch(`${BASE}/planning/sessions`),
    staleTime: 30 * 1000,
  });
}

/** ECUE de la session sélectionnée. */
export function usePlanningSessionEcue(sessionId: string | null) {
  return useQuery({
    queryKey: ["planning-session-ecue", sessionId],
    queryFn: () => apiFetch(`${BASE}/planning/sessions/${sessionId}/ecue`),
    enabled: !!sessionId,
  });
}

/** Plannings (événements du calendrier), filtrables par période. */
export function useCoursePlannings(query: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ["course-plannings", query],
    queryFn: () => apiFetch(`${BASE}/planning${buildQueryString(query as any)}`),
    staleTime: 15 * 1000,
  });
}

export function useCreateCoursePlanning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProfessionalCoursePlanning) =>
      apiFetch(`${BASE}/planning`, jsonInit("POST", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["course-plannings"], exact: false }),
  });
}

export function useUpdateCoursePlanning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfessionalCoursePlanning }) =>
      apiFetch(`${BASE}/planning/${id}`, jsonInit("PATCH", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["course-plannings"], exact: false }),
  });
}

export function useDeleteCoursePlanning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/planning/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["course-plannings"], exact: false }),
  });
}
