"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import { getToken, getUserFromToken } from "@/lib/jwt-storage";

export interface Filiere {
  id: string;
  tenantId: string;
  name: string;
  domaine?: string | null;
  /** Nombre de classes rattachees (renvoye par la liste et le detail). */
  classCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFiliere {
  name: string;
  domaine?: string | null;
}

export type UpdateFiliere = Partial<CreateFiliere>;

function createAcademicHeaders() {
  const headers = createApiHeaders();
  const token = typeof window !== "undefined" ? getToken() : null;
  const user = token ? getUserFromToken(token) : null;

  if (user?.tenantId) {
    headers["X-Tenant"] = user.tenantId;
  }

  return headers;
}

async function readError(response: Response, fallback: string) {
  try {
    const error = await response.json();
    return error.message || error.error || fallback;
  } catch {
    return `Erreur ${response.status}: ${response.statusText}`;
  }
}

async function fetchFilieres(): Promise<Filiere[]> {
  const response = await fetch("/api/v1/filieres", {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Impossible de charger les filieres"));
  }

  const payload = await response.json();
  return payload.data ?? [];
}

async function fetchFiliere(id: string): Promise<Filiere> {
  const response = await fetch(`/api/v1/filieres/${id}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Impossible de charger la filiere"));
  }

  return response.json();
}

export function useFilieres() {
  return useQuery({
    queryKey: ["filieres"],
    queryFn: fetchFilieres,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFiliere(id: string) {
  return useQuery({
    queryKey: ["filieres", id],
    queryFn: () => fetchFiliere(id),
    enabled: Boolean(id),
  });
}

export function useCreateFiliere() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFiliere) => {
      const response = await fetch("/api/v1/filieres", {
        method: "POST",
        headers: createAcademicHeaders(),
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Impossible de creer la filiere"));
      }

      return response.json() as Promise<Filiere>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filieres"] });
    },
  });
}

export function useUpdateFiliere() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFiliere }) => {
      const response = await fetch(`/api/v1/filieres/${id}`, {
        method: "PUT",
        headers: createAcademicHeaders(),
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Impossible de modifier la filiere"));
      }

      return response.json() as Promise<Filiere>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filieres"] });
    },
  });
}

export function useDeleteFiliere() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const headers = createAcademicHeaders();
      delete headers["Content-Type"];

      const response = await fetch(`/api/v1/filieres/${id}`, {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Impossible de supprimer la filiere"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filieres"] });
      queryClient.invalidateQueries({ queryKey: ["programmes"] });
    },
  });
}
