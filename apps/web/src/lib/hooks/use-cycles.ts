"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import { getToken, getUserFromToken } from "@/lib/jwt-storage";
import { 
  Cycle, 
  CreateCycle, 
  UpdateCycle, 
  CycleQuery,
  CycleQuerySchema 
} from "@ecoledigitale/contracts";

function createAcademicHeaders() {
  const headers = createApiHeaders();
  const token = typeof window !== "undefined" ? getToken() : null;
  const user = token ? getUserFromToken(token) : null;

  if (user?.tenantId) {
    headers["X-Tenant"] = user.tenantId;
  }

  return headers;
}

function sanitizeCycleCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildDefaultCycleCode(name: string): string {
  return sanitizeCycleCode(name).slice(0, 20) || "CYCLE";
}

// API functions
async function fetchCycles(query: Partial<CycleQuery> = {}): Promise<{ data: Cycle[]; pagination: any }> {
  const validatedQuery = CycleQuerySchema.parse(query);
  const searchParams = new URLSearchParams();
  
  Object.entries(validatedQuery).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/cycles?${searchParams}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch cycles");
  }

  return response.json();
}

async function fetchCycle(id: string): Promise<Cycle> {
  const response = await fetch(`/api/v1/cycles/${id}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch cycle");
  }

  return response.json();
}

async function createCycle(data: CreateCycle): Promise<Cycle> {
  const payload: CreateCycle = {
    ...data,
    code: data.code ?? buildDefaultCycleCode(data.name),
  };

  const response = await fetch(`/api/v1/cycles`, {
    method: "POST",
    headers: createAcademicHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = "Impossible de créer le cycle";
    let backendMessage = "";
    let errorField: string | undefined = undefined;
    
    try {
      const error = await response.json();
      backendMessage = error.message || error.error || "";
      
      // Provide user-friendly messages for specific errors
      if (response.status === 409 || backendMessage.includes("already exists") || backendMessage.includes("existe déjà")) {
        if (backendMessage.includes("code") || backendMessage.toLowerCase().includes("code")) {
          errorMessage = "Un cycle avec ce code existe déjà. Veuillez utiliser un code différent.";
          errorField = "code";
        } else {
          errorMessage = backendMessage || "Un cycle similaire existe déjà.";
        }
      } else {
        errorMessage = backendMessage || errorMessage;
      }
    } catch {
      // If response is not JSON, use status text
      errorMessage = `Erreur ${response.status}: ${response.statusText}`;
    }
    
    const error = new Error(errorMessage);
    (error as any).status = response.status;
    (error as any).field = errorField;
    throw error;
  }

  return response.json();
}

async function updateCycle(id: string, data: UpdateCycle): Promise<Cycle> {
  const response = await fetch(`/api/v1/cycles/${id}`, {
    method: "PUT",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update cycle");
  }

  return response.json();
}

async function deleteCycle(id: string): Promise<void> {
  const response = await fetch(`/api/v1/cycles/${id}`, {
    method: "DELETE",
    headers: (() => {
      const headers = createAcademicHeaders();
      delete headers["Content-Type"];
      return headers;
    })(),
  });

  if (!response.ok) {
    let errorMessage = "Impossible de supprimer le cycle";
    try {
    const error = await response.json();
      const backendMessage = error.message || error.error || "";
      
      // Provide user-friendly messages for specific errors
      if (response.status === 409) {
        if (backendMessage.includes("programmes") || backendMessage.includes("programme")) {
          errorMessage = "Impossible de supprimer le cycle car il contient des programmes associés.\n\nVeuillez d'abord retirer ou supprimer tous les programmes du cycle avant de le supprimer.";
        } else {
          errorMessage = backendMessage || "Le cycle ne peut pas être supprimé car il contient des éléments associés.";
        }
      } else {
        errorMessage = backendMessage || errorMessage;
      }
    } catch {
      // If response is not JSON, use status text
      errorMessage = `Erreur ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }
}

// Hooks
export function useCycles(query: Partial<CycleQuery> = {}) {
  return useQuery({
    queryKey: ["cycles", query],
    queryFn: () => fetchCycles(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCycle(id: string) {
  return useQuery({
    queryKey: ["cycles", id],
    queryFn: () => fetchCycle(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCycle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cycles"] });
    },
  });
}

export function useUpdateCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCycle }) => updateCycle(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["cycles"] });
      queryClient.invalidateQueries({ queryKey: ["cycles", id] });
    },
  });
}

export function useDeleteCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCycle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cycles"] });
    },
  });
}
