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
