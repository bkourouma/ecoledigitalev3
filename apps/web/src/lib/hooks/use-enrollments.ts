"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
// Temporary inline types until contracts package is properly built
interface FeeStructure {
  inscription: number;
  scolarite: number;
  annexes: number;
  autres: number;
  total: number;
  currency: string;
}

interface StudentEnrollment {
  id: string;
  tenantId: string;
  studentId: string;
  classId: string;
  academicYearId: string;
  fees: FeeStructure;
  originSchool?: string;
  lv2?: string;
  scholarshipLevel?: 'oui' | 'non';
  isRepeating?: boolean;
  isTransfer?: boolean;
  isInscribed?: boolean;
  transferDecision?: string;
  affectationStatus?: 'affecte' | 'non_affecte' | 'prise_en_charge';
  affectationDecision?: string;
  cepeCode?: string;
  enrollmentDate: string;
  status: 'active' | 'suspended' | 'completed' | 'dropped' | 'transferred';
  createdAt: string;
  updatedAt: string;
  // Optional expanded relations when includeDetails=true
  student?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    studentNumber: string;
  };
  class?: {
    id: string;
    name: string;
    code: string;
    programme?: { name: string; code: string };
  };
  academicYear?: { id: string; name: string };
}

interface CreateStudentEnrollment {
  studentId: string;
  classId: string;
  academicYearId: string;
  originSchool?: string;
  lv2?: string;
  scholarshipLevel?: 'oui' | 'non';
  isRepeating?: boolean;
  isTransfer?: boolean;
  isInscribed?: boolean;
  transferDecision?: string;
  affectationStatus?: 'affecte' | 'non_affecte' | 'prise_en_charge';
  affectationDecision?: string;
  cepeCode?: string;
  fees: {
    inscription: number;
    scolarite: number;
    annexes: number;
    autres: number;
    currency: string;
  };
  enrollmentDate?: string;
  status?: 'active' | 'suspended' | 'completed' | 'dropped' | 'transferred';
}

interface UpdateStudentEnrollment {
  classId?: string;
  originSchool?: string;
  lv2?: string;
  scholarshipLevel?: 'oui' | 'non';
  isRepeating?: boolean;
  isTransfer?: boolean;
  isInscribed?: boolean;
  transferDecision?: string;
  affectationStatus?: 'affecte' | 'non_affecte' | 'prise_en_charge';
  affectationDecision?: string;
  cepeCode?: string;
  enrollmentDate?: string; // YYYY-MM-DD
  fees?: {
    inscription?: number;
    scolarite?: number;
    annexes?: number;
    autres?: number;
    currency?: string;
  };
  status?: 'active' | 'suspended' | 'completed' | 'dropped' | 'transferred';
}

interface BulkEnrollment {
  studentIds: string[];
  classId: string;
  academicYearId: string;
  fees: {
    inscription: number;
    scolarite: number;
    annexes: number;
    autres: number;
    currency: string;
  };
}

interface StudentEnrollmentWithDetails extends StudentEnrollment {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    studentNumber: string;
  };
  class: {
    id: string;
    name: string;
    code: string;
    programme: {
      name: string;
      code: string;
    };
  };
  academicYear: {
    id: string;
    name: string;
  };
}

// Use backend API directly - Next.js proxy not configured for all endpoints
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface EnrollmentQuery {
  page?: number;
  limit?: number;
  classId?: string;
  academicYearId?: string;
  studentId?: string;
  status?: string;
  includeDetails?: boolean;
}

interface AvailableStudent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  studentNumber: string;
}

interface BulkEnrollmentResult {
  successful: StudentEnrollment[];
  failed: Array<{
    studentId: string;
    error: string;
  }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}
// Helper to safely parse JSON strings
function safeParseJSON<T = any>(value: any): T | any {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return value;
  }
}


// API functions
async function fetchEnrollments(query: EnrollmentQuery = {}): Promise<{ data: StudentEnrollmentWithDetails[]; pagination: any }> {
  const searchParams = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });
  const response = await fetch(`${API_BASE_URL}/api/v1/enrollments?${searchParams}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch enrollments: ${response.statusText}`);
  }
  const payload = await response.json();

  // Normalize a possible stringified JSON fees returned by Postgres/driver
  const normalized = Array.isArray(payload?.data)
    ? payload.data.map((e: any) => ({
        ...e,
        fees: typeof e.fees === 'string' ? safeParseJSON(e.fees) : e.fees,
      }))
    : payload?.data;
  return { ...payload, data: normalized } as any;
}

