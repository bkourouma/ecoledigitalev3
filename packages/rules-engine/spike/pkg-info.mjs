// Taille et dépendances (transitives comprises) des candidats du spike ADR-003.
import { readFileSync, readdirSync, statSync, realpathSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue; // les dépendances sont comptées séparément
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}

function resolveFrom(realDir, name) {
  // pnpm : les dépendances d'un paquet sont dans le dossier node_modules qui le contient
  const depth = name.startsWith('@') ? 2 : 1;
  let nm = realDir;
  for (let i = 0; i < depth; i++) nm = dirname(nm);
  const p = join(nm, ...name.split('/'));
  return existsSync(p) ? realpathSync(p) : undefined;
}

function closure(realDir, seen = new Map()) {
  if (seen.has(realDir)) return seen;
  const pkg = JSON.parse(readFileSync(join(realDir, 'package.json'), 'utf8'));
  seen.set(realDir, { name: pkg.name, version: pkg.version, size: dirSize(realDir) });
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const d = resolveFrom(realDir, dep);
    if (d) closure(d, seen);
  }
  return seen;
}

const candidates = ['jsonata', 'cel-js', '@marcbachmann/cel-js', '@bufbuild/cel', 'decimal.js', 'peggy'];
const rows = [];
for (const c of candidates) {
  const real = realpathSync(join('node_modules', c));
  const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
  const all = closure(real);
  const total = [...all.values()].reduce((s, x) => s + x.size, 0);
  rows.push({
    paquet: `${c}@${pkg.version}`,
    licence: pkg.license,
    modules: all.size,
    'taille_KiB (avec dépendances)': Math.round(total / 1024),
    'dépendances directes': Object.keys(pkg.dependencies ?? {}).join(', ') || '(aucune)',
  });
}
console.table(rows);
