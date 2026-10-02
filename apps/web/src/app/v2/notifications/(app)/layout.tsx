import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { NotificationsShell } from "../_components/NotificationsShell";

/**
 * Habillage de l'administration des notifications (`/v2/notifications/*`, hors désinscription publique) : session
 * obligatoire côté serveur ; la permission de chaque écran est vérifiée par sa page (la barrière réelle reste l'API).
 */
export default async function NotificationsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <NotificationsShell>{children}</NotificationsShell>;
}
