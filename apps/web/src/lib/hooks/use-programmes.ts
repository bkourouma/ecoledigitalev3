"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import { getToken, getUserFromToken } from "@/lib/jwt-storage";

interface Programme {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description?: string;
  domaine?: string | null;
  cycleId: string;
  filiereId?: string | null;
  filiere?: {
    id: string;
    name: string | null;
    domaine: string | null;
  } | null;
  status: "draft" | "review" | "approved" | "active" | "archived";
  createdAt: string;
  updatedAt: string;
  cycle?: {
    id: string;
    name: string;
    code: string;
    type: string;
  };
}

interface CreateProgramme {
  name: string;
  code: string;
  version?: string;
  description?: string;
  domaine?: string;
  cycleId: string;
  filiereId?: string | null;
  status?: "draft" | "review" | "approved" | "active" | "archived";
}

interface UpdateProgramme {
  name?: string;
  code?: string;
  description?: string;
  domaine?: string;
  cycleId?: string;
  filiereId?: string | null;
  status?: "draft" | "review" | "approved" | "active" | "archived";
}

interface ProgrammeQuery {
  page?: number;
  limit?: number;
  search?: string;
  cycleId?: string;
  filiereId?: string;
  status?: string;
}

function createAcademicHeaders() {
  const headers = createApiHeaders();
  const token = typeof window !== "undefined" ? getToken() : null;
  const user = token ? getUserFromToken(token) : null;

  if (user?.tenantId) {
    headers["X-Tenant"] = user.tenantId;
  }

  return headers;
}

async function fetchProgrammesPage(query: ProgrammeQuery): Promise<{ data: Programme[]; pagination: any }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/programmes?${searchParams.toString()}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch programmes");
  }

  return response.json();
}

// Page size used when fetching every programme. The API caps `limit` at 100,
// so we page through and aggregate client-side to remove any practical limit.
const FETCH_ALL_PAGE_SIZE = 100;

async function fetchProgrammes(query: ProgrammeQuery = {}): Promise<{ data: Programme[]; pagination: any }> {
  // Explicit limit -> single page (unchanged behaviour for callers that paginate).
  if (query.limit !== undefined) {
    return fetchProgrammesPage(query);
  }

  // No limit requested -> load ALL programmes by paging through and merging.
  const all: Programme[] = [];
  let total = 0;
  let page = 1;

  // Hard upper bound to avoid an unbounded loop on unexpected responses.
  for (let guard = 0; guard < 1000; guard++) {
    const res = await fetchProgrammesPage({ ...query, page, limit: FETCH_ALL_PAGE_SIZE });
    const rows = res.data || [];
    all.push(...rows);
    total = res.pagination?.total ?? all.length;

    if (rows.length === 0 || all.length >= total) {
      break;
    }
    page += 1;
  }

  return {
    data: all,
    pagination: { page: 1, limit: all.length, total, totalPages: 1 },
  };
}

async function fetchProgramme(id: string): Promise<Programme> {
  const response = await fetch(`/api/v1/programmes/${id}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch programme");
  }

  return response.json();
}

async function createProgramme(data: CreateProgramme): Promise<Programme> {
  const response = await fetch(`/api/v1/programmes`, {
    method: "POST",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    let errorMessage = "Impossible de creer le programme";

    try {
      const error = await response.json();
      const backendMessage = error.message || error.error || "";

      if (response.status === 409) {
        if (backendMessage.includes("code and version") || backendMessage.includes("code et version")) {
          const version = data.version || "1.0";
          errorMessage = `Un programme avec le code "${data.code}" et la version "${version}" existe deja.\n\nVeuillez utiliser un code different ou modifier la version du programme.`;
        } else {
          errorMessage = backendMessage || "Un programme similaire existe deja.";
        }
      } else if (response.status === 404) {
        errorMessage = backendMessage || "Le cycle selectionne n'existe pas ou n'est plus disponible.";
      } else {
        errorMessage = backendMessage || errorMessage;
      }
    } catch {
      errorMessage = `Erreur ${response.status}: ${response.statusText}`;
    }

    throw new Error(errorMessage);
  }

  return response.json();
}

async function updateProgramme(id: string, data: UpdateProgramme): Promise<Programme> {
  const response = await fetch(`/api/v1/programmes/${id}`, {
    method: "PUT",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || "Failed to update programme");
  }

  return response.json();
}

async function deleteProgramme(id: string): Promise<void> {
  const headers = createAcademicHeaders();
  delete headers["Content-Type"];

  const response = await fetch(`/api/v1/programmes/${id}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    let errorMessage = "Impossible de supprimer le programme";

    try {
      const error = await response.json();
      const backendMessage = error.message || error.error || "";

      if (response.status === 409) {
        if (backendMessage.includes("courses") || backendMessage.includes("cours")) {
          errorMessage = "Impossible de supprimer le programme car il contient des cours associes.\n\nVeuillez d'abord retirer ou supprimer tous les cours du programme avant de le supprimer.";
        } else {
          errorMessage = backendMessage || "Le programme ne peut pas etre supprime car il contient des elements associes.";
        }
      } else {
        errorMessage = backendMessage || errorMessage;
      }
    } catch {
      errorMessage = `Erreur ${response.status}: ${response.statusText}`;
    }

    throw new Error(errorMessage);
  }
}

export function useProgrammes(query: ProgrammeQuery = {}) {
  return useQuery({
    queryKey: ["programmes", query],
    queryFn: () => fetchProgrammes(query),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProgramme(id: string) {
  return useQuery({
    queryKey: ["programmes", id],
    queryFn: () => fetchProgramme(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateProgramme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProgramme,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["programmes"] });
      queryClient.invalidateQueries({ queryKey: ["filieres"] });
    },
  });
}

export function useUpdateProgramme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProgramme }) => updateProgramme(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["programmes"] });
      queryClient.invalidateQueries({ queryKey: ["programmes", id] });
      queryClient.invalidateQueries({ queryKey: ["filieres"] });
    },
  });
}

export function useDeleteProgramme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProgramme,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["programmes"] });
      queryClient.invalidateQueries({ queryKey: ["filieres"] });
    },
  });
}

export type { Programme, CreateProgramme, UpdateProgramme, ProgrammeQuery };
