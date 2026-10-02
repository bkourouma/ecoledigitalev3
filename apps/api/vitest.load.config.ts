import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Tests de CHARGE (`pnpm --filter @ecoledigitale/api test:load`) : fichiers `test/load/**\/*.load.ts` uniquement, jamais inclus dans
 * la suite par défaut (`vitest.config.ts` n'inclut que `*.test.ts`). Durées généreuses : la génération du jeu de données est comprise.
 * Les alias de la configuration par défaut sont repris tels quels ; `include` est REMPLACÉ (mergeConfig concatène les tableaux).
 */
export default defineConfig({
  resolve: base.resolve ?? {},
  test: {
    include: ["test/load/**/*.load.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
