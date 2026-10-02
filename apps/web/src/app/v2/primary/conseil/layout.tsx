import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR du conseil des maîtres : l'une des permissions listées (fail-closed). */
export default async function PrimaryConseilLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.conseil);
  return <>{children}</>;
}
