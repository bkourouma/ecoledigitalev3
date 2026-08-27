"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import { activeRoleOf, routeForRole } from "@/lib/role-landing";

/**
 * Racine « / » : aucune page propre, uniquement une redirection.
 *
 * Chaque utilisateur est renvoyé sur l'espace de son rôle actif — l'administration
 * sur `/tableau-de-bord` — et les visiteurs non connectés sur `/login`. La page
 * d'accueil communautaire qui vivait ici avait déjà été retirée du menu.
 */
export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/login");
      return;
    }

    // Plusieurs rôles disponibles : on passe d'abord par le choix du rôle actif,
    // qui redirige ensuite vers le même point d'atterrissage.
    if ((session as any).requiresRoleSelection) {
      router.replace("/select-role");
      return;
    }

    router.replace(routeForRole(activeRoleOf(session)));
  }, [session, status, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-role-primary" />
    </div>
  );
}
