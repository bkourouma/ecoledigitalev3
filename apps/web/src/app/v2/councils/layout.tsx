import type { ReactNode } from "react";
import { CouncilsNav } from "./_components/CouncilsNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des conseils de classe (`/v2/councils/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (garde serveur) ET par l'API (la vraie barrière : RBAC, périmètre de classe, état de la séance).
 */
export default async function CouncilsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <CouncilsNav />
        {children}
      </div>
    </AppShell>
  );
}
