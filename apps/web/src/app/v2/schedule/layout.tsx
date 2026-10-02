import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { ScheduleNav } from "./_components/ScheduleNav";

/**
 * Habillage de l'emploi du temps (`/v2/schedule/*`) : session obligatoire côté serveur ; la permission de chaque écran
 * est vérifiée par sa page, et l'API reste la barrière réelle sur les données.
 */
export default async function ScheduleLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ScheduleNav />
      {children}
    </div>
  );
}
