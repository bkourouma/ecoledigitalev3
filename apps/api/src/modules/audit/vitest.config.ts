import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");

/**
 * Configuration Vitest du module `audit` (le jest d'apps/api ne le concerne pas : ses tests
 * sont sous `test/`, hors du `testMatch` **\/__tests__/**).
 *
 *   pnpm exec vitest run --config apps/api/src/modules/audit/vitest.config.ts            # unitaires (+ intégration ignorée)
 *   node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/audit/vitest.config.ts   # avec Postgres jetable
 *
 * Les alias reproduisent les `paths` du tsconfig : les packages de travail (kernel, database,
 * contracts) sont consommés depuis leurs sources.
 */
export default defineConfig({
  root: here,
  resolve: {
    alias: [
      { find: /^@ecoledigitale\/kernel$/, replacement: resolve(repo, "packages/kernel/src/index.ts") },
      { find: /^@ecoledigitale\/database$/, replacement: resolve(repo, "packages/database/src/index.ts") },
      { find: /^@ecoledigitale\/contracts\/src\/(.*)$/, replacement: `${resolve(repo, "packages/contracts/src")}/$1` },
      { find: /^@ecoledigitale\/contracts\/(.*)$/, replacement: `${resolve(repo, "packages/contracts/src")}/$1` },
      { find: /^@ecoledigitale\/worker\/sdk$/, replacement: resolve(repo, "apps/worker/src/sdk.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Chaque fichier d'intégration crée sa propre base : on les sérialise.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
