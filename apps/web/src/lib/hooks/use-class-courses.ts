"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface ClassCourse {
  id: string;
  tenantId: string;
  classId: string;
  courseId: string;
  isRequired: boolean;
  createdAt: string;
}

// Hook pour récupérer les cours d'une classe
export function useClassCourses(classId: string) {
  return useQuery({
    queryKey: ['class-courses', classId],
    queryFn: async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // 'X-Tenant': Handled by fetch interceptor or createApiHeaders,
      };

      const response = await fetch(`/api/v1/classes/${classId}/courses`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la récupération des cours de la classe');
      }

      return response.json();
    },
    enabled: !!classId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook pour récupérer un classCourseId spécifique via l'endpoint dédié
export function useClassCourse(classId: string, courseId: string) {
  return useQuery({
    queryKey: ['class-course', classId, courseId],
    queryFn: async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // 'X-Tenant': Handled by fetch interceptor or createApiHeaders,
};

      // Utiliser le nouvel endpoint pour récupérer le classCourseId
      const response = await fetch(`/api/v1/class-courses/find?classId=${classId}&courseId=${courseId}`, {
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Relation classe-cours non trouvée. Veuillez d\'abord assigner ce cours à cette classe.');
        }
        throw new Error('Erreur lors de la récupération de la relation classe-cours');
      }

      const data = await response.json();
      return {
        classCourseId: data.data.id,
        classId: data.data.classId,
        courseId: data.data.courseId,
        isRequired: data.data.isRequired,
        course: data.data.course,
        createdAt: data.data.createdAt,
        isTemporary: false
      };
    },
    enabled: !!(classId && courseId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook pour créer ou récupérer un classCourseId
export function useGetOrCreateClassCourse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ classId, courseId }: { classId: string; courseId: string }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // 'X-Tenant': Handled by fetch interceptor or createApiHeaders,
};

      // D'abord, essayer de récupérer la relation existante
      const findResponse = await fetch(`/api/v1/class-courses/find?classId=${classId}&courseId=${courseId}`, {
        headers,
      });

      if (findResponse.ok) {
        // La relation existe déjà
        const data = await findResponse.json();
        return {
          classCourseId: data.data.id,
          classId: data.data.classId,
          courseId: data.data.courseId,
          isRequired: data.data.isRequired,
          course: data.data.course,
          existed: true
        };
      }

      if (findResponse.status === 404) {
        // La relation n'existe pas, la créer
        const createResponse = await fetch(`/api/v1/class-courses`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            classId,
            courseId,
            isRequired: true
          }),
        });

        if (!createResponse.ok) {
          throw new Error('Erreur lors de la création de la relation classe-cours');
        }

        const createData = await createResponse.json();
        return {
          classCourseId: createData.data.id,
          classId: createData.data.classId,
          courseId: createData.data.courseId,
          isRequired: createData.data.isRequired,
          existed: false
        };
      }

      throw new Error('Erreur lors de la récupération de la relation classe-cours');
    },
    onSuccess: () => {
      // Invalider les caches liés
      queryClient.invalidateQueries({ queryKey: ['class-courses'] });
      queryClient.invalidateQueries({ queryKey: ['class-course'] });
    },
  });
}

// Hook pour vérifier si un cours est assigné à une classe
export function useIsClassCourseAssigned(classId: string, courseId: string) {
  const { data: classCourses, isLoading } = useClassCourses(classId);

  const isAssigned = classCourses?.data?.some((course: any) => course.id === courseId) || false;

  return {
    isAssigned,
    isLoading,
    classCourses: classCourses?.data || []
  };
}

// Types
export interface ClassCourse {
  id: string;
  name: string;
  code: string;
  description: string;
  hoursTotal: number;
  hoursTheory: number;
  hoursPractical: number;
  isRequired: boolean;
  status: string;
  programme?: {
    id: string;
    name: string;
    code: string;
  };
}
