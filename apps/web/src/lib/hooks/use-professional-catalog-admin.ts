"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProfessionalEcue,
  UpdateProfessionalEcue,
  CreateProfessionalUe,
  UpdateProfessionalUe,
  ProfessionalUeEcueInput,
  UpdateProfessionalUeEcue,
  CreateProfessionalUeSession,
  UpdateProfessionalUeSession,
  ProfessionalUeSessionStatut,
  CreateProfessionalEcueSeance,
  UpdateProfessionalEcueSeance,
  MarkProfessionalAttendance,
} from "@ecoledigitale/contracts";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hooks d'administration — Module Professionnel : Filière → UE → ECUE (feature 030).
 * ECUE (pédagogique), UE (administratif), composition, prérequis UE, sessions,
 * séances, résultats. Via le proxy Next.js `/api/v1/professional/*`.
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

/* ================================ ECUE ================================ */

export interface ProfessionalEcueQuery {
  statut?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function useProfessionalEcueList(query: ProfessionalEcueQuery = {}) {
  return useQuery({
    queryKey: ["professional-ecue", query],
    queryFn: () => apiFetch(`${BASE}/ecue${buildQueryString(query as any)}`),
    staleTime: 60 * 1000,
  });
}

/**
 * Charge l'INTÉGRALITÉ des ECUE en un seul lot (pageSize = plafond du service),
 * la boucle ne servant que si le total dépasse ce plafond. Renvoie { items, total }.
 */
export function useAllProfessionalEcueList(
  filters: { statut?: string; q?: string } = {}
) {
  return useQuery({
    queryKey: ["professional-ecue-all", filters],
    queryFn: async () => {
      // Le service plafonne pageSize à 1000 : une seule requête suffit dans les
      // volumes réels. Par lots de 100, les ~840 ECUE demandaient 9 allers-retours
      // en série — le moindre incident réseau (ERR_HTTP2_PING_FAILED) faisait
      // échouer la queryFn entière et react-query relançait tout depuis page=1,
      // d'où des « Chargement… » sans fin.
      const pageSize = 1000;
      const all: any[] = [];
      let page = 1;
      // Boucle conservée comme filet au-delà de 1000 (garde-fou page > 100).
      for (;;) {
        const res: any = await apiFetch(
          `${BASE}/ecue${buildQueryString({ ...filters, page, pageSize } as any)}`
        );
        const batch: any[] = res?.items ?? [];
        all.push(...batch);
        const total: number = res?.total ?? all.length;
        if (batch.length === 0 || all.length >= total || page > 100) break;
        page += 1;
      }
      return { items: all, total: all.length };
    },
    staleTime: 60 * 1000,
  });
}

export function useProfessionalEcue(id: string | null) {
  return useQuery({
    queryKey: ["professional-ecue-item", id],
    queryFn: () => apiFetch(`${BASE}/ecue/${id}`),
    enabled: !!id,
  });
}

export function useCreateProfessionalEcue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProfessionalEcue) => apiFetch(`${BASE}/ecue`, jsonInit("POST", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-ecue"], exact: false }),
  });
}

export function useUpdateProfessionalEcue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfessionalEcue }) =>
      apiFetch(`${BASE}/ecue/${id}`, jsonInit("PATCH", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-ecue"], exact: false }),
  });
}

export function useDeleteProfessionalEcue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/ecue/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-ecue"], exact: false }),
  });
}

/* ================================= UE ================================= */

