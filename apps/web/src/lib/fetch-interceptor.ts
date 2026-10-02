"use client";

import { getToken, isTokenExpired, isTokenExpiringSoon, removeToken, saveToken, getUserFromToken } from './jwt-storage';
import { getRSOToken, isRSOTokenExpired, isRSOTokenExpiringSoon, refreshRSOToken } from './rso/auth';
import { getActiveAcademicYearId } from './academic-year-storage';
import { resolveBrowserTenant } from '@/platform/tenant/browser';
import { isIamAccessToken, refreshIamAccessToken } from './iam-session';

// Global fetch interceptor to automatically add tenant header, JWT auth, and redirect API calls
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  const directApiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  console.log('🚀 Fetch interceptor loaded');
  
  // Singleton promise for token refresh (prevents multiple simultaneous refresh calls)
  let refreshPromise: Promise<string> | null = null;
  let rsoRefreshPromise: Promise<string | null> | null = null;
  
  /**
   * Refresh JWT token
   * 
   * Calls the /api/v1/auth/refresh endpoint to get a new token
   * with extended expiration. Uses the current token to authenticate.
   * 
   * @param currentToken - Current JWT token
   * @returns Promise resolving to new JWT token
   */
  async function refreshToken(currentToken: string): Promise<string> {
    console.log('🔄 Refreshing JWT token (expires soon)...');
    
    try {
      // Tenant du jeton en priorité ; aucun repli codé en dur (en-tête omis si inconnu).
      const refreshTenant = resolveBrowserTenant(getUserFromToken(currentToken))?.key;
      const response = await originalFetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          ...(refreshTenant ? { 'X-Tenant': refreshTenant } : {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Token refresh failed:', errorData.message || response.statusText);
        throw new Error('Token refresh failed');
      }
      
      const data = await response.json();
      const newToken = data.token;
      
      if (!newToken) {
        throw new Error('No token in refresh response');
      }
      
      // Save new token to localStorage
      saveToken(newToken);
      console.log('✅ JWT token refreshed successfully');
      
      return newToken;
    } catch (error) {
      console.error('❌ Token refresh error:', error);
      throw error;
    }
  }
  
  /**
   * Get valid JWT token (refresh if expiring soon)
   * 
   * Checks if token is expiring within 5 minutes and automatically
   * refreshes it if needed. Uses singleton pattern to ensure only
   * one refresh happens at a time (concurrent requests wait).
   * 
   * @returns Promise resolving to valid JWT token or null
   */
  async function getValidToken(): Promise<string | null> {
    const token = getToken();

    if (!token) {
      return null;
    }

    // Jeton d'accès IAM v2 (15 min) : renouvelé PAR LE SERVEUR (refresh à rotation, jamais exposé au navigateur),
    // sous verrou inter-onglets — voir lib/iam-session.ts. Le refresh legacy ci-dessous ne le connaît pas.
    if (isIamAccessToken(token)) {
      if (isTokenExpired(token) || isTokenExpiringSoon(token, 2)) {
        const fresh = await refreshIamAccessToken();
        if (!fresh) {
          removeToken();
          return null;
        }
        return fresh;
      }
      return token;
    }
    
    // Check if token is already expired
    if (isTokenExpired(token)) {
      console.error('❌ Token already expired');
      removeToken();
      return null;
    }
    
    // Check if token is expiring soon (within 5 minutes)
    if (isTokenExpiringSoon(token, 5)) {
      console.log('⏰ Token expiring soon (< 5 minutes) - triggering refresh');
      
      // Use singleton pattern: if refresh already in progress, wait for it
      if (!refreshPromise) {
        refreshPromise = refreshToken(token)
          .catch(error => {
            console.error('❌ Token refresh failed:', error);
            // On refresh failure, remove invalid token
            removeToken();
            throw error;
          })
          .finally(() => {
            // Clear the promise when done (success or failure)
            refreshPromise = null;
          });
      } else {
        console.log('⏳ Token refresh already in progress - waiting...');
      }
      
      try {
        // Wait for refresh to complete
        const newToken = await refreshPromise;
        return newToken;
      } catch (error) {
        // Refresh failed, return null to trigger login redirect
        return null;
      }
    }
    
    // Token is valid and not expiring soon
    return token;
  }

  /**
   * Get valid RSO token (refresh if expiring soon)
   * 
   * Checks if RSO token is expiring within 30 minutes and automatically
   * refreshes it if needed. Uses singleton pattern to ensure only
   * one refresh happens at a time (concurrent requests wait).
   * 
   * @returns Promise resolving to valid RSO token or null
   */
  async function getValidRSOToken(): Promise<string | null> {
    const token = getRSOToken();
    
    if (!token) {
      return null;
    }
    
    // Check if token is already expired
    if (isRSOTokenExpired()) {
      console.error('❌ RSO token already expired');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('rso_token');
        localStorage.removeItem('rso_token_expires');
      }
      return null;
    }
    
    // Check if token is expiring soon (within 30 minutes)
    if (isRSOTokenExpiringSoon(30)) {
      console.log('⏰ RSO token expiring soon (< 30 minutes) - triggering refresh');
      
      // Use singleton pattern: if refresh already in progress, wait for it
      if (!rsoRefreshPromise) {
        rsoRefreshPromise = refreshRSOToken()
          .then(newToken => {
            if (!newToken) {
              // Refresh failed, clear token
              if (typeof window !== 'undefined') {
                localStorage.removeItem('rso_token');
                localStorage.removeItem('rso_token_expires');
              }
            }
            return newToken;
          })
          .catch(error => {
            console.error('❌ RSO token refresh failed:', error);
            // On refresh failure, remove invalid token
            if (typeof window !== 'undefined') {
              localStorage.removeItem('rso_token');
              localStorage.removeItem('rso_token_expires');
            }
            return null;
          })
          .finally(() => {
            // Clear the promise when done (success or failure)
            rsoRefreshPromise = null;
          });
      } else {
        console.log('⏳ RSO token refresh already in progress - waiting...');
      }
      
      try {
        // Wait for refresh to complete
        const newToken = await rsoRefreshPromise;
        return newToken;
      } catch (error) {
        // Refresh failed, return null to trigger login redirect
        return null;
      }
    }
    
    // Token is valid and not expiring soon
    return token;
  }

  // Tenant : choix explicite (super-admin) > sous-domaine > NEXT_PUBLIC_TENANT_SLUG.
  // `null` si inconnu : plus aucun repli codé en dur (voir platform/tenant/resolve-tenant.ts).
  function getTenantSlug(): string | null {
    return resolveBrowserTenant()?.key ?? null;
  }

  function clearSuperAdminSession(): void {
    localStorage.removeItem('superAdminToken');
    localStorage.removeItem('superAdminEmail');
    localStorage.removeItem('superAdminSelectedTenant');
  }

  /** Routes réservées aux opérateurs de la plateforme v2 (`/api/v1/platform/*`, `/api/v1/entitlements/admin/*`). */
  function isOperatorConsoleRoute(url: string): boolean {
    return url.includes('/api/v1/platform/') || url.includes('/api/v1/entitlements/admin/');
  }

  function redirectToSuperAdminLogin(): void {
    if (!window.location.pathname.startsWith('/super-admin/login')) {
      window.location.href = '/super-admin/login';
    }
  }

  function isSemesterAveragesPdfRoute(url: string): boolean {
    return (
      url.includes('/api/v1/semester-averages/attendance-certificates/pdf') ||
      url.includes('/api/v1/semester-averages/attendance-certificates/pdf-html') ||
      url.includes('/api/v1/semester-averages/report-cards/pdf')
    );
  }

  function shouldRetrySemesterPdfDirect(url: string): boolean {
    const isLocalDev =
      process.env.NODE_ENV === 'development' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const isProxyUrl =
      url.startsWith('/api/v1/') ||
      url.includes('localhost:3000/api/v1/');

    return isLocalDev && isProxyUrl && isSemesterAveragesPdfRoute(url);
  }

  function buildDirectApiUrl(url: string): string {
    // Already absolute: keep as-is
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    if (url.startsWith('http://localhost:3000')) {
      return url.replace('http://localhost:3000', directApiBaseUrl);
    }

    if (url.startsWith('https://localhost:3000')) {
      return url.replace('https://localhost:3000', directApiBaseUrl);
    }

    if (url.startsWith('/')) {
      return `${directApiBaseUrl}${url}`;
    }

    return `${directApiBaseUrl}/${url}`;
  }

  /**
   * Next.js App Router uses window.fetch for RSC payloads, HMR refresh, prefetch, and Server Actions
   * (see next/dist/client/components/router-reducer/fetch-server-response.js). Those requests must not
   * receive JWT / X-Tenant rewriting or they can fail with "TypeError: Failed to fetch" in dev.
   */
  function isNextJsUndecoratedFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    resolvedUrl: string
  ): boolean {
    const frameworkHeaders = [
      'rsc',
      'next-router-state-tree',
      'next-router-prefetch',
      'next-router-segment-prefetch',
      'next-hmr-refresh',
      'next-action',
    ];
    const inspectHeaders = (h: Headers) => frameworkHeaders.some((name) => h.has(name));

    if (input instanceof Request && inspectHeaders(input.headers)) {
      return true;
    }
    if (init?.headers && inspectHeaders(new Headers(init.headers as HeadersInit))) {
      return true;
    }

    try {
      const u = new URL(resolvedUrl, window.location.origin);
      if (u.pathname.startsWith('/_next/')) {
        return true;
      }
      // Flight requests append this query param (see next/dist/client/components/app-router-headers)
      if (u.searchParams.has('_rsc')) {
        return true;
      }
    } catch {
      // ignore invalid URL
    }
    return false;
  }

  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Convert input to URL string
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = input.toString();
    }

    if (isNextJsUndecoratedFetch(input, init, url)) {
      return originalFetch(input, init);
    }
    
    // Only intercept API calls to our backend (both /api/v1/ and /api/teacher/, /api/student/, etc.)
    // BUT skip NextAuth internal endpoints completely - they handle their own authentication
    const nextAuthPaths = [
      '/api/auth/',
    ];
    
    const isNextAuthCall = nextAuthPaths.some(path => url.includes(path));

    // Routes PUBLIQUES de l'API (vérification d'un document par QR code) : aucun jeton, aucun établissement imposé, et surtout
    // aucune redirection vers /login quand le visiteur n'est pas connecté.
    const isPublicApiCall = /\/api\/v1\/(?:public|reportcards\/public)\//.test(url);

    if (url.includes('/api/') && !isNextAuthCall && !isPublicApiCall) {
      const requestMethod = (
        input instanceof Request ? input.method : init?.method || 'GET'
      ).toUpperCase();

      // Clone the init object or create a new one
      const newInit: RequestInit = { ...init };

      // Ensure headers exist
      if (!newInit.headers) {
        newInit.headers = {};
      }

      // Convert headers to Headers object if needed
      let headers: Headers;
      if (newInit.headers instanceof Headers) {
        headers = new Headers(newInit.headers);
      } else {
        headers = new Headers(newInit.headers as HeadersInit);
      }

      // IMPORTANT: Set X-Tenant header FIRST, before token validation
      // The backend needs X-Tenant to extract tenant context before validating the token
      // Always ensure X-Tenant is set, even if token is not yet available
      if (!headers.has('X-Tenant')) {
        const selectedTenant = localStorage.getItem('superAdminSelectedTenant');
        if (selectedTenant) {
          headers.set('X-Tenant', selectedTenant);
        }

        // Try to get tenant from token first (if available)
        const currentToken = getToken();
        let tenantIdSet = Boolean(selectedTenant);
        
        if (!tenantIdSet && currentToken && !isTokenExpired(currentToken)) {
          const info = getUserFromToken(currentToken);
          if (info && info.tenantId) {
            // Use tenantId (UUID) from token for X-Tenant header to ensure exact match
            headers.set('X-Tenant', info.tenantId);
            console.log(`🏢 X-Tenant header set from JWT: ${info.tenantId} (slug: ${info.tenantSlug || 'N/A'})`);
            tenantIdSet = true;
          }
        }
        
        // Fallback to slug-based tenant if token not available or doesn't have tenantId
        if (!tenantIdSet) {
          try {
            const tenantSlug = getTenantSlug();
            if (tenantSlug) {
              headers.set('X-Tenant', tenantSlug);
              console.log(`🏢 X-Tenant header set from slug fallback: ${tenantSlug}`);
            } else {
              console.warn('⚠️ Tenant inconnu : en-tête X-Tenant non défini');
            }
          } catch (error) {
            console.error('❌ Failed to get tenant:', error);
          }
        }
      } else {
        const currentTenant = headers.get('X-Tenant');
        // If header is set to a slug (not UUID), try to update it with tenantId from token
        const isSlug = currentTenant && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentTenant);
        if (isSlug) {
          const currentToken = getToken();
          if (currentToken && !isTokenExpired(currentToken)) {
            const info = getUserFromToken(currentToken);
            if (info && info.tenantId) {
              // Replace slug with tenantId UUID for exact match
              headers.set('X-Tenant', info.tenantId);
              console.log(`🏢 X-Tenant header updated from slug to UUID: ${info.tenantId} (was: ${currentTenant})`);
            } else {
              console.log(`🏢 X-Tenant header already set (slug): ${currentTenant} (no tenantId in token)`);
            }
          } else {
            console.log(`🏢 X-Tenant header already set (slug): ${currentTenant} (no valid token)`);
          }
        } else {
          console.log(`🏢 X-Tenant header already set (UUID): ${currentTenant}`);
        }
      }

      // Attach currently active academic year to all API requests when available.
      if (!headers.has('X-Academic-Year-Id')) {
        const activeAcademicYearId = getActiveAcademicYearId();
        if (activeAcademicYearId) {
          headers.set('X-Academic-Year-Id', activeAcademicYearId);
        }
      }

      // Add JWT token for authenticated endpoints (skip login/refresh/session/signin/callback)
      // Admin routes always require authentication
      // RSO auth routes are excluded (they use separate RSO token system)
      const authExcludedPaths = [
        '/auth/login',
        '/auth/refresh',
        '/auth/session',
        '/auth/signin',
        '/auth/callback',
        '/auth/providers',
        '/auth/csrf',
        '/auth/register-request',  // Public self-registration (no token yet)
        // Module iam (NEXT_PUBLIC_AUTH_V2=1) : routes qui s'appellent sans jeton d'accès (mot de passe oublié, jeton de
        // réinitialisation / d'invitation, jeton d'étape MFA) ou avec leur propre jeton (enrôlement).
        '/iam/login',
        '/iam/refresh',
        '/iam/logout',
        '/iam/password/forgot',
        '/iam/password/reset',
        '/iam/mfa/challenge',
        '/iam/mfa/enroll',
        '/iam/mfa/verify',
        '/super-admin/auth/login',
        '/rso/auth/login',      // RSO login (public)
        '/rso/auth/forgot-password',  // RSO password reset (public)
        '/rso/auth/reset-password',   // RSO password reset (public)
      ];
      
      // Check if this is an RSO route (RSO has separate authentication system)
      const isRSORoute = url.includes('/api/v1/rso/');
      // Console plateforme v2 (opérateurs) : mêmes jeton et règles que les routes super-admin historiques.
      const isSuperAdminApiRoute = url.includes('/api/v1/super-admin/') || isOperatorConsoleRoute(url);
      const isSuperAdminAuthExcluded = url.includes('/api/v1/super-admin/auth/login');

      const isAuthExcluded = authExcludedPaths.some(path => url.includes(path));
      
      // For RSO routes, skip main JWT token injection (RSO client handles its own auth)
      if (isRSORoute) {
        // RSO routes use their own authentication (handled by RSO client functions)
        // Just ensure X-Tenant is set for RSO routes if not already set
        if (!headers.has('X-Tenant')) {
          headers.set('X-Tenant', 'aspci'); // RSO module is ASPCI-specific
        }
        
        // Auto-refresh RSO token if expiring soon (for routes that need auth)
        const rsoAuthExcludedPaths = [
          '/rso/auth/login',
          '/rso/auth/forgot-password',
          '/rso/auth/reset-password',
        ];
        const isRSOAuthExcluded = rsoAuthExcludedPaths.some(path => url.includes(path));
        
        if (!isRSOAuthExcluded && !headers.has('Authorization')) {
          // Get valid RSO token (auto-refresh if expiring soon)
          const rsoToken = await getValidRSOToken();
          
          if (rsoToken) {
            headers.set('Authorization', `Bearer ${rsoToken}`);
            console.log('[Fetch Interceptor] RSO token added to request');
          } else {
            console.warn('[Fetch Interceptor] No valid RSO token available');
          }
        }
        
        // Don't inject main JWT token for RSO routes - RSO uses its own token system
        console.log('[Fetch Interceptor] RSO route detected, using RSO token');
        console.log('[Fetch Interceptor] RSO route headers:', {
          'X-Tenant': headers.get('X-Tenant'),
          'Authorization': headers.has('Authorization') ? 'SET' : 'NOT SET'
        });
      } else if (isSuperAdminApiRoute && !isSuperAdminAuthExcluded) {
        const superAdminToken = localStorage.getItem('superAdminToken');
        const selectedTenant = localStorage.getItem('superAdminSelectedTenant');

        if (!superAdminToken && !headers.has('Authorization')) {
          console.error('No super-admin token available for super-admin API call');

          if (!window.location.pathname.includes('/super-admin/login')) {
            redirectToSuperAdminLogin();
          }

          throw new Error('Super-admin authentication required');
        }

        if (superAdminToken && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${superAdminToken}`);
        }

        if (selectedTenant) {
          headers.set('X-Tenant', selectedTenant);
        }
      } else if (!isAuthExcluded) {
        const superAdminToken = localStorage.getItem('superAdminToken');
        const selectedTenant = localStorage.getItem('superAdminSelectedTenant');
        // Get valid token (auto-refresh if expiring soon)
        const token = await getValidToken();
        
        if (token) {
          // Add Authorization header with Bearer token
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
            console.log('🔐 JWT token injected in request');
          }

          // Update X-Tenant header with tenantId from token (always use token's tenantId for exact match)
          // For admin sessions routes, we still need to use the correct tenantId to access the right tables
          const info = getUserFromToken(token);
          if (info && info.tenantId) {
            const currentTenant = headers.get('X-Tenant');
            
            // Check if current tenant is a slug (not UUID) - slugs should always be replaced with JWT tenantId
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isCurrentTenantSlug = currentTenant && !uuidRegex.test(currentTenant);
            const isCurrentTenantUuid = currentTenant && uuidRegex.test(currentTenant);
            
            // Debug logging
            console.log(`🔍 [X-Tenant Debug] currentTenant: ${currentTenant}, isSlug: ${isCurrentTenantSlug}, isUuid: ${isCurrentTenantUuid}, JWT tenantId: ${info.tenantId}`);
            
            // If current tenant is a slug, always replace it with JWT tenantId (for correct table access)
            // Only preserve a different tenant UUID if explicitly set and different from JWT (for cross-tenant admin access)
            if (isCurrentTenantSlug) {
              // Slug detected - always replace with JWT tenantId to ensure correct table access
              headers.set('X-Tenant', info.tenantId);
              console.log(`🏢 X-Tenant header updated from slug to JWT tenantId: ${info.tenantId} (was slug: ${currentTenant})`);
            } else {
              // Always update X-Tenant with tenantId from token to ensure exact match and correct table access
              headers.set('X-Tenant', info.tenantId);
              console.log(`🏢 X-Tenant header updated from JWT: ${info.tenantId} (was: ${currentTenant})`);
            }
          }
          
          // Also inject X-User-Id from JWT claims for backend routes that require it
          if (info?.userId && !headers.has('X-User-Id')) {
            headers.set('X-User-Id', info.userId);
            console.log('🆔 X-User-Id header injected from JWT');
          }
        } else if (superAdminToken && selectedTenant && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${superAdminToken}`);
          headers.set('X-Tenant', selectedTenant);
          console.log('Super-admin token injected with selected tenant');
        } else {
          // No token available - only redirect for /api/v1/ endpoints (backend API)
          // Allow NextAuth endpoints (/api/auth/) to work without token
          if (url.includes('/api/v1/')) {
            console.error('❌ No valid JWT token available for backend API call');
            console.error('   URL:', url);
            
            // Don't redirect if already on login page
            if (!window.location.pathname.includes('/login')) {
              console.log('🔄 Redirecting to login page...');
              window.location.href = '/login';
            }
            throw new Error('Authentication required');
          }
          // For non-backend API calls without token, just log and continue
          console.warn('⚠️  No JWT token for API call (might be NextAuth internal):', url);
        }
      }

      // Update the init object with new headers
      newInit.headers = headers;

      // Log final headers for debugging (only for admin routes to avoid spam)
      if (url.includes('/admin/')) {
        console.log(`📤 Request headers for ${url}:`);
        console.log(`   X-Tenant: ${headers.get('X-Tenant') || 'NOT SET'}`);
        console.log(`   Authorization: ${headers.has('Authorization') ? 'SET' : 'NOT SET'}`);
        console.log(`   X-User-Id: ${headers.get('X-User-Id') || 'NOT SET'}`);
      }

      // Always use the Next.js proxy for API calls
      let finalUrl = url;
      if (url.startsWith('/api/v1/')) {
        // Handle relative URLs - keep them relative to use Next.js proxy
        finalUrl = url;
      } else if (url.includes('localhost:4000/api/v1/')) {
        // Convert direct backend calls to use proxy
        finalUrl = url.replace('http://localhost:4000/api/v1/', '/api/v1/');
      } else if (url.includes('localhost:3000/api/v1/')) {
        // Already correct - use proxy
        finalUrl = url.replace('http://localhost:3000', '');
      }

      // Make the request
      let response = await originalFetch(finalUrl, newInit);

      // Jeton IAM refusé (expiré entre-temps, horloge, session renouvelée dans un autre onglet) : UN renouvellement
      // forcé côté serveur puis UNE nouvelle tentative. Si la session IAM est révoquée, le renouvellement échoue et la
      // 401 est traitée plus bas (jeton effacé) ; l'interface est prévenue pour rediriger vers la connexion.
      if (
        response.status === 401 &&
        !isAuthExcluded &&
        isIamAccessToken(headers.get('Authorization')?.replace(/^Bearer /, ''))
      ) {
        const body = newInit.body as unknown;
        const replayable =
          body === undefined || body === null || typeof body === 'string' ||
          body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob;
        if (replayable) {
          const rejected = headers.get('Authorization')?.replace(/^Bearer /, '');
          const fresh = await refreshIamAccessToken(rejected ? { rejectedToken: rejected } : {});
          if (fresh) {
            const retryHeaders = new Headers(headers);
            retryHeaders.set('Authorization', `Bearer ${fresh}`);
            response = await originalFetch(finalUrl, { ...newInit, headers: retryHeaders });
          } else {
            window.dispatchEvent(new CustomEvent('ed:iam-session-ended'));
          }
        }
      }

      if (response.status === 404 && shouldRetrySemesterPdfDirect(url)) {
        console.warn(`[Fetch Interceptor] Next.js proxy 404 for PDF route, retrying direct API call: ${url}`);
        response = await originalFetch(buildDirectApiUrl(finalUrl), newInit);
      }
      
      // Handle 401 Unauthorized responses (invalid/expired/revoked tokens)
      if (response.status === 401 && !url.includes('/auth/')) {
        // Use console.warn instead of console.error to avoid showing as error in dev overlay
        // This is expected behavior when token expires - the app will handle it
        const isRSORoute = url.includes('/api/v1/rso/');
        const isSuperAdminApiRoute = url.includes('/api/v1/super-admin/');
        
        console.warn(`⚠️  401 Unauthorized - ${isRSORoute ? 'RSO' : 'JWT'} token invalid or expired`);
        console.warn('   URL:', url);
        console.warn('   Method:', newInit.method || 'GET');
        
        // Try to get error details (but don't log as error)
        try {
          const errorData = await response.clone().json();
          console.warn('   Error:', errorData.message || errorData.error);
          console.warn('   Code:', errorData.code);
        } catch (e) {
          // Silently handle parsing errors
        }
        
        // Clear invalid token (main JWT for non-RSO routes, RSO token for RSO routes)
        if (isRSORoute) {
          // Clear RSO token
          if (typeof window !== 'undefined') {
            localStorage.removeItem('rso_token');
            localStorage.removeItem('rso_token_expires');
          }
          // Redirect to main login page since RSO login is removed
          if (!window.location.pathname.includes('/login')) {
            console.warn('🔄 Redirecting to login page...');
            window.location.href = '/login';
          }
        } else if (isOperatorConsoleRoute(url)) {
          // Console v2 : le client de la console (platform/admin/operator.ts) redirige lui-même vers /v2/platform/login.
          clearSuperAdminSession();
        } else if (isSuperAdminApiRoute) {
          clearSuperAdminSession();
          redirectToSuperAdminLogin();
        } else {
          // Clear main JWT token
          removeToken();
          // Don't redirect immediately - let the application code handle the error
          // This allows error messages to be displayed to the user
          // The application can decide whether to redirect based on the context
          console.warn('⚠️  401 error detected - application should handle this error');
          console.warn('   The response is being returned to the caller for error handling');
        }
      }
      
      return response;
    }
    
    // For non-API calls, use original fetch
    return originalFetch(input, init);
  };
}
