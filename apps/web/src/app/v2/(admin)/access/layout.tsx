import type { ReactNode } from "react";
import { requirePermission } from "@/platform/auth/server";

/** Rôles et accès : lecture des rôles requise ; les actions d'écriture sont gardées par l'API (permissions sensibles, MFA). */
export default async function AccessLayout({ children }: { children: ReactNode }) {
  await requirePermission("rbac.role.read");
  return <>{children}</>;
}
