"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import { getToken, getUserFromToken } from "@/lib/jwt-storage";

export interface BilanType {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBilanType {
  name: string;
  description?: string | null;
}

export interface UpdateBilanType {
  name?: string;
  description?: string | null;
}

interface BilanTypeQuery {
  search?: string;
  page?: number;
  limit?: number;
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

async function fetchBilanTypes(query: BilanTypeQuery = {}): Promise<{ data: BilanType[]; pagination: any }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, String(value));
    }
  });

  const response = await fetch(`/api/v1/bilan-types?${searchParams.toString()}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bilan types: ${response.statusText}`);
  }

  return response.json();
}

async function createBilanType(data: CreateBilanType): Promise<{ data: BilanType }> {
  const response = await fetch(`/api/v1/bilan-types`, {
    method: "POST",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `Failed to create bilan type: ${response.statusText}`);
  }

  return response.json();
}

async function updateBilanType(id: string, data: UpdateBilanType): Promise<{ data: BilanType }> {
  const response = await fetch(`/api/v1/bilan-types/${id}`, {
    method: "PUT",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `Failed to update bilan type: ${response.statusText}`);
  }

  return response.json();
}

async function deleteBilanType(id: string): Promise<void> {
  const response = await fetch(`/api/v1/bilan-types/${id}`, {
    method: "DELETE",
    headers: createAcademicHeaders(),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `Failed to delete bilan type: ${response.statusText}`);
  }
}

export function useBilanTypes(query: BilanTypeQuery = {}) {
  return useQuery({
    queryKey: ["bilan-types", query],
    queryFn: () => fetchBilanTypes(query),
  });
}

export function useCreateBilanType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createBilanType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bilan-types"] });
    },
  });
}

export function useUpdateBilanType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBilanType }) => updateBilanType(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bilan-types"] });
    },
  });
}

export function useDeleteBilanType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteBilanType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bilan-types"] });
    },
  });
}
