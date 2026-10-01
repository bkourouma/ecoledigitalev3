/**
 * Hook de démarrage Next.js (exécuté une fois au lancement du serveur).
 * Refuse de démarrer en production si l'environnement est invalide
 * (NEXTAUTH_SECRET absent ou faible). Voir `lib/env.server.ts`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertWebEnv } = await import("./lib/env.server");
    assertWebEnv();
  }
}
