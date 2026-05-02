"use client";

import { createContext, useContext, ReactNode, useMemo } from 'react';

interface TenantContextType {
  tenantSlug: string;
  tenantId?: string;
}

const TenantContext = createContext<TenantContextType>({
  tenantSlug: 'imhotepdata', // Use imhotepdata as it has the actual formations data
  tenantId: undefined,
});

interface TenantProviderProps {
  children: ReactNode;
  tenantSlug?: string;
  tenantId?: string;
}

/**
 * TenantProvider - Provides tenant context throughout the application
 * 
 * Resolves tenant from (in order of priority):
 * 1. Props (for testing or explicit control)
 * 2. Environment variable NEXT_PUBLIC_TENANT_SLUG
 * 3. Subdomain (e.g., tenant.ecoledigitale.ci)
 * 4. Fallback to 'imhotepdata' (development only)
 * 
 * Note: Session-based tenant resolution should be handled in components
 * that have access to SessionProvider using useSession hook.
 * 
 * Usage:
 * ```tsx
 * import { TenantProvider, useTenant } from '@/contexts/TenantContext';
 * 
 * // In your layout or app:
 * <TenantProvider>
 *   <YourApp />
 * </TenantProvider>
 * 
 * // In any component:
 * const { tenantSlug } = useTenant();
 * ```
 */
export function TenantProvider({ children, tenantSlug: propsTenantSlug, tenantId: propsTenantId }: TenantProviderProps) {
  const tenantSlug = useMemo(() => {
    // 1. Use props if provided (for testing or explicit control)
    if (propsTenantSlug) {
      return propsTenantSlug;
    }

    // Note: Session-based tenant resolution is handled by components that use useSession
    // This avoids the need for SessionProvider to be available at TenantProvider level

    // 2. Use environment variable
    if (process.env.NEXT_PUBLIC_TENANT_SLUG) {
      return process.env.NEXT_PUBLIC_TENANT_SLUG;
    }

    // 3. Try to resolve from subdomain (client-side only)
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      
      // Extract subdomain from hostname
      // Examples:
      // - imhotepacademy.ecoledigitale.ci -> imhotepacademy
      // - localhost -> null
      // - imhotepacademy.localhost -> imhotepacademy
      
      const parts = hostname.split('.');
      
      // If we have a subdomain (more than 2 parts, or more than 1 for localhost)
      if (parts.length > 2 || (parts.length > 1 && parts[parts.length - 1] === 'localhost')) {
        const subdomain = parts[0];
        
        // Don't treat 'www' as a tenant
        if (subdomain && subdomain !== 'www') {
          console.log('🏢 Tenant resolved from subdomain:', subdomain);
          return subdomain;
        }
      }
    }

    // 4. Fallback used during SSR / pre-render and as a dev default.
    // On the client, subdomain detection above (#3) takes precedence and replaces
    // this on hydration. Throwing here would break next build static generation
    // since `window` is undefined and Host headers aren't available in useMemo.
    return 'imhotepdata';
  }, [propsTenantSlug]);

  const value = useMemo(() => ({
    tenantSlug,
    tenantId: propsTenantId,
  }), [tenantSlug, propsTenantId]);

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
}

/**
 * useTenant hook - Access tenant context in any component
 * 
 * @returns {TenantContextType} Tenant context with tenantSlug and optional tenantId
 * @throws {Error} If used outside of TenantProvider
 * 
 * @example
 * ```tsx
 * const { tenantSlug } = useTenant();
 * 
 * // Use in API calls
 * headers: {
 *   'X-Tenant': tenantSlug,
 * }
 * ```
 */
export function useTenant(): TenantContextType {
  const context = useContext(TenantContext);
  
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  
  return context;
}

/**
 * withTenant HOC - Wrap a component to ensure it has tenant context
 * 
 * @param Component - Component to wrap
 * @returns Wrapped component with tenant context
 * 
 * @example
 * ```tsx
 * export default withTenant(MyComponent);
 * ```
 */
export function withTenant<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> {
  return function WithTenantComponent(props: P) {
    return (
      <TenantProvider>
        <Component {...props} />
      </TenantProvider>
    );
  };
}

