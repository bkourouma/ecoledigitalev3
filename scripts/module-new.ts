#!/usr/bin/env tsx
/**
 * pnpm module:new <key>
 *
 * Crée le squelette d'un module backend sous apps/api/src/modules/<key>/ conforme à
 * docs/architecture/module-conventions.md (manifest, index, migrations/0001, domain,
 * application, infrastructure, http, test). Le module est découvert automatiquement par le
 * registre : aucun fichier central à modifier.
 */
import { ScaffoldError, scaffoldModule } from "../apps/api/src/platform/module-scaffold";

const USAGE = "Usage : pnpm module:new <cle>   (minuscules, chiffres et _ ; ex. pnpm module:new finance)";

function main(): number {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const key = argv[0];
  if (!key || argv.length !== 1 || key.startsWith("-")) {
    console.error(USAGE);
    return 2;
  }
  try {
    const { dir, files } = scaffoldModule({ key });
    console.log(`Module "${key}" créé : ${dir}`);
    for (const f of files) console.log(`  + ${f}`);
    console.log("");
    console.log("Étapes suivantes :");
    console.log(`  1. adapter manifest.ts (packs, dependsOn, permissions, menus, événements) et la migration 0001 ;`);
    console.log(`  2. pnpm check:boundaries            (frontières entre modules) ;`);
    console.log(`  3. pnpm db:v2:migrate               (applique la baseline puis les migrations des modules) ;`);
    console.log(`  4. pnpm test:isolation              (RLS : table hors liste blanche => tenant_id + RLS forcée) ;`);
    console.log(`  5. pnpm --filter @ecoledigitale/api test:v2.`);
    return 0;
  } catch (e) {
    if (e instanceof ScaffoldError) {
      console.error(`Refusé : ${e.message}`);
      return 1;
    }
    throw e;
  }
}

process.exit(main());