export interface ProfessionalUeQuery {
  filiere_id?: string;
  statut?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function useProfessionalUeList(query: ProfessionalUeQuery = {}) {
  return useQuery({
    queryKey: ["professional-ue", query],
    queryFn: () => apiFetch(`${BASE}/ue${buildQueryString(query as any)}`),
    staleTime: 60 * 1000,
  });
}

/**
 * Charge l'INTÉGRALITÉ des UE en un seul lot (pageSize = plafond du service),
 * la boucle ne servant que si le total dépasse ce plafond. Renvoie { items, total }.
 */
export function useAllProfessionalUeList(
  filters: { filiere_id?: string; statut?: string; q?: string } = {}
) {
  return useQuery({
    queryKey: ["professional-ue-all", filters],
    queryFn: async () => {
      // Idem `useAllProfessionalEcueList` : le service plafonne à 1000, donc une
      // seule requête au lieu de 5 lots pour les ~480 UE. La boucle reste en
      // filet au-delà de 1000.
      const pageSize = 1000;
      const all: any[] = [];
      let page = 1;
      for (;;) {
        const res: any = await apiFetch(
          `${BASE}/ue${buildQueryString({ ...filters, page, pageSize } as any)}`
        );
        const batch: any[] = res?.items ?? [];
        all.push(...batch);
        const total: number = res?.total ?? all.length;
        if (batch.length === 0 || all.length >= total || page > 100) break;
        page += 1;
      }
      return { items: all, total: all.length };
    },
    staleTime: 60 * 1000,
  });
}

export function useProfessionalUe(id: string | null) {
  return useQuery({
    queryKey: ["professional-ue-item", id],
    queryFn: () => apiFetch(`${BASE}/ue/${id}`),
    enabled: !!id,
  });
}

export function useCreateProfessionalUe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProfessionalUe) => apiFetch(`${BASE}/ue`, jsonInit("POST", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-ue"], exact: false }),
  });
}

export function useUpdateProfessionalUe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfessionalUe }) =>
      apiFetch(`${BASE}/ue/${id}`, jsonInit("PATCH", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-ue"], exact: false }),
  });
}

export function useDeleteProfessionalUe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/ue/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-ue"], exact: false }),
  });
}

/* ========================= Composition UE↔ECUE ======================== */

export function useProfessionalUeEcue(ueId: string | null) {
  return useQuery({
    queryKey: ["professional-ue-ecue", ueId],
    queryFn: () => apiFetch(`${BASE}/ue/${ueId}/ecue`),
    enabled: !!ueId,
  });
}

export function useAddEcueToUe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ueId, data }: { ueId: string; data: ProfessionalUeEcueInput }) =>
      apiFetch(`${BASE}/ue/${ueId}/ecue`, jsonInit("POST", data)),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["professional-ue-ecue", v.ueId] });
      qc.invalidateQueries({ queryKey: ["professional-ue-item", v.ueId] });
    },
  });
}

export function useUpdateUeEcueLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ueId, ecueId, data }: { ueId: string; ecueId: string; data: UpdateProfessionalUeEcue }) =>
      apiFetch(`${BASE}/ue/${ueId}/ecue/${ecueId}`, jsonInit("PATCH", data)),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["professional-ue-ecue", v.ueId] }),
  });
}

export function useRemoveEcueFromUe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ueId, ecueId }: { ueId: string; ecueId: string }) =>
      apiFetch(`${BASE}/ue/${ueId}/ecue/${ecueId}`, { method: "DELETE" }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["professional-ue-ecue", v.ueId] });
      qc.invalidateQueries({ queryKey: ["professional-ue-item", v.ueId] });
    },
  });
}

/* ============================ Prérequis UE =========================== */

export function useProfessionalUePrerequisites(ueId: string | null) {
  return useQuery({
    queryKey: ["professional-ue-prerequisites", ueId],
    queryFn: () => apiFetch(`${BASE}/ue/${ueId}/prerequisites`),
    enabled: !!ueId,
  });
}

export function useSetProfessionalUePrerequisites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prerequisite_ue_ids }: { id: string; prerequisite_ue_ids: string[] }) =>
      apiFetch(`${BASE}/ue/${id}/prerequisites`, jsonInit("PUT", { prerequisite_ue_ids })),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["professional-ue-prerequisites", v.id] });
      qc.invalidateQueries({ queryKey: ["professional-ue"], exact: false });
    },
  });
}

/* ============================ Sessions d'UE ========================== */

