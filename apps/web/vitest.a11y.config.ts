import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Balayage d'accessibilité transversal : rejoue TOUS les tests d'écran existants et fait passer axe-core sur le DOM de
 * chacun (mode `strict` de `src/platform/test/setup.ts`) ; une violation serious/critical fait échouer le test.
 * Exécution : `pnpm --filter @ecoledigitale/web test:a11y` (long : plusieurs minutes).
 */
export default mergeConfig(base, defineConfig({ test: { env: { A11Y_AUDIT: "strict" } } }));