// Fetch single enrollment by ID (optionally with details)
async function fetchEnrollmentById(id: string): Promise<{ data: StudentEnrollment }> {
  // Since there's no GET /enrollments/:id endpoint, we use the list endpoint
  // and filter client-side. We fetch with max limit (100) and paginate if needed.
  let page = 1;
  const limit = 100;
  let enrollment: StudentEnrollment | undefined;

  // Try to find the enrollment by paginating through results
  while (!enrollment) {
    const response = await fetch(`${API_BASE_URL}/api/v1/enrollments?limit=${limit}&page=${page}`, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `Failed to fetch enrollment ${id}`);
    }
    
    const payload = await response.json();
    
    // Normalize fees for all enrollments
    const normalized = Array.isArray(payload?.data)
      ? payload.data.map((e: any) => ({
          ...e,
          fees: typeof e.fees === 'string' ? safeParseJSON(e.fees) : e.fees,
        }))
      : payload?.data;
    
    // Find the enrollment by ID
    if (Array.isArray(normalized)) {
      enrollment = normalized.find((e: any) => e.id === id);
    }
    
    // If not found and there are more pages, continue
    if (!enrollment && payload?.pagination && page < payload.pagination.totalPages) {
      page++;
    } else {
      break;
    }
  }
  
  if (!enrollment) {
    throw new Error(`Enrollment with id ${id} not found`);
  }
  
  return { data: enrollment } as any;
}

async function fetchAvailableStudents(academicYearId?: string, search?: string): Promise<{ data: AvailableStudent[] }> {
  const searchParams = new URLSearchParams();

  if (academicYearId) {
    searchParams.append("academicYearId", academicYearId);
  }

  if (search) {
    searchParams.append("search", search);
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/enrollments/available-students?${searchParams}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch available students: ${response.statusText}`);
  }

  return response.json();
}

async function createEnrollment(data: CreateStudentEnrollment): Promise<{ data: StudentEnrollment }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/enrollments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to create enrollment: ${response.statusText}`);
  }

  return response.json();
}

async function createBulkEnrollments(data: BulkEnrollment): Promise<{ data: BulkEnrollmentResult }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/enrollments/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to create bulk enrollments: ${response.statusText}`);
  }

  return response.json();
}

async function updateEnrollment(id: string, data: UpdateStudentEnrollment): Promise<{ data: StudentEnrollment }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/enrollments/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to update enrollment: ${response.statusText}`);
  }

  return response.json();
}

async function deleteEnrollment(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/enrollments/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to delete enrollment: ${response.statusText}`);
  }
}

// React Query hooks
export function useEnrollments(
  query: EnrollmentQuery = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["enrollments", query],
    queryFn: () => fetchEnrollments(query),
    ...options,
  });
}

export function useAvailableStudents(academicYearId?: string, search?: string) {
  return useQuery({
    queryKey: ["enrollments", "available-students", { academicYearId, search }],
    queryFn: () => fetchAvailableStudents(academicYearId, search),
    enabled: !!academicYearId,
  });
}

export function useEnrollment(enrollmentId?: string) {
  return useQuery({
    queryKey: ["enrollments", enrollmentId],
    queryFn: () => fetchEnrollmentById(enrollmentId as string),
    enabled: !!enrollmentId,
  });
}

export function useCreateEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createEnrollment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

export function useCreateBulkEnrollments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createBulkEnrollments,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

export function useUpdateEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStudentEnrollment }) =>
      updateEnrollment(id, data),
    onSuccess: (_data, variables) => {
      // Refresh lists and the specific enrollment details
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      if (variables?.id) {
        queryClient.invalidateQueries({ queryKey: ["enrollments", variables.id] });
      }
    },
  });
}

export function useDeleteEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteEnrollment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

// Export types for use in components
export type {
  StudentEnrollment,
  CreateStudentEnrollment,
  UpdateStudentEnrollment,
  BulkEnrollment,
  StudentEnrollmentWithDetails,
  AvailableStudent,
  BulkEnrollmentResult
};
