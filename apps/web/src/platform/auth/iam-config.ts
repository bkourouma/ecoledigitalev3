/**
 * Bascule de l'authentification web : `NEXT_PUBLIC_AUTH_V2=1` fait passer NextAuth (identifiants + Google) et les pages
 * de connexion sur les routes `/api/v1/iam/*` (module `iam` : sessions à refresh rotatif, MFA TOTP, révocation).
 * Absent ou autre valeur : authentification LEGACY, comportement historique inchangé (défaut tant que la bascule
 * n'est pas décidée). Plan de bascule : docs/architecture/auth-cutover.md.
 *
 * Variable `NEXT_PUBLIC_*` : référencée littéralement pour être injectée au build ; lisible côté serveur ET navigateur.
 */
export function isAuthV2(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_V2 === "1";
}

/** Base URL de l'API pour les appels SERVEUR (NextAuth) : même règle que `lib/auth-options.ts`. */
export function iamApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.API_INTERNAL_URL || env.API_URL || "http://localhost:4000";
}
