import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR de l'espace famille : lecture des bilans ou compétences de ses enfants (ou de soi pour un élève), fail-closed. */
export default async function PrimaryMonEnfantLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS["mon-enfant"]);
  return <>{children}</>;
}
