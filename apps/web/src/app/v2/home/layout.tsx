import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/** Accueil de gestion (`/v2/home`) : dans la coque de navigation du rôle de la session. */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
