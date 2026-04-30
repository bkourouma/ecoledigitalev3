"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from '@/lib/api-utils';
import { 
  TeacherPaymentConfig, 
  CreateTeacherPaymentConfig, 
  UpdateTeacherPaymentConfig
} from "@ecoledigitale/contracts";

// API functions
async function fetchTeacherPaymentConfigs(): Promise<{ data: TeacherPaymentConfig[] }> {
  const response = await fetch('/api/v1/teacher-payment-configs', {
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
      "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch teacher payment configs");
  }

  return response.json();
}

async function fetchTeacherPaymentConfig(id: string): Promise<TeacherPaymentConfig> {
  // Let fetch-interceptor handle headers automatically
  const response = await fetch(`/api/v1/teacher-payment-configs/${id}`, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Failed to fetch teacher payment config");
  }

  const payload = await response.json();
  // API returns { data: TeacherPaymentConfig }
  return payload.data || payload;
}

async function createTeacherPaymentConfig(data: CreateTeacherPaymentConfig): Promise<TeacherPaymentConfig> {
  // Convert dates to YYYY-MM-DD format for API
  const payload = {
    ...data,
    effectiveFrom: typeof data.effectiveFrom === 'string' 
      ? data.effectiveFrom 
      : data.effectiveFrom.toISOString().split('T')[0],
    effectiveTo: data.effectiveTo 
      ? (typeof data.effectiveTo === 'string' 
          ? data.effectiveTo 
          : data.effectiveTo.toISOString().split('T')[0])
      : undefined,
  };

  const response = await fetch('/api/v1/teacher-payment-configs', {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
      "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to create teacher payment config");
  }

  return response.json();
}

async function updateTeacherPaymentConfig(id: string, data: UpdateTeacherPaymentConfig): Promise<TeacherPaymentConfig> {
  // Convert dates to YYYY-MM-DD format for API
  const payload: any = { ...data };
  if (payload.effectiveFrom) {
    payload.effectiveFrom = typeof payload.effectiveFrom === 'string' 
      ? payload.effectiveFrom 
      : payload.effectiveFrom.toISOString().split('T')[0];
  }
  if (payload.effectiveTo) {
    payload.effectiveTo = typeof payload.effectiveTo === 'string' 
      ? payload.effectiveTo 
      : payload.effectiveTo.toISOString().split('T')[0];
  }

  const response = await fetch(`/api/v1/teacher-payment-configs/${id}`, {
    method: 'PUT',
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
      "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update teacher payment config");
  }

  return response.json();
}

async function deleteTeacherPaymentConfig(id: string): Promise<void> {
  const response = await fetch(`/api/v1/teacher-payment-configs/${id}`, {
    method: 'DELETE',
    headers: {
      "X-Tenant": "imhotepacademy",
      "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to delete teacher payment config");
  }
}

// Hooks
export function useTeacherPaymentConfigs() {
  return useQuery({
    queryKey: ["teacher-payment-configs"],
    queryFn: fetchTeacherPaymentConfigs,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useTeacherPaymentConfig(id: string) {
  return useQuery({
    queryKey: ["teacher-payment-configs", id],
    queryFn: () => fetchTeacherPaymentConfig(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateTeacherPaymentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTeacherPaymentConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs"] });
    },
  });
}

export function useUpdateTeacherPaymentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTeacherPaymentConfig }) => 
      updateTeacherPaymentConfig(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs", id] });
    },
  });
}

export function useDeleteTeacherPaymentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTeacherPaymentConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs"] });
    },
  });
}

