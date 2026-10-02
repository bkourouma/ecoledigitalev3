import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { AnalyticsNav } from "../owner/_components/kit";

/**
 * Habillage du pilotage de la direction (`/v2/direction/*`). Session obligatoire côté serveur + navigation de section ; la
 * permission de chaque écran est vérifiée par sa page (`requirePermission`). L'API reste la barrière réelle sur les données.
 */
export default async function DirectionLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="print:hidden">
        <AnalyticsNav />
      </div>
      {children}
    </div>
  );
}
