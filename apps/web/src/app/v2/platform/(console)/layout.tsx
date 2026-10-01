import type { ReactNode } from "react";
import { OperatorShell } from "@/platform/admin/shell/OperatorShell";

/**
 * Console plateforme (opérateurs). Authentification SÉPARÉE de NextAuth : jeton super-admin du navigateur, vérifié par la
 * coquille (redirection vers `/v2/platform/login`). Pas de garde serveur possible ici (le jeton n'est pas un cookie) :
 * chaque route `/api/v1/platform/*` est protégée par le `SuperAdminAuthorizer` de l'API.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <OperatorShell>{children}</OperatorShell>;
}
