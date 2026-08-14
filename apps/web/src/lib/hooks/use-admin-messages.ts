'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

// Hook for fetching admin conversations
export function useAdminConversations(
  childId?: string,
  parentId?: string,
  status?: string,
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      conversations: Array<{
        id: string;
        parentId: string;
        parentName: string;
        childId: string;
        childName: string;
        subject: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        lastMessage?: {
          content: string;
          sentAt: string;
          senderName: string;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['admin-conversations', childId, parentId, status, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (parentId) params.append('parentId', parentId);
      if (status) params.append('status', status);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/admin/messages/conversations${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch conversations' }));
        throw new Error(error.message || 'Failed to fetch conversations');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for fetching an admin conversation thread
export function useAdminConversationThread(conversationId: string | null) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      conversation: {
        id: string;
        parentId: string;
        parentName: string;
        childId: string;
        childName: string;
        subject: string;
        status: string;
        createdAt: string;
      };
      messages: Array<{
        id: string;
        senderId: string;
        senderName: string;
        content: string;
        sentAt: string;
        isRead: boolean;
      }>;
    } 
  }>({
    queryKey: ['admin-conversation-thread', conversationId],
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
      
      const headers = createApiHeaders(session);
      const url = `/api/v1/admin/messages/conversations/${conversationId}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch conversation thread' }));
        throw new Error(error.message || 'Failed to fetch conversation thread');
      }
      
      return response.json();
    },
    enabled: !!session && !!conversationId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Hook for replying to a conversation as admin
export function useAdminReplyToConversation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      message: {
        id: string;
        senderId: string;
        senderName: string;
        content: string;
        sentAt: string;
        isRead: boolean;
      };
    } 
  }, Error, { conversationId: string; content: string; sendWhatsapp?: boolean; sendEmail?: boolean }>({
    mutationFn: async ({ conversationId, content, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/admin/messages/conversations/${conversationId}/reply`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, sendWhatsapp: !!sendWhatsapp, sendEmail: !!sendEmail }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to send reply' }));
        throw new Error(error.message || 'Failed to send reply');
      }
      
      return response.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate conversation thread query to refetch messages
      queryClient.invalidateQueries({ queryKey: ['admin-conversation-thread', variables.conversationId] });
      // Invalidate conversations list to update last message
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });
}

// Hook for fetching teacher messages (admin view)
export function useAdminTeacherMessages(
  childId?: string,
  teacherId?: string,
  parentId?: string,
  startDate?: string,
  endDate?: string,
  priorityLevel?: string,
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      messages: Array<{
        id: string;
        childId: string;
        childName: string;
        teacherId: string;
        teacherName: string;
        parentId: string;
        parentName: string;
        subject: string;
        content: string;
        priorityLevel: string | null;
        sentAt: string;
        isRead: boolean;
        readAt: string | null;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['admin-teacher-messages', childId, teacherId, parentId, startDate, endDate, priorityLevel, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (teacherId) params.append('teacherId', teacherId);
      if (parentId) params.append('parentId', parentId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (priorityLevel) params.append('priorityLevel', priorityLevel);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/admin/messages/teacher-messages${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch teacher messages' }));
        throw new Error(error.message || 'Failed to fetch teacher messages');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for sending messages to teachers (admin)
export function useAdminSendToTeachers() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      message: string;
      sentTo: number;
      emailSummary?: Record<string, number>;
    } 
  }, Error, {
    teacherIds?: string[];
    allTeachers?: boolean;
    subject: string;
    content: string;
    priorityLevel?: string;
    sendWhatsapp?: boolean;
    sendEmail?: boolean;
  }>({
    mutationFn: async ({ teacherIds, allTeachers, subject, content, priorityLevel, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/admin/messages/send-to-teachers`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          teacherIds: teacherIds || [],
          allTeachers: !!allTeachers,
          subject,
          content,
          priorityLevel,
          sendWhatsapp: !!sendWhatsapp,
          sendEmail: !!sendEmail,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to send messages' }));
        throw new Error(error.message || 'Failed to send messages');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate any related queries if needed
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-messages'] });
    },
  });
}

// Hook for sending announcements to students (admin)
export function useAdminSendToStudents() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      message: string;
      sentTo: number;
      emailSummary?: Record<string, number>;
    } 
  }, Error, { 
    classIds?: string[]; 
    studentIds?: string[]; 
    subject: string; 
    content: string; 
    priorityLevel?: string;
    sendWhatsapp?: boolean;
    sendEmail?: boolean;
  }>({
    mutationFn: async ({ classIds = [], studentIds = [], subject, content, priorityLevel, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/admin/messages/send-to-students`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ classIds, studentIds, subject, content, priorityLevel, sendWhatsapp: !!sendWhatsapp, sendEmail: !!sendEmail }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to send announcement' }));
        throw new Error(error.message || 'Failed to send announcement');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate any related queries if needed
      queryClient.invalidateQueries({ queryKey: ['admin-student-messages'] });
    },
  });
}

// Hook for fetching parents with their children for conversation creation
export function useAdminParents(search?: string) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      parents: Array<{
        id: string;
        name: string;
        email: string;
        children: Array<{
          id: string;
          name: string;
        }>;
      }>;
    } 
  }>({
    queryKey: ['admin-parents', search],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      
      const queryString = params.toString();
      const url = `/api/v1/admin/messages/parents${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch parents' }));
        throw new Error(error.message || 'Failed to fetch parents');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for starting a new conversation as admin
export function useAdminStartConversation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      conversation: {
        id: string;
        parentId: string;
        parentName: string;
        childId: string;
        childName: string;
        subject: string;
        status: string;
        createdAt: string;
      };
      message: {
        id: string;
        senderId: string;
        senderName: string;
        content: string;
        sentAt: string;
      };
    } 
  }, Error, { parentId: string; childId: string; subject: string; content: string; sendWhatsapp?: boolean; sendEmail?: boolean }>({
    mutationFn: async ({ parentId, childId, subject, content, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/admin/messages/conversations`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parentId, childId, subject, content, sendWhatsapp: !!sendWhatsapp, sendEmail: !!sendEmail }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to start conversation' }));
        throw new Error(error.message || 'Failed to start conversation');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate conversations list to show new conversation
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });
}

export function useAdminStudentsWithParents(classId: string | undefined) {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ['admin-students-with-parents', classId],
    queryFn: async () => {
      if (!classId) return { success: true, data: [] as any[] };
      const headers = createApiHeaders(session);
      const res = await fetch(
        `/api/v1/admin/messages/students-by-class-with-parents?classId=${encodeURIComponent(classId)}`,
        { headers }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Échec chargement élèves/parents');
      }
      return res.json();
    },
    enabled: !!session && !!classId,
  });
}

export function useAdminBulkParentConversations() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      allClasses?: boolean;
      classIds?: string[];
      studentProfileIds?: string[];
      subject: string;
      content: string;
      sendWhatsapp?: boolean;
      sendEmail?: boolean;
    }) => {
      const headers = createApiHeaders(session);
      const res = await fetch('/api/v1/admin/messages/bulk-parent-conversations', {
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
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });
}
