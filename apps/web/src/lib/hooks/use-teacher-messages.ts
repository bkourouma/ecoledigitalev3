'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface CreateTeacherMessageInput {
  studentId: string;
  subject: string;
  content: string;
  priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
  sendWhatsapp?: boolean;
}

export interface TeacherMessage {
  id: string;
  studentId: string;
  studentName: string;
  parentId: string;
  parentName: string;
  subject: string;
  content: string;
  priorityLevel: 'low' | 'normal' | 'high' | 'urgent' | null;
  sentAt: string;
  readAt: string | null;
  isRead: boolean;
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

// Hook to create a teacher message
export function useCreateTeacherMessage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useMutation({
    mutationFn: async (input: CreateTeacherMessageInput) => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const response = await fetch(`${API_BASE_URL}/api/v1/teacher/messages`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...input, sendWhatsapp: !!input.sendWhatsapp }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to create message' }));
        throw new Error(error.message || 'Failed to create message');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate messages queries to refetch
      queryClient.invalidateQueries({ queryKey: ['teacher-messages'] });
      queryClient.invalidateQueries({ queryKey: ['parent-teacher-messages'] });
    },
  });
}

// Hook to fetch teacher messages (sent messages)
export function useTeacherMessages(
  filters: {
    studentId?: string;
    parentId?: string;
    startDate?: string;
    endDate?: string;
    priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
  } = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery<TeacherMessagesResponse>({
    queryKey: ['teacher-messages', filters, page, limit],
    queryFn: async () => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const params = new URLSearchParams();
      if (filters.studentId) params.append('studentId', filters.studentId);
      if (filters.parentId) params.append('parentId', filters.parentId);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.priorityLevel) params.append('priorityLevel', filters.priorityLevel);
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const queryString = params.toString();
      const url = `${API_BASE_URL}/api/v1/teacher/messages${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch messages' }));
        throw new Error(error.message || 'Failed to fetch messages');
      }

      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

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

// Hook to fetch admin messages for teacher
export function useAdminMessagesForTeacher(
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
    queryKey: ['teacher-admin-messages', filters, page, limit],
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
      const url = `${API_BASE_URL}/api/v1/teacher/messages/admin-messages${queryString ? `?${queryString}` : ''}`;

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

export function useTeacherBulkToParents() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  return useMutation({
    mutationFn: async (body: {
      studentIds?: string[];
      classId?: string;
      subject: string;
      content: string;
      priorityLevel?: string;
      sendWhatsapp?: boolean;
    }) => {
      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId!;
      const res = await fetch(`${API_BASE_URL}/api/v1/teacher/messages/bulk-to-parents`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Échec envoi groupé');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-messages'] });
    },
  });
}

export function useTeacherMessageToEstablishment() {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  return useMutation({
    mutationFn: async (body: { subject: string; content: string; sendWhatsapp?: boolean }) => {
      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId!;
      const res = await fetch(`${API_BASE_URL}/api/v1/teacher/messages/to-establishment`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Échec envoi');
      }
      return res.json();
    },
  });
}

export function useTeacherMessagesToStudents() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;
  return useMutation({
    mutationFn: async (body: {
      studentProfileIds?: string[];
      classId?: string;
      subject: string;
      content: string;
      sendWhatsapp?: boolean;
    }) => {
      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId!;
      const res = await fetch(`${API_BASE_URL}/api/v1/teacher/messages/to-students`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Échec envoi aux élèves');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-messages'] });
    },
  });
}

