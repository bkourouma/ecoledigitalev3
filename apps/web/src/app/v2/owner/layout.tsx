import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { AnalyticsNav } from "./_components/kit";

/**
 * Habillage de l'espace du propriétaire (`/v2/owner/*`, nouvelle arborescence : les pages `/owner/*` historiques ne sont pas
 * touchées). Session obligatoire côté serveur + navigation de section ; chaque page vérifie sa permission et l'API reste la
 * barrière réelle sur les données.
 */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
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
