"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
const API_BASE_URL = "";

export interface AssignmentInstance {
  id: string;
  tenant_id: string;
  assignment_id: string;
  class_id: string;
  academic_year_id: string;
  starts_at?: string;
  ends_at: string;
  status: 'draft' | 'published' | 'archived';
  duration_minutes?: number;
  max_attempts?: number;
  shuffle_questions?: boolean;
  show_results_mode?: 'immediate' | 'after_end' | 'after_correction';
  late_submission_allowed?: boolean;
  late_penalty_percent?: number;
  overrides?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateAssignmentInstance {
  assignment_id: string;
  class_id: string;
  academic_year_id: string;
  starts_at?: string;
  ends_at: string;
  duration_minutes?: number;
  max_attempts?: number;
  shuffle_questions?: boolean;
  show_results_mode?: 'immediate' | 'after_end' | 'after_correction';
  late_submission_allowed?: boolean;
  late_penalty_percent?: number;
  overrides?: Record<string, any>;
}

async function createInstance(data: CreateAssignmentInstance): Promise<AssignmentInstance> {
  const processed = {
    ...data,
    ...(data.starts_at ? { starts_at: new Date(data.starts_at).toISOString() } : {}),
    ends_at: new Date(data.ends_at).toISOString(),
  };

  const res = await fetch(`/api/v1/assignment-instances`, {
    method: 'POST',
    headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(processed),
  });
  if (!res.ok) throw new Error('Failed to create assignment instance');
  return res.json();
}

async function listInstances(query: Partial<{ class_id: string; assignment_id: string; academic_year_id: string; page: number; limit: number; status?: string; search?: string; }>) {
  const sp = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== '') sp.append(k, String(v)); });
  const res = await fetch(`/api/v1/assignment-instances?${sp}`, {
    headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
  });
  if (!res.ok) throw new Error('Failed to fetch assignment instances');
  return res.json();
}

export function useCreateAssignmentInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createInstance,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignment-instances'] });
    }
  });
}

export function useAssignmentInstances(query: Partial<{ class_id: string; assignment_id: string; academic_year_id: string; page: number; limit: number; status?: string; search?: string; }>) {
  return useQuery({
    queryKey: ['assignment-instances', query],
    queryFn: () => listInstances(query),
  });
}

