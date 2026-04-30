'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import { useActiveAcademicYear } from '@/lib/hooks/use-academic-years';
import { 
  ParentGradeList, 
  CourseGradeSummary, 
  OverallGradeStatistics, 
  GradeTrendData,
  GradeFilter 
} from '@ecoledigitale/contracts';

interface OverallAveragesFilters {
  childId?: string;
  startDate?: string;
  endDate?: string;
  semester?: string;
}

interface GradeTrendsFilters {
  childId?: string;
  courseId?: string;
  startDate?: string;
  endDate?: string;
  semester?: string;
  period?: 'week' | 'month' | 'semester';
}

// Base hook for parent grades API calls
// Provides session and headers for API calls
export function useParentGrades() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Hook for fetching assignment grades
export function useAssignmentGrades(
  childId?: string,
  filters?: GradeFilter,
  page: number = 1
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<ParentGradeList>({
    queryKey: ['parent-assignment-grades', childId, filters, page, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters?.courseId) params.append('courseId', filters.courseId);
      if (filters?.startDate) params.append('startDate', filters.startDate);
      if (filters?.endDate) params.append('endDate', filters.endDate);
      params.append('page', page.toString());
      params.append('limit', '20');
      
      const queryString = params.toString();
      const url = `/api/v1/parent/grades/assignments${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch assignment grades' }));
        throw new Error(error.message || 'Failed to fetch assignment grades');
      }
      
      const data = await response.json();
      return data.data;
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching grades organized by course
export function useGradesByCourse(childId?: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ courses: CourseGradeSummary[] }>({
    queryKey: ['parent-grades-by-course', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/grades/by-course${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch grades by course' }));
        throw new Error(error.message || 'Failed to fetch grades by course');
      }
      
      const data = await response.json();
      return data.data;
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching overall averages and statistics
export function useOverallAverages(
  childId?: string,
  filters?: OverallAveragesFilters
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ statistics: OverallGradeStatistics }>({
    queryKey: ['parent-overall-averages', childId, filters, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters?.startDate) params.append('startDate', filters.startDate);
      if (filters?.endDate) params.append('endDate', filters.endDate);
      if (filters?.semester) params.append('semester', filters.semester);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/grades/averages${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch overall averages' }));
        throw new Error(error.message || 'Failed to fetch overall averages');
      }
      
      const data = await response.json();
      return data.data;
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching grade trends data
export function useGradeTrends(
  childId?: string,
  filters?: GradeTrendsFilters
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ trends: GradeTrendData[] }>({
    queryKey: ['parent-grade-trends', childId, filters, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters?.courseId) params.append('courseId', filters.courseId);
      if (filters?.startDate) params.append('startDate', filters.startDate);
      if (filters?.endDate) params.append('endDate', filters.endDate);
      if (filters?.semester) params.append('semester', filters.semester);
      if (filters?.period) params.append('period', filters.period);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/grades/trends${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch grade trends' }));
        throw new Error(error.message || 'Failed to fetch grade trends');
      }
      
      const data = await response.json();
      return data.data;
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

