import type { ReactNode } from "react";
import { ResultsNav } from "./_components/ResultsNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des résultats, délibérations et clôtures (`/v2/results/*`). Session exigée côté serveur ; la permission de chaque
 * écran est vérifiée par sa page. Les valeurs (moyennes, rangs, mentions, décisions) viennent de l'API : aucun calcul ici.
 */
export default async function ResultsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <ResultsNav />
        {children}
      </div>
    </AppShell>
  );
}
