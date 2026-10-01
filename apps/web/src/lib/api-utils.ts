/**
 * API Utilities - Shared helpers for making API requests
 * 
 * This module provides utilities for consistent API calls across the application.
 * All functions handle tenant context and authentication automatically.
 */

import { Session } from 'next-auth';
import { requireBrowserTenant } from '@/platform/tenant/browser';

/**
 * Get tenant slug : sous-domaine, puis NEXT_PUBLIC_TENANT_SLUG (voir platform/tenant/resolve-tenant.ts).
 * Lève `TenantUnknownError` quand le tenant est inconnu : plus aucun repli codé en dur.
 * Les appelants existants l'entourent déjà d'un try/catch.
 */
export function getTenantSlug(): string {
  return requireBrowserTenant().key;
}

/**
 * Create headers for API requests with tenant and auth
 * 
 * @param session - Optional NextAuth session
 * @param additionalHeaders - Additional headers to include
 * @returns Headers object ready for fetch
 */
export function createApiHeaders(
  session?: Session | null,
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...additionalHeaders,
  };

  // Tenant : en priorité celui de la session (évite localhost + dev → imhotepdata alors que l’utilisateur est sur imhotepacademy, etc.)
  const sessionTenantSlug = session && (session as { tenantSlug?: string }).tenantSlug;
  const sessionTenantId = session && (session as { tenantId?: string }).tenantId;
  if (sessionTenantSlug) {
    headers['X-Tenant'] = sessionTenantSlug;
  } else if (sessionTenantId) {
    headers['X-Tenant'] = sessionTenantId;
  } else {
    try {
      headers['X-Tenant'] = getTenantSlug();
    } catch (error) {
      console.warn('Could not get tenant slug:', error);
    }
  }

  // JWT token will be automatically added by fetch interceptor (Phase 4)
  // No manual header manipulation needed here
  
  return headers;
}

/**
 * Build query parameters string from an object
 * 
 * @param params - Object with query parameters
 * @returns Query string (with leading ?) or empty string
 */
export function buildQueryString(params?: Record<string, any>): string {
  if (!params) return '';
  
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Make an API request with automatic tenant and auth handling
 * 
 * @param endpoint - API endpoint (e.g., '/api/v1/students')
 * @param options - Fetch options
 * @param session - Optional NextAuth session
 * @returns Fetch response
 */
export async function apiRequest(
  endpoint: string,
  options?: RequestInit,
  session?: Session | null
): Promise<Response> {
  const headers = createApiHeaders(session, options?.headers as Record<string, string>);

  return fetch(endpoint, {
    ...options,
    headers,
  });
}

/**
 * Make an API request and parse JSON response
 * 
 * @param endpoint - API endpoint
 * @param options - Fetch options
 * @param session - Optional NextAuth session
 * @returns Parsed JSON response
 * @throws Error if response is not OK
 */
export async function apiRequestJson<T = any>(
  endpoint: string,
  options?: RequestInit,
  session?: Session | null
): Promise<T> {
  const response = await apiRequest(endpoint, options, session);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('API Error:', {
      endpoint,
      status: response.status,
      error: errorText,
    });
    throw new Error(`API request failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

