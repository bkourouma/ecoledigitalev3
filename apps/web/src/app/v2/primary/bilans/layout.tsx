import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR des bilans annuels : l'une des permissions listées (fail-closed). */
export default async function PrimaryBilansLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.bilans);
  return <>{children}</>;
}
