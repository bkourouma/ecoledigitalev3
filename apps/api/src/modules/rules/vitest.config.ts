/**
 * Configuration Vitest du module rules.
 *
 *   # unitaires + golden (sans base)
 *   pnpm exec vitest run --config apps/api/src/modules/rules/vitest.config.ts
 *   # + intégration sur Postgres éphémère (Docker)
 *   ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs \
 *     --config apps/api/src/modules/rules/vitest.config.ts
 *
 * Le moteur (`packages/rules-engine`) est atteint par `engine.ts` (chemin relatif) : aucun alias à prévoir.
 * Les alias ci-dessous reproduisent ceux des autres modules (noyau, base, contrats).
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
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["domain/**/*.ts", "application/**/*.ts", "infrastructure/**/*.ts", "http/**/*.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
