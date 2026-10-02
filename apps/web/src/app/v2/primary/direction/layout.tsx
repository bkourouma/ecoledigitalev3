import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR du pilotage de la direction : l'une des permissions listées (fail-closed). */
export default async function PrimaryDirectionLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.direction);
  return <>{children}</>;
}
