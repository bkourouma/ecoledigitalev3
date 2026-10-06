"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import {
  AttendanceSession,
  CreateAttendanceSession,
  UpdateAttendanceSession,
  StudentAttendance,
  CreateStudentAttendance,
  UpdateStudentAttendance,
  BatchAttendance,
  AttendanceSummary,
  ClassAttendanceSummary,
  AttendanceSessionQuery,
  StudentAttendanceQuery,
} from "@ecoledigitale/contracts";

// ========================================
// API FUNCTIONS
// ========================================

async function fetchWithTenant(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v1${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorData: any = null;
    let errorText = '';
    let parseError: Error | null = null;
    
    try {
      errorText = await response.text();
      
      if (errorText && errorText.trim()) {
        try {
          errorData = JSON.parse(errorText);
        } catch (parseErr) {
          parseError = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
          // If parsing fails, use the text as the message
          errorData = { message: errorText, raw: errorText };
        }
      } else {
        errorData = { message: `HTTP ${response.status} ${response.statusText}`, emptyResponse: true };
      }
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
      errorData = { 
        message: `Network error: HTTP ${response.status} ${response.statusText}`,
        error: parseError.message,
        networkError: true
      };
    }
    
    // Ensure we have a meaningful error message
    const errorMessage = errorData?.message || errorData?.error || errorText || `HTTP ${response.status} ${response.statusText}`;
    
    // Build a comprehensive error log object
    const errorLog: any = {
      endpoint: `/api/v1${endpoint}`,
      fullUrl: `${window.location.origin}/api/v1${endpoint}`,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    };
    
    if (errorData) {
      errorLog.errorData = errorData;
    }
    
    if (errorText) {
      errorLog.errorText = errorText;
      errorLog.errorTextLength = errorText.length;
    } else {
      errorLog.errorText = 'No error text available';
    }
    
    if (parseError) {
      errorLog.parseError = parseError.message;
    }
    
    console.error('❌ API Error:', errorLog);
    
    throw new Error(errorMessage);
  }

  return response.json();
}

// Session Instances API (nouvelle logique basée sur session_instances)
async function fetchSessionInstances(query: AttendanceSessionQuery = { page: 1, limit: 50 }) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params.append(key, value.toString());
    }
  });

  const queryString = params.toString();
  const endpoint = `/attendance/session-instances${queryString ? `?${queryString}` : ""}`;

  return fetchWithTenant(endpoint);
}

// Attendance Sessions API (ancienne logique - à garder pour compatibilité)
async function fetchAttendanceSessions(query: AttendanceSessionQuery = { page: 1, limit: 50 }) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params.append(key, value.toString());
    }
  });

  const queryString = params.toString();
  const endpoint = `/attendance-legacy/sessions${queryString ? `?${queryString}` : ""}`;

  return fetchWithTenant(endpoint);
}

async function fetchAttendanceSession(id: string) {
  return fetchWithTenant(`/attendance-legacy/sessions/${id}`);
}

