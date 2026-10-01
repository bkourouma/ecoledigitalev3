/**
 * Config Vitest du module (l'API historique utilise Jest, qui ne voit que les
 * dossiers `__tests__` : les tests de ce module vivent dans `test/` pour ne pas
 * être ramassés par Jest).
 *
 *   pnpm exec vitest run --config apps/api/src/modules/tenancy/vitest.config.ts
 *   node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/tenancy/vitest.config.ts
 *
 * Les alias font pointer les paquets workspace vers leurs sources : le module
 * n'a pas (encore) ces dépendances déclarées dans apps/api/package.json.
 */
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// `__dirname` est injecté par Vite pour les fichiers de config.
const here = __dirname;
const repo = `${resolve(__dirname, "../../../../..").split("\\").join("/")}/`;

export default defineConfig({
  root: here,
  resolve: {
    alias: [
      { find: /^@ecoledigitale\/kernel$/, replacement: `${repo}packages/kernel/src/index.ts` },
      { find: /^@ecoledigitale\/database$/, replacement: `${repo}packages/database/src/index.ts` },
      { find: /^@ecoledigitale\/contracts\/src\/(.*)$/, replacement: `${repo}packages/contracts/src/$1` },
      // Forme courte utilisée par d'autres modules (`@ecoledigitale/contracts/v2`).
      { find: /^@ecoledigitale\/contracts\/(?!src\/)(.*)$/, replacement: `${repo}packages/contracts/src/$1` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Chaque fichier d'intégration crée sa propre base : on les sérialise.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
