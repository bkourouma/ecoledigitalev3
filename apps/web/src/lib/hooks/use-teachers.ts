"use client";

import { createApiHeaders } from "@/lib/api-utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useMemo } from "react";
import { getToken, getUserFromToken } from "@/lib/jwt-storage";
import {
  Teacher,
  CreateTeacher,
  UpdateTeacher,
  TeacherQuery,
  ContractType,
  TeacherStatus
} from "@ecoledigitale/contracts";

// Types for teacher-specific data
export interface TeacherAssignment {
  id: string;
  teacherId: string;
  classId: string;
  courseId: string;
  classCourseId?: string;
  contractType: 'salarie' | 'vacataire';
  datebut: string;
  datefin: string;
  courseAmount?: number;
  status: 'active' | 'paused' | 'ended' | 'cancelled';
  notes?: string;
  // Joined data
  courseName?: string;
  className?: string;
  classCode?: string;
  courseCode?: string;
  credits?: number;
  hoursTotal?: number;
}

export interface TeachingHour {
  id: string;
  teacherId: string;
  assignmentId: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  sessionType: 'theory' | 'practical' | 'exam' | 'evaluation' | 'supervision';
  validated: boolean;
  validatedBy?: string;
  validatedAt?: string;
  hourlyRate?: number;
  amount?: number;
  notes?: string;
  // Joined data
  courseName?: string;
  className?: string;
}

export interface TeacherPayment {
  id: string;
  teacherId: string;
  periodId: string;
  totalHours: number;
  grossAmount: number;
  deductions: number;
  netAmount: number;
  status: 'pending' | 'processing' | 'paid' | 'cancelled';
  paymentDate?: string;
  paymentMethod?: string;
  reference?: string;
  // Joined data
  periodName?: string;
  periodStart?: string;
  periodEnd?: string;
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

function getTeacherTenantScope(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  const selectedTenant = window.localStorage.getItem("superAdminSelectedTenant");
  if (selectedTenant) {
    return `super-admin:${selectedTenant}`;
  }

  const token = getToken();
  const user = token ? getUserFromToken(token) : null;

  if (user?.tenantId) {
    return `tenant-id:${user.tenantId}`;
  }

  if (user?.tenantSlug) {
    return `tenant-slug:${user.tenantSlug}`;
  }

  return "tenant:unknown";
}

// API functions
async function fetchTeachers(query: Partial<TeacherQuery>): Promise<{ data: Teacher[]; pagination: any }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") {
      searchParams.append(key, String(value));
    }
  });

  const response = await fetch(`/api/v1/teachers?${searchParams}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch teachers");
  }

  return response.json();
}

async function fetchTeacher(id: string): Promise<Teacher> {
  const response = await fetch(`/api/v1/teachers/${id}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch teacher");
  }

  return response.json();
}

