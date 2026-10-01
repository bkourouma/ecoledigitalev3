import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware
 * 
 * Adds security headers to all responses, including Content Security Policy
 * to mitigate XSS attacks on localStorage (where JWT tokens are stored).
 *
 * Espace propriétaire : les pages sont sous **`/owner/*`** (`src/app/owner/`, et non un groupe
 * de routes `(owner)`). La vérification du rôle **owner** est faite côté client dans
 * `app/owner/layout.tsx` (NextAuth) ; ce fichier ne fait pas d’auth JWT (pas de session Edge ici).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if this is a route that should be handled by Next.js API route
  // instead of being rewritten to the backend
  const isNextJsApiRoute = pathname.match(/^\/api\/v1\/parents\/[^/]+$/);
  
  // Transmet le chemin aux layouts serveur (platform/auth/server.ts) : ils n'ont pas accès à l'URL.
  // En-tête de REQUÊTE interne (non renvoyé au navigateur) ; absent des appels /api/ (rewrites vers l'API).
  const requestHeaders = new Headers(request.headers);
  if (!pathname.startsWith('/api/')) {
    requestHeaders.set('x-pathname', pathname);
  } else {
    requestHeaders.delete('x-pathname');
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Add a custom header to indicate this should not be rewritten
  // (This is just for debugging - Next.js API routes should have priority anyway)
  if (isNextJsApiRoute) {
    response.headers.set('X-Use-NextJS-Route', 'true');
  }
  
  // Content Security Policy (CSP) headers for XSS protection
  // Mitigates risk of JWT token theft from localStorage via XSS attacks
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Note: unsafe-eval needed for some Next.js features
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:4000 http://localhost:3000",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  
  response.headers.set('Content-Security-Policy', cspHeader);
  
  // Additional security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Remove X-Powered-By header
  response.headers.delete('X-Powered-By');
  
  return response;
}

// Apply middleware to all routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
