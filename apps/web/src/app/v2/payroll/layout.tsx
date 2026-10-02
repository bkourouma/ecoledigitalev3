import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { PayrollNav } from "./_components/PayrollNav";

/**
 * Habillage de la paie (`/v2/payroll/*`). Session obligatoire côté serveur + navigation de section ; la permission de
 * chaque écran est vérifiée par sa page (`requirePermission`). L'API reste la barrière réelle sur les données.
 */
export default async function PayrollLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="print:hidden">
        <PayrollNav />
      </div>
      {children}
    </div>
  );
}
