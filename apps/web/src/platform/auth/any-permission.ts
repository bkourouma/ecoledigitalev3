/**
 * Garde SERVEUR « l'une ou l'autre » : certains écrans sont ouverts par plusieurs permissions (par exemple la liste des
 * élèves : `student.list` pour le secrétariat, `student.class.read` pour l'enseignant limité à ses classes).
 * À utiliser dans un layout ou une page (server component), comme `requirePermission`. Fail-closed : service de
 * permissions indisponible => refus.
 */

import { redirect } from "next/navigation";
import { FORBIDDEN_PATH, fetchPermissions, requireSession } from "./server";
import { hasPermission, type SessionLike } from "./policies";

export async function requireAnyPermission(...permissions: string[]): Promise<SessionLike> {
  const session = await requireSession();
  const granted = await fetchPermissions(session).catch(() => null);
  if (!granted || !permissions.some((p) => hasPermission(granted, p))) return redirect(FORBIDDEN_PATH);
  return session;
}
