import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PORTAL_GUARD, PortalShell } from "@/platform/portal";

export const metadata: Metadata = { title: "Espace élève" };

/**
 * Portail élève (`/v2/student/*`). Garde serveur : session + droit de lire SON dossier (`student.self.read`, fail-closed).
 * Aucun identifiant d'élève n'apparaît dans les adresses : l'API résout l'élève depuis le compte.
 */
export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PORTAL_GUARD.student);
  return <PortalShell portal="student">{children}</PortalShell>;
}
