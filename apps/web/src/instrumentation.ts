/**
 * Hook de démarrage Next.js (exécuté une fois au lancement du serveur).
 * Le contrôle d'environnement (NEXTAUTH_SECRET en production) vit dans
 * `instrumentation-node.ts`, chargé seulement côté Node.js (il utilise process.exit,
 * absent du runtime Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
