import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { StaffNav } from "./_components/StaffNav";

/**
 * Habillage du personnel et des affectations (`/v2/staff/*`). Mise en page TEMPORAIRE tant que `app/v2/layout.tsx` n'existe
 * pas : session obligatoire côté serveur + navigation ; la permission de chaque écran est vérifiée par sa page.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <StaffNav />
      {children}
    </div>
  );
}
