#!/usr/bin/env node
/**
 * Build de production : bundle esbuild, un fichier CommonJS par point d'entrée.
 *
 *   node scripts/build.mjs        ->  dist/index.cjs  dist/dlq.cjs
 *   node dist/index.cjs
 *
 * Pourquoi un bundle plutôt que `tsc` : les packages du workspace (@ecoledigitale/kernel,
 * @ecoledigitale/database) sont consommés EN SOURCE TypeScript (`main: ./src/index.ts`) ;
 * un `tsc` du worker ne les compilerait pas, et `node` ne sait pas exécuter leur .ts.
 * Le bundle les embarque, ainsi que les dépendances npm : l'image Docker d'exécution ne
 * contient que dist/ (pas de node_modules).
 *
 * Découverte des modules : tous les `<modulesDir>/<key>/subscribers.ts|jobs.ts` présents AU
 * BUILD sont importés statiquement dans le bundle (remplacement de src/discovery/bundled.ts).
 * `WORKER_MODULES_DIRS` (séparées par des virgules) surcharge les dossiers scannés ;
 * `WORKER_BUILD_OUTDIR` change le dossier de sortie (tests).
 */
import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");

const moduleDirs = process.env.WORKER_MODULES_DIRS
  ? process.env.WORKER_MODULES_DIRS.split(",").map((d) => resolve(d.trim()))
  : [join(repoRoot, "apps", "api", "src", "modules"), join(repoRoot, "modules")];

const EXTS = [".ts", ".mts", ".js", ".mjs", ".cjs"];
const findFile = (dir, base) => EXTS.map((e) => join(dir, base + e)).find((f) => existsSync(f)) ?? null;

function scanModules() {
  const found = [];
  for (const dir of moduleDirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const entry of readdirSync(dir).sort()) {
      const moduleDir = join(dir, entry);
      if (!statSync(moduleDir).isDirectory()) continue;
      const subscribers = findFile(moduleDir, "subscribers");
      const jobs = findFile(moduleDir, "jobs");
      const migrations = join(moduleDir, "migrations");
      const hasSchema = existsSync(migrations) && readdirSync(migrations).some((f) => f.toLowerCase().endsWith(".sql"));
      if (subscribers || jobs) found.push({ module: entry, subscribers, jobs, hasSchema });
    }
  }
  return found;
}

const modules = scanModules();

function bundledSource() {
  const lines = [];
  const items = [];
  modules.forEach((m, i) => {
    const parts = [`module: ${JSON.stringify(m.module)}`, `hasSchema: ${m.hasSchema === true}`];
    if (m.subscribers) {
      lines.push(`import s${i} from ${JSON.stringify(m.subscribers.replace(/\\/g, "/"))};`);
      parts.push(`subscribers: s${i}`);
    }
    if (m.jobs) {
      lines.push(`import j${i} from ${JSON.stringify(m.jobs.replace(/\\/g, "/"))};`);
      parts.push(`jobs: j${i}`);
    }
    items.push(`  { ${parts.join(", ")} },`);
  });
  return `${lines.join("\n")}\nexport const bundledModules = [\n${items.join("\n")}\n];\n`;
}

/** Câblage des ports entre modules (adaptateurs de plateforme de l'API) : embarqué dans le bundle s'il existe. */
const wiringFile = join(repoRoot, "apps", "api", "src", "platform", "adapters", "worker.ts");

function platformWiringSource(source) {
  if (!existsSync(wiringFile)) return source;
  const target = JSON.stringify(wiringFile.replace(/\\/g, "/"));
  return source.replace(
    "export const bundledPlatformWiring: PlatformWiring | undefined = undefined;",
    `import { installWorkerAdapters } from ${target};\nexport const bundledPlatformWiring: PlatformWiring | undefined = installWorkerAdapters as unknown as PlatformWiring;`,
  );
}

/** Remplace src/discovery/bundled.ts par la liste statique des modules découverts au build, et embarque le câblage des ports. */
const bundleModulesPlugin = {
  name: "bundle-modules",
  setup(b) {
    b.onLoad({ filter: /discovery[\\/]bundled\.ts$/ }, () => ({
      contents: bundledSource(),
      loader: "ts",
      resolveDir: root,
    }));
    b.onLoad({ filter: /discovery[\\/]platform-wiring\.ts$/ }, (args) => ({
      contents: platformWiringSource(readFileSync(args.path, "utf8")),
      loader: "ts",
      resolveDir: dirname(args.path),
    }));
  },
};

await build({
  entryPoints: {
    index: join(root, "src", "index.ts"),
    dlq: join(root, "src", "cli", "dlq.ts"),
  },
  outdir: process.env.WORKER_BUILD_OUTDIR ? resolve(process.env.WORKER_BUILD_OUTDIR) : join(root, "dist"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  // Dépendances optionnelles natives, absentes volontairement (chargées dans un try/catch).
  external: ["pg-native", "msgpackr-extract", "bufferutil", "utf-8-validate"],
  // Un module hors de apps/worker retrouve zod & co. dans les node_modules du worker.
  nodePaths: [join(root, "node_modules")],
  plugins: [bundleModulesPlugin],
});

console.log(`[build] câblage des ports entre modules : ${existsSync(wiringFile) ? "embarqué" : "(absent)"}`);
console.log(
  `[build] modules embarqués : ${modules.length === 0 ? "(aucun)" : modules.map((m) => `${m.module}[${[m.subscribers && "subscribers", m.jobs && "jobs"].filter(Boolean).join(",")}]`).join(" ")}`,
);
