import type { ReactNode } from "react";
import { ReportcardsNav } from "./_components/ReportcardsNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des bulletins et documents officiels (`/v2/reportcards/*`). Session exigée côté serveur ; la permission de chaque
 * écran est vérifiée par sa page (gestion, élève, parent). Un bulletin est un instantané immuable de résultats clôturés :
 * le web n'affiche que ce que l'API renvoie et ne calcule rien.
 */
export default async function ReportcardsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <ReportcardsNav />
        {children}
      </div>
    </AppShell>
  );
}
