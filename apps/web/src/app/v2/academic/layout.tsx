import type { ReactNode } from "react";
import { AcademicNav } from "./_components/AcademicNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage du cœur académique (`/v2/academic/*`). Mise en page TEMPORAIRE tant que `app/v2/layout.tsx` (portail v2) n'existe
 * pas : session obligatoire côté serveur + navigation de section. La permission de chaque écran est vérifiée par sa page
 * (un layout n'est pas ré-exécuté à la navigation interne) et, en dernier ressort, par l'API.
 */
export default async function AcademicLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <AcademicNav />
        {children}
      </div>
    </AppShell>
  );
}
