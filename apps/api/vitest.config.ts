import { defineConfig } from "vitest/config";

/**
 * Tests Vitest de la plateforme v2 de l'API (registre, plateforme, outillage, modules).
 * Les tests LEGACY restent sous Jest (`pnpm --filter @ecoledigitale/api test`, src/__tests__) :
 * jest ignore src/modules (voir jest.config.js), vitest n'exécute que ce qui suit.
 *
 * Les tests d'intégration lisent TEST_DATABASE_URL et s'ignorent sans elle ; voir
 * `pnpm test:isolation` pour un Postgres éphémère dans Docker.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/modules/**/test/**/*.test.ts", "src/modules/**/__tests__/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration créent des bases/rôles et certains écrivent dans des dossiers temporaires.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
