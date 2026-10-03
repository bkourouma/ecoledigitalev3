import type { ReactNode } from "react";
import { RulesNav } from "./_components/RulesNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des règles de calcul (`/v2/rules/*`). Session exigée côté serveur ; la permission `rules.ruleset.read` est
 * vérifiée par chaque page. Les jeux nationaux sont en lecture seule ; l'approbation et la publication sont réservées à
 * l'opérateur de la plateforme (console), jamais à l'établissement.
 */
export default async function RulesLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <RulesNav />
        {children}
      </div>
    </AppShell>
  );
}
