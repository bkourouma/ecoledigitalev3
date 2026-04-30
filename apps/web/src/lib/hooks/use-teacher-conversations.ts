'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface TeacherConversation {
  id: string;
  parentId: string;
  parentName: string;
  teacherId: string;
  studentId: string;
  studentName: string;
  subject: string;
  status: 'active' | 'archived' | 'closed';
  lastMessagePreview: string | null;
  lastMessageDate: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: 'parent' | 'teacher';
  content: string;
  sentAt: string;
  isRead: boolean;
  readAt: string | null;
}

export interface ConversationThread {
  conversation: TeacherConversation;
  messages: ConversationMessage[];
}

// Hook to fetch teacher conversations
export function useTeacherConversations(
  filters: {
    studentId?: string;
    parentId?: string;
    status?: 'active' | 'archived' | 'closed';
  } = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery<{
    success: boolean;
    data: {
      conversations: TeacherConversation[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    };
  }>({
    queryKey: ['teacher-conversations', filters, page, limit],
    queryFn: async () => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const params = new URLSearchParams();
      if (filters.studentId) params.append('studentId', filters.studentId);
      if (filters.parentId) params.append('parentId', filters.parentId);
      if (filters.status) params.append('status', filters.status);
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const queryString = params.toString();
      const url = `${API_BASE_URL}/api/v1/teacher/conversations${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch conversations' }));
        throw new Error(error.message || 'Failed to fetch conversations');
      }

      return response.json();
    },
    enabled: !!session && !!userId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook to fetch a conversation thread
export function useTeacherConversationThread(conversationId: string | null) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useQuery<{
    success: boolean;
    data: ConversationThread;
  }>({
    queryKey: ['teacher-conversation-thread', conversationId],
    queryFn: async () => {
      if (!conversationId) {
        throw new Error('Conversation ID is required');
      }

      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;

      const url = `${API_BASE_URL}/api/v1/teacher/conversations/${conversationId}`;

      const response = await fetch(url, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch conversation thread' }));
        throw new Error(error.message || 'Failed to fetch conversation thread');
      }

      return response.json();
    },
    enabled: !!session && !!userId && !!conversationId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Hook to reply to a conversation
export function useReplyToTeacherConversation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: string; content: string }) => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;
      headers['Content-Type'] = 'application/json';

      const url = `${API_BASE_URL}/api/v1/teacher/conversations/${conversationId}/reply`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to reply to conversation' }));
        throw new Error(error.message || 'Failed to reply to conversation');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate conversations list to update unread count and last message
      queryClient.invalidateQueries({ queryKey: ['teacher-conversations'] });
      // Invalidate conversation thread to show new message
      queryClient.invalidateQueries({ queryKey: ['teacher-conversation-thread', variables.conversationId] });
    },
  });
}

// Hook to start a new conversation
export function useStartTeacherConversation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userId = (session as any)?.userId || (session?.user as any)?.id;

  return useMutation({
    mutationFn: async ({
      studentId,
      subject,
      content,
    }: {
      studentId: string;
      subject: string;
      content: string;
    }) => {
      if (!userId) {
        throw new Error('User ID not found in session');
      }

      const headers = createApiHeaders(session);
      headers['X-User-Id'] = userId;
      headers['Content-Type'] = 'application/json';

      const url = `${API_BASE_URL}/api/v1/teacher/conversations`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ studentId, subject, content }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to start conversation' }));
        throw new Error(error.message || 'Failed to start conversation');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate conversations list to show new conversation
      queryClient.invalidateQueries({ queryKey: ['teacher-conversations'] });
    },
  });
}

