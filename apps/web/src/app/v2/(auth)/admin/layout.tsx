import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/** Membres de l'établissement (`/v2/admin/members`, entrée « Utilisateurs » du menu) : dans la coque de gestion. */
export default async function MembersLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
