"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProfessionalSemestre,
  CreateProfessionalSemestresBatch,
  CreateSessionsBySemestre,
  ReopenSessions,
  UpdateProfessionalSemestre,
} from "@ecoledigitale/contracts";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hooks d'administration — Semestres (Module Professionnel).
 * Un semestre regroupe des sessions d'UE (non terminées) d'une filière.
 * Via le proxy Next.js `/api/v1/professional/semestres/*`.
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

/** Liste des semestres (optionnellement filtrée par filière). */
export function useProfessionalSemestres(query: { filiere_id?: string } = {}) {
  return useQuery({
    queryKey: ["professional-semestres", query],
    queryFn: () => apiFetch(`${BASE}/semestres${buildQueryString(query as any)}`),
    staleTime: 30 * 1000,
  });
}

/** Détail d'un semestre (avec ses sessions rattachées). */
export function useProfessionalSemestre(id: string | null) {
  return useQuery({
    queryKey: ["professional-semestre", id],
    queryFn: () => apiFetch(`${BASE}/semestres/${id}`),
    enabled: !!id,
  });
}

export interface ClasseNomOuvert {
  nom: string;
  /** Semestres que ce nom est censé couvrir. */
  semestres_portee: { id: string; libelle: string }[];
  /** false = portée non déclarée, tous les semestres sont supposés couverts. */
  portee_declaree: boolean;
  semestres_ouverts: { id: string; libelle: string }[];
  semestres_restants: { id: string; libelle: string }[];
  complet: boolean;
}

export interface ClasseNomsPayload {
  semestres: { id: string; libelle: string }[];
  noms: ClasseNomOuvert[];
}

/**
 * Noms de classe déjà ouverts pour une classe, avec les semestres qu'il leur
 * reste. Entièrement déduit des ouvertures existantes : rien n'est stocké.
 */
export function useClasseNoms(classeId: string | null) {
  return useQuery<ClasseNomsPayload>({
    queryKey: ["professional-classe-noms", classeId],
    queryFn: () => apiFetch(`${BASE}/classes/${classeId}/noms`),
    enabled: !!classeId,
  });
}

export interface ClasseNomPortee {
  classe_id: string;
  nom: string;
  semestre_ids: string[];
}

/** Portées de tous les noms de classe — pour la liste des ouvertures. */
export function useToutesPortees() {
  return useQuery<ClasseNomPortee[]>({
    queryKey: ["professional-classe-portees"],
    queryFn: () => apiFetch(`${BASE}/classe-noms`),
    staleTime: 30 * 1000,
  });
}

/** Déclare les semestres qu'un nom de classe est censé couvrir. */
export function useDeclareClasseNom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      classeId,
      nom,
      semestreIds,
    }: {
      classeId: string;
      nom: string;
      semestreIds: string[];
    }) =>
      apiFetch(
        `${BASE}/classes/${classeId}/noms`,
        jsonInit("POST", { nom, semestre_ids: semestreIds })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-classe-noms"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-classe-portees"], exact: false });
    },
  });
}

/** UE d'une filière, sélectionnables dans un semestre. */
export function useEligibleUeForSemestre(filiereId: string | null) {
  return useQuery({
    queryKey: ["professional-semestre-eligible-ue", filiereId],
    queryFn: () =>
      apiFetch(`${BASE}/semestres/eligible-ue${buildQueryString({ filiere_id: filiereId })}`),
    enabled: !!filiereId,
  });
}

export function useCreateProfessionalSemestre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProfessionalSemestre) =>
      apiFetch(`${BASE}/semestres`, jsonInit("POST", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-semestres"], exact: false }),
  });
}

/** Création groupée de plusieurs semestres d'une même filière. */
export function useCreateProfessionalSemestresBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProfessionalSemestresBatch) =>
      apiFetch(`${BASE}/semestres/batch`, jsonInit("POST", data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-semestres"], exact: false }),
  });
}

/** Création groupée de sessions par semestre (un semestre ou toute la filière). */
export function useCreateSessionsBySemestre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSessionsBySemestre) =>
      apiFetch(`${BASE}/sessions/by-semestre`, jsonInit("POST", data)),
    onSuccess: () => {
      // La liste des sessions utilise la clé "...-list".
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions-list"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-semestres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-classe-noms"], exact: false });
    },
  });
}

/** Rouvre des sessions terminées (nouvelle date de fin + statut « ouvert »). */
export function useReopenSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ReopenSessions) =>
      apiFetch(`${BASE}/sessions/reopen`, jsonInit("POST", data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions-list"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-ue-sessions"], exact: false });
    },
  });
}

export function useUpdateProfessionalSemestre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfessionalSemestre }) =>
      apiFetch(`${BASE}/semestres/${id}`, jsonInit("PATCH", data)),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["professional-semestres"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-semestre", v.id] });
    },
  });
}

export function useDeleteProfessionalSemestre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/semestres/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["professional-semestres"], exact: false }),
  });
}
