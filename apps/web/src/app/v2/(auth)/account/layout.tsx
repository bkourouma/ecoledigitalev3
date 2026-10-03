import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Pages de compte d'un utilisateur connecté (sécurité, sessions, établissements) : dans la coque de navigation de son rôle.
 * Les pages d'authentification elles-mêmes (connexion, mot de passe oublié...) restent hors coque, dans `(auth)`.
 */
export default async function AccountPagesLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
