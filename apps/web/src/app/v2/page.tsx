import { redirect } from "next/navigation";
import { activeRoleOf, v2RouteForRole } from "@/lib/role-landing";
import { requireSession } from "@/platform/auth/server";

/** `/v2` n'a pas de contenu propre : on ouvre l'écran d'atterrissage du rôle actif (sinon l'accueil de gestion). */
export default async function V2IndexPage() {
  const session = await requireSession();
  redirect(v2RouteForRole(activeRoleOf(session)));
}
