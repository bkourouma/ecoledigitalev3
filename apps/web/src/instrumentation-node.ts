/**
 * Refuse de démarrer le serveur web en production si l'environnement est invalide
 * (NEXTAUTH_SECRET absent, trop court ou valeur connue comme faible).
 * Voir `lib/env.server.ts`. Importé par `instrumentation.ts` côté Node.js uniquement.
 *
 * Next.js journalise l'erreur d'un hook `register` mais laisse le process en vie
 * (le serveur répondrait alors en 500) : on arrête donc explicitement le process.
 */
import { assertWebEnv } from "./lib/env.server";

try {
  assertWebEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
