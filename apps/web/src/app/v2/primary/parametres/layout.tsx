import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR des paramètres : `primary.settings.manage` (fail-closed). */
export default async function PrimaryParametresLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.parametres);
  return <>{children}</>;
}
