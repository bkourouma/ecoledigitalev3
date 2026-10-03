import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PORTAL_GUARD } from "@/platform/portal";
import { AppShell } from "@/platform/shell/AppShell";

export const metadata: Metadata = { title: "Espace parent" };

/**
 * Portail parent (`/v2/parent/*`). Garde serveur : session + droit de suivre ses enfants (`student.child.read`, fail-closed).
 * Chaque page ajoute sa permission ; le lien de tutelle est vérifié par chaque module de l'API à chaque lecture (404 ou 403 hors lien).
 * La coque (`AppShell`) est celle du rôle de la session : portail parent pour un parent.
 */
export default async function ParentLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PORTAL_GUARD.parent);
  return <AppShell>{children}</AppShell>;
}
