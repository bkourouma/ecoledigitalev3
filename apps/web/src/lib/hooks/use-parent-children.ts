import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import { useActiveAcademicYear } from '@/lib/hooks/use-academic-years';
import { ChildListItem, ChildDetail, GradesSummary, ParentScheduleSession } from '@ecoledigitale/contracts';

// Hook for fetching children list
export function useParentChildren() {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ success: boolean; data: { children: ChildListItem[]; total: number } }>({
    queryKey: ['parent-children', activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/children', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch children list' }));
        throw new Error(error.message || 'Failed to fetch children list');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for fetching child details
export function useChildDetails(childId: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ success: boolean; data: { child: ChildDetail } }>({
    queryKey: ['parent-child', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/children/${childId}`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch child details' }));
        throw new Error(error.message || 'Failed to fetch child details');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for fetching child grades summary
export function useChildGradesSummary(childId: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ success: boolean; data: { gradesSummary: GradesSummary } }>({
    queryKey: ['parent-child-grades-summary', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/children/${childId}/grades-summary`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch grades summary' }));
        throw new Error(error.message || 'Failed to fetch grades summary');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for fetching child weekly schedule
export function useChildSchedule(childId: string, week?: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ success: boolean; data: { schedule: ParentScheduleSession[]; weekStart: string; weekEnd: string } }>({
    queryKey: ['parent-child-schedule', childId, week, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const params = week ? `?week=${encodeURIComponent(week)}` : '';
      const response = await fetch(`/api/v1/parent/children/${childId}/schedule${params}`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch schedule' }));
        throw new Error(error.message || 'Failed to fetch schedule');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 2 * 60 * 1000, // 2 minutes (schedule changes more frequently)
  });
}

// Hook for fetching child upcoming classes (next 7 days, max 10)
export function useUpcomingClasses(childId: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ success: boolean; data: { upcomingClasses: ParentScheduleSession[] } }>({
    queryKey: ['parent-child-upcoming-classes', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/children/${childId}/upcoming-classes`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch upcoming classes' }));
        throw new Error(error.message || 'Failed to fetch upcoming classes');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 1 * 60 * 1000, // 1 minute (upcoming classes change frequently)
  });
}

// Attendance Record type
export interface AttendanceRecord {
  id: string;
  date: string;
  courseName: string;
  courseCode: string | null;
  status: 'present' | 'absent' | 'late' | 'excused' | 'medical_leave';
  arrivalTime: string | null;
  excuseReason: string | null;
  notes: string | null;
}

// Hook for fetching child attendance records (paginated)
export function useChildAttendance(childId: string, page: number = 1) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      attendanceRecords: AttendanceRecord[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        pages: number;
        hasMore: boolean;
      };
    } 
  }>({
    queryKey: ['parent-child-attendance', childId, page, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/children/${childId}/attendance?page=${page}&limit=20`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch attendance records' }));
        throw new Error(error.message || 'Failed to fetch attendance records');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Absence Record type
export interface AbsenceRecord {
  id: string;
  date: string;
  courseName: string;
  courseCode: string | null;
  absenceType: 'absent' | 'excused' | 'medical_leave';
  excuseReason: string | null;
  markedAt: string;
}

// Absence Statistics type
export interface AbsenceStatistics {
  totalAbsences: number;
  excusedCount: number;
  unexcusedCount: number;
  medicalCount: number;
  absenceRate: number;
}

// Absence History Filters type
export interface AbsenceHistoryFilters {
  startDate?: string;
  endDate?: string;
  absenceType?: 'absent' | 'excused' | 'medical_leave';
  courseId?: string;
}

// Hook for fetching child absence history with filters
export function useAbsenceHistory(childId: string, filters: AbsenceHistoryFilters = {}) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      absences: AbsenceRecord[];
      statistics: AbsenceStatistics;
    } 
  }>({
    queryKey: ['parent-child-absence-history', childId, filters, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.absenceType) params.append('absenceType', filters.absenceType);
      if (filters.courseId) params.append('courseId', filters.courseId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/children/${childId}/absence-history${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch absence history' }));
        throw new Error(error.message || 'Failed to fetch absence history');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

