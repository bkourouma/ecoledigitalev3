/**
 * Configuration Vitest du module iam (les tests historiques de apps/api restent sous Jest).
 *
 *   pnpm exec vitest run --config apps/api/src/modules/iam/vitest.config.ts       (depuis la racine du dépôt)
 *   node packages/database/scripts/with-postgres.mjs --config <chemin absolu de ce fichier>
 *
 * Les paquets de travail `@ecoledigitale/{kernel,database}` ne sont pas encore des
 * dépendances de apps/api : on les résout ici par alias vers leurs sources.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packages = resolve(here, "../../../../../packages");

export default {
  root: here,
  resolve: {
    alias: [
      { find: /^@ecoledigitale\/kernel$/, replacement: resolve(packages, "kernel/src/index.ts") },
      { find: /^@ecoledigitale\/database$/, replacement: resolve(packages, "database/src/index.ts") },
      { find: /^@ecoledigitale\/contracts\/v2\/(.*)$/, replacement: resolve(packages, "contracts/src/v2/$1") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
};
