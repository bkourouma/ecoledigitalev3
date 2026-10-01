"use client";

import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { activeRoleOf } from "@/lib/role-landing";
import { PlatformSidebar } from "./PlatformSidebar";
import { isPlatformNavEnabled, portalForRole } from "./portal";
import type { MenuPortal } from "./types";
import { useNavigation } from "./useNavigation";

interface SidebarGateProps {
  /** Le Sidebar historique, rendu tel quel quand le menu API n'est pas activé ou pas disponible. */
  legacy: ReactNode;
  onCloseMobileMenu?: () => void;
}

function PlatformNavigation({ portal, legacy, onCloseMobileMenu }: SidebarGateProps & { portal: MenuPortal }) {
  const navigation = useNavigation({ portal, enabled: true });

  // Endpoint absent / en erreur / menu vide : comportement historique inchangé.
  if (!navigation.isLoading && navigation.source === "legacy") return <>{legacy}</>;

  return (
    <PlatformSidebar
      items={navigation.items}
      isLoading={navigation.isLoading}
      onNavigate={onCloseMobileMenu}
      onClose={onCloseMobileMenu}
    />
  );
}

/**
 * Point de bascule unique entre le Sidebar historique et le menu piloté par l'API.
 *
 * Éteint par défaut : sans `NEXT_PUBLIC_PLATFORM_NAV`, ce composant rend `legacy` et n'émet aucune requête.
 * Activation par portail : `NEXT_PUBLIC_PLATFORM_NAV=admin,teacher` (ou `1` pour tous) — voir ./portal.ts.
 */
export function SidebarGate({ legacy, onCloseMobileMenu }: SidebarGateProps) {
  const { data: session } = useSession();
  const portal = portalForRole(activeRoleOf(session));
  const enabled = isPlatformNavEnabled(process.env.NEXT_PUBLIC_PLATFORM_NAV, portal);

  if (!enabled || !portal) return <>{legacy}</>;
  return <PlatformNavigation portal={portal} legacy={legacy} onCloseMobileMenu={onCloseMobileMenu} />;
}
