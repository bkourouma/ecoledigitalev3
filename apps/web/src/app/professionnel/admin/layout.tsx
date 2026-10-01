import { canAccessProfessionalAdminPath } from "@/platform/auth/policies";
import { requireAccess } from "@/platform/auth/server";

/**
 * Garde SERVEUR du Module Professionnel (`/professionnel/admin/*`), jusque-là sans garde : seul le menu
 * était masqué. Réservé à l'administration et au propriétaire ; l'enseignant garde l'accès à la saisie
 * des notes (`/professionnel/admin/notes`), qui est aussi son écran de notation.
 *
 * Limite connue : ce layout n'est pas ré-exécuté lors d'une navigation interne entre deux pages du
 * module ; la protection s'applique donc au chargement direct / rafraîchissement. Les données restent
 * protégées par l'API. Un contrôle par route (middleware avec jeton signé) viendra avec le module `iam`.
 */
export default async function ProfessionnelAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAccess((session, pathname) => canAccessProfessionalAdminPath(session, pathname));
  return <>{children}</>;
}
