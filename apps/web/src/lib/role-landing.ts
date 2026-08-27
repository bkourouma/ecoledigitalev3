/**
 * Page d'atterrissage d'un utilisateur, selon son rôle actif.
 *
 * Chaque espace a la sienne ; l'administration atterrit sur le tableau de bord
 * et non sur « / », dont la page d'accueil communautaire a été retirée du menu.
 *
 * Source unique pour la connexion (`app/login`), le choix de rôle
 * (`app/select-role`) et la racine (`app/page.tsx`), qui doivent rester alignés.
 */
export function routeForRole(role?: string): string {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "owner") return "/owner/dashboard";
  if (normalized === "teacher") return "/teacher/dashboard";
  if (normalized === "parent") return "/parent/children";
  if (normalized === "student") return "/student/courses";
  if (normalized === "formateur") return "/formateur/dashboard";
  return "/tableau-de-bord";
}

/** Rôle actif d'une session NextAuth, avec repli sur le premier rôle connu. */
export function activeRoleOf(session: unknown): string | undefined {
  const s = session as any;
  return s?.activeRole || s?.roles?.[0];
}

/**
 * Rôles autorisés sur `/tableau-de-bord`.
 *
 * Le propriétaire en est exclu volontairement : son tableau de bord à lui est
 * `/owner/dashboard`. Les libellés accentués et la casse historique du projet
 * (« Administrateur ») sont acceptés.
 */
const ADMIN_ROLE_KEYS = ["admin", "super_admin", "administrateur"];

/** Vrai si l'un des rôles de la session est un rôle d'administration. */
export function isAdminRole(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => ADMIN_ROLE_KEYS.includes(String(r).toLowerCase()));
}
