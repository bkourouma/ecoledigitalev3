/**
 * JWT Storage Module
 * 
 * Manages JWT token storage in localStorage for authentication persistence.
 * Provides utilities for saving, retrieving, and checking token expiration.
 * 
 * Security Considerations:
 * - localStorage is vulnerable to XSS attacks
 * - Mitigated by Content Security Policy (CSP) headers
 * - Tokens contain no sensitive data (passwords, etc.)
 * - 24-hour token expiration limits exposure window
 */

import { jwtDecode } from 'jwt-decode';
import { JWTPayload } from '@ecoledigitale/contracts';

/**
 * localStorage key for JWT token
 */
const TOKEN_KEY = 'ecoledigitale_jwt_token';

/**
 * Save JWT token to localStorage
 * 
 * @param token - JWT token string
 */
export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    console.log('💾 JWT token saved to localStorage');
  } catch (error) {
    console.error('❌ Failed to save token to localStorage:', error);
    throw new Error('Failed to save authentication token');
  }
}

/**
 * Retrieve JWT token from localStorage
 * 
 * @returns JWT token string or null if not found
 */
export function getToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token;
  } catch (error) {
    console.error('❌ Failed to get token from localStorage:', error);
    return null;
  }
}

/**
 * Remove JWT token from localStorage
 * 
 * Called on logout or when token is invalid/expired
 */
export function removeToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    console.log('🗑️ JWT token removed from localStorage');
  } catch (error) {
    console.error('❌ Failed to remove token from localStorage:', error);
  }
}

/**
 * Check if token exists in localStorage
 * 
 * @returns True if token exists, false otherwise
 */
export function hasToken(): boolean {
  const token = getToken();
  return token !== null && token.length > 0;
}

/**
 * Decode JWT token to get payload
 * 
 * ⚠️ WARNING: This does NOT verify the token signature!
 * Use only for reading claims client-side (e.g., expiration check).
 * Backend must always verify tokens before trusting.
 * 
 * @param token - JWT token string
 * @returns Decoded JWT payload or null if decode fails
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwtDecode<JWTPayload>(token);
    return decoded;
  } catch (error) {
    console.error('❌ Failed to decode JWT token:', error);
    return null;
  }
}

/**
 * Check if token is expired
 * 
 * @param token - JWT token string
 * @returns True if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return true; // Treat invalid tokens as expired
  }
  
  const now = Math.floor(Date.now() / 1000); // Current time in Unix seconds
  return decoded.exp <= now;
}

/**
 * Check if token is expiring soon (within threshold)
 * 
 * Used to trigger automatic token refresh before expiration.
 * Default threshold: 5 minutes before expiration.
 * 
 * @param token - JWT token string
 * @param minutesThreshold - Minutes before expiration to consider "expiring soon" (default: 5)
 * @returns True if token expires within threshold
 */
export function isTokenExpiringSoon(token: string, minutesThreshold: number = 5): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return true; // Treat invalid tokens as expiring
  }
  
  const now = Math.floor(Date.now() / 1000); // Current time in Unix seconds
  const expiresAt = decoded.exp;
  const threshold = minutesThreshold * 60; // Convert minutes to seconds
  
  const timeUntilExpiration = expiresAt - now;
  
  if (timeUntilExpiration <= 0) {
    return true; // Already expired
  }
  
  return timeUntilExpiration < threshold;
}

/**
 * Get token expiration date
 * 
 * @param token - JWT token string
 * @returns Date object or null if token invalid
 */
export function getTokenExpirationDate(token: string): Date | null {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return null;
  }
  
  return new Date(decoded.exp * 1000); // Convert Unix seconds to milliseconds
}

/**
 * Get user information from token
 * 
 * Extracts user context without making a backend call.
 * Useful for displaying user info, checking roles, etc.
 * 
 * @param token - JWT token string
 * @returns User info or null if token invalid
 */
export function getUserFromToken(token: string): {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  roles: string[];
} | null {
  const decoded = decodeToken(token);
  if (!decoded) {
    return null;
  }
  
  return {
    userId: decoded.userId,
    tenantId: decoded.tenantId,
    tenantSlug: decoded.tenantSlug,
    roles: decoded.roles
  };
}

/**
 * Clear all authentication state
 * 
 * Called on logout or when switching users/tenants
 */
export function clearAuthState(): void {
  removeToken();
  // Could also clear other auth-related localStorage items here
  console.log('🧹 Authentication state cleared');
}













