'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import {
  EmergencyContact,
  EmergencyContactCreate,
  EmergencyContactUpdate,
  PickupAuthorization,
  PickupAuthorizationUpdate,
  RelationshipType,
  RelationshipTypeUpdate,
  DataAccess,
} from '@ecoledigitale/contracts';

// Base hook for parent emergency API calls
// Provides session and headers for API calls
export function useParentEmergency() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Base query configuration for parent emergency hooks
const defaultQueryConfig = {
  enabled: (session: any) => !!session,
  staleTime: 2 * 60 * 1000, // 2 minutes
  retry: 1,
};

// Base mutation configuration for parent emergency hooks
const defaultMutationConfig = {
  retry: 1,
};

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
      
      const response = await fetch('/api/v1/parent/emergency/contacts', {
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
      
      const response = await fetch('/api/v1/parent/emergency/contacts', {
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
    retry: 1,
  });
}

// Hook for updating emergency contact
export function useUpdateEmergencyContact(contactId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: EmergencyContactUpdate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/emergency/contacts/${contactId}`, {
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
    retry: 1,
  });
}

// Hook for removing emergency contact
export function useRemoveEmergencyContact() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (contactId: string) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/emergency/contacts/${contactId}`, {
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
    retry: 1,
  });
}

// Hook for fetching pickup authorization
export function usePickupAuthorization() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      relationships: PickupAuthorization[];
    } 
  }>({
    queryKey: ['parent-pickup-authorization'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/emergency/pickup-authorization', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch pickup authorization' }));
        throw new Error(error.message || 'Failed to fetch pickup authorization');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for updating pickup authorization
export function useUpdatePickupAuthorization(relationshipId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: PickupAuthorizationUpdate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/emergency/pickup-authorization/${relationshipId}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update pickup authorization' }));
        throw new Error(error.message || 'Failed to update pickup authorization');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-pickup-authorization'] });
    },
    retry: 1,
  });
}

// Hook for fetching relationship types
export function useRelationshipTypes() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      relationships: RelationshipType[];
    } 
  }>({
    queryKey: ['parent-relationship-types'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/emergency/relationship-types', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch relationship types' }));
        throw new Error(error.message || 'Failed to fetch relationship types');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for updating relationship type
export function useUpdateRelationshipType(relationshipId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  
  return useMutation({
    mutationFn: async (data: RelationshipTypeUpdate) => {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/parent/emergency/relationship-types/${relationshipId}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update relationship type' }));
        throw new Error(error.message || 'Failed to update relationship type');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parent-relationship-types'] });
    },
    retry: 1,
  });
}

// Hook for fetching data access information
export function useDataAccess() {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      dataAccess: DataAccess[];
    } 
  }>({
    queryKey: ['parent-data-access'],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const response = await fetch('/api/v1/parent/emergency/data-access', {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch data access information' }));
        throw new Error(error.message || 'Failed to fetch data access information');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

