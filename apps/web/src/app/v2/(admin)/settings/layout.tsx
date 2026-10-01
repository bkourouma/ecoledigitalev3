import type { ReactNode } from "react";
import { requirePermission } from "@/platform/auth/server";
import { SettingsNav } from "@/platform/admin/tenancy/SettingsNav";

/** Paramètres de l'établissement : lecture de la structure requise ; les modifications sont gardées par l'API. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requirePermission("tenancy.institution.read");
  return (
    <>
      <SettingsNav />
      {children}
    </>
  );
}
