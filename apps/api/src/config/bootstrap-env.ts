/**
 * À importer EN PREMIER dans le point d'entrée (`src/index.ts`).
 *
 * Charge `.env` (dotenv) puis valide la configuration. Comme les imports ES sont
 * exécutés dans l'ordre, une configuration invalide arrête le process avant le
 * chargement des routes et des services (jwt.service, super-admin-jwt.service…).
 */
import "dotenv/config";
import { loadEnvOrExit } from "./env";

export const env = loadEnvOrExit();
