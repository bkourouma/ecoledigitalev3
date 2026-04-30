"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Exam Schedule Types
export interface ExamSchedule {
  id: string;
  tenantId: string;
  courseId: string;
  courseName?: string;
  academicYearId: string;
  academicYearName?: string;
  name: string;
  type: 'midterm' | 'final' | 'quiz' | 'assignment' | 'other';
  examDate: string;
  examTime: string | null;
  duration: number | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExamSchedule {
  courseId: string;
  academicYearId: string;
  name: string;
  type: 'midterm' | 'final' | 'quiz' | 'assignment' | 'other';
  examDate: string;
  examTime?: string;
  duration?: number;
  location?: string;
}

export interface UpdateExamSchedule {
  courseId?: string;
  academicYearId?: string;
  name?: string;
  type?: 'midterm' | 'final' | 'quiz' | 'assignment' | 'other';
  examDate?: string;
  examTime?: string;
  duration?: number;
  location?: string;
}

export interface ExamScheduleQuery {
  courseId?: string;
  academicYearId?: string;
  type?: string;
  page?: number;
  limit?: number;
}

// API functions
async function fetchExamSchedules(query: ExamScheduleQuery = {}): Promise<{ data: ExamSchedule[]; pagination?: any }> {
  const searchParams = new URLSearchParams();
  
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const url = `/api/v1/exam-schedules${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch exam schedules");
  }

  const payload = await response.json();
  
  // Handle both paginated and non-paginated responses
  if (payload.success !== false) {
    if (Array.isArray(payload.data)) {
      return { data: payload.data };
    } else if (payload.data && Array.isArray(payload.data.events)) {
      return { data: payload.data.events };
    } else if (Array.isArray(payload)) {
      return { data: payload };
    } else {
      return { data: [] };
    }
  }
  
  return { data: [] };
}

async function fetchExamSchedule(id: string): Promise<ExamSchedule> {
  // Since there's no GET /exam-schedules/:id endpoint, we use the list endpoint
  // and filter client-side. We fetch with max limit (100) and paginate if needed.
  let page = 1;
  const limit = 100;
  let examSchedule: ExamSchedule | undefined;

  // Try to find the exam schedule by paginating through results
  while (!examSchedule) {
    const response = await fetch(`/api/v1/exam-schedules?limit=${limit}&page=${page}`, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `Failed to fetch exam schedule ${id}`);
    }
    
    const payload = await response.json();
    
    // Handle different response formats
    let schedules: ExamSchedule[] = [];
    if (payload.success !== false) {
      if (Array.isArray(payload.data)) {
        schedules = payload.data;
      } else if (payload.data && Array.isArray(payload.data.events)) {
        schedules = payload.data.events;
      } else if (Array.isArray(payload)) {
        schedules = payload;
      }
    }
    
    // Find the exam schedule by ID
    examSchedule = schedules.find((e: any) => e.id === id);
    
    // If not found and there are more pages, continue
    if (!examSchedule && payload?.pagination && page < payload.pagination.totalPages) {
      page++;
    } else {
      break;
    }
  }
  
  if (!examSchedule) {
    throw new Error(`Exam schedule with id ${id} not found`);
  }
  
  return examSchedule;
}

async function createExamSchedule(data: CreateExamSchedule): Promise<ExamSchedule> {
  const response = await fetch(`/api/v1/exam-schedules`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || "Failed to create exam schedule");
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function updateExamSchedule(id: string, data: UpdateExamSchedule): Promise<ExamSchedule> {
  const response = await fetch(`/api/v1/exam-schedules/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || "Failed to update exam schedule");
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function deleteExamSchedule(id: string): Promise<void> {
  const response = await fetch(`/api/v1/exam-schedules/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || `Failed to delete exam schedule: ${response.statusText}`);
  }
}

// React Query hooks
export function useExamSchedules(query: ExamScheduleQuery = {}) {
  return useQuery({
    queryKey: ["exam-schedules", query],
    queryFn: () => fetchExamSchedules(query),
  });
}

export function useExamSchedule(id?: string) {
  return useQuery({
    queryKey: ["exam-schedules", id],
    queryFn: () => fetchExamSchedule(id as string),
    enabled: !!id,
  });
}

export function useCreateExamSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createExamSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-schedules"] });
    },
  });
}

export function useUpdateExamSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateExamSchedule }) =>
      updateExamSchedule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-schedules"] });
    },
  });
}

export function useDeleteExamSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteExamSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-schedules"] });
    },
  });
}

