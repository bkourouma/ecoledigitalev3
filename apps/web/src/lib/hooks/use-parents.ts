import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import { getToken, getUserFromToken } from '@/lib/jwt-storage';

export interface Parent {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  childrenCount: number;
  createdAt: string;
  /** Mot de passe initial / dernier reset (admin uniquement, API) */
  initialPassword?: string | null;
}

export interface CreateParentData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
}

export interface UpdateParentData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface AssignStudentToParentData {
  parentId: string;
  relationshipType?: 'parent' | 'guardian' | 'emergency_contact';
  isPrimaryContact?: boolean;
  emergencyContact?: boolean;
  canPickup?: boolean;
  notes?: string;
}

function getParentTenantScope(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  const selectedTenant = window.localStorage.getItem("superAdminSelectedTenant");
  if (selectedTenant) {
    return `super-admin:${selectedTenant}`;
  }

  const token = getToken();
  const user = token ? getUserFromToken(token) : null;

  if (user?.tenantId) {
    return `tenant-id:${user.tenantId}`;
  }

  if (user?.tenantSlug) {
    return `tenant-slug:${user.tenantSlug}`;
  }

  return "tenant:unknown";
}

// Fetch parents list
async function resetParentPassword(
  id: string
): Promise<{ parentId: string; initialPassword: string; message: string }> {
  const response = await fetch(`/api/v1/parents/${id}/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Impossible de réinitialiser le mot de passe");
  }

  return response.json();
}

async function fetchParents(query?: { search?: string; page?: number; limit?: number; academicYearId?: string }): Promise<{ success: boolean; data: { parents: Parent[]; total: number; page: number; limit: number; totalPages: number } }> {
  const session = await new Promise((resolve) => {
    // This will be handled by the hook
    resolve(null);
  });
  
  const params = new URLSearchParams();
  if (query?.search) params.append('search', query.search);
  if (query?.page) params.append('page', query.page.toString());
  if (query?.limit) params.append('limit', query.limit.toString());
  if (query?.academicYearId) params.append('academicYearId', query.academicYearId);
  
  const queryString = params.toString();
  const response = await fetch(`/api/v1/parents${queryString ? `?${queryString}` : ''}`, {
    headers: createApiHeaders(session as any),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch parents' }));
    throw new Error(error.message || 'Failed to fetch parents');
  }
  
  return response.json();
}

// Create parent
async function createParent(data: CreateParentData): Promise<{ success: boolean; data: Parent }> {
  const session = await new Promise((resolve) => {
    // This will be handled by the hook
    resolve(null);
  });
  
  const response = await fetch('/api/v1/parents', {
    method: 'POST',
    headers: createApiHeaders(session as any),
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to create parent' }));
    throw new Error(error.message || 'Failed to create parent');
  }
  
  return response.json();
}

// Assign student to parent
async function assignStudentToParent(studentId: string, data: AssignStudentToParentData): Promise<{ success: boolean; data: any }> {
  const session = await new Promise((resolve) => {
    // This will be handled by the hook
    resolve(null);
  });
  
  const response = await fetch(`/api/v1/students/${studentId}/parents`, {
    method: 'POST',
    headers: createApiHeaders(session as any),
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to assign student to parent' }));
    throw new Error(error.message || 'Failed to assign student to parent');
  }
  
  return response.json();
}

// Fetch parents for a student
async function fetchStudentParents(studentId: string): Promise<{ success: boolean; data: { parents: any[]; total: number } }> {
  const session = await new Promise((resolve) => {
    // This will be handled by the hook
    resolve(null);
  });
  
  const response = await fetch(`/api/v1/students/${studentId}/parents`, {
    headers: createApiHeaders(session as any),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch student parents' }));
    throw new Error(error.message || 'Failed to fetch student parents');
  }
  
  return response.json();
}

// Unassign student from parent
async function unassignStudentFromParent(studentId: string, parentId: string): Promise<void> {
  const session = await new Promise((resolve) => {
    // This will be handled by the hook
    resolve(null);
  });
  
  const response = await fetch(`/api/v1/students/${studentId}/parents/${parentId}`, {
    method: 'DELETE',
    headers: createApiHeaders(session as any),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to unassign student from parent' }));
    throw new Error(error.message || 'Failed to unassign student from parent');
  }
}

// React Query hooks
export function useParents(query?: { search?: string; page?: number; limit?: number; academicYearId?: string }) {
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useQuery({
    queryKey: ['parents', tenantScope, query],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const params = new URLSearchParams();
      if (query?.search) params.append('search', query.search);
      if (query?.page) params.append('page', query.page.toString());
      if (query?.limit) params.append('limit', query.limit.toString());
      if (query?.academicYearId) params.append('academicYearId', query.academicYearId);
      
      const queryString = params.toString();
      const response = await fetch(`/api/v1/parents${queryString ? `?${queryString}` : ''}`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch parents' }));
        throw new Error(error.message || 'Failed to fetch parents');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useParent(id: string) {
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useQuery({
    queryKey: ['parent', tenantScope, id],
    queryFn: async () => {
      console.log('[useParent] Fetching parent with ID:', id);
      const headers = createApiHeaders(session);
      
      let response;
      try {
        response = await fetch(`/api/v1/parents/${id}`, {
          headers,
        });
      } catch (fetchError: any) {
        console.error('[useParent] Fetch error:', fetchError);
        const errorMessage = fetchError?.message || 'Failed to connect to server';
        throw new Error(errorMessage);
      }
      
      console.log('[useParent] Response status:', response.status);
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch parent';
        try {
          const errorText = await response.text();
          console.error('[useParent] Error response text:', errorText);
          
          if (errorText) {
            try {
              const errorJson = JSON.parse(errorText);
              errorMessage = errorJson.message || errorJson.error || errorMessage;
            } catch {
              // If not JSON, use the text as error message
              errorMessage = errorText || errorMessage;
            }
          }
        } catch (parseError) {
          console.error('[useParent] Error parsing error response:', parseError);
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      console.log('[useParent] Response data:', result);
      
      // Handle both { success: true, data: {...} } and direct parent object
      if (result.success && result.data) {
        console.log('[useParent] Returning parent data:', result.data);
        return result.data;
      }
      console.log('[useParent] Returning result directly:', result);
      return result;
    },
    enabled: !!session && !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1, // Retry once on failure
  });
}

export function useCreateParent() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useMutation({
    mutationFn: async (data: CreateParentData) => {
      const headers = createApiHeaders(session);
      const response = await fetch('/api/v1/parents', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to create parent' }));
        throw new Error(error.message || 'Failed to create parent');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parents', tenantScope] });
    },
  });
}

export function useUpdateParent() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateParentData }) => {
      const headers = createApiHeaders(session);
      const response = await fetch(`/api/v1/parents/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to update parent';
        try {
          const error = await response.json();
          errorMessage = error.message || error.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      return response.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['parents', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['parent', tenantScope, id] });
    },
  });
}

