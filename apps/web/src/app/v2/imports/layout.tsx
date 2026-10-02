import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { ImportsNav } from "./_components/ImportsNav";

/**
 * Habillage des imports Excel / CSV (`/v2/imports/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page (la barrière réelle reste l'API : permissions d'imports ET du module cible, MFA des soldes).
 */
export default async function ImportsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <ImportsNav />
      {children}
    </div>
  );
}
