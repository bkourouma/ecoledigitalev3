"use client";

import { createContext, useContext, ReactNode, useMemo } from 'react';
import { SessionContext } from 'next-auth/react';
import { resolveBrowserTenant } from '@/platform/tenant/browser';
import type { TenantSource } from '@/platform/tenant/resolve-tenant';

interface TenantContextType {
  /** Slug du tenant, ou `null` quand il est inconnu (état explicite : aucun repli codé en dur). */
  tenantSlug: string | null;
  tenantId?: string;
  /** `unknown` : ni session, ni sous-domaine reconnu, ni NEXT_PUBLIC_TENANT_SLUG. */
  status: 'resolved' | 'unknown';
  source?: TenantSource;
}

const TenantContext = createContext<TenantContextType>({
  tenantSlug: null,
  tenantId: undefined,
  status: 'unknown',
});

interface TenantProviderProps {
  children: ReactNode;
  tenantSlug?: string;
  tenantId?: string;
}

/**
 * TenantProvider - Provides tenant context throughout the application
 *
 * Résolution UNIQUE, déléguée à `@/platform/tenant/resolve-tenant` :
 * 1. Props (for testing or explicit control)
 * 2. Session NextAuth (le provider doit être placé sous `SessionProvider`)
 * 3. Sous-domaine `<slug>.ecoledigitale.allianceconsultants.net` / domaine personnalisé configuré
 * 4. Variable d'environnement NEXT_PUBLIC_TENANT_SLUG (développement local)
 *
 * Aucun repli codé en dur : si rien ne correspond, `status === 'unknown'` et `tenantSlug === null`.
 * L'interface doit alors afficher un état « tenant inconnu » plutôt que d'appeler l'API.
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
 * const { tenantSlug, status } = useTenant();
 * ```
 */
export function TenantProvider({ children, tenantSlug: propsTenantSlug, tenantId: propsTenantId }: TenantProviderProps) {
  const session = useContext(SessionContext)?.data as
    | { tenantSlug?: string; tenantId?: string }
    | null
    | undefined;
  const sessionSlug = session?.tenantSlug;
  const sessionId = session?.tenantId;

  const value = useMemo<TenantContextType>(() => {
    // 1. Use props if provided (for testing or explicit control)
    if (propsTenantSlug) {
      return { tenantSlug: propsTenantSlug, tenantId: propsTenantId, status: 'resolved', source: 'override' };
    }

    // 2-4. Session > sous-domaine > NEXT_PUBLIC_TENANT_SLUG (voir platform/tenant/resolve-tenant.ts)
    const resolved = resolveBrowserTenant({ tenantSlug: sessionSlug, tenantId: sessionId });
    if (!resolved) {
      return { tenantSlug: null, tenantId: propsTenantId, status: 'unknown' };
    }
    return {
      tenantSlug: resolved.slug ?? resolved.key,
      tenantId: propsTenantId ?? resolved.id ?? undefined,
      status: 'resolved',
      source: resolved.source,
    };
  }, [propsTenantSlug, propsTenantId, sessionSlug, sessionId]);

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
 * const { tenantSlug, status } = useTenant();
 * if (status === 'unknown') return <TenantUnknownNotice />;
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
