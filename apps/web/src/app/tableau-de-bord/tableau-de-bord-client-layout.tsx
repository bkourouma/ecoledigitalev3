"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import { isAdminRole } from "@/lib/role-landing";

/**
 * Le tableau de bord est réservé à l'administration.
 *
 * Les autres profils ont chacun le leur (`/owner/dashboard`, `/teacher/dashboard`,
 * …) : ils sont renvoyés sur `/unauthorized` plutôt que
 * de voir des indicateurs sur tout l'établissement.
 *
 * Le garde est côté client, comme celui de `app/owner/layout.tsx` : le middleware
 * ne lit pas la session NextAuth. Il masque l'écran, il ne remplace pas les
 * contrôles d'accès de l'API, qui restent la vraie barrière sur les données.
 */
export default function TableauDeBordLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const roles = (session as { roles?: string[] } | null)?.roles;
  const allowed = isAdminRole(roles);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!allowed) {
      router.replace("/unauthorized");
    }
  }, [allowed, session, status, router]);

  if (status === "loading" || !session || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Chargement…
      </div>
    );
  }

  return <>{children}</>;
}
