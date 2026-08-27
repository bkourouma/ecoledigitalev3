"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useEffect } from "react";
import { OwnerFiltersProvider } from "@/components/owner/filters/owner-filters-context";
import { OwnerFilterSlot } from "@/components/owner/filters/OwnerFilterSlot";

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

  return (
    // `useSearchParams` impose une frontière Suspense côté App Router. La barre
    // de filtre est rendue par `OwnerFilterSlot`, sous cette frontière : elle
    // doit lire `?vue=` pour connaître l'onglet regardé, ce que ce composant-ci
    // — qui pose le Suspense — ne peut pas faire.
    //
    // Le pouls, lui, ne vit plus dans le layout : monté ici, il coiffait les
    // dix-sept écrans de l'espace et volait un tiers de la hauteur utile de
    // chacun. Il est désormais le corps du tableau de bord.
    <Suspense fallback={<div className="text-muted-foreground">Chargement…</div>}>
      <OwnerFiltersProvider>
        <OwnerFilterSlot />
        {children}
      </OwnerFiltersProvider>
    </Suspense>
  );
}
