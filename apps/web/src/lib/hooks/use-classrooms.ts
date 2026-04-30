"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import {
  Classroom,
  CreateClassroom,
  UpdateClassroom,
  ClassroomWithReservations,
  ClassroomType,
  ClassroomStatus
} from "@ecoledigitale/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ClassroomsQueryParams {
  type?: ClassroomType;
  status?: ClassroomStatus;
  building?: string;
  isActive?: boolean;
  includeReservations?: boolean;
  page?: number;
  limit?: number;
}

interface ClassroomsResponse {
  data: Classroom[] | ClassroomWithReservations[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface ClassroomResponse {
  data: Classroom | ClassroomWithReservations;
}

// Fetch classrooms with optional filters
export function useClassrooms(params: ClassroomsQueryParams = {}) {
  return useQuery<ClassroomsResponse>({
    queryKey: ["classrooms", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });

      const response = await fetch(
        `/api/v1/classrooms?${searchParams}`,
        {
          credentials: "include",
          headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
        }
      );

      if (!response.ok) {
        throw new Error("Erreur lors de la récupération des salles de classe");
      }

      return response.json();
    },
  });
}

// Fetch single classroom by ID
export function useClassroom(id: string, includeReservations = false) {
  return useQuery<ClassroomResponse>({
    queryKey: ["classroom", id, includeReservations],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (includeReservations) {
        searchParams.append("includeReservations", "true");
      }

      const response = await fetch(
        `/api/v1/classrooms/${id}?${searchParams}`,
        {
          credentials: "include",
          headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
        }
      );

      if (!response.ok) {
        throw new Error("Erreur lors de la récupération de la salle de classe");
      }

      return response.json();
    },
    enabled: !!id,
  });
}

// Create classroom mutation
export function useCreateClassroom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (classroomData: CreateClassroom): Promise<ClassroomResponse> => {
      const response = await fetch(`/api/v1/classrooms`, {
        method: "POST",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        credentials: "include",
        body: JSON.stringify(classroomData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de la création de la salle de classe");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch classrooms
      queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
}

// Update classroom mutation
export function useUpdateClassroom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      data 
    }: { 
      id: string; 
      data: UpdateClassroom 
    }): Promise<ClassroomResponse> => {
      // Ensure data is not empty and is a valid object
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        throw new Error("Aucune donnée à mettre à jour");
      }

      const body = JSON.stringify(data);
      
      // Ensure body is not empty
      if (!body || body === '{}' || body === 'null' || body === 'undefined') {
        throw new Error("Le corps de la requête ne peut pas être vide");
      }

      const response = await fetch(`/api/v1/classrooms/${id}`, {
        method: "PUT",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        credentials: "include",
        body: body,
      });

      if (!response.ok) {
        let errorMessage = "Erreur lors de la mise à jour de la salle de classe";
        try {
        const error = await response.json();
          errorMessage = error.message || error.error || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = `Erreur ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      return response.json();
    },
    onSuccess: (_, { id }) => {
      // Invalidate and refetch classrooms and specific classroom
      queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      queryClient.invalidateQueries({ queryKey: ["classroom", id] });
    },
  });
}

// Delete classroom mutation
export function useDeleteClassroom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/v1/classrooms/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
          // Don't include Content-Type for DELETE requests without body
    },
      });

      if (!response.ok) {
        let errorMessage = "Erreur lors de la suppression de la salle de classe";
        try {
        const error = await response.json();
          errorMessage = error.message || error.error || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = `Erreur ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
    },
    onSuccess: () => {
      // Invalidate and refetch classrooms
      queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
}

// Get available classrooms for a specific time period
export function useAvailableClassrooms(startDatetime?: Date, endDatetime?: Date) {
  return useQuery<ClassroomsResponse>({
    queryKey: ["available-classrooms", startDatetime, endDatetime],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.append("status", "disponible");
      searchParams.append("isActive", "true");
      
      if (startDatetime && endDatetime) {
        // This would require additional API endpoint to check availability
        // For now, we'll just return active classrooms
      }

      const response = await fetch(
        `/api/v1/classrooms?${searchParams}`,
        {
          credentials: "include",
          headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
        }
      );

      if (!response.ok) {
        throw new Error("Erreur lors de la récupération des salles disponibles");
      }

      return response.json();
    },
    enabled: !!startDatetime && !!endDatetime,
  });
}

// Get classroom statistics
export function useClassroomStats() {
  return useQuery({
    queryKey: ["classroom-stats"],
    queryFn: async () => {
      const response = await fetch(
        `/api/v1/classrooms?limit=1000`,
        {
          credentials: "include",
          headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
        }
      );

      if (!response.ok) {
        throw new Error("Erreur lors de la récupération des statistiques");
      }

      const data: ClassroomsResponse = await response.json();
      
      const stats = {
        total: data.pagination.total,
        available: data.data.filter((c: any) => c.status === 'disponible').length,
        occupied: data.data.filter((c: any) => c.status === 'occupe').length,
        maintenance: data.data.filter((c: any) => c.status === 'maintenance').length,
        outOfService: data.data.filter((c: any) => c.status === 'hors_service').length,
        byType: data.data.reduce((acc: any, classroom: any) => {
          acc[classroom.type] = (acc[classroom.type] || 0) + 1;
          return acc;
        }, {}),
        totalCapacity: data.data.reduce((sum: number, classroom: any) => sum + classroom.capacity, 0),
      };

      return stats;
    },
  });
}
