import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des indicateurs transverses de la direction (`/v2/analytics/*`) : session obligatoire côté serveur (la navigation est dans la barre latérale).
 * La permission de chaque écran est vérifiée par sa page ; l'API reste la barrière réelle sur les données.
 */
export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </div>
    </AppShell>
  );
}
