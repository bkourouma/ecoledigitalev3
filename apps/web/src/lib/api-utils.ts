/**
 * API Utilities - Shared helpers for making API requests
 * 
 * This module provides utilities for consistent API calls across the application.
 * All functions handle tenant context and authentication automatically.
 */

import { Session } from 'next-auth';

/**
 * Get tenant slug from environment or error
 * This is a client-side utility that works with the fetch interceptor
 */
export function getTenantSlug(): string {
  if (typeof window === 'undefined') {
    // Server-side: use environment variable
    // Default to 'imhotepdata' as it has the actual formations data
    return process.env.NEXT_PUBLIC_TENANT_SLUG || 'imhotepdata';
  }

  // Client-side: use environment variable first
  if (process.env.NEXT_PUBLIC_TENANT_SLUG) {
    return process.env.NEXT_PUBLIC_TENANT_SLUG;
  }

  // Try to extract from subdomain
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  
  if (parts.length > 2 || (parts.length > 1 && parts[parts.length - 1] === 'localhost')) {
    const subdomain = parts[0];
    if (subdomain && subdomain !== 'www') {
      return subdomain;
    }
  }

  // Fallback for development
  // Use 'imhotepdata' as it has the actual formations data
  if (process.env.NODE_ENV === 'development') {
    return 'imhotepdata';
  }

  throw new Error('Tenant configuration missing! Set NEXT_PUBLIC_TENANT_SLUG');
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

