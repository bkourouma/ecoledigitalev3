'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import {
  EnrolledCourse,
  AcademicCourseMaterial,
  AcademicCalendarEvent,
  ExamSchedule,
  AcademicYearInfo,
  EnrolledCourseFilter,
  AcademicCourseMaterialFilter,
  AcademicCalendarFilter,
  ExamScheduleFilter,
  AcademicYearFilter,
} from '@ecoledigitale/contracts';

// Base hook for parent academic API calls
// Provides session and headers for API calls
export function useParentAcademic() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Base query configuration for parent academic hooks
const defaultQueryConfig = {
  enabled: (session: any) => !!session,
  staleTime: 2 * 60 * 1000, // 2 minutes
  retry: 1,
};

// Hook for fetching enrolled courses
export function useEnrolledCourses(
  childId?: string,
  courseId?: string,
  teacherId?: string,
  academicYearId?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      courses: EnrolledCourse[];
    } 
  }>({
    queryKey: ['parent-enrolled-courses', childId, courseId, teacherId, academicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (courseId) params.append('courseId', courseId);
      if (teacherId) params.append('teacherId', teacherId);
      if (academicYearId) params.append('academicYearId', academicYearId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/academic/enrolled-courses${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch enrolled courses' }));
        throw new Error(error.message || 'Failed to fetch enrolled courses');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching course materials
export function useCourseMaterials(
  childId?: string,
  courseId?: string,
  materialType?: string,
  startDate?: string,
  endDate?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      materials: AcademicCourseMaterial[];
    } 
  }>({
    queryKey: ['parent-course-materials', childId, courseId, materialType, startDate, endDate],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (courseId) params.append('courseId', courseId);
      if (materialType) params.append('materialType', materialType);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/academic/course-materials${queryString ? `?${queryString}` : ''}`;
      
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
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching academic calendar events
export function useAcademicCalendar(
  academicYearId?: string,
  semester?: number,
  startDate?: string,
  endDate?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      events: AcademicCalendarEvent[];
    } 
  }>({
    queryKey: ['parent-academic-calendar', academicYearId, semester, startDate, endDate],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (academicYearId) params.append('academicYearId', academicYearId);
      if (semester !== undefined && semester !== null) params.append('semester', semester.toString());
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/academic/calendar${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch academic calendar events' }));
        throw new Error(error.message || 'Failed to fetch academic calendar events');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching exam schedules
export function useExamSchedules(
  childId?: string,
  courseId?: string,
  examType?: string,
  startDate?: string,
  endDate?: string,
  academicYearId?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      exams: ExamSchedule[];
    } 
  }>({
    queryKey: ['parent-exam-schedules', childId, courseId, examType, startDate, endDate, academicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (courseId) params.append('courseId', courseId);
      if (examType) params.append('examType', examType);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (academicYearId) params.append('academicYearId', academicYearId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/academic/exam-schedules${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch exam schedules' }));
        throw new Error(error.message || 'Failed to fetch exam schedules');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching academic year information
export function useAcademicYearInfo(
  childId?: string,
  academicYearId?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      academicYears: AcademicYearInfo[];
    } 
  }>({
    queryKey: ['parent-academic-year', childId, academicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (academicYearId) params.append('academicYearId', academicYearId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/academic/academic-year${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch academic year information' }));
        throw new Error(error.message || 'Failed to fetch academic year information');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

