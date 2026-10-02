import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR de la banque d'appréciations : l'une des permissions listées (fail-closed). */
export default async function PrimaryAppreciationsLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.appreciations);
  return <>{children}</>;
}
