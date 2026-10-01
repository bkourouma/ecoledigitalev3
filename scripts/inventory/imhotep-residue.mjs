#!/usr/bin/env node
// Test de fin d'étape pour la suppression d'Imhotep : compte les résidus (motifs Imhotep) hors
// archives. À lancer après chaque étape de l'ordre de suppression ; un groupe doit tomber à 0
// quand l'étape qui le concerne est terminée.
//
//   node scripts/inventory/imhotep-residue.mjs                    # tous les groupes, résumé
//   node scripts/inventory/imhotep-residue.mjs --group tables     # un groupe, avec le détail fichier:ligne
//   node scripts/inventory/imhotep-residue.mjs --group tables --expect 0   # code retour 1 si != 0
//   node scripts/inventory/imhotep-residue.mjs --list              # liste les groupes
//
// Lecture seule. Aucune dépendance. Le portail apps/formation-pro-public est exclu tant qu'il existe
// (il est lui-même le sujet de la suppression) : voir --include-public.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESIDUE_GROUPS, RESIDUE_SCAN_ROOTS, RESIDUE_IGNORE, IMHOTEP } from './imhotep.config.mjs';
import { SCAN } from './inventory.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const group = opt('--group');
const expect = opt('--expect');
const includePublic = args.includes('--include-public');

if (args.includes('--list')) {
  for (const [k, g] of Object.entries(RESIDUE_GROUPS)) console.log(`${k.padEnd(16)} ${g.why}`);
  process.exit(0);
}

const exts = new Set([...SCAN.extensions, '.json', '.yml', '.yaml', '.conf', '.sh', '.example']);
function* walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isFile()) { yield rel; return; }
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${ent.name}`;
    if (ent.isDirectory()) {
      if (SCAN.ignoreDirs.has(ent.name)) continue;
      yield* walk(r);
    } else yield r;
  }
}
const isIgnored = (rel) => RESIDUE_IGNORE.some((p) => rel.startsWith(p)) || (!includePublic && rel.startsWith(IMHOTEP.publicApp));
const wanted = (rel) => exts.has(path.extname(rel)) || /(^|\/)\.env\.example$/.test(rel) || rel.endsWith('.sh') || rel.endsWith('.conf');

const groups = group ? { [group]: RESIDUE_GROUPS[group] } : RESIDUE_GROUPS;
if (group && !RESIDUE_GROUPS[group]) { console.error(`groupe inconnu : ${group}`); process.exit(2); }

const hits = Object.fromEntries(Object.keys(groups).map((k) => [k, []]));
for (const r of RESIDUE_SCAN_ROOTS) for (const rel of walk(r)) {
  if (isIgnored(rel) || !wanted(rel)) continue;
  let text;
  try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (const [k, g] of Object.entries(groups)) {
    lines.forEach((ln, i) => { if (g.re.test(ln)) hits[k].push(`${rel}:${i + 1}`); });
  }
}

let total = 0;
for (const [k, list] of Object.entries(hits)) {
  const files = new Set(list.map((x) => x.split(':')[0]));
  console.log(`${k.padEnd(16)} ${String(list.length).padStart(5)} occurrences dans ${String(files.size).padStart(4)} fichiers  — ${groups[k].why}`);
  if (group) for (const h of list.slice(0, 200)) console.log('   ' + h);
  total += list.length;
}
if (expect !== null) process.exit(total === Number(expect) ? 0 : 1);
