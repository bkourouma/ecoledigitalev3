import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests de caractérisation (tranche 2.0). Voir README.md.
 *
 * `root` = ce dossier : le runner (run.mjs) lance `vitest --root tests/characterization`.
 * Les dépendances propres à l'API legacy (fastify...) ne sont pas résolubles depuis ce dossier
 * (il n'est pas un paquet du workspace pnpm) : on les aliase vers `apps/api/node_modules`.
 */
// Le legacy utilise les méthodes de date LOCALES (getDay(), setDate()) dans le calcul des jours ouvrés de la paie : on fige le fuseau
// pour que les snapshots ne dépendent pas de la machine (la production tourne en UTC).
process.env.TZ = "UTC";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const apiRequire = createRequire(resolve(repoRoot, "apps", "api", "package.json"));

function apiDependency(name: string): string {
  // `fastify` expose son entrée CommonJS ; on pointe sur le dossier du paquet pour que Vite résolve son `main`.
  return dirname(apiRequire.resolve(`${name}/package.json`));
}

export default defineConfig({
  root: here,
  resolve: {
    alias: {
      fastify: apiDependency("fastify"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { TZ: "UTC" },
    globalSetup: ["./harness/global-setup.ts"],
    // Une base par fichier de test, créée depuis un modèle : les fichiers peuvent donc tourner en
    // parallèle, mais on reste séquentiel pour une sortie stable et un Postgres éphémère modeste.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // `-u` ne régénère QUE nos snapshots JSON (voir harness/snapshot.ts), jamais ceux de Vitest.
    snapshotFormat: { printBasicPrototype: false },
  },
});
