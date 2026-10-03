import type { ReactNode } from "react";
import { DocumentsShell } from "./_components/DocumentsShell";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage de la gestion documentaire (`/v2/documents/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (la barrière réelle sur les données reste l'API : niveau de la catégorie, propriétaire, tuteur lié, partages).
 */
export default async function DocumentsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <DocumentsShell>{children}</DocumentsShell>
    </AppShell>
  );
}