async function createTeacher(data: CreateTeacher): Promise<Teacher> {
  const response = await fetch(`/api/v1/teachers`, {
    method: "POST",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to create teacher");
  }

  return response.json();
}

async function updateTeacher(id: string, data: UpdateTeacher): Promise<Teacher> {
  const response = await fetch(`/api/v1/teachers/${id}`, {
    method: "PUT",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update teacher");
  }

  return response.json();
}

async function resetTeacherPassword(
  teacherId: string
): Promise<{ teacherId: string; initialPassword: string; message: string }> {
  const response = await fetch(`/api/v1/teachers/${teacherId}/reset-password`, {
    method: "POST",
    headers: createAcademicHeaders(),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Impossible de réinitialiser le mot de passe");
  }

  return response.json();
}

async function deleteTeacher(id: string): Promise<void> {
  const headers = createAcademicHeaders();
  delete headers["Content-Type"];

  const response = await fetch(`/api/v1/teachers/${id}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    let errorMessage = "Impossible de supprimer l'enseignant";
    try {
      const error = await response.json();
      const backendMessage = error.message || error.error || "";
      
      // Provide user-friendly messages for specific errors
      if (response.status === 404) {
        errorMessage = "Enseignant introuvable. La liste va être actualisée.";
      } else if (response.status === 409) {
        if (backendMessage.includes("courses") || backendMessage.includes("cours")) {
          errorMessage = "Impossible de supprimer l'enseignant car il est associé à des cours.\n\nVeuillez d'abord retirer l'enseignant de tous les cours avant de le supprimer.";
        } else if (backendMessage.includes("assignments") || backendMessage.includes("devoirs")) {
          errorMessage = "Impossible de supprimer l'enseignant car il contient des devoirs associés.\n\nVeuillez d'abord supprimer tous les devoirs de l'enseignant avant de le supprimer.";
        } else {
          errorMessage = backendMessage || "L'enseignant ne peut pas être supprimé car il contient des éléments associés.";
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
export function useTeachers(query: Partial<TeacherQuery> = {}) {
  const tenantScope = getTeacherTenantScope();

  return useQuery({
    queryKey: ["teachers", tenantScope, query],
    queryFn: () => fetchTeachers(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to fetch all teachers (with pagination)
export function useAllTeachers() {
  const tenantScope = getTeacherTenantScope();

  return useQuery({
    queryKey: ["all-teachers", tenantScope],
    queryFn: async () => {
      const allTeachers: Teacher[] = [];
      let page = 1;
      const limit = 100; // Max allowed by API
      let totalPages = 1;

      // First request to get total count and first page
      const firstResult = await fetchTeachers({ page, limit });
      console.log('First page result:', firstResult);
      
      if (firstResult.data && firstResult.data.length > 0) {
        allTeachers.push(...firstResult.data);
      }
      
      if (firstResult.pagination) {
        totalPages = firstResult.pagination.totalPages || 1;
        console.log(`Total pages: ${totalPages}, Total teachers: ${firstResult.pagination.total}`);
        
        // Fetch remaining pages if any
        const remainingPages = [];
        for (let p = 2; p <= totalPages; p++) {
          remainingPages.push(fetchTeachers({ page: p, limit }));
        }
        
        const remainingResults = await Promise.all(remainingPages);
        remainingResults.forEach((result) => {
          if (result.data && result.data.length > 0) {
            allTeachers.push(...result.data);
          }
        });
      }

      console.log(`Fetched ${allTeachers.length} teachers total`);
      return {
        data: allTeachers,
        pagination: {
          total: allTeachers.length,
          page: 1,
          limit: allTeachers.length,
          totalPages: 1,
        },
      };
    },
    enabled: true,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useTeacher(id: string) {
  const tenantScope = getTeacherTenantScope();

  return useQuery({
    queryKey: ["teachers", tenantScope, id],
    queryFn: () => fetchTeacher(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateTeacher() {
  const queryClient = useQueryClient();
  const tenantScope = getTeacherTenantScope();

  return useMutation({
    mutationFn: createTeacher,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope] });
      queryClient.invalidateQueries({ queryKey: ["all-teachers", tenantScope] });
    },
  });
}

export function useUpdateTeacher() {
  const queryClient = useQueryClient();
  const tenantScope = getTeacherTenantScope();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTeacher }) => updateTeacher(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope] });
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope, id] });
      queryClient.invalidateQueries({ queryKey: ["all-teachers", tenantScope] });
    },
  });
}

export function useDeleteTeacher() {
  const queryClient = useQueryClient();
  const tenantScope = getTeacherTenantScope();

  return useMutation({
    mutationFn: deleteTeacher,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope] });
      queryClient.invalidateQueries({ queryKey: ["all-teachers", tenantScope] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope] });
      queryClient.invalidateQueries({ queryKey: ["all-teachers", tenantScope] });
    },
  });
}

export function useResetTeacherPassword() {
  const queryClient = useQueryClient();
  const tenantScope = getTeacherTenantScope();

  return useMutation({
    mutationFn: resetTeacherPassword,
    onSuccess: (_, teacherId) => {
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope] });
      queryClient.invalidateQueries({ queryKey: ["teachers", tenantScope, teacherId] });
      queryClient.invalidateQueries({ queryKey: ["all-teachers", tenantScope] });
    },
  });
}

// Helper hook to get current teacher ID
export function useCurrentTeacherId() {
  const { data: session } = useSession();
  const tenantScope = getTeacherTenantScope();

  return useQuery({
    queryKey: ["current-teacher-id", "by-email-v2", tenantScope, session?.user?.email],
    queryFn: async () => {
      if (!session?.user?.email) return null;

      const targetEmail = session.user.email.trim().toLowerCase();
      const response = await fetch(`/api/v1/teachers?email=${encodeURIComponent(targetEmail)}&limit=100`, {
        headers: createAcademicHeaders(),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch teacher ID");
      }

      const data = await response.json();
      const teachers = Array.isArray(data.data) ? data.data : [];
      const matchedTeacher = teachers.find((teacher: any) => (
        typeof teacher?.email === "string" && teacher.email.trim().toLowerCase() === targetEmail
      ));

      return matchedTeacher?.id || null;
    },
    enabled: !!session?.user?.email,
  });
}

// Teacher-specific hooks for current user

export function useTeachingHours(teacherId?: string, fromDate?: string, toDate?: string) {
  return useQuery({
    // Don't include teacherId in query key since backend resolves it from user header
    queryKey: ["teaching-hours", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (fromDate) params.append("fromDate", fromDate);
      if (toDate) params.append("toDate", toDate);
      // teacherId is optional - backend resolves it from user header if not provided
      if (teacherId) params.append("teacherId", teacherId);

      const queryString = params.toString();

      const response = await fetch(`/api/teacher/attendance${queryString ? `?${queryString}` : ""}`);

      if (!response.ok) {
        throw new Error("Failed to fetch teaching hours");
      }

      const data = await response.json();
      console.log('=== useTeachingHours Hook Debug ===');
      console.log('API Response:', data);
      console.log('Data array length:', data?.data?.length);
      console.log('Totals:', data?.totals);
      return data;
    },
    // Enable query even without teacherId - backend resolves it from X-User-Id header
    enabled: true,
  });
}

export function useTeacherPayments(teacherId?: string, periodId?: string) {
  const { data: session } = useSession();
  
  return useQuery({
    queryKey: ["teacher-payments", teacherId, periodId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (teacherId) params.append("teacherId", teacherId);
      if (periodId) params.append("periodId", periodId);
      
      const response = await fetch(`/api/v1/teacher-payments?${params.toString()}`, {
        headers: {
          "Content-Type": "application/json"
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to fetch teacher payments");
      }

      return response.json();
    },
    enabled: !!teacherId,
  });
}

export function useTeacherSchedule(teacherId?: string, weekStart?: string) {
  return useQuery({
    queryKey: ["teacher-schedule", teacherId, weekStart],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (teacherId) params.append("teacherId", teacherId);
      if (weekStart) params.append("weekStart", weekStart);

      // Fetch scheduled sessions for the teacher
      const response = await fetch(`/api/v1/teacher/assignments/scheduled-sessions?${params}`, {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch teacher schedule");
      }

      return response.json();
    },
    enabled: !!teacherId,
  });
}

export function useTeacherAssignments() {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery({
    queryKey: ["teacher-assignments", userId],
    queryFn: async () => {
      if (!userId) {
        throw new Error("User ID not found in session");
      }

      const response = await fetch(`/api/v1/teacher-assignments`, {
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "imhotepacademy",
          "X-User-Id": userId
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch teacher assignments");
      }

      const data = await response.json();

      // Ensure we return an array
      if (Array.isArray(data)) {
        return data;
      } else if (data?.data && Array.isArray(data.data)) {
        return data.data;
      } else {
        console.warn("Teacher assignments API returned unexpected format:", data);
        return [];
      }
    },
    enabled: !!userId,
  });
}

export function useTeacherAssignmentStudents(assignmentId?: string) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery({
    queryKey: ["teacher-assignment-students", assignmentId, userId],
    queryFn: async () => {
      if (!assignmentId) return [];
      if (!userId) {
        throw new Error("User ID not found in session");
      }

      const response = await fetch(`/api/v1/teacher-assignments/${assignmentId}/students`, {
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "imhotepacademy",
          "X-User-Id": userId
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch assignment students");
      }

      const data = await response.json();

      // Ensure we return an array
      if (Array.isArray(data)) {
        return data;
      } else if (data?.data && Array.isArray(data.data)) {
        return data.data;
      } else {
        console.warn("Assignment students API returned unexpected format:", data);
        return [];
      }
    },
    enabled: !!assignmentId && !!userId,
  });
}

export function useTeacherStudents() {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  const { data: assignmentsResponse, isLoading: assignmentsLoading, error: assignmentsError } = useTeacherAssignments();

  // Ensure assignments is always an array, with proper null/undefined checks
  const assignments = useMemo(() => {
    if (!assignmentsResponse) return [];
    if (Array.isArray(assignmentsResponse)) return assignmentsResponse;
    if (assignmentsResponse?.data && Array.isArray(assignmentsResponse.data)) return assignmentsResponse.data;
    return [];
  }, [assignmentsResponse]);

  return useQuery({
    queryKey: ["teacher-all-students", Array.isArray(assignments) ? assignments.map((a: any) => a.id).join(",") : "empty", userId],
    queryFn: async () => {
      if (!userId) {
        throw new Error("User ID not found in session");
      }
      if (!Array.isArray(assignments) || !assignments.length) return [];

      // Fetch students for all assignments
      const studentPromises = (Array.isArray(assignments) ? assignments : []).map(async (assignment: any) => {
        const response = await fetch(`/api/v1/teacher-assignments/${assignment.id}/students`, {
          headers: {
            "Content-Type": "application/json",
            "X-Tenant": "imhotepacademy",
            "X-User-Id": userId
          },
        });

        if (!response.ok) {
          console.warn(`Failed to fetch students for assignment ${assignment.id}`);
          return [];
        }

        const data = await response.json();
        const students = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
        
        return students.map((student: any) => ({
          ...student,
          course: assignment.courseName || assignment.course?.name || 'Non assigné',
          courseId: assignment.id,
          level: assignment.className || assignment.class?.name || 'Non défini',
          assignmentId: assignment.id
        }));
      });

      const allStudentsArrays = await Promise.all(studentPromises);
      const allStudents = allStudentsArrays.flat();

      // Remove duplicates based on student ID
      const uniqueStudents = allStudents.filter((student, index, self) =>
        index === self.findIndex(s => s.id === student.id)
      );

      return uniqueStudents;
    },
    enabled: !!userId && !assignmentsLoading && !assignmentsError && Array.isArray(assignments) && assignments.length > 0,
  });
}

// New hook for teacher students with class filtering (Feature: 001-modify-teacher-students)
export function useTeacherStudentsByClass(classId?: string, includeMetrics?: boolean) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery({
    queryKey: ["teacher-students", classId, includeMetrics, userId],
    queryFn: async () => {
      if (!userId) {
        throw new Error("User ID not found in session");
      }

      const params = new URLSearchParams();
      if (classId && classId !== 'all') params.append('classId', classId);
      if (includeMetrics) params.append('includeMetrics', 'true');
      const headers = createApiHeaders(session);

      const response = await fetch(
        `/api/v1/teacher/students?${params}`,
        {
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch teacher students");
      }

      return response.json();
    },
    enabled: !!userId, // Only run query when userId is available
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Types are now imported from @ecoledigitale/contracts
