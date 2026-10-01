import { canAccessAdminDashboard } from "@/platform/auth/policies";
import { requireAccess } from "@/platform/auth/server";
import TableauDeBordClientLayout from "./tableau-de-bord-client-layout";

/**
 * Garde SERVEUR du tableau de bord : session obligatoire (sinon /login), puis rôle d'administration
 * (sinon /unauthorized). Le garde client (`tableau-de-bord-client-layout.tsx`) est conservé.
 */
export default async function TableauDeBordLayout({ children }: { children: React.ReactNode }) {
  await requireAccess((session) => canAccessAdminDashboard(session));
  return <TableauDeBordClientLayout>{children}</TableauDeBordClientLayout>;
}
