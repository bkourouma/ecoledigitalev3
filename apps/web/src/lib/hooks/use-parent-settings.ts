'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import {
  ParentProfile,
  ContactInformation,
  EmergencyContact,
  NotificationPreference,
  ParentChildRelationship,
  ProfileUpdate,
  ContactUpdate,
  EmergencyContactCreate,
  EmergencyContactUpdate,
  NotificationPreferencesUpdate,
  PasswordChange,
} from '@ecoledigitale/contracts';

// Base hook for parent settings API calls
// Provides session and headers for API calls
export function useParentSettings() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Base query configuration for parent settings hooks
const defaultQueryConfig = {
  enabled: (session: any) => !!session,
  staleTime: 2 * 60 * 1000, // 2 minutes
  retry: 1,
};

// Hook for fetching parent profile information
export function useParentProfile() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      profile: ParentProfile;
    } 
  }>({
    queryKey: ['parent-profile'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/profile', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch parent profile' }));
        throw new Error(error.message || 'Failed to fetch parent profile');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for updating parent profile information
export function useUpdateParentProfile() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: ProfileUpdate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/profile', {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update parent profile' }));
        throw new Error(error.message || 'Failed to update parent profile');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-profile'] });
    },
  });
}

// Hook for fetching contact information
export function useContactInformation() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      contact: ContactInformation;
    } 
  }>({
    queryKey: ['parent-contact'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/contact', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch contact information' }));
        throw new Error(error.message || 'Failed to fetch contact information');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for updating contact information
export function useUpdateContactInformation() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: ContactUpdate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/contact', {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update contact information' }));
        throw new Error(error.message || 'Failed to update contact information');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-contact'] });
    },
  });
}

// Hook for fetching emergency contacts
export function useEmergencyContacts() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      contacts: EmergencyContact[];
    } 
  }>({
    queryKey: ['parent-emergency-contacts'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/emergency-contacts', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch emergency contacts' }));
        throw new Error(error.message || 'Failed to fetch emergency contacts');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for adding emergency contact
export function useAddEmergencyContact() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: EmergencyContactCreate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/emergency-contacts', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to add emergency contact' }));
        throw new Error(error.message || 'Failed to add emergency contact');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-emergency-contacts'] });
    },
  });
}

// Hook for updating emergency contact
export function useUpdateEmergencyContact() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async ({ contactId, data }: { contactId: string; data: EmergencyContactUpdate }) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/settings/emergency-contacts/${contactId}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update emergency contact' }));
        throw new Error(error.message || 'Failed to update emergency contact');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-emergency-contacts'] });
    },
  });
}

// Hook for removing emergency contact
export function useRemoveEmergencyContact() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (contactId: string) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/settings/emergency-contacts/${contactId}`, {
        method: 'DELETE',
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to remove emergency contact' }));
        throw new Error(error.message || 'Failed to remove emergency contact');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-emergency-contacts'] });
    },
  });
}

// Hook for fetching notification preferences
export function useNotificationPreferences() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      preferences: NotificationPreference[];
    } 
  }>({
    queryKey: ['parent-notification-preferences'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/notification-preferences', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch notification preferences' }));
        throw new Error(error.message || 'Failed to fetch notification preferences');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for updating notification preferences
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: NotificationPreferencesUpdate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/notification-preferences', {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update notification preferences' }));
        throw new Error(error.message || 'Failed to update notification preferences');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-notification-preferences'] });
    },
  });
}

// Hook for fetching relationship management information
export function useRelationships() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      relationships: ParentChildRelationship[];
    } 
  }>({
    queryKey: ['parent-relationships'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/relationships', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch relationships' }));
        throw new Error(error.message || 'Failed to fetch relationships');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for changing password
export function useChangePassword() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: PasswordChange) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/settings/change-password', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to change password' }));
        throw new Error(error.message || 'Failed to change password');
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate any queries that might depend on user data
      queryClient.invalidateQueries({ queryKey: ['parent-profile'] });
    },
  });
}

