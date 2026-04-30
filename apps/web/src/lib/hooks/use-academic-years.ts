"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import { clearActiveAcademicYearId, setActiveAcademicYearId } from "@/lib/academic-year-storage";
// Temporary inline types until contracts package is properly built
interface AcademicYear {
  id: string;
  tenantId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateAcademicYear {
  name: string;
  startDate?: string;
  endDate?: string;
}

interface UpdateAcademicYear {
  name?: string;
}

interface AcademicYearWithStats extends AcademicYear {
  classCount: number;
  studentCount: number;
}

const API_BASE_URL = "";

interface AcademicYearQuery {
  page?: number;
  limit?: number;
  includeStats?: boolean;
}

// API functions
async function fetchAcademicYears(query: AcademicYearQuery = {}): Promise<{ data: AcademicYearWithStats[]; pagination: any }> {
  const searchParams = new URLSearchParams();
  
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/academic-years?${searchParams}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch academic years: ${response.statusText}`);
  }

  return response.json();
}

async function fetchActiveAcademicYear(): Promise<{ data: AcademicYear }> {
  const response = await fetch(`/api/v1/academic-years/active`, {
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No active academic year found");
    }
    throw new Error(`Failed to fetch active academic year: ${response.statusText}`);
  }

  const payload = await response.json();
  const activeId = payload?.data?.id;
  if (activeId) {
    setActiveAcademicYearId(activeId);
  } else {
    clearActiveAcademicYearId();
  }
  return payload;
}

async function createAcademicYear(data: CreateAcademicYear): Promise<{ data: AcademicYear }> {
  // Compatibilité ascendante: certains serveurs attendent encore startDate/endDate.
  const payload = {
    name: data.name,
    startDate: data.startDate ?? "2000-01-01",
    endDate: data.endDate ?? "2099-12-31",
  };
  const response = await fetch(`/api/v1/academic-years`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to create academic year: ${response.statusText}`);
  }

  return response.json();
}

async function updateAcademicYear(id: string, data: UpdateAcademicYear): Promise<{ data: AcademicYear }> {
  const response = await fetch(`/api/v1/academic-years/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to update academic year: ${response.statusText}`);
  }

  return response.json();
}

async function setActiveAcademicYear(id: string): Promise<{ data: AcademicYear }> {
  const response = await fetch(`/api/v1/academic-years/${id}/set-active`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
    body: JSON.stringify({}), // Add empty body to satisfy content-type requirement
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to set active academic year: ${response.statusText}`);
  }

  return response.json();
}

async function deleteAcademicYear(id: string): Promise<void> {
  const response = await fetch(`/api/v1/academic-years/${id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
    body: JSON.stringify({}), // Add empty body to satisfy content-type requirement
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `Failed to delete academic year: ${response.statusText}`);
  }
}

// React Query hooks
export function useAcademicYears(query: AcademicYearQuery = {}) {
  return useQuery({
    queryKey: ["academic-years", query],
    queryFn: () => fetchAcademicYears(query),
  });
}

export function useActiveAcademicYear() {
  return useQuery({
    queryKey: ["academic-years", "active"],
    queryFn: fetchActiveAcademicYear,
    retry: false, // Don't retry if no active academic year
  });
}

export function useCreateAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAcademicYear,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

export function useUpdateAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAcademicYear }) =>
      updateAcademicYear(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

export function useSetActiveAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setActiveAcademicYear,
    onSuccess: (payload) => {
      const activeId = payload?.data?.id;
      if (activeId) {
        setActiveAcademicYearId(activeId);
      }
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      queryClient.invalidateQueries({ queryKey: ["academic-years", "active"] });
      // Rafraîchir les données dépendantes de l'année active
      queryClient.invalidateQueries();
    },
  });
}

export function useDeleteAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAcademicYear,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

// Export types for use in components
export type { AcademicYear, CreateAcademicYear, UpdateAcademicYear, AcademicYearWithStats };
