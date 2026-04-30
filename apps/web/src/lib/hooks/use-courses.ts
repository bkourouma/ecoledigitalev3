"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import { getToken, getUserFromToken } from "@/lib/jwt-storage";

interface Course {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  description?: string;
  programmeId: string;
  bilanTypeId: string;
  cm?: string;
  td?: string;
  tp?: string;
  coef?: number;
  vhh?: string;
  hoursTotal?: number;
  hoursTheory?: number;
  hoursPractical?: number;
  deliveryMode?: "presential" | "remote" | "hybrid" | "elearning";
  status: "draft" | "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  programme?: {
    id: string;
    name: string;
    code: string;
  };
  bilanType?: {
    id: string;
    name: string;
  } | null;
}

interface CreateCourse {
  name: string;
  programmeId: string;
  bilanTypeId: string;
  code?: string;
  cm?: string;
  td?: string;
  tp?: string;
  coef?: number;
  vhh?: string;
  hoursTotal?: number;
  hoursTheory?: number;
  hoursPractical?: number;
  deliveryMode?: "presential" | "remote" | "hybrid" | "elearning";
  status?: "draft" | "active" | "inactive";
}

interface UpdateCourse {
  name?: string;
  programmeId?: string;
  bilanTypeId?: string;
  code?: string;
  cm?: string;
  td?: string;
  tp?: string;
  coef?: number;
  vhh?: string;
  hoursTotal?: number;
  hoursTheory?: number;
  hoursPractical?: number;
  deliveryMode?: "presential" | "remote" | "hybrid" | "elearning";
  status?: "draft" | "active" | "inactive";
}

interface CourseQuery {
  page?: number;
  limit?: number;
  search?: string;
  programmeId?: string;
  teacherId?: string;
  status?: string;
}

const DEFAULT_COURSE_HOURS_TOTAL = 1;
const DEFAULT_COURSE_DELIVERY_MODE: "presential" = "presential";

export function sanitizeCourseCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 20);
}

/** Code unique par ligne en création groupée (max 20 car. côté API). */
export function buildBulkCourseCode(base: string, rowIndex: number): string {
  const b = (base || "MATIERE").slice(0, 20);
  const suffix = `-${rowIndex + 1}`;
  const maxBase = Math.max(1, 20 - suffix.length);
  return `${b.slice(0, maxBase)}${suffix}`.slice(0, 20);
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

async function fetchCourses(query: CourseQuery = {}): Promise<{ data: Course[]; pagination: any }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/courses?${searchParams.toString()}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch courses");
  }

  return response.json();
}

async function fetchCourse(id: string): Promise<Course> {
  const response = await fetch(`/api/v1/courses/${id}`, {
    headers: createAcademicHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch course");
  }

  return response.json();
}

async function createCourse(data: CreateCourse): Promise<Course> {
  const resolvedCode =
    data.code !== undefined && data.code !== null && String(data.code).trim() !== ""
      ? String(data.code).trim().slice(0, 20)
      : sanitizeCourseCode(data.name) || "MATIERE";
  const payload = {
    ...data,
    code: resolvedCode,
    hoursTotal: data.hoursTotal ?? DEFAULT_COURSE_HOURS_TOTAL,
    deliveryMode: data.deliveryMode || DEFAULT_COURSE_DELIVERY_MODE,
  };

  const response = await fetch(`/api/v1/courses`, {
    method: "POST",
    headers: createAcademicHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const msg =
      (typeof body.message === "string" && body.message.trim()) ||
      (typeof body.error === "string" && body.error.trim()) ||
      response.statusText ||
      "Failed to create course";
    throw new Error(msg);
  }

  return response.json();
}

async function updateCourse(id: string, data: UpdateCourse): Promise<Course> {
  const response = await fetch(`/api/v1/courses/${id}`, {
    method: "PUT",
    headers: createAcademicHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || "Failed to update course");
  }

  return response.json();
}

async function deleteCourse(id: string): Promise<void> {
  const headers = createAcademicHeaders();
  delete headers["Content-Type"];

  const response = await fetch(`/api/v1/courses/${id}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    let errorMessage = "Impossible de supprimer le cours";
    try {
      const error = await response.json();
      const backendMessage = error.message || error.error || "";

      if (response.status === 409) {
        if (backendMessage.includes("materials")) {
          errorMessage = "Impossible de supprimer le cours car il contient des materiaux associes.\n\nVeuillez d'abord supprimer tous les materiaux du cours avant de le supprimer.";
        } else if (backendMessage.includes("assignments")) {
          errorMessage = "Impossible de supprimer le cours car il contient des devoirs associes.\n\nVeuillez d'abord supprimer tous les devoirs du cours avant de le supprimer.";
        } else if (backendMessage.includes("class")) {
          errorMessage = "Impossible de supprimer le cours car il est associe a des classes.\n\nVeuillez d'abord retirer le cours de toutes les classes avant de le supprimer.";
        } else {
          errorMessage = backendMessage || "Le cours ne peut pas etre supprime car il contient des elements associes.";
        }
      } else {
        errorMessage = backendMessage || errorMessage;
      }
    } catch {
      errorMessage = `Erreur ${response.status}: ${response.statusText}`;
    }

    throw new Error(errorMessage);
  }
}

export function useCourses(query: CourseQuery = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["courses", query],
    queryFn: () => fetchCourses(query),
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useCourse(id: string) {
  return useQuery({
    queryKey: ["courses", id],
    queryFn: () => fetchCourse(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCourse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCourse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });
}

export function useUpdateCourse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCourse }) => updateCourse(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.invalidateQueries({ queryKey: ["courses", id] });
    },
  });
}

export function useDeleteCourse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCourse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });
}

export function useTeacherCourses(teacherId?: string) {
  return useQuery({
    queryKey: ["teacher-courses", teacherId],
    queryFn: async () => {
      const response = await fetch(`/api/teacher/courses`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch teacher courses");
      }

      return response.json();
    },
    enabled: !!teacherId,
    staleTime: 5 * 60 * 1000,
  });
}

export type { Course, CreateCourse, UpdateCourse, CourseQuery };
