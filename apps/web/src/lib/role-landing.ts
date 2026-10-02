/**
 * Page d'atterrissage d'un utilisateur, selon son rôle actif.
 *
 * Chaque espace a la sienne ; l'administration atterrit sur le tableau de bord
 * et non sur « / », dont la page d'accueil communautaire a été retirée du menu.
 *
 * Source unique pour la connexion (`app/login`), le choix de rôle
 * (`app/select-role`) et la racine (`app/page.tsx`), qui doivent rester alignés.
 */
/**
 * Atterrissage « v2 » : avec `NEXT_PUBLIC_V2_LANDING=1`, chaque rôle atterrit sur son écran de la plateforme v2 (`/v2/...`,
 * menu piloté par l'API) au lieu des pages historiques. Utilisé par la démonstration (`pnpm demo:up`), dont l'API n'expose pas
 * les routes historiques ; absent, le comportement historique est inchangé. Les clés sont celles de `session.activeRole`
 * (rôle historique quand il existe : `teacher`, `student`, `parent`, `owner`, `admin` ; sinon le modèle de rôle v2).
 */
const V2_LANDING: Readonly<Record<string, string>> = Object.freeze({
  owner: "/v2/owner",
  admin: "/v2/direction",
  directeur: "/v2/direction",
  directeur_etudes: "/v2/academic",
  responsable_pedagogique: "/v2/assessments",
  secretariat: "/v2/students",
  econome: "/v2/finance",
  teacher: "/v2/teacher",
  enseignant: "/v2/teacher",
  instituteur: "/v2/primary",
  educateur: "/v2/attendance",
  responsable_examens: "/v2/examinations",
  admissions_officer: "/v2/admissions",
  parent: "/v2/parent",
  student: "/v2/student",
  eleve: "/v2/student",
});

export function isV2Landing(): boolean {
  return process.env.NEXT_PUBLIC_V2_LANDING === "1";
}

export function routeForRole(role?: string): string {
  const normalized = String(role || "").toLowerCase();
  if (isV2Landing()) return V2_LANDING[normalized] ?? "/v2/settings";
  if (normalized === "owner") return "/owner/dashboard";
  if (normalized === "teacher") return "/teacher/dashboard";
  if (normalized === "parent") return "/parent/children";
  if (normalized === "student") return "/student/courses";
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
