import type { ReactNode } from "react";
import { AnalyticsNav } from "../owner/_components/kit";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des indicateurs transverses de la direction (`/v2/analytics/*`) : session obligatoire côté serveur + navigation de section.
 * La permission de chaque écran est vérifiée par sa page ; l'API reste la barrière réelle sur les données.
 */
export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <div className="print:hidden">
          <AnalyticsNav />
        </div>
        {children}
      </div>
    </AppShell>
  );
}
