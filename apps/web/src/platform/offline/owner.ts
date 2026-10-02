/**
 * Identité propriétaire des données hors ligne : `tenant:utilisateur` du jeton courant.
 *
 * `allowExpired` : les brouillons de notes et la copie d'emploi du temps restent attribués à l'identité du jeton même
 * s'il a expiré — une saisie hors ligne dure plus longtemps qu'un jeton d'accès, et ne pas pouvoir l'écrire serait une perte.
 * L'expiration empêche seulement l'ENVOI (`hasValidSession`). Sans jeton (déconnexion), il n'y a plus de propriétaire.
 */

import { getToken, getUserFromToken, isTokenExpired } from "@/lib/jwt-storage";

export function currentOfflineOwner(options: { allowExpired?: boolean } = {}): string | null {
  if (typeof window === "undefined") return null;
  const token = getToken();
  if (!token) return null;
  if (!options.allowExpired && isTokenExpired(token)) return null;
  const user = getUserFromToken(token);
  return user ? `${user.tenantSlug || user.tenantId}:${user.userId}` : null;
}

/** Un jeton non expiré est disponible : l'API peut être appelée. */
export function hasValidSession(): boolean {
  if (typeof window === "undefined") return false;
  const token = getToken();
  return Boolean(token) && !isTokenExpired(token as string);
}
