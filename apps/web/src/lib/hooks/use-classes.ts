"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import { useSession } from "next-auth/react";
// Temporary inline types until contracts package is properly built
interface Class {
  id: string;
  tenantId: string;
  programmeId: string;
  academicYearId: string;
  name: string;
  code: string;
  maxStudents: number;
  createdAt: string;
  updatedAt: string;
  classroomId?: string | null;
}

interface CreateClass {
  programmeId: string;
  academicYearId: string;
  name: string;
  code?: string;
  maxStudents?: number;
  courseIds?: string[];
  classroomId?: string; // optionnel
}

interface UpdateClass {
  programmeId?: string; // permettre le changement de programme lors de l’édition
  name?: string;
  code?: string;
  maxStudents?: number;
  courseIds?: string[];
  classroomId?: string;
}

interface ClassWithDetails extends Class {
  programme: {
    id: string;
    name: string;
    code: string;
  };
  academicYear: {
    id: string;
    name: string;
    /** YYYY-MM-DD — bornes pour affectations, etc. */
    startDate?: string | null;
    endDate?: string | null;
  };
  classroom?: {
    id: string;
    name: string;
    code: string;
    capacity?: number;
  } | null;
  courseCount: number;
  studentCount: number;
  courses?: {
    id: string;
    name: string;
    code: string;
    isRequired: boolean;
  }[];
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ClassQuery {
  page?: number;
  limit?: number;
  programmeId?: string;
  academicYearId?: string;
  includeDetails?: boolean;
}

interface AvailableCourse {
  id: string;
  name: string;
  code: string;
  credits: number;
  teachingUnitName: string;
}

// API functions
async function fetchClasses(query: ClassQuery = {}): Promise<{ data: ClassWithDetails[]; pagination: any }> {
  const searchParams = new URLSearchParams();
  
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/classes?${searchParams}`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch classes: ${response.statusText}`);
  }

  return response.json();
}

async function fetchClass(id: string, includeCourses = false): Promise<{ data: ClassWithDetails }> {
  const searchParams = new URLSearchParams();
  if (includeCourses) {
    searchParams.append("includeCourses", "true");
  }

  const response = await fetch(`/api/v1/classes/${id}?${searchParams}`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch class: ${response.statusText}`);
  }

  return response.json();
}

async function fetchAvailableCourses(programmeId: string): Promise<{ data: AvailableCourse[] }> {
  const response = await fetch(`/api/v1/classes/programme/${programmeId}/available-courses`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch available courses: ${response.statusText}`);
  }

  return response.json();
}

async function createClass(data: CreateClass): Promise<{ data: Class }> {
  const response = await fetch(`/api/v1/classes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to create class: ${response.statusText}`);
  }

  return response.json();
}

async function updateClass(id: string, data: UpdateClass): Promise<{ data: Class }> {
  const response = await fetch(`/api/v1/classes/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to update class: ${response.statusText}`);
  }

  return response.json();
}

async function deleteClass(id: string): Promise<void> {
  const response = await fetch(`/api/v1/classes/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to delete class: ${response.statusText}`);
  }
}

// React Query hooks
export function useClasses(query: ClassQuery = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["classes", query],
    queryFn: () => fetchClasses(query),
    enabled: options?.enabled ?? true,
  });
}

export function useClassesByProgramme(programmeId: string) {
  return useQuery({
    queryKey: ["classes", "programme", programmeId],
    queryFn: () => fetchClasses({ programmeId, includeDetails: true }),
    enabled: !!programmeId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useClass(id: string, includeCourses = false) {
  return useQuery({
    queryKey: ["classes", id, { includeCourses }],
    queryFn: () => fetchClass(id, includeCourses),
    enabled: !!id,
  });
}

export function useAvailableCourses(programmeId: string) {
  return useQuery({
    queryKey: ["classes", "available-courses", programmeId],
    queryFn: () => fetchAvailableCourses(programmeId),
    enabled: !!programmeId,
  });
}

async function fetchClassCourses(classId: string): Promise<{ data: any[] }> {
  const response = await fetch(`/api/v1/classes/${classId}/courses`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch class courses: ${response.statusText}`);
  }

  return response.json();
}

export function useClassCourses(classId: string) {
  return useQuery({
    queryKey: ["classes", classId, "courses"],
    queryFn: () => fetchClassCourses(classId),
    enabled: !!classId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createClass,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });
}

export function useUpdateClass() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateClass }) =>
      updateClass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });
}

export function useDeleteClass() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteClass,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });
}

// Teacher-specific classes hook
export function useTeacherClasses() {
  const { data: session } = useSession();
  
  return useQuery({
    queryKey: ["teacher-classes", session?.user?.email],
    queryFn: async () => {
      if (!session?.user?.email) {
        throw new Error("No user email found");
      }

      // First get the teacher ID from email
      const teacherResponse = await fetch(`/api/v1/teachers?email=${session.user.email}`, {
        headers: {
          "Content-Type": "application/json",
          // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
        },
      });

      if (!teacherResponse.ok) {
        throw new Error("Failed to fetch teacher");
      }

      const teacherData = await teacherResponse.json();
      const teacher = teacherData.data?.[0];
      
      if (!teacher) {
        throw new Error("Teacher not found");
      }

      // Now fetch the teacher's classes using the new endpoint
      const classesResponse = await fetch(`/api/v1/teacher/students/classes`, {
        headers: {
          "Content-Type": "application/json",
          // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
        },
      });

      if (!classesResponse.ok) {
        throw new Error(`Failed to fetch teacher classes: ${classesResponse.statusText}`);
      }

      const classesData = await classesResponse.json();
      
      // Transform the data to match the expected format
      const transformedData = {
        data: classesData.data.map((classItem: any) => ({
          id: classItem.id,
          tenantId: "", // Not provided by the API
          programmeId: "", // Not provided by the API
          academicYearId: "", // Not provided by the API
          name: classItem.name,
          code: classItem.code,
          maxStudents: 0, // Not provided by the API
          createdAt: "", // Not provided by the API
          updatedAt: "", // Not provided by the API
          classroomId: null, // Not provided by the API
          programme: {
            id: "",
            name: "",
            code: ""
          },
          academicYear: {
            id: "",
            name: ""
          },
          classroom: null,
          courseCount: 0,
          studentCount: classItem.studentCount,
          courses: []
        })),
        pagination: classesData.pagination
      };

      return transformedData;
    },
    enabled: !!session?.user?.email,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Export types for use in components
export type { Class, CreateClass, UpdateClass, ClassWithDetails, AvailableCourse };