export function useProfessionalUeSessions(ueId: string | null) {
  return useQuery({
    queryKey: ["professional-ue-sessions", ueId],
    queryFn: () => apiFetch(`${BASE}/ue/${ueId}/sessions`),
    enabled: !!ueId,
  });
}

export function useProfessionalUeSessionsList(
  query: { ue_id?: string; statut?: string; semestre_id?: string; pageSize?: number } = {}
) {
  return useQuery({
    queryKey: ["professional-ue-sessions-list", query],
    queryFn: () => apiFetch(`${BASE}/ue-sessions${buildQueryString(query as any)}`),
    staleTime: 60 * 1000,
  });
}

export function useProfessionalUeSession(id: string | null) {
  return useQuery({
    queryKey: ["professional-ue-session", id],
    queryFn: () => apiFetch(`${BASE}/ue-sessions/${id}`),
    enabled: !!id,
  });
}

export function useCreateProfessionalUeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ueId, data }: { ueId: string; data: CreateProfessionalUeSession }) =>
      apiFetch(`${BASE}/ue/${ueId}/sessions`, jsonInit("POST", data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions-list"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
    },
  });
}

export function useUpdateProfessionalUeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfessionalUeSession }) =>
      apiFetch(`${BASE}/ue-sessions/${id}`, jsonInit("PATCH", data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions-list"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
    },
  });
}

export function useTransitionProfessionalUeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: ProfessionalUeSessionStatut }) =>
      apiFetch(`${BASE}/ue-sessions/${id}/status`, jsonInit("PATCH", { statut })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions-list"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
    },
  });
}

export function useDeleteProfessionalUeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/ue-sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions-list"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
    },
  });
}

/* ============ Enseignants par ECUE (au sein d'une session) =========== */

/** Liste les ECUE de la session avec l'enseignant affecté (ou null). */
export function useSessionEcueTeachers(ueSessionId: string | null) {
  return useQuery({
    queryKey: ["professional-session-ecue-teachers", ueSessionId],
    queryFn: () => apiFetch(`${BASE}/ue-sessions/${ueSessionId}/ecue-teachers`),
    enabled: !!ueSessionId,
  });
}

/** Affecte (ou retire si enseignant_id=null) un enseignant à un ECUE d'une session. */
export function useSetSessionEcueTeacher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ueSessionId,
      ecue_id,
      enseignant_id,
    }: {
      ueSessionId: string;
      ecue_id: string;
      enseignant_id: string | null;
    }) =>
      apiFetch(
        `${BASE}/ue-sessions/${ueSessionId}/ecue-teachers`,
        jsonInit("PUT", { ecue_id, enseignant_id })
      ),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({
        queryKey: ["professional-session-ecue-teachers", v.ueSessionId],
      }),
  });
}

/* ============================ Séances d'ECUE ========================= */

export function useProfessionalSeances(ueSessionId: string | null) {
  return useQuery({
    queryKey: ["professional-seances", ueSessionId],
    queryFn: () => apiFetch(`${BASE}/ue-sessions/${ueSessionId}/seances`),
    enabled: !!ueSessionId,
  });
}

export function useCreateProfessionalSeance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ueSessionId, data }: { ueSessionId: string; data: CreateProfessionalEcueSeance }) =>
      apiFetch(`${BASE}/ue-sessions/${ueSessionId}/seances`, jsonInit("POST", data)),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["professional-seances", v.ueSessionId] }),
  });
}

export function useUpdateProfessionalSeance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seanceId, data }: { seanceId: string; data: UpdateProfessionalEcueSeance }) =>
      apiFetch(`${BASE}/seances/${seanceId}`, jsonInit("PATCH", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-seances"], exact: false }),
  });
}

