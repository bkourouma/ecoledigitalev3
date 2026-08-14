"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useEffect } from "react";
import { PulseBar } from "@/components/owner/PulseBar";
import { OwnerFiltersProvider } from "@/components/owner/filters/owner-filters-context";
import {
  OWNER_FILTER_SCOPE,
  OWNER_PERIOD_OPTIONS,
  OwnerFilterBar,
} from "@/components/owner/filters/OwnerFilterBar";

function isOwnerRole(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => String(r).toLowerCase() === "owner");
}

function isAdminRole(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) =>
    ["admin", "super_admin", "administrateur"].includes(String(r).toLowerCase())
  );
}

function canAccessOwnerPath(pathname: string, roles: unknown): boolean {
  if (isOwnerRole(roles)) return true;
  if (isAdminRole(roles) && (pathname === "/owner/acces" || pathname.startsWith("/owner/acces/"))) {
    return true;
  }
  return false;
}

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const roles = (session as { roles?: string[] } | null)?.roles;

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!canAccessOwnerPath(pathname, roles)) {
      router.replace("/unauthorized");
    }
  }, [pathname, roles, session, status, router]);

  if (status === "loading" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Chargement…
      </div>
    );
  }

  if (!canAccessOwnerPath(pathname, roles)) {
    return null;
  }

  // « Accès » est ouvert aux administrateurs non-propriétaires : ils n'ont pas
  // les droits sur /owner/pulse, la barre y serait un bandeau d'erreur.
  const showPulse = isOwnerRole(roles) && !pathname.startsWith("/owner/acces");

  // Un écran absent de la table de portée n'affiche aucune barre : mieux vaut
  // pas de filtre qu'un filtre qui ne filtre rien.
  const filterDimensions = OWNER_FILTER_SCOPE[pathname] ?? [];

  return (
    // `useSearchParams` impose une frontière Suspense côté App Router.
    <Suspense fallback={<div className="text-muted-foreground">Chargement…</div>}>
      <OwnerFiltersProvider>
        {showPulse && (
          <div className="mb-6">
            <PulseBar />
          </div>
        )}
        {filterDimensions.length > 0 && (
          <div className="mb-6">
            <OwnerFilterBar
              dimensions={filterDimensions}
              periods={OWNER_PERIOD_OPTIONS[pathname]}
            />
          </div>
        )}
        {children}
      </OwnerFiltersProvider>
    </Suspense>
  );
}