export function useResetParentPassword() {
  const queryClient = useQueryClient();
  const tenantScope = getParentTenantScope();

  return useMutation({
    mutationFn: resetParentPassword,
    onSuccess: (_, parentId) => {
      queryClient.invalidateQueries({ queryKey: ["parents", tenantScope] });
      queryClient.invalidateQueries({ queryKey: ["parent", tenantScope, parentId] });
    },
  });
}

export function useDeleteParent() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const headers = createApiHeaders(session);
      const response = await fetch(`/api/v1/parents/${id}`, {
        method: 'DELETE',
        headers,
        // Don't include Content-Type for DELETE requests without body
      });
      
      if (!response.ok) {
        let errorMessage = 'Impossible de supprimer le parent';
        try {
          const error = await response.json();
          const backendMessage = error.message || error.error || '';
          
          // Provide user-friendly messages for specific errors
          if (response.status === 404) {
            errorMessage = "Parent introuvable dans l'établissement actif. La liste va être actualisée.";
          } else if (response.status === 409) {
            if (backendMessage.includes('students') || backendMessage.includes('étudiants') || backendMessage.includes('enfants')) {
              errorMessage = "Impossible de supprimer le parent car il est associé à des étudiants.\n\nVeuillez d'abord retirer tous les étudiants du parent avant de le supprimer.";
            } else {
              errorMessage = backendMessage || "Le parent ne peut pas être supprimé car il contient des éléments associés.";
            }
          } else {
            errorMessage = backendMessage || errorMessage;
          }
        } catch {
          // If response is not JSON, use status text
          errorMessage = `Erreur ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
    },
    onSuccess: (_, deletedId) => {
      // Optimistically remove the parent from all parent queries
      queryClient.setQueriesData(
        { queryKey: ['parents', tenantScope] },
        (oldData: any) => {
          if (!oldData) return oldData;
          
          // Handle different response structures
          // Structure: { success: true, data: { parents: [...], total: ..., page: ..., limit: ..., totalPages: ... } }
          if (oldData.data?.parents) {
            const filteredParents = oldData.data.parents.filter((parent: Parent) => parent.id !== deletedId);
            return {
              ...oldData,
              data: {
                ...oldData.data,
                parents: filteredParents,
                total: Math.max(0, (oldData.data.total || 0) - 1),
                totalPages: oldData.data.limit ? Math.ceil(Math.max(0, (oldData.data.total || 0) - 1) / oldData.data.limit) : oldData.data.totalPages,
              },
            };
          }
          
          // Fallback: if structure is different, just invalidate
          return oldData;
        }
      );
      
      // Invalidate and refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['parents', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['parent', tenantScope, deletedId] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['parents', tenantScope] });
    },
  });
}

export function useAssignStudentToParent() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useMutation({
    mutationFn: async ({ studentId, data }: { studentId: string; data: AssignStudentToParentData }) => {
      const headers = createApiHeaders(session);
      const response = await fetch(`/api/v1/students/${studentId}/parents`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to assign student to parent' }));
        throw new Error(error.message || 'Failed to assign student to parent');
      }
      
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['student-parents', variables.studentId] });
      queryClient.invalidateQueries({ queryKey: ['parents', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

export function useStudentParents(studentId: string) {
  const { data: session } = useSession();
  
  return useQuery({
    queryKey: ['student-parents', studentId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const response = await fetch(`/api/v1/students/${studentId}/parents`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch student parents' }));
        throw new Error(error.message || 'Failed to fetch student parents');
      }
      
      return response.json();
    },
    enabled: !!session && !!studentId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUnassignStudentFromParent() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();
  
  return useMutation({
    mutationFn: async ({ studentId, parentId }: { studentId: string; parentId: string }) => {
      const headers = createApiHeaders(session);
      const response = await fetch(`/api/v1/students/${studentId}/parents/${parentId}`, {
        method: 'DELETE',
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to unassign student from parent' }));
        throw new Error(error.message || 'Failed to unassign student from parent');
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['student-parents', variables.studentId] });
      queryClient.invalidateQueries({ queryKey: ['parents', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

export interface ParentChild {
  id: string;
  name: string;
  email: string;
  currentYear: number;
  status: 'active' | 'suspended' | 'dropped' | 'transfer' | 'graduated';
  studentNumber: string;
}

export function useParentChildren(parentId: string) {
  const { data: session } = useSession();
  const tenantScope = getParentTenantScope();

  return useQuery({
    queryKey: ['parent-children', tenantScope, parentId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const response = await fetch(`/api/v1/parents/${parentId}/children`, {
        headers,
      });

      if (!response.ok) {
        let errorMessage = 'Failed to fetch parent children';
        try {
          const error = await response.json();
          errorMessage = error.message || error.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      // Handle both { success: true, data: {...} } and direct data
      if (result.success && result.data) {
        return result.data;
      }
      return result;
    },
    enabled: !!session && !!parentId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
