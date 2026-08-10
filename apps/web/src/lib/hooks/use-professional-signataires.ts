"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SignataireCle, SignataireDto, SignataireUpdateInput } from "@ecoledigitale/contracts";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks — Signataires configurables des documents officiels (attestation de
 * réussite, diplôme, attestation d'authenticité). Un seul nom par « titre ».
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

/** Récupère les signataires (hors hook, pour la génération PDF à la demande). */
export function fetchSignataires(): Promise<SignataireDto[]> {
  return apiFetch<SignataireDto[]>(`${BASE}/signataires`);
}

/** Les 4 signataires configurables. */
export function useSignataires() {
  return useQuery({
    queryKey: ["professional-signataires"],
    queryFn: fetchSignataires,
    staleTime: 5 * 60 * 1000,
  });
}

/** Enregistre le signataire d'un titre. */
export function useUpdateSignataire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cle, data }: { cle: SignataireCle; data: SignataireUpdateInput }) =>
      apiFetch<SignataireDto>(`${BASE}/signataires/${cle}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-signataires"] }),
  });
}

/** Transforme la liste en index par clé, pratique pour alimenter les PDF. */
export function indexSignataires(list: SignataireDto[] | undefined | null) {
  const map = {} as Record<SignataireCle, SignataireDto | undefined>;
  for (const s of list ?? []) map[s.cle] = s;
  return map;
}
