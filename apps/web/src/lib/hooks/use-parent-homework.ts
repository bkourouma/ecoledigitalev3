'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import { useActiveAcademicYear } from '@/lib/hooks/use-academic-years';
import { ParentAssignment, ParentAssignmentList, AssignmentFilter } from '@ecoledigitale/contracts';

// Base hook for parent homework API calls
// Provides session and headers for API calls
export function useParentHomework() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Hook for fetching active assignments
export function useActiveAssignments(filters: AssignmentFilter = {}) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      assignments: ParentAssignment[];
      total: number;
    } 
  }>({
    queryKey: ['parent-active-assignments', filters, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (filters.childId) params.append('childId', filters.childId);
      if (filters.courseId) params.append('courseId', filters.courseId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/homework/assignments/active${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch active assignments' }));
        throw new Error(error.message || 'Failed to fetch active assignments');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching upcoming deadlines
export function useUpcomingDeadlines(childId?: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      deadlines: ParentAssignment[];
      total: number;
    } 
  }>({
    queryKey: ['parent-upcoming-deadlines', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/homework/assignments/upcoming-deadlines${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch upcoming deadlines' }));
        throw new Error(error.message || 'Failed to fetch upcoming deadlines');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching completed assignments
export function useCompletedAssignments(
  childId?: string,
  page: number = 1,
  filters: AssignmentFilter = {}
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      assignments: ParentAssignment[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    } 
  }>({
    queryKey: ['parent-completed-assignments', childId, page, filters, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.courseId) params.append('courseId', filters.courseId);
      params.append('page', page.toString());
      params.append('limit', '20');
      
      const queryString = params.toString();
      const url = `/api/v1/parent/homework/assignments/completed${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch completed assignments' }));
        throw new Error(error.message || 'Failed to fetch completed assignments');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for fetching parent grades
export function useParentGrades(
  childId?: string,
  filters: AssignmentFilter & { startDate?: string; endDate?: string } = {}
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      grades: Array<{
        id: string;
        assignmentId: string;
        assignmentName: string;
        courseId: string;
        courseName: string;
        courseCode: string | null;
        childId: string;
        childName: string;
        grade: number;
        maxPoints: number;
        percentage: number;
        feedback: string | null;
        submittedAt: string | null;
        gradedAt: string | null;
        dueDate: string | null;
      }>;
      statistics: {
        average: number;
        totalGraded: number;
        gradeDistribution: { [key: string]: number };
      };
    } 
  }>({
    queryKey: ['parent-grades', childId, filters, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.courseId) params.append('courseId', filters.courseId);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/homework/grades${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch grades' }));
        throw new Error(error.message || 'Failed to fetch grades');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Phase 7: User Story 5 - Access Course Materials
export function useCourseMaterials(
  childId?: string,
  courseId?: string
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      materials: Array<{
        id: string;
        courseId: string;
        courseName: string;
        courseCode: string | null;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        uploadedAt: string | null;
        childId: string;
        childName: string;
      }>;
    } 
  }>({
    queryKey: ['parent-course-materials', childId, courseId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (courseId) params.append('courseId', courseId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/homework/course-materials${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch course materials' }));
        throw new Error(error.message || 'Failed to fetch course materials');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Base query configuration for parent homework hooks
const defaultQueryConfig = {
  enabled: (session: any) => !!session,
  staleTime: 2 * 60 * 1000, // 2 minutes
  retry: 1,
};

