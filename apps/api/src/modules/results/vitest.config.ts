/**
 * Configuration Vitest du module results.
 *
 *   # unitaires (sans base)
 *   pnpm exec vitest run --config apps/api/src/modules/results/vitest.config.ts
 *   # + intégration et parité sur Postgres éphémère (Docker)
 *   ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs \
 *     --config apps/api/src/modules/results/vitest.config.ts
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("./"),
  resolve: {
    alias: [
      { find: /^@ecoledigitale\/kernel$/, replacement: here("../../../../../packages/kernel/src/index.ts") },
      { find: /^@ecoledigitale\/database$/, replacement: here("../../../../../packages/database/src/index.ts") },
      { find: /^@ecoledigitale\/contracts\/src\/(.*)$/, replacement: `${here("../../../../../packages/contracts/src")}/$1` },
      { find: /^@ecoledigitale\/worker\/sdk$/, replacement: here("../../../../worker/src/sdk.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration créent chacun leur base : on les sérialise.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      include: ["domain/**/*.ts", "application/**/*.ts", "infrastructure/**/*.ts", "http/**/*.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
