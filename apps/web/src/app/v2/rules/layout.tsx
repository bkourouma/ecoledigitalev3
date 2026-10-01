import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";

/**
 * Habillage des règles de calcul (`/v2/rules/*`). Session exigée côté serveur ; la permission `rules.ruleset.read` est
 * vérifiée par chaque page. Les jeux nationaux sont en lecture seule ; l'approbation et la publication sont réservées à
 * l'opérateur de la plateforme (console), jamais à l'établissement.
 */
export default async function RulesLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</div>;
}
