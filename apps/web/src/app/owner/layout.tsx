import { canAccessOwnerPath } from "@/platform/auth/policies";
import { requireAccess } from "@/platform/auth/server";
import OwnerClientLayout from "./owner-client-layout";

/**
 * Garde SERVEUR de l'espace propriétaire : session obligatoire (sinon /login), puis rôle owner — ou
 * administrateur pour `/owner/acces` uniquement (voir platform/auth/policies.ts) ; sinon /unauthorized.
 *
 * Le garde client (`owner-client-layout.tsx`) est conservé : il suit les navigations internes, pour
 * lesquelles ce layout n'est pas ré-exécuté, et gère l'état « session en chargement ».
 */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  await requireAccess((session, pathname) => canAccessOwnerPath(session, pathname));
  return <OwnerClientLayout>{children}</OwnerClientLayout>;
}
