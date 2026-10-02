import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR de « Ma classe » : l'une des permissions listées (fail-closed). */
export default async function PrimaryClasseLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.classe);
  return <>{children}</>;
}
