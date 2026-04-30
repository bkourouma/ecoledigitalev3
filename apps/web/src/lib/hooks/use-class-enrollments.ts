"use client";

import { useQuery } from '@tanstack/react-query';

import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Hook pour récupérer les inscriptions d'une classe
export function useClassEnrollments(classId: string) {
  return useQuery({
    queryKey: ['class-enrollments', classId],
    queryFn: async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // 'X-Tenant': Handled by fetch interceptor or createApiHeaders,
      };

      const response = await fetch(`${API_BASE_URL}/api/v1/enrollments?classId=${classId}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la récupération des inscriptions de la classe');
      }

      return response.json();
    },
    enabled: !!classId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Types
export interface ClassEnrollment {
  id: string;
  enrollmentDate: string;
  status: 'active' | 'suspended' | 'completed' | 'dropped' | 'transferred';
  fees: {
    inscription: number;
    scolarite: number;
    annexes: number;
    autres: number;
    total: number;
    currency: string;
  };
  student?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    studentNumber: string;
    phone?: string;
    dateOfBirth?: string;
    nationality?: string;
  };
  class?: {
    id: string;
    name: string;
    code: string;
  };
  academicYear?: {
    id: string;
    name: string;
  };
}
