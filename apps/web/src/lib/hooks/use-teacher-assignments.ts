"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
export interface TeacherAssignment {
  id: string;
  tenantId: string;
  classCourseId: string;
  classId?: string;
  courseId?: string;
  teacherId: string;
  contractType: "salarie" | "vacataire";
  datebut: string;
  datefin: string;
  courseAmount?: number | null;
  status: "active" | "paused" | "ended" | "cancelled";
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  // Additional fields from API response
  teacherName?: string;
  courseName?: string;
  courseCode?: string;
  className?: string;
  classCode?: string;
  hoursValidated?: number;
  validatedBy?: string;
  validatedAt?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface AssignmentQuery {
  teacherId?: string;
  classId?: string;
  courseId?: string;
  academicYearId?: string;
  status?: TeacherAssignment["status"];
  showAll?: boolean;
  page?: number;
  limit?: number;
}

async function fetchAssignments(query: AssignmentQuery = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== "") searchParams.append(k, String(v));
  });

  // Use the correct API v1 endpoint
  const res = await fetch(`/api/v1/teacher-assignments?${searchParams}`, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error("Failed to fetch assignments");
  return res.json();
}

async function fetchAssignment(id: string): Promise<TeacherAssignment> {
  // Try to use the direct GET endpoint first
  const response = await fetch(`/api/v1/teacher-assignments/${id}`, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  
  if (response.ok) {
    const assignment = await response.json();
    return assignment;
  }
  
  // Fallback to pagination if GET endpoint doesn't exist or returns 404
  if (response.status === 404) {
    // Try with showAll=true to bypass teacher filtering
    let page = 1;
    const limit = 100;
    let assignment: TeacherAssignment | undefined;

    while (!assignment) {
      const listResponse = await fetch(`/api/v1/teacher-assignments?limit=${limit}&page=${page}&showAll=true`, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!listResponse.ok) {
        const errorText = await listResponse.text().catch(() => "");
        const errorJson = await listResponse.json().catch(() => ({}));
        throw new Error(errorJson.message || errorJson.error || errorText || `Failed to fetch assignment ${id}`);
      }
      
      const payload = await listResponse.json();
      
      // Handle different response formats
      let assignments: TeacherAssignment[] = [];
      if (payload.success !== false) {
        if (Array.isArray(payload.data)) {
          assignments = payload.data;
        } else if (payload.data && Array.isArray(payload.data.assignments)) {
          assignments = payload.data.assignments;
        } else if (Array.isArray(payload)) {
          assignments = payload;
        }
      }
      
      // Find the assignment by ID
      assignment = assignments.find((a: any) => a.id === id);
      
      // If not found and there are more pages, continue
      if (!assignment && payload?.pagination && page < payload.pagination.totalPages) {
        page++;
      } else {
        break;
      }
    }
    
    if (!assignment) {
      throw new Error(`Assignment with id ${id} not found`);
    }
    
    return assignment;
  }
  
  // If response is not ok and not 404, throw error
  const errorText = await response.text().catch(() => "");
  const errorJson = await response.json().catch(() => ({}));
  throw new Error(errorJson.message || errorJson.error || errorText || `Failed to fetch assignment ${id}`);
}

export interface CreateAssignmentInput {
  classCourseId?: string;
  classId?: string;
  courseId?: string;
  teacherId: string;
  contractType: "salarie" | "vacataire";
  datebut: string; // YYYY-MM-DD
  datefin: string; // YYYY-MM-DD
  courseAmount?: number;
  status?: TeacherAssignment["status"];
  notes?: string;
}

export interface GenerateMissingAssignmentSessionsInput {
  assignmentIds?: string[];
  startDate?: string;
}

export interface GenerateMissingAssignmentSessionsResult {
  created: number;
  skipped: number;
  assignments: Array<{
    assignmentId: string;
    courseName?: string;
    className?: string;
    teacherName?: string;
    created: number;
    skipped?: boolean;
    reason?: string;
    hoursScheduled?: number;
  }>;
}

async function createAssignment(data: CreateAssignmentInput) {
  const res = await fetch(`/api/v1/teacher-assignments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to create assignment");
  }
  const payload = await res.json();
  return payload.data || payload;
}

async function updateAssignment({ id, data }: { id: string; data: Partial<CreateAssignmentInput> }) {
  const res = await fetch(`/api/v1/teacher-assignments/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to update assignment");
  }
  const payload = await res.json();
  return payload.data || payload;
}

async function deleteAssignment(id: string) {
  const res = await fetch(`/api/v1/teacher-assignments/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `Failed to delete assignment: ${res.statusText}`);
  }
}

async function generateMissingAssignmentSessions(
  data: GenerateMissingAssignmentSessionsInput = {}
): Promise<GenerateMissingAssignmentSessionsResult> {
  const res = await fetch(`/api/v1/teacher-assignments/generate-missing-sessions`, {
    method: "POST",
    headers: createApiHeaders(undefined, {
      "Content-Type": "application/json",
      "X-Academic-Year-Id": "",
    }),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to generate missing sessions");
  }

  const payload = await res.json();
  return payload.data || payload;
}

export function useTeacherAssignments(query: AssignmentQuery = {}) {
  return useQuery({ 
    queryKey: ["teacher-assignments", query], 
    queryFn: () => fetchAssignments(query),
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
  });
}

export function useTeacherAssignment(id?: string) {
  return useQuery({
    queryKey: ["teacher-assignments", id],
    queryFn: () => fetchAssignment(id as string),
    enabled: !!id,
  });
}

export function useCreateTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAssignment,
    onSuccess: async () => { 
      // Invalidate all teacher-assignments queries (with any query params)
      await qc.invalidateQueries({ 
        queryKey: ["teacher-assignments"],
        exact: false, // Invalidate all queries that start with this key
      });
      // Force refetch all matching queries
      await qc.refetchQueries({ 
        queryKey: ["teacher-assignments"],
        exact: false,
      });
    },
  });
}

export function useUpdateTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateAssignment,
    onSuccess: async () => { 
      await qc.invalidateQueries({ 
        queryKey: ["teacher-assignments"],
        exact: false,
      });
      await qc.refetchQueries({ 
        queryKey: ["teacher-assignments"],
        exact: false,
      });
    },
  });
}

export function useDeleteTeacherAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAssignment,
    onSuccess: async () => { 
      await qc.invalidateQueries({ 
        queryKey: ["teacher-assignments"],
        exact: false,
      });
      await qc.refetchQueries({ 
        queryKey: ["teacher-assignments"],
        exact: false,
      });
    },
  });
}

export function useGenerateMissingAssignmentSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateMissingAssignmentSessions,
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["teacher-assignments"],
        exact: false,
      });
      await qc.invalidateQueries({
        queryKey: ["teacher-schedule"],
        exact: false,
      });
    },
  });
}
