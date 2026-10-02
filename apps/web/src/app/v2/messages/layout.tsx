import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { MessagingShell } from "./_components/MessagingShell";

/**
 * Habillage de la messagerie (`/v2/messages/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (la barrière réelle sur les données reste l'API).
 */
export default async function MessagesLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <MessagingShell>{children}</MessagingShell>;
}
