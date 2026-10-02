import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_GUARDS } from "../_components/guards";

/** Garde SERVEUR des compétences : l'une des permissions listées (fail-closed). */
export default async function PrimaryCompetencesLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_GUARDS.competences);
  return <>{children}</>;
}
