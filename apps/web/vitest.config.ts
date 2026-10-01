import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests Vitest du web : logique pure et hooks de `src/platform/**`, écrans v2 (`src/app/v2/**`).
 * Les anciens tests Jest de `src/__tests__` ne sont PAS repris ici.
 * Exécution : `pnpm --filter @ecoledigitale/web test`.
 */
const contracts = path.resolve(__dirname, "../../packages/contracts/src");

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    // Les contrats v2 s'importent par `@ecoledigitale/contracts/src/v2/<fichier>` (comme dans l'API) : un alias « préfixe »
    // simple casserait ce chemin, d'où les expressions régulières (même table que les `paths` de tsconfig.json).
    alias: [
      { find: /^@ecoledigitale\/contracts\/src\/(.*)$/, replacement: `${contracts}/$1` },
      { find: /^@ecoledigitale\/contracts\/v2$/, replacement: `${contracts}/v2/index.ts` },
      { find: /^@ecoledigitale\/contracts\/v2\/(.*)$/, replacement: `${contracts}/v2/$1` },
      { find: /^@ecoledigitale\/contracts$/, replacement: `${contracts}/index.ts` },
      { find: /^@\/(.*)$/, replacement: `${path.resolve(__dirname, "src")}/$1` },
    ],
  },
  test: {
    include: ["src/platform/**/*.test.{ts,tsx}", "src/app/v2/**/*.test.{ts,tsx}", "src/lib/__tests__/env.server.test.ts"],
    environment: "node",
    setupFiles: ["src/platform/test/setup.ts"],
    // Les fichiers de test qui ont besoin du DOM le demandent avec `// @vitest-environment jsdom`.
    restoreMocks: true,
  },
});
