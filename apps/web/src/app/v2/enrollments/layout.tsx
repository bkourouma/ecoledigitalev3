import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { EnrollmentsNav } from "./_components/EnrollmentsNav";

/**
 * Habillage des inscriptions (`/v2/enrollments/*`). Mise en page TEMPORAIRE tant que `app/v2/layout.tsx` n'existe pas :
 * session obligatoire côté serveur + navigation de section ; la permission de chaque écran est vérifiée par sa page.
 */
export default async function EnrollmentsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <EnrollmentsNav />
      {children}
    </div>
  );
}
