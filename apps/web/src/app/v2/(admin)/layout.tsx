import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Administration d'un tenant (`/v2/settings`, `/v2/access`, `/v2/audit`). Session obligatoire (sinon `/login`, vérifiée par
 * `AppShell`) ; chaque section ajoute sa propre permission (`requirePermission`, voir les layouts de `settings`, `access`, `audit`).
 * Les gardes complètent l'API, qui reste la barrière réelle (RBAC + RLS). La coque est celle des autres modules de gestion.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
