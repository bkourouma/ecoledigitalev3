/**
 * Point d'entrée des adaptateurs pour `apps/worker` : le worker charge ce fichier (disque en développement, EMBARQUÉ dans le
 * bundle de production par `apps/worker/scripts/build.mjs`) et appelle `installWorkerAdapters` une fois, après avoir ouvert
 * ses accès base de données et AVANT de démarrer abonnés et jobs.
 */
export { installWorkerAdapters as default, installWorkerAdapters } from "./index";
export type { WorkerAdapterInput, WiredPlatform } from "./index";
