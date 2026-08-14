'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import { TeacherMessage, MessageFilter, SchoolAnnouncement, AnnouncementFilter, ParentTeacherConversation, ConversationFilter, ConversationMessage, Notification, NotificationFilter, EventInvitation, InvitationFilter } from '@ecoledigitale/contracts';

// Base hook for parent messages API calls
// Provides session and headers for API calls
export function useParentMessages() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Hook for fetching teacher messages
export function useTeacherMessages(
  childId?: string,
  filters: MessageFilter = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      messages: TeacherMessage[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['parent-teacher-messages', childId, filters, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.teacherId) params.append('teacherId', filters.teacherId);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.readStatus) params.append('readStatus', filters.readStatus);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/messages/teacher-messages${queryString ? `?${queryString}` : ''}`;
      
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

// Hook for fetching school announcements
export function useSchoolAnnouncements(
  filters: AnnouncementFilter = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      announcements: SchoolAnnouncement[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['parent-school-announcements', filters, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.priorityLevel) params.append('priorityLevel', filters.priorityLevel);
      if (filters.readStatus) params.append('readStatus', filters.readStatus);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/messages/announcements${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch school announcements' }));
        throw new Error(error.message || 'Failed to fetch school announcements');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for fetching parent-teacher conversations
export function useParentTeacherConversations(
  childId?: string,
  filters: ConversationFilter = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      conversations: ParentTeacherConversation[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['parent-teacher-conversations', childId, filters, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.teacherId) params.append('teacherId', filters.teacherId);
      if (filters.status) params.append('status', filters.status);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/messages/conversations${queryString ? `?${queryString}` : ''}`;
      
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

// Hook for fetching a conversation thread
export function useConversationThread(conversationId: string | null) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      conversation: ParentTeacherConversation;
      messages: ConversationMessage[];
    } 
  }>({
    queryKey: ['conversation-thread', conversationId],
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
      
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/conversations/${conversationId}`;
      
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

// Hook for starting a new conversation
export function useStartParentConversation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      conversation: ParentTeacherConversation;
      message: ConversationMessage;
    } 
  }, Error, { childId: string; teacherId: string; subject: string; content: string; sendWhatsapp?: boolean; sendEmail?: boolean }>({
    mutationFn: async ({ childId, teacherId, subject, content, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/conversations`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ childId, teacherId, subject, content, sendWhatsapp: !!sendWhatsapp, sendEmail: !!sendEmail }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to start conversation' }));
        throw new Error(error.message || 'Failed to start conversation');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate conversations list to show new conversation
      queryClient.invalidateQueries({ queryKey: ['parent-teacher-conversations'] });
    },
  });
}

// Hook for fetching teachers for a child
export function useChildTeachers(childId: string | null) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      teachers: Array<{
        id: string;
        userId: string;
        name: string;
        email: string;
        courseName?: string;
        className?: string;
        coursesSummary?: string;
      }>;
    } 
  }>({
    queryKey: ['child-teachers', childId],
    queryFn: async () => {
      if (!childId) throw new Error('Child ID is required');
      
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/teachers/${childId}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch teachers' }));
        throw new Error(error.message || 'Failed to fetch teachers');
      }
      
      return response.json();
    },
    enabled: !!session && !!childId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for replying to a conversation
export function useReplyToConversation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      message: ConversationMessage;
      whatsappStatus?: string;
    } 
  }, Error, { conversationId: string; content: string; sendWhatsapp?: boolean; sendEmail?: boolean }>({
    mutationFn: async ({ conversationId, content, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/conversations/${conversationId}/reply`;
      
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
      queryClient.invalidateQueries({ queryKey: ['conversation-thread', variables.conversationId] });
      // Invalidate conversations list to update unread count and last message
      queryClient.invalidateQueries({ queryKey: ['parent-teacher-conversations'] });
    },
  });
}

// Hook for fetching notifications
export function useNotifications(
  filters: NotificationFilter = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      notifications: Notification[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['parent-notifications', filters, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (filters.notificationType) params.append('notificationType', filters.notificationType);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.readStatus) params.append('readStatus', filters.readStatus);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/messages/notifications${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch notifications' }));
        throw new Error(error.message || 'Failed to fetch notifications');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for marking notification as read
export function useMarkNotificationRead() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      notification: Notification;
    } 
  }, Error, string>({
    mutationFn: async (notificationId: string) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/notifications/${notificationId}/read`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to mark notification as read' }));
        throw new Error(error.message || 'Failed to mark notification as read');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate notifications query to refetch
      queryClient.invalidateQueries({ queryKey: ['parent-notifications'] });
    },
  });
}

// Hook for fetching event invitations
export function useEventInvitations(
  childId?: string,
  filters: InvitationFilter = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      invitations: EventInvitation[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    } 
  }>({
    queryKey: ['parent-event-invitations', childId, filters, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.eventType) params.append('eventType', filters.eventType);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.rsvpStatus) params.append('rsvpStatus', filters.rsvpStatus);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/messages/event-invitations${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch event invitations' }));
        throw new Error(error.message || 'Failed to fetch event invitations');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for responding to event invitation
export function useRespondToInvitation() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      invitation: EventInvitation;
    } 
  }, Error, { invitationId: string; rsvpStatus: 'accepted' | 'declined' | 'tentative' }>({
    mutationFn: async ({ invitationId, rsvpStatus }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/event-invitations/${invitationId}/rsvp`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rsvpStatus }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to respond to invitation' }));
        throw new Error(error.message || 'Failed to respond to invitation');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate invitations query to refetch
      queryClient.invalidateQueries({ queryKey: ['parent-event-invitations'] });
    },
  });
}

// Hook for sending a message to the school/establishment
export function useSendSchoolMessage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  return useMutation<{ 
    success: boolean; 
    data: { 
      conversation: {
        id: string;
        parentId: string;
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
  }, Error, { childId: string; subject: string; content: string; sendWhatsapp?: boolean; sendEmail?: boolean }>({
    mutationFn: async ({ childId, subject, content, sendWhatsapp, sendEmail }) => {
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/school-messages`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ childId, subject, content, sendWhatsapp: !!sendWhatsapp, sendEmail: !!sendEmail }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to send message to school' }));
        throw new Error(error.message || 'Failed to send message to school');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate conversations list to show new conversation
      queryClient.invalidateQueries({ queryKey: ['parent-school-conversations'] });
    },
  });
}

// Hook for fetching school conversations
export function useSchoolConversations(
  childId?: string,
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
    queryKey: ['parent-school-conversations', childId, status, page, limit],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (status) params.append('status', status);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/messages/school-conversations${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch school conversations' }));
        throw new Error(error.message || 'Failed to fetch school conversations');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Hook for fetching a school conversation thread
export function useSchoolConversationThread(conversationId: string | null) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      conversation: {
        id: string;
        parentId: string;
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
    queryKey: ['school-conversation-thread', conversationId],
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
      
      const headers = createApiHeaders(session);
      const url = `/api/v1/parent/messages/school-conversations/${conversationId}`;
      
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

// Hook for replying to a school conversation
export function useReplyToSchoolConversation() {
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
      const url = `/api/v1/parent/messages/school-conversations/${conversationId}/reply`;
      
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
      queryClient.invalidateQueries({ queryKey: ['school-conversation-thread', variables.conversationId] });
      // Invalidate conversations list to update last message
      queryClient.invalidateQueries({ queryKey: ['parent-school-conversations'] });
    },
  });
}

