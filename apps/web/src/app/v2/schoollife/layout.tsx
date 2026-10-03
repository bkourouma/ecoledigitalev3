import type { ReactNode } from "react";
import { SchoolLifeNav } from "./_components/SchoolLifeNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage de la vie scolaire (`/v2/schoollife/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (garde serveur) ET par l'API (la vraie barrière : RBAC, périmètre de classe, niveau de confidentialité).
 */
export default async function SchoolLifeLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <SchoolLifeNav />
        {children}
      </div>
    </AppShell>
  );
}
