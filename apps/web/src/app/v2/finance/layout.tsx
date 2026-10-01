import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { FinanceNav } from "./_components/FinanceNav";

/**
 * Habillage de la finance (`/v2/finance/*`). Session obligatoire côté serveur + navigation de section ; la permission de
 * chaque écran est vérifiée par sa page (`requirePermission`). L'API reste la barrière réelle sur les données.
 */
export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <FinanceNav />
      {children}
    </div>
  );
}
