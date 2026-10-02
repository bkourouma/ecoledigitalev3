import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { AdmissionsShell } from "./_components/AdmissionsShell";

/**
 * Habillage des admissions (`/v2/admissions/*`) : session obligatoire côté serveur ; la permission de chaque écran est vérifiée
 * par sa page (la barrière réelle sur les données reste l'API : permission, fonctionnalité du plan, isolation par établissement).
 */
export default async function AdmissionsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <AdmissionsShell>{children}</AdmissionsShell>;
}
