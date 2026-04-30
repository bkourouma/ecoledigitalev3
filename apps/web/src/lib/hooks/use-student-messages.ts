'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface AdminMessage {
  id: string;
  subject: string;
  content: string;
  priorityLevel: 'low' | 'normal' | 'high' | 'urgent' | null;
  sentAt: string;
  readAt: string | null;
  isRead: boolean;
  adminName: string;
}

export interface AdminMessagesResponse {
  success: boolean;
  data: {
    messages: AdminMessage[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

// Hook to fetch admin messages for student
export function useAdminMessagesForStudent(
  filters: {
    startDate?: string;
    endDate?: string;
    priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
    readStatus?: 'read' | 'unread' | 'all';
  } = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery<AdminMessagesResponse>({
    queryKey: ['student-admin-messages', filters, page, limit],
    queryFn: async () => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.priorityLevel) params.append('priorityLevel', filters.priorityLevel);
      if (filters.readStatus) params.append('readStatus', filters.readStatus);
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const queryString = params.toString();
      const url = `${API_BASE_URL}/api/v1/student/messages/admin-messages${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch admin messages' }));
        throw new Error(error.message || 'Failed to fetch admin messages');
      }

      return response.json();
    },
    enabled: !!session && !!userId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

export interface TeacherMessage {
  id: string;
  subject: string;
  content: string;
  priorityLevel: 'low' | 'normal' | 'high' | 'urgent' | null;
  sentAt: string;
  readAt: string | null;
  isRead: boolean;
  teacherName: string;
  teacherId: string;
}

export interface TeacherMessagesResponse {
  success: boolean;
  data: {
    messages: TeacherMessage[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

// Hook to fetch teacher messages for student
export function useTeacherMessagesForStudent(
  filters: {
    startDate?: string;
    endDate?: string;
    priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
    readStatus?: 'read' | 'unread' | 'all';
  } = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery<TeacherMessagesResponse>({
    queryKey: ['student-teacher-messages', filters, page, limit],
    queryFn: async () => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.priorityLevel) params.append('priorityLevel', filters.priorityLevel);
      if (filters.readStatus) params.append('readStatus', filters.readStatus);
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const queryString = params.toString();
      const url = `${API_BASE_URL}/api/v1/student/messages/teacher-messages${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch teacher messages' }));
        throw new Error(error.message || 'Failed to fetch teacher messages');
      }

      return response.json();
    },
    enabled: !!session && !!userId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

export function useStudentMyTeachers() {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  return useQuery({
    queryKey: ['student-my-teachers'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId!;
      const res = await fetch(`${API_BASE_URL}/api/v1/student/messages/my-teachers`, { headers });
      if (!res.ok) throw new Error('Impossible de charger les enseignants');
      return res.json();
    },
    enabled: !!session && !!userId,
  });
}

export function useStudentMessageToSchool() {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { subject: string; content: string; sendWhatsapp?: boolean }) => {
      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId!;
      const res = await fetch(`${API_BASE_URL}/api/v1/student/messages/to-school`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || 'Échec envoi');
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student-admin-messages'] }),
  });
}

export function useStudentMessageToTeacher() {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      teacherUserId: string;
      classCourseId?: string;
      subject: string;
      content: string;
      sendWhatsapp?: boolean;
    }) => {
      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId!;
      const res = await fetch(`${API_BASE_URL}/api/v1/student/messages/to-teacher`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || 'Échec envoi');
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student-teacher-messages'] }),
  });
}
