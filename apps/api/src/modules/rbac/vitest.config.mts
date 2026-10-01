import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (p: string): string => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url));

/**
 * Vitest du module rbac (les tests de apps/api historiques sont sous Jest).
 *
 *   pnpm --filter @ecoledigitale/api exec vitest run --config src/modules/rbac/vitest.config.mts
 *   # intégration (Postgres éphémère dans Docker) :
 *   ED_PG_IMAGE=postgres:17-alpine node ../../packages/database/scripts/with-postgres.mjs --config src/modules/rbac/vitest.config.mts
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: [
      { find: /^@ecoledigitale\/kernel$/, replacement: root("packages/kernel/src/index.ts") },
      { find: /^@ecoledigitale\/database$/, replacement: root("packages/database/src/index.ts") },
      { find: /^@ecoledigitale\/contracts\/src\/(.*)$/, replacement: `${root("packages/contracts/src")}/$1` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
