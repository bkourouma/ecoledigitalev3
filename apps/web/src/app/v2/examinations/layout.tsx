import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { ExaminationsNav } from "./_components/ExaminationsNav";

/**
 * Habillage des examens (`/v2/examinations/*`). Session exigée côté serveur ; la permission de chaque écran est vérifiée par sa page.
 * Le web n'affiche que ce que l'API décide (éligibilité, issue, taux, numéro de candidat) : aucune règle d'examen n'est codée ici.
 */
export default async function ExaminationsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ExaminationsNav />
      {children}
    </div>
  );
}
