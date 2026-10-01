import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests Vitest du web : logique pure et hooks de `src/platform/**`.
 * Les anciens tests Jest de `src/__tests__` ne sont PAS repris ici.
 * Exécution : `pnpm --filter @ecoledigitale/web test`.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      // Sous-chemins des contrats v2 (`@ecoledigitale/contracts/v2/rbac`, comme dans tsconfig.json) : AVANT l'alias de
      // l'index (premier gagnant).
      "@ecoledigitale/contracts/v2": path.resolve(__dirname, "../../packages/contracts/src/v2"),
      "@ecoledigitale/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/platform/**/*.test.{ts,tsx}", "src/app/v2/**/*.test.{ts,tsx}", "src/lib/__tests__/env.server.test.ts"],
    environment: "node",
    setupFiles: ["src/platform/test/setup.ts"],
    // Les fichiers de test qui ont besoin du DOM le demandent avec `// @vitest-environment jsdom`.
    restoreMocks: true,
  },
});
