/**
 * RSO Activities Client
 * API client for RSO activity consultation (read-only for PFSO agents)
 */

import { getRSOToken } from './auth';

const API_BASE = '/api/v1/rso';

export interface RSOActivity {
  id: number;
  tenantId: string;
  installationId: number;
  type: string;
  titre: string;
  description: string;
  dateActivite: string; // ISO date string
  statut: string;
  createdBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RSOActivityFilters {
  installationId?: number;
  year?: number;
  type?: string;
  page?: number;
  limit?: number;
}

export interface RSOActivityListResponse {
  activities: RSOActivity[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RSOActivityTypesResponse {
  types: string[];
}

/**
 * List activities with filters
 */
export async function listRSOActivities(
  filters: RSOActivityFilters = {}
): Promise<RSOActivityListResponse> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié. Veuillez vous connecter.');
  }

  const queryParams = new URLSearchParams();
  if (filters.installationId) {
    queryParams.append('installationId', filters.installationId.toString());
  }
  if (filters.year) {
    queryParams.append('year', filters.year.toString());
  }
  if (filters.type) {
    queryParams.append('type', filters.type);
  }
  if (filters.page) {
    queryParams.append('page', filters.page.toString());
  }
  if (filters.limit) {
    queryParams.append('limit', filters.limit.toString());
  }

  const url = `${API_BASE}/activities${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant': 'aspci', // Use slug instead of UUID
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
    throw new Error(error.message || `Erreur ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get activity by ID
 */
export async function getRSOActivityById(activityId: number): Promise<RSOActivity> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié. Veuillez vous connecter.');
  }

  const response = await fetch(`${API_BASE}/activities/${activityId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant': 'aspci',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
    throw new Error(error.message || `Erreur ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get activity types
 */
export async function getRSOActivityTypes(): Promise<string[]> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié. Veuillez vous connecter.');
  }

  try {
    const response = await fetch(`${API_BASE}/activities/types`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Tenant': 'aspci',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      let errorMessage = `Erreur ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        // If response is not JSON, use status text
      }
      throw new Error(errorMessage);
    }

    const data: RSOActivityTypesResponse = await response.json();
    if (!data || !Array.isArray(data.types)) {
      throw new Error('Format de réponse invalide: types attendu');
    }
    return data.types;
  } catch (error: any) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(error?.message || 'Erreur inconnue lors de la récupération des types d\'activités');
  }
}

/**
 * Create a new activity
 */
export async function createRSOActivity(activityData: {
  installationId: number;
  type: string;
  titre: string;
  description?: string;
  dateActivite: string;
  statut?: string;
}): Promise<RSOActivity> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié. Veuillez vous connecter.');
  }

  const response = await fetch(`${API_BASE}/activities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Tenant': 'aspci',
    },
    body: JSON.stringify(activityData),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
    throw new Error(error.message || `Erreur ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Update an existing activity
 */
export async function updateRSOActivity(
  activityId: number,
  activityData: {
    installationId?: number;
    type?: string;
    titre?: string;
    description?: string;
    dateActivite?: string;
    statut?: string;
  }
): Promise<RSOActivity> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié. Veuillez vous connecter.');
  }

  const response = await fetch(`${API_BASE}/activities/${activityId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Tenant': 'aspci',
    },
    body: JSON.stringify(activityData),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
    throw new Error(error.message || `Erreur ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete an activity
 */
export async function deleteRSOActivity(activityId: number): Promise<void> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié. Veuillez vous connecter.');
  }

  const response = await fetch(`${API_BASE}/activities/${activityId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant': 'aspci',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
    throw new Error(error.message || `Erreur ${response.status}: ${response.statusText}`);
  }
}

