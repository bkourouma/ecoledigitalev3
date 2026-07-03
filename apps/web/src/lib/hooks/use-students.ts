"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import {
  StudentProfile,
  StudentWithUser,
  UpdateStudentProfile,
  StudentQuery,
} from "@ecoledigitale/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Helper function to generate matricule
const generateMatricule = (firstName: string, lastName: string): string => {
  const prefix = (firstName.substring(0, 2) + lastName.substring(0, 2)).toUpperCase();
  const randomNumber = Math.floor(10000000 + Math.random() * 90000000);
  return `${prefix}${randomNumber}`;
};

// API functions
async function fetchStudents(query: Partial<StudentQuery> = {}): Promise<{ data: StudentWithUser[]; pagination: any }> {
  const queryString = buildQueryString(query as Record<string, unknown>);
  const response = await fetch(`${API_BASE_URL}/api/v1/students${queryString}`, {
    headers: createApiHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to fetch students (${response.status})`);
  }

  const result = await response.json();

  // Use backend shape directly (StudentWithUser with nested user and camelCase keys)
  const students: StudentWithUser[] = result.students ?? result.data ?? [];

  return {
    data: students,
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  };
}

async function fetchStudent(id: string): Promise<StudentWithUser> {
  const response = await fetch(`${API_BASE_URL}/api/v1/students/${id}`, {
    headers: createApiHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch student");
  }

  return response.json();
}

async function createStudent(data: any): Promise<StudentProfile> {
  // Use the combined endpoint that creates both user and student profile
  const response = await fetch(`${API_BASE_URL}/api/v1/students/with-user`, {
    method: "POST",
    headers: createApiHeaders(),
    body: JSON.stringify({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
      matricule: data.matricule,
      currentYear: data.currentYear || 1,
      status: data.status || "active",
      bio: data.bio,
      dateOfBirth: data.dateOfBirth,
      placeOfBirth: data.placeOfBirth,
      nationality: data.nationality,
      address: data.address,
      phone: data.phone,
      emergencyPhone: data.emergencyPhone,
      fatherName: data.fatherName,
      motherName: data.motherName,
      birthCertificateNumber: data.birthCertificateNumber,
      birthCertificateDate: data.birthCertificateDate,
      civilRegistryOffice: data.civilRegistryOffice,
      subPrefecture: data.subPrefecture,
      residence: data.residence,
      establishmentMatricule: data.establishmentMatricule,
      dspsMatricule: data.dspsMatricule,
      dspsPreviousMatricule: data.dspsPreviousMatricule,
      bacObtentionDate: data.bacObtentionDate,
      bacSeries: data.bacSeries,
      lastDiploma: data.lastDiploma,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to create student");
  }

  return response.json();
}

export async function uploadStudentDiploma(studentId: string, file: File): Promise<{ url: string }> {
  const doUpload = async () => {
    const headers = createApiHeaders();
    // Laisser le navigateur définir le Content-Type multipart (avec boundary).
    delete (headers as any)["Content-Type"];
    delete (headers as any)["content-type"];

    const formData = new FormData();
    formData.append("file", file);

    return fetch(`${API_BASE_URL}/api/v1/students/${studentId}/diploma`, {
      method: "POST",
      headers,
      body: formData,
    });
  };

  let response = await doUpload();
  // En dev, l'API (tsx watch) peut recharger juste après la création de
  // l'étudiant : la route renvoie alors brièvement 404. On retente une fois.
  if (response.status === 404) {
    await new Promise((r) => setTimeout(r, 1500));
    response = await doUpload();
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Échec de l'upload du diplôme");
  }

  const json = await response.json();
  return json?.data ?? json;
}

async function updateStudent(id: string, data: UpdateStudentProfile): Promise<StudentProfile> {
  const response = await fetch(`${API_BASE_URL}/api/v1/students/${id}`, {
    method: "PUT",
    headers: createApiHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update student");
  }

  return response.json();
}

async function deleteStudent(id: string): Promise<void> {
  const headers = createApiHeaders();
  delete headers["Content-Type"];

  const response = await fetch(`${API_BASE_URL}/api/v1/students/${id}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    let errorMessage = "Impossible de supprimer l'étudiant";
    try {
      const error = await response.json();
      const backendMessage = error.message || error.error || "";
      
      // Provide user-friendly messages for specific errors
      if (response.status === 409) {
        if (backendMessage.includes("enrollments") || backendMessage.includes("inscriptions")) {
          errorMessage = "Impossible de supprimer l'étudiant car il est inscrit à des cours.\n\nVeuillez d'abord retirer l'étudiant de tous les cours avant de le supprimer.";
        } else if (backendMessage.includes("assignments") || backendMessage.includes("devoirs")) {
          errorMessage = "Impossible de supprimer l'étudiant car il contient des devoirs associés.\n\nVeuillez d'abord supprimer tous les devoirs de l'étudiant avant de le supprimer.";
        } else {
          errorMessage = backendMessage || "L'étudiant ne peut pas être supprimé car il contient des éléments associés.";
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

async function resetStudentPassword(id: string): Promise<{ studentId: string; initialPassword: string; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/students/${id}/reset-password`, {
    method: "POST",
    headers: createApiHeaders(),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Impossible de réinitialiser le mot de passe");
  }

  return response.json();
}

// Hooks
export function useStudents(query: Partial<StudentQuery> = {}) {
  return useQuery({
    queryKey: ["students", query],
    queryFn: () => fetchStudents(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useStudent(id: string) {
  return useQuery({
    queryKey: ["students", id],
    queryFn: () => fetchStudent(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createStudent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useUpdateStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStudentProfile }) => updateStudent(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["students", id] });
    },
  });
}

export function useDeleteStudent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteStudent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useResetStudentPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetStudentPassword,
    onSuccess: (_, studentId) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
    },
  });
}

// Export helper function
export { generateMatricule };
