"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AcademicYearPeriod {
  id: string;
  tenantId: string;
  academicYearId: string;
  name: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAcademicYearPeriod {
  name: string;
  startDate: string;
  endDate: string;
}

export type UpdateAcademicYearPeriod = Partial<CreateAcademicYearPeriod>;

const headers = {
  "Content-Type": "application/json",
  "X-Tenant": "imhotepacademy",
  "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
};

async function fetchPeriods(academicYearId: string): Promise<{ data: AcademicYearPeriod[] }> {
  const response = await fetch(`/api/v1/academic-years/${academicYearId}/periods`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch periods: ${response.statusText}`);
  }
  return response.json();
}

async function createPeriod(
  academicYearId: string,
  data: CreateAcademicYearPeriod
): Promise<{ data: AcademicYearPeriod }> {
  const response = await fetch(`/api/v1/academic-years/${academicYearId}/periods`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Failed to create period: ${response.statusText}`);
  }
  return response.json();
}

async function updatePeriod(
  academicYearId: string,
  periodId: string,
  data: UpdateAcademicYearPeriod
): Promise<{ data: AcademicYearPeriod }> {
  const response = await fetch(`/api/v1/academic-years/${academicYearId}/periods/${periodId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Failed to update period: ${response.statusText}`);
  }
  return response.json();
}

async function deletePeriod(academicYearId: string, periodId: string): Promise<void> {
  const response = await fetch(`/api/v1/academic-years/${academicYearId}/periods/${periodId}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(err.message || `Failed to delete period: ${response.statusText}`);
  }
}

export function useAcademicYearPeriods(academicYearId: string | undefined) {
  return useQuery({
    queryKey: ["academic-year-periods", academicYearId],
    queryFn: () => fetchPeriods(academicYearId!),
    enabled: Boolean(academicYearId),
  });
}

export function useCreateAcademicYearPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ academicYearId, data }: { academicYearId: string; data: CreateAcademicYearPeriod }) =>
      createPeriod(academicYearId, data),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["academic-year-periods", vars.academicYearId] });
    },
  });
}

export function useUpdateAcademicYearPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      academicYearId,
      periodId,
      data,
    }: {
      academicYearId: string;
      periodId: string;
      data: UpdateAcademicYearPeriod;
    }) => updatePeriod(academicYearId, periodId, data),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["academic-year-periods", vars.academicYearId] });
    },
  });
}

export function useDeleteAcademicYearPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ academicYearId, periodId }: { academicYearId: string; periodId: string }) =>
      deletePeriod(academicYearId, periodId),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["academic-year-periods", vars.academicYearId] });
    },
  });
}
