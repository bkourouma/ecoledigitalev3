import type { ReactNode } from "react";
import { MessagingShell } from "./_components/MessagingShell";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage de la messagerie (`/v2/messages/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (la barrière réelle sur les données reste l'API).
 */
export default async function MessagesLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <MessagingShell>{children}</MessagingShell>
    </AppShell>
  );
}
