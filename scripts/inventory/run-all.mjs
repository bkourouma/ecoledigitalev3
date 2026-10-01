#!/usr/bin/env node
// Régénère (ou vérifie, avec --check) tout docs/inventory/ dans le bon ordre.
//   node scripts/inventory/run-all.mjs
//   node scripts/inventory/run-all.mjs --check
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
const steps = ['build-tables-matrix.mjs', 'imhotep-deps.mjs', 'build-imhotep-doc.mjs', 'build-slice-dependents.mjs', 'build-readme.mjs'];

let failed = 0;
for (const s of steps) {
  const args = check ? [path.join(dir, s), '--check'] : [path.join(dir, s)];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error(`échec : ${s}`); }
}
process.exit(failed ? 1 : 0);
