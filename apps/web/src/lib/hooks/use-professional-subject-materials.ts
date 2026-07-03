"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks pour les supports de cours rattachés à la MATIÈRE (réutilisables d'une
 * session à l'autre) — lecture seule via le site, avec tracking des consultations.
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

export function useSubjectMaterials(subjectId: string | null) {
  return useQuery({
    queryKey: ["professional-subject-materials", subjectId],
    queryFn: () => apiFetch(`${BASE}/ecue/${subjectId}/materials`),
    enabled: !!subjectId,
  });
}

export function useUploadSubjectMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subjectId,
      titre,
      description,
      file,
    }: {
      subjectId: string;
      titre: string;
      description?: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append("titre", titre);
      if (description) formData.append("description", description);
      formData.append("file", file);

      const headers = createApiHeaders();
      delete (headers as any)["Content-Type"];
      delete (headers as any)["content-type"];

      const res = await fetch(`${BASE}/ecue/${subjectId}/materials/upload`, {
        method: "POST",
        headers,
        body: formData,
      });
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
      return json?.data ?? json;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["professional-subject-materials", vars.subjectId] }),
  });
}

export function useDeleteSubjectMaterial(subjectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) =>
      apiFetch(`${BASE}/materials/${materialId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (subjectId) {
        qc.invalidateQueries({ queryKey: ["professional-subject-materials", subjectId] });
      }
    },
  });
}

export function useMaterialViewsSummary(materialId: string | null) {
  return useQuery({
    queryKey: ["professional-material-views-summary", materialId],
    queryFn: () => apiFetch(`${BASE}/materials/${materialId}/views/summary`),
    enabled: !!materialId,
  });
}

/**
 * Charge un support en blob auth + renvoie l'URL temporaire (pour intégration
 * dans <iframe> ou <video>). À révoquer via URL.revokeObjectURL plus tard.
 */
export async function fetchMaterialBlobUrl(materialId: string): Promise<{ url: string; type: string }> {
  const headers = createApiHeaders();
  delete (headers as any)["Content-Type"];
  delete (headers as any)["content-type"];
  const res = await fetch(`${BASE}/materials/${materialId}/view`, { headers });
  if (!res.ok) {
    let msg = `Erreur HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return { url, type: blob.type || "application/octet-stream" };
}
