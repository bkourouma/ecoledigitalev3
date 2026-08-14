/**
 * Qui a le droit de voir un mot de passe initial en clair.
 *
 * Les fiches enseignant / étudiant / parent portent un `initial_password` : le
 * mot de passe généré à la création du compte, conservé en clair pour pouvoir le
 * redonner à l'intéressé. Les listings le renvoyaient à TOUT utilisateur
 * authentifié du tenant — un enseignant lisant `GET /api/v1/students` récupérait
 * les mots de passe de tous les élèves, même si l'interface ne les affiche pas.
 *
 * On restreint la donnée à la direction et à l'administration. Pour tous les
 * autres appelants, le champ est renvoyé à `null` : la forme de la réponse ne
 * change pas, seule la valeur disparaît.
 */

/**
 * Forme minimale acceptée : la requête Fastify comme les interfaces locales des
 * routes (`AuthenticatedRequest`) satisfont cette structure.
 */
type RequestWithUser = { user?: { roles?: string[] } | null };

/** Rôles autorisés à lire un mot de passe initial. Comparaison insensible à la casse. */
const CREDENTIAL_VIEWER_ROLES = ["owner", "admin", "super_admin", "administrateur"];

export function canViewInitialPassword(request: RequestWithUser): boolean {
  const roles = request.user?.roles;
  if (!Array.isArray(roles)) return false;
  const normalized = roles.map((role) => String(role).toLowerCase());
  return CREDENTIAL_VIEWER_ROLES.some((role) => normalized.includes(role));
}

/**
 * Valeur à renvoyer pour un champ `initialPassword`.
 * `maskInitialPassword(canView, row.initial_password)` → la valeur ou `null`.
 */
export function maskInitialPassword(
  canView: boolean,
  value: string | null | undefined
): string | null {
  if (!canView) return null;
  return value ?? null;
}
