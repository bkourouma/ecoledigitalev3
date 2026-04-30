'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface CreateAnnouncementInput {
  title: string;
  content: string;
  priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface UpdateAnnouncementInput {
  title?: string;
  content?: string;
  priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface SchoolAnnouncement {
  id: string;
  title: string;
  content: string;
  priorityLevel: 'low' | 'normal' | 'high' | 'urgent' | null;
  authorId: string;
  authorName: string;
  postedAt: string;
}

export interface AnnouncementsResponse {
  success: boolean;
  data: {
    announcements: SchoolAnnouncement[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

// Hook to create an announcement
export function useCreateAnnouncement() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useMutation({
    mutationFn: async (input: CreateAnnouncementInput) => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/announcements`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to create announcement' }));
        throw new Error(error.message || 'Failed to create announcement');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate announcements queries to refetch
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['parent-announcements'] });
    },
  });
}

// Hook to update an announcement
export function useUpdateAnnouncement() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAnnouncementInput }) => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/announcements/${id}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update announcement' }));
        throw new Error(error.message || 'Failed to update announcement');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate announcements queries to refetch
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['parent-announcements'] });
    },
  });
}

// Hook to delete an announcement
export function useDeleteAnnouncement() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/announcements/${id}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to delete announcement' }));
        throw new Error(error.message || 'Failed to delete announcement');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate announcements queries to refetch
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['parent-announcements'] });
    },
  });
}

// Hook to fetch announcements (for admin)
export function useAdminAnnouncements(
  filters: {
    startDate?: string;
    endDate?: string;
    priorityLevel?: 'low' | 'normal' | 'high' | 'urgent';
  } = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery<AnnouncementsResponse>({
    queryKey: ['admin-announcements', filters, page, limit],
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
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const queryString = params.toString();
      const url = `${API_BASE_URL}/api/v1/admin/announcements${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch announcements' }));
        throw new Error(error.message || 'Failed to fetch announcements');
      }

      return response.json();
    },
    enabled: !!session && !!userId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

