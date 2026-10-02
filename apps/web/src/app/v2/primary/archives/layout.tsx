import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR des archives d'année : l'une des permissions listées (fail-closed). */
export default async function PrimaryArchivesLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.archives);
  return <>{children}</>;
}
