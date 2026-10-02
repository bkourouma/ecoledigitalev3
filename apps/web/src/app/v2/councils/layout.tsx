import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { CouncilsNav } from "./_components/CouncilsNav";

/**
 * Habillage des conseils de classe (`/v2/councils/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (garde serveur) ET par l'API (la vraie barrière : RBAC, périmètre de classe, état de la séance).
 */
export default async function CouncilsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <CouncilsNav />
      {children}
    </div>
  );
}
