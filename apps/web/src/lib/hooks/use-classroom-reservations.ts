"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import {
  ClassroomReservation,
  CreateReservation,
  UpdateReservation,
  ReservationWithDetails,
  ReservationStatus
} from "@ecoledigitale/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ReservationsQueryParams {
  classroomId?: string;
  courseId?: string;
  classId?: string;
  status?: ReservationStatus;
  startDate?: string;
  endDate?: string;
  includeDetails?: boolean;
  page?: number;
  limit?: number;
}

interface ReservationsResponse {
  data: ClassroomReservation[] | ReservationWithDetails[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface ReservationResponse {
  data: ClassroomReservation | ReservationWithDetails;
}

// Fetch reservations with optional filters
export function useClassroomReservations(params: ReservationsQueryParams = {}) {
  return useQuery<ReservationsResponse>({
    queryKey: ["classroom-reservations", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });

      const response = await fetch(
        `/api/v1/classroom-reservations?${searchParams}`,
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
        throw new Error("Erreur lors de la récupération des réservations");
      }

      return response.json();
    },
  });
}

// Fetch reservations for a specific classroom
export function useClassroomReservationsByRoom(classroomId: string, includeDetails = true) {
  return useClassroomReservations({
    classroomId,
    includeDetails,
    status: 'confirmed',
    limit: 100
  });
}

// Fetch upcoming reservations
export function useUpcomingReservations(limit = 10) {
  const today = new Date().toISOString().split('T')[0];
  
  return useClassroomReservations({
    startDate: today,
    includeDetails: true,
    status: 'confirmed',
    limit
  });
}

// Create reservation mutation
export function useCreateReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reservationData: CreateReservation): Promise<ReservationResponse> => {
      const response = await fetch(`/api/v1/classroom-reservations`, {
        method: "POST",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        credentials: "include",
        body: JSON.stringify({
          ...reservationData,
          startDatetime: reservationData.startDatetime.toISOString(),
          endDatetime: reservationData.endDatetime.toISOString(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de la création de la réservation");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch reservations and classrooms
      queryClient.invalidateQueries({ queryKey: ["classroom-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
}

// Update reservation mutation
export function useUpdateReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      data 
    }: { 
      id: string; 
      data: UpdateReservation 
    }): Promise<ReservationResponse> => {
      const updateData = { ...data };
      
      // Convert dates to ISO strings if they exist
      if (updateData.startDatetime) {
        updateData.startDatetime = updateData.startDatetime.toISOString() as any;
      }
      if (updateData.endDatetime) {
        updateData.endDatetime = updateData.endDatetime.toISOString() as any;
      }

      const response = await fetch(`/api/v1/classroom-reservations/${id}`, {
        method: "PUT",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        credentials: "include",
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de la mise à jour de la réservation");
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch reservations and classrooms
      queryClient.invalidateQueries({ queryKey: ["classroom-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
}

// Cancel reservation mutation
export function useCancelReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/v1/classroom-reservations/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de l'annulation de la réservation");
      }
    },
    onSuccess: () => {
      // Invalidate and refetch reservations and classrooms
      queryClient.invalidateQueries({ queryKey: ["classroom-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
}

// Check classroom availability for a specific time period
export function useCheckClassroomAvailability(
  classroomId: string, 
  startDatetime: Date, 
  endDatetime: Date
) {
  return useQuery({
    queryKey: ["classroom-availability", classroomId, startDatetime, endDatetime],
    queryFn: async () => {
      const reservations = await useClassroomReservations({
        classroomId,
        startDate: startDatetime.toISOString().split('T')[0],
        endDate: endDatetime.toISOString().split('T')[0],
        status: 'confirmed'
      });

      // Check for conflicts
      const hasConflict = reservations.data?.some((reservation: any) => {
        const resStart = new Date(reservation.startDatetime);
        const resEnd = new Date(reservation.endDatetime);
        
        return (
          (startDatetime >= resStart && startDatetime < resEnd) ||
          (endDatetime > resStart && endDatetime <= resEnd) ||
          (startDatetime <= resStart && endDatetime >= resEnd)
        );
      });

      return {
        isAvailable: !hasConflict,
        conflictingReservations: hasConflict ? reservations.data : []
      };
    },
    enabled: !!classroomId && !!startDatetime && !!endDatetime,
  });
}

// Get reservation statistics
export function useReservationStats() {
  return useQuery({
    queryKey: ["reservation-stats"],
    queryFn: async () => {
      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const response = await fetch(
        `/api/v1/classroom-reservations?` +
        `startDate=${startOfWeek.toISOString().split('T')[0]}&` +
        `endDate=${endOfWeek.toISOString().split('T')[0]}&` +
        `limit=1000&includeDetails=true`,
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

      const data: ReservationsResponse = await response.json();
      
      const stats = {
        thisWeek: data.pagination.total,
        today: data.data.filter((r: any) => {
          const resDate = new Date(r.startDatetime).toDateString();
          return resDate === today.toDateString();
        }).length,
        upcoming: data.data.filter((r: any) => {
          return new Date(r.startDatetime) > today;
        }).length,
        byStatus: data.data.reduce((acc: any, reservation: any) => {
          acc[reservation.status] = (acc[reservation.status] || 0) + 1;
          return acc;
        }, {}),
        byClassroom: data.data.reduce((acc: any, reservation: any) => {
          const classroomName = (reservation as any).classroom?.name || 'Unknown';
          acc[classroomName] = (acc[classroomName] || 0) + 1;
          return acc;
        }, {}),
      };

      return stats;
    },
  });
}
