/**
 * RSO Activity Log Client
 * Client-side helper for logging activities (calls backend API)
 */

import { getRSOToken } from './auth';

const API_BASE = '/api/v1/rso';

export interface LogActivityRequest {
  action: string;
  entityType?: string;
  entityId?: number;
  description?: string;
}

/**
 * Log an activity (client-side helper)
 * Note: This is a convenience function. The backend also logs activities automatically.
 */
export async function logActivity(data: LogActivityRequest): Promise<void> {
  const token = getRSOToken();
  if (!token) {
    // Silently fail if not authenticated (logging shouldn't break the app)
    return;
  }

  try {
    await fetch(`${API_BASE}/activity-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Tenant': 'aspci',
      },
      body: JSON.stringify({
        ...data,
        ipAddress: 'client', // Will be set by backend
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    });
  } catch (error) {
    // Silently fail - logging shouldn't break the app
    console.error('Error logging activity:', error);
  }
}

