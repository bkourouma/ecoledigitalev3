import type { ReactNode } from "react";
import { HigherNav } from "./_components/HigherNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage de l'enseignement supérieur (`/v2/higher/*`) : diplômes, attestations, documents officiels, crédits, rattrapages,
 * signataires. Session exigée côté serveur ; la permission de chaque écran est vérifiée par sa page. L'éligibilité, la mention
 * et la moyenne de cycle viennent des règles : le web les affiche, il ne les calcule pas.
 */
export default async function HigherLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <HigherNav />
        {children}
      </div>
    </AppShell>
  );
}