async function createAttendanceSession(data: CreateAttendanceSession) {
  return fetchWithTenant("/attendance-legacy/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function updateAttendanceSession(id: string, data: UpdateAttendanceSession) {
  return fetchWithTenant(`/attendance-legacy/sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async function deleteAttendanceSession(id: string) {
  return fetchWithTenant(`/attendance-legacy/sessions/${id}`, {
    method: "DELETE",
  });
}

// Student Attendance API
async function fetchAttendanceRecords(query: StudentAttendanceQuery = { page: 1, limit: 50 }) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params.append(key, value.toString());
    }
  });

  const queryString = params.toString();
  const endpoint = `/attendance-legacy/records${queryString ? `?${queryString}` : ""}`;
  
  return fetchWithTenant(endpoint);
}

async function batchMarkAttendance(sessionId: string, data: BatchAttendance) {
  return fetchWithTenant(`/attendance-legacy/sessions/${sessionId}/batch`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function updateAttendanceRecord(id: string, data: UpdateStudentAttendance) {
  return fetchWithTenant(`/attendance-legacy/records/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Analytics API
async function fetchStudentAttendanceSummary(studentId: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);
  
  const queryString = params.toString();
  const endpoint = `/attendance/students/${studentId}/summary${queryString ? `?${queryString}` : ""}`;
  
  return fetchWithTenant(endpoint);
}

async function fetchClassAttendanceSummary(classCourseId: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);
  
  const queryString = params.toString();
  const endpoint = `/attendance/classes/${classCourseId}/summary${queryString ? `?${queryString}` : ""}`;
  
  return fetchWithTenant(endpoint);
}

// ========================================
// REACT HOOKS
// ========================================

// Session Instances Hooks (nouvelle logique)
export function useSessionInstances(query: AttendanceSessionQuery = { page: 1, limit: 50 }) {
  return useQuery({
    queryKey: ["session-instances", query],
    queryFn: () => fetchSessionInstances(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    retryDelay: 1000,
  });
}

// Hook de test simple (comme useCycles)
export function useSessionInstancesSimple() {
  return useQuery({
    queryKey: ["session-instances-simple"],
    queryFn: () => fetchWithTenant('/attendance/session-instances'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    retryDelay: 1000,
  });
}

export function useSessionInstance(id: string) {
  return useQuery({
    queryKey: ["session-instance", id],
    queryFn: () => fetchWithTenant(`/attendance/session-instances/${id}`),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Attendance Sessions Hooks (ancienne logique - à garder pour compatibilité)
export function useAttendanceSessions(query: AttendanceSessionQuery = { page: 1, limit: 50 }) {
  return useQuery({
    queryKey: ["attendance-sessions", query],
    queryFn: () => fetchAttendanceSessions(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAttendanceSession(id: string) {
  return useQuery({
    queryKey: ["attendance-session", id],
    queryFn: () => fetchAttendanceSession(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useCreateAttendanceSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAttendanceSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
  });
}

export function useUpdateAttendanceSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAttendanceSession }) =>
      updateAttendanceSession(id, data),
    onSuccess: (_: any, variables: { id: string; data: UpdateAttendanceSession }) => {
      queryClient.invalidateQueries({ queryKey: ["attendance-session", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
  });
}

export function useDeleteAttendanceSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAttendanceSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
  });
}

// Student Attendance Hooks
export function useAttendanceRecords(query: StudentAttendanceQuery = { page: 1, limit: 50 }) {
  return useQuery({
    queryKey: ["attendance-records", query],
    queryFn: () => fetchAttendanceRecords(query),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useBatchMarkAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: BatchAttendance }) =>
      batchMarkAttendance(sessionId, data),
    onSuccess: (_: any, variables: { sessionId: string; data: BatchAttendance }) => {
      queryClient.invalidateQueries({ queryKey: ["attendance-records"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-records", { sessionId: variables.sessionId }] });
      queryClient.invalidateQueries({ queryKey: ["attendance-session", variables.sessionId] });
    },
  });
}

export function useUpdateAttendanceRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStudentAttendance }) =>
      updateAttendanceRecord(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-records"] });
    },
  });
}

// Analytics Hooks
export function useStudentAttendanceSummary(studentId: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["student-attendance-summary", studentId, startDate, endDate],
    queryFn: () => fetchStudentAttendanceSummary(studentId, startDate, endDate),
    enabled: !!studentId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useClassAttendanceSummary(classCourseId: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["class-attendance-summary", classCourseId, startDate, endDate],
    queryFn: () => fetchClassAttendanceSummary(classCourseId, startDate, endDate),
    enabled: !!classCourseId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ========================================
// UTILITY HOOKS
// ========================================

// Hook to get attendance sessions for a specific teacher
export function useTeacherAttendanceSessions(teacherId: string) {
  return useAttendanceSessions({ page: 1, limit: 50, teacherId });
}

// Hook to get attendance sessions for a specific class course
export function useClassCourseAttendanceSessions(classCourseId: string) {
  return useAttendanceSessions({ page: 1, limit: 50, classCourseId });
}

// Hook to get attendance records for a specific session
export function useSessionAttendanceRecords(sessionId: string) {
  return useAttendanceRecords({ page: 1, limit: 50, sessionId });
}

// Hook to get attendance records for a specific student
export function useStudentAttendanceRecords(studentId: string, startDate?: string, endDate?: string) {
  return useAttendanceRecords({ page: 1, limit: 50, studentId, startDate, endDate });
}

// ========================================
// TYPE EXPORTS
// ========================================

export type {
  AttendanceSession,
  CreateAttendanceSession,
  UpdateAttendanceSession,
  StudentAttendance,
  CreateStudentAttendance,
  UpdateStudentAttendance,
  BatchAttendance,
  AttendanceSummary,
  ClassAttendanceSummary,
  AttendanceSessionQuery,
  StudentAttendanceQuery,
};
