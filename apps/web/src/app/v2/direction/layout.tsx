import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage du pilotage de la direction (`/v2/direction/*`). Session obligatoire côté serveur (la navigation est dans la barre latérale) ; la
 * permission de chaque écran est vérifiée par sa page (`requirePermission`). L'API reste la barrière réelle sur les données.
 */
export default async function DirectionLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </div>
    </AppShell>
  );
}
