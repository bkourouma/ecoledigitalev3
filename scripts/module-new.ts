#!/usr/bin/env tsx
/**
 * pnpm module:new <key> [--range 1600]
 *
 * Crée le squelette d'un module backend sous apps/api/src/modules/<key>/ conforme au contrat d'assemblage
 * (docs/architecture/module-conventions.md, platform-assembly.md) : manifest, index, migration dans la plage
 * réservée, domain, application, infrastructure, http (plugin `(app, runtime)`), subscribers.ts, jobs.ts,
 * tests unitaires + intégration, README, et modules/isolation-allowlist.<key>.ts. Ajoute la plage au tableau de
 * module-conventions.md. Le module est découvert automatiquement par le registre : aucun fichier central à
 * modifier. Pas à pas : docs/architecture/new-module-guide.md.
 */
import { MODULE_NEW_USAGE, ScaffoldError, parseModuleNewArgs, scaffoldModule } from "../apps/api/src/platform/module-scaffold";

function main(): number {
  try {
    const { key, range } = parseModuleNewArgs(process.argv.slice(2));
    const result = scaffoldModule({ key, ...(range !== undefined ? { range } : {}) });
    const pad = (n: number): string => String(n).padStart(4, "0");
    console.log(`Module "${key}" créé : ${result.dir}`);
    for (const f of result.files) console.log(`  + ${f}`);
    for (const f of result.rootFiles) console.log(`  + ../${f}`);
    console.log(`Plage de migrations : ${pad(result.range.start)}-${pad(result.range.end)}`);
    if (result.conventionsUpdated) console.log(`Tableau des plages mis à jour : ${result.conventionsUpdated}`);
    for (const w of result.warnings) console.warn(`Attention : ${w}`);
    console.log("");
    console.log("Étapes suivantes (détail : docs/architecture/new-module-guide.md) :");
    console.log(`  1. adapter manifest.ts (packs, dependsOn, permissions, features, menus, événements), remplacer l'entité d'exemple "item" ;`);
    console.log(`  2. écrire les migrations dans la plage ${pad(result.range.start)}-${pad(result.range.end)} (jamais de modification d'un fichier appliqué) ;`);
    console.log(`  3. pnpm check:boundaries            (frontières entre modules) ;`);
    console.log(`  4. pnpm --filter @ecoledigitale/api type-check:v2   (tsc) ;`);
    console.log(`  5. pnpm --filter @ecoledigitale/api exec vitest run src/modules/${key}   (tests du module) ;`);
    console.log(`  6. pnpm test:isolation              (RLS : base éphémère dans Docker) ;`);
    console.log(`  7. pnpm --filter @ecoledigitale/worker build   (si vous ajoutez des abonnés ou des jobs).`);
    return 0;
  } catch (e) {
    if (e instanceof ScaffoldError) {
      console.error(e.message === MODULE_NEW_USAGE || e.message.includes(MODULE_NEW_USAGE) ? e.message : `Refusé : ${e.message}`);
      return e.message.includes("Usage") ? 2 : 1;
    }
    throw e;
  }
}

process.exit(main());
