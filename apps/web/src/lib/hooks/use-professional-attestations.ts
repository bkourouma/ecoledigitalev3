"use client";

import { useQuery } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks — Attestations de réussite, directement à partir des inscriptions et
 * de la validation des UE d'une filière (pas de diplôme à configurer).
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

/** Roster des étudiants inscrits dans une filière, avec leur progression de crédits. */
export function useAttestationRoster(filiereId: string | null, classeNom?: string) {
  return useQuery({
    queryKey: ["professional-attestation-roster", filiereId, classeNom ?? ""],
    queryFn: () =>
      apiFetch(
        `${BASE}/filieres/${filiereId}/attestation-roster` +
          (classeNom ? `?classe_nom=${encodeURIComponent(classeNom)}` : "")
      ),
    enabled: !!filiereId,
    staleTime: 30 * 1000,
  });
}

/** Récupère les données imprimables de l'attestation d'un étudiant (pour génération PDF à la demande). */
export function fetchFiliereAttestation(filiereId: string, studentId: string) {
  return apiFetch(`${BASE}/filieres/${filiereId}/students/${studentId}/attestation`);
}
