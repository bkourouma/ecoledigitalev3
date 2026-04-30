/**
 * RSO Permissions API Client
 * API client for viewing permissions
 */

import { getRSOToken } from './auth';

const API_BASE = '/api/v1/rso';

export interface RSOPermission {
  id: number;
  role: string;
  module: string;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export interface PermissionsListResponse {
  permissions: RSOPermission[];
}

/**
 * List all permissions
 */
export async function listPermissions(): Promise<PermissionsListResponse> {
  const token = getRSOToken();
  if (!token) {
    throw new Error('Non authentifié');
  }

  const response = await fetch(`${API_BASE}/permissions`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant': 'aspci',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erreur lors de la récupération des permissions' }));
    throw new Error(error.message || 'Erreur lors de la récupération des permissions');
  }

  return response.json();
}

