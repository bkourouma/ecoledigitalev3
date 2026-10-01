import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { TenantAdminShell } from "@/platform/admin/shell/TenantAdminShell";

/**
 * Administration d'un tenant. Garde serveur : session obligatoire (sinon `/login`) ; chaque section ajoute sa propre
 * permission (`requirePermission`, voir les layouts de `settings`, `access`, `audit`). Les gardes complètent l'API,
 * qui reste la barrière réelle (RBAC + RLS).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <TenantAdminShell>{children}</TenantAdminShell>;
}
