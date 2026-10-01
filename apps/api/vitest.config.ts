import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const packages = resolve(repo, "packages");

/**
 * Tests Vitest de la plateforme v2 de l'API (registre, plateforme, outillage, modules).
 * Les tests LEGACY restent sous Jest (`pnpm --filter @ecoledigitale/api test`, src/__tests__) :
 * jest ignore src/modules (voir jest.config.js), vitest n'exécute que ce qui suit.
 *
 * Les tests d'intégration lisent TEST_DATABASE_URL (et, pour le test de sortie de phase,
 * REDIS_URL) et s'ignorent sans elles ; voir `pnpm test:isolation` pour un Postgres éphémère
 * dans Docker.
 *
 * Alias : ils reproduisent les `paths` de tsconfig.json. Les modules importent les contrats sous
 * trois formes historiques (`@ecoledigitale/contracts/v2`, `/v2/<fichier>`, `/src/v2/<fichier>`) et
 * le SDK du worker sous `@ecoledigitale/worker/sdk` ; sans ces alias la suite complète d'apps/api
 * échouait (8 fichiers de tests de modules ne se chargeaient pas depuis le vitest racine).
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ecoledigitale\/kernel$/, replacement: resolve(packages, "kernel/src/index.ts") },
      { find: /^@ecoledigitale\/database$/, replacement: resolve(packages, "database/src/index.ts") },
      { find: /^@ecoledigitale\/contracts\/v2$/, replacement: resolve(packages, "contracts/src/v2/index.ts") },
      { find: /^@ecoledigitale\/contracts\/v2\/(.*)$/, replacement: `${resolve(packages, "contracts/src/v2")}/$1` },
      { find: /^@ecoledigitale\/contracts\/src\/(.*)$/, replacement: `${resolve(packages, "contracts/src")}/$1` },
      { find: /^@ecoledigitale\/worker\/sdk$/, replacement: resolve(repo, "apps/worker/src/sdk.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts", "src/modules/**/test/**/*.test.ts", "src/modules/**/__tests__/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration créent des bases/rôles et certains écrivent dans des dossiers temporaires.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