export function useDeleteProfessionalSeance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seanceId: string) => apiFetch(`${BASE}/seances/${seanceId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-seances"], exact: false }),
  });
}

export function useSeanceAttendance(seanceId: string | null) {
  return useQuery({
    queryKey: ["professional-seance-attendance", seanceId],
    queryFn: () => apiFetch(`${BASE}/seances/${seanceId}/attendance`),
    enabled: !!seanceId,
  });
}

export function useMarkSeanceAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seanceId, data }: { seanceId: string; data: MarkProfessionalAttendance }) =>
      apiFetch(`${BASE}/seances/${seanceId}/attendance`, jsonInit("POST", data)),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["professional-seance-attendance", v.seanceId] }),
  });
}

/**
 * Justifie (ou dé-justifie) l'absence d'un étudiant sur une séance : le
 * pointage bascule entre `absent` et `excuse`, avec le motif saisi.
 */
export function useJustifyAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      seanceId,
      studentId,
      justifiee,
      motif,
    }: {
      seanceId: string;
      studentId: string;
      justifiee: boolean;
      motif?: string;
    }) =>
      apiFetch(
        `${BASE}/seances/${seanceId}/attendance/${studentId}/justification`,
        jsonInit("POST", { justifiee, motif })
      ),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["professional-seance-attendance", v.seanceId] });
      qc.invalidateQueries({ queryKey: ["professional-student-presences"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-presences-history"], exact: false });
    },
  });
}

/** Dépose (ou remplace) le justificatif PDF d'une absence justifiée. */
export function useUploadJustificatif() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      seanceId,
      studentId,
      file,
    }: {
      seanceId: string;
      studentId: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append("file", file);
      const headers = createApiHeaders();
      delete (headers as any)["Content-Type"];
      delete (headers as any)["content-type"];
      const res = await fetch(
        `${BASE}/seances/${seanceId}/attendance/${studentId}/justificatif`,
        { method: "POST", headers, body: formData }
      );
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* réponse non JSON */
      }
      if (!res.ok) throw new Error(json?.message ?? `Erreur HTTP ${res.status}`);
      return json?.data ?? json;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["professional-seance-attendance", v.seanceId] }),
  });
}

/** Retire le justificatif d'une absence (la justification reste). */
export function useDeleteJustificatif() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seanceId, studentId }: { seanceId: string; studentId: string }) =>
      apiFetch(`${BASE}/seances/${seanceId}/attendance/${studentId}/justificatif`, {
        method: "DELETE",
      }),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["professional-seance-attendance", v.seanceId] }),
  });
}

/**
 * Charge le justificatif en blob authentifié et renvoie une URL temporaire
 * (à révoquer via URL.revokeObjectURL après usage).
 */
export async function fetchJustificatifUrl(seanceId: string, studentId: string): Promise<string> {
  const headers = createApiHeaders();
  delete (headers as any)["Content-Type"];
  delete (headers as any)["content-type"];
  const res = await fetch(`${BASE}/seances/${seanceId}/attendance/${studentId}/justificatif`, {
    headers,
  });
  if (!res.ok) {
    let msg = `Erreur HTTP ${res.status}`;
    try {
      msg = (await res.json())?.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return URL.createObjectURL(await res.blob());
}

/* ===================== Résultats ECUE & validation UE ================ */

export function useSessionResults(ueSessionId: string | null) {
  return useQuery({
    queryKey: ["professional-session-results", ueSessionId],
    queryFn: () => apiFetch(`${BASE}/ue-sessions/${ueSessionId}/results`),
    enabled: !!ueSessionId,
  });
}

export function useRecomputeSessionResults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ueSessionId: string) =>
      apiFetch(`${BASE}/ue-sessions/${ueSessionId}/results/recompute`, jsonInit("POST", {})),
    onSuccess: (_d, ueSessionId) =>
      qc.invalidateQueries({ queryKey: ["professional-session-results", ueSessionId] }),
  });
}

export function useValidateEcueResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resultId, validee }: { resultId: string; validee: boolean }) =>
      apiFetch(`${BASE}/ecue-results/${resultId}/validate`, jsonInit("PATCH", { validee })),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-session-results"], exact: false }),
  });
}
