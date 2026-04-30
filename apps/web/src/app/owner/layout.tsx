"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";

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

  return <>{children}</>;
}
