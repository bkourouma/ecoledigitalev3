import type { ReactNode } from "react";
import { NotificationsShell } from "../_components/NotificationsShell";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage de l'administration des notifications (`/v2/notifications/*`, hors désinscription publique) : session
 * obligatoire côté serveur ; la permission de chaque écran est vérifiée par sa page (la barrière réelle reste l'API).
 */
export default async function NotificationsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <NotificationsShell>{children}</NotificationsShell>
    </AppShell>
  );
}
