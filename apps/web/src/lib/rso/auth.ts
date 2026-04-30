/**
 * RSO Authentication Stub
 * 
 * This file provides stub functions for RSO authentication.
 * The actual RSO authentication system was removed with Phase 021.
 * These stubs allow the code to compile but RSO functionality is disabled.
 */

/**
 * Get RSO token from localStorage
 * @returns RSO token or null
 */
export function getRSOToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem('rso_token');
}

/**
 * Check if RSO token is expired
 * @returns true if expired or no token
 */
export function isRSOTokenExpired(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  
  const token = getRSOToken();
  if (!token) {
    return true;
  }
  
  const expiresStr = localStorage.getItem('rso_token_expires');
  if (!expiresStr) {
    return true;
  }
  
  try {
    const expires = parseInt(expiresStr, 10);
    return Date.now() >= expires;
  } catch {
    return true;
  }
}

/**
 * Check if RSO token is expiring soon
 * @param minutes - Minutes before expiration to consider "soon"
 * @returns true if expiring within the specified minutes
 */
export function isRSOTokenExpiringSoon(minutes: number = 30): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  
  const expiresStr = localStorage.getItem('rso_token_expires');
  if (!expiresStr) {
    return true;
  }
  
  try {
    const expires = parseInt(expiresStr, 10);
    const threshold = Date.now() + (minutes * 60 * 1000);
    return Date.now() >= expires || expires <= threshold;
  } catch {
    return true;
  }
}

/**
 * Refresh RSO token
 * @returns Promise resolving to new token or null
 */
export async function refreshRSOToken(): Promise<string | null> {
  // RSO authentication removed - always return null
  console.warn('[RSO Auth] Token refresh attempted but RSO auth system is disabled');
  if (typeof window !== 'undefined') {
    localStorage.removeItem('rso_token');
    localStorage.removeItem('rso_token_expires');
  }
  return null;
}

/**
 * Get user information from RSO token
 * @returns User info or null
 */
export function getRSOUserFromToken(): { id: number; role: string; username: string } | null {
  // RSO authentication removed - return null
  return null;
}

/**
 * Logout from RSO
 */
export function rsoLogout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('rso_token');
    localStorage.removeItem('rso_token_expires');
    // Redirect to main login page since RSO login is removed
    window.location.href = '/login';
  }
}

