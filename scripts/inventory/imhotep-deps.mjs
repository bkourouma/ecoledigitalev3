#!/usr/bin/env node
// Dépendances ENTRANTES vers Imhotep (formation professionnelle publique), pour la suppression (D7).
//   node scripts/inventory/build-tables-matrix.mjs    # prérequis (produit tables-usage-matrix.json)
//   node scripts/inventory/imhotep-deps.mjs           # écrit docs/inventory/imhotep-removal-inventory.json
//
// Sortie : pour chaque graine (IMHOTEP dans imhotep.config.mjs), qui, HORS des graines, en dépend :
//   - imports API / web (avec ligne) ;  - références SQL aux tables Imhotep (avec ligne) ;
//   - FK entrantes ;  - appels HTTP web vers les préfixes /api/v1 Imhotep ;  - symboles de contrats Zod ;
//   - dépendances npm exclusives à Imhotep ;  - fichiers d'infra / scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk, classifyFile } from './lib/code-scan.mjs';
import { IMHOTEP } from './imhotep.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixPath = path.join(root, 'docs/inventory/tables-usage-matrix.json');
if (!fs.existsSync(matrixPath)) {
  console.error('Lancer d\'abord : node scripts/inventory/build-tables-matrix.mjs');
  process.exit(2);
}
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------------------------------------------------------------- ensembles
const startsWithAny = (rel, list) => list.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
const isImhotep = (rel) =>
  startsWithAny(rel, IMHOTEP.api) ||
  startsWithAny(rel, IMHOTEP.webDirs) ||
  startsWithAny(rel, IMHOTEP.webFiles) ||
  rel.startsWith(IMHOTEP.publicApp) ||
  startsWithAny(rel, IMHOTEP.contracts) ||
  startsWithAny(rel, IMHOTEP.scriptsRoot);
const isShared = (rel) => startsWithAny(rel, IMHOTEP.apiShared) || startsWithAny(rel, IMHOTEP.webShared);

const allFiles = walk(root).filter((f) => !f.startsWith('scripts/inventory/'));
// walk() ignore les .md : on ajoute les fichiers non-code utiles
const extraDocs = ['scripts/IMHOTEP_DATA_MIGRATION_GUIDE.md', 'scripts/IMHOTEP_DATA_NEXT_STEPS.md', 'apps/web/scripts/README-test-formation-detail.md']
  .filter((f) => fs.existsSync(path.join(root, f)));
const files = [...new Set([...allFiles, ...extraDocs])].sort();

// ---------------------------------------------------------------- résolution d'imports
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const fileSet = new Set(files);
function resolveSpec(fromRel, spec) {
  let base;
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else if (spec.startsWith('@/')) base = 'apps/web/src/' + spec.slice(2);
  else if (spec.startsWith('@ecoledigitale/contracts')) base = 'packages/contracts/' + (spec === '@ecoledigitale/contracts' ? 'src/index' : spec.replace('@ecoledigitale/contracts/', ''));
  else if (spec.startsWith('@ecoledigitale/ui')) base = 'packages/ui/src/index';
  else if (spec.startsWith('@ecoledigitale/utils')) base = 'packages/utils/src/index';
  else return null;
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  const cands = [base, ...EXTS.map((e) => stripped + e), ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
  for (const c of cands) if (fileSet.has(c)) return c;
  return null;
}
const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const imports = new Map(); // rel -> [{to, line, spec}]
const texts = new Map();
for (const rel of files) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
  const text = read(rel);
  texts.set(rel, text);
  const list = [];
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    importRe.lastIndex = 0;
    for (const m of ln.matchAll(importRe)) {
      const to = resolveSpec(rel, m[1]);
      if (to) list.push({ to, line: i + 1, spec: m[1] });
    }
  });
  imports.set(rel, list);
}

const dirOf = (rel) => {
  const c = classifyFile(rel);
  return `${c.group}/${c.kind}`;
};

// ---------------------------------------------------------------- 1. imports entrants
const inboundImports = []; // {from, fromGroup, to, line, viaShared}
for (const [from, list] of imports) {
  if (isImhotep(from)) continue;
  for (const e of list) {
    if (!isImhotep(e.to)) continue;
    inboundImports.push({ from, from_kind: dirOf(from), from_is_shared_candidate: isShared(from), to: e.to, line: e.line, spec: e.spec });
  }
}

// ---------------------------------------------------------------- 2. tables Imhotep
const imTables = matrix.tables.filter((t) => t.domain === 'imhotep' && !t.name.endsWith('_aspci'));
const wordRe = (name) => new RegExp(String.raw`(?<![\w])${name}(?![\w])`);
const sqlCtx = (name) => new RegExp(String.raw`\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|ONLY|TRUNCATE|USING|EXISTS|LATERAL)\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?${name}"?(?![\w])|getTableName\(\s*[^,()]+,\s*['"\`]${name}['"\`]`);
const tableInbound = [];
for (const t of imTables) {
  const re = t.name.includes('_') ? wordRe(t.name) : sqlCtx(t.name);
  for (const [file] of t.refs) {
    if (isImhotep(file)) continue;
    const text = texts.get(file) || (fileSet.has(file) ? read(file) : '');
    const lines = [];
    text.split('\n').forEach((ln, i) => { if (re.test(ln)) lines.push(i + 1); });
    tableInbound.push({ table: t.name, file, kind: dirOf(file), shared_candidate: isShared(file), lines: lines.slice(0, 12), count: lines.length });
  }
}

// FK entrantes / sortantes
const imNames = new Set(imTables.map((t) => t.name));
const allByName = new Map(matrix.tables.map((t) => [t.name, t]));
const fkIn = [];
const fkOut = [];
for (const t of imTables) {
  for (const f of t.fk_in) if (!imNames.has(f) && !f.endsWith('_aspci')) fkIn.push({ table: t.name, referenced_by: f, referencing_domain: allByName.get(f)?.domain });
  for (const f of t.fk_out) if (!imNames.has(f) && f !== 'tenants') fkOut.push({ table: t.name, references: f, target_domain: allByName.get(f)?.domain });
}

// ---------------------------------------------------------------- 3. appels HTTP web -> préfixes
const prefixRe = (p) => new RegExp(String.raw`/api/v1${p.replace(/\//g, '\\/')}(?![\w-])`);
const httpInbound = [];
for (const rel of files) {
  if (isImhotep(rel)) continue;
  const c = classifyFile(rel);
  if (c.group !== 'web' && c.group !== 'packages') continue;
  const text = texts.get(rel);
  if (!text) continue;
  const hits = [];
  text.split('\n').forEach((ln, i) => {
    for (const p of [...IMHOTEP.apiPrefixes, ...IMHOTEP.apiSharedPrefixes]) if (prefixRe(p).test(ln)) hits.push({ line: i + 1, prefix: p });
  });
  if (hits.length) httpInbound.push({ file: rel, kind: dirOf(rel), shared_candidate: isShared(rel), hits: hits.slice(0, 8), count: hits.length });
}

// ---------------------------------------------------------------- 4. symboles de contrats
const contractFiles = files.filter((f) => startsWithAny(f, IMHOTEP.contracts));
const symbols = new Map();
for (const f of contractFiles) {
  const t = texts.get(f) || '';
  for (const m of t.matchAll(/export\s+(?:declare\s+)?(?:const|let|type|interface|function|enum|class)\s+([A-Za-z_][\w]*)/g)) symbols.set(m[1], f);
}
// symboles exportés AUSSI par un fichier de contrat non-Imhotep : collision de noms, ignorés
const otherContractExports = new Set();
for (const f of files.filter((x) => x.startsWith('packages/contracts/src/') && !startsWithAny(x, IMHOTEP.contracts))) {
  const t = texts.get(f) || '';
  for (const m of t.matchAll(/export\s+(?:declare\s+)?(?:const|let|type|interface|function|enum|class)\s+([A-Za-z_][\w]*)/g)) otherContractExports.add(m[1]);
}
const symbolInbound = new Map(); // file -> Set(symbol) ; détection par import nommé depuis @ecoledigitale/contracts
for (const [rel, text] of texts) {
  if (isImhotep(rel)) continue;
  if (rel.startsWith('packages/contracts/src/index.ts')) continue;
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](@ecoledigitale\/contracts[^'"]*|\.[^'"]*)['"]/g)) {
    const resolved = resolveSpec(rel, m[2]);
    const fromImhotepFile = resolved && startsWithAny(resolved, IMHOTEP.contracts);
    const viaRoot = m[2] === '@ecoledigitale/contracts';
    if (!fromImhotepFile && !viaRoot) continue;
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (!symbols.has(name)) continue;
      if (viaRoot && otherContractExports.has(name)) continue; // ambigu : défini aussi hors Imhotep
      if (!symbolInbound.has(rel)) symbolInbound.set(rel, new Set());
      symbolInbound.get(rel).add(name);
    }
  }
}
const contractsInbound = [...symbolInbound.entries()]
  .filter(([rel]) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
  .map(([file, set]) => ({ file, kind: dirOf(file), shared_candidate: isShared(file), symbols: [...set].sort().slice(0, 10), count: set.size }))
  .sort((a, b) => (a.file < b.file ? -1 : 1));

// ---------------------------------------------------------------- 5. dépendances npm
function npmUsage(pkgRel, scopePrefixes) {
  const pkg = JSON.parse(read(pkgRel));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const out = [];
  for (const dep of Object.keys(deps).sort()) {
    const re = new RegExp(String.raw`(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]${dep.replace(/[/@.]/g, '\\$&')}(?:/[^'"]*)?['"]`);
    const importers = [];
    for (const [rel, text] of texts) {
      if (!scopePrefixes.some((p) => rel.startsWith(p))) continue;
      if (re.test(text)) importers.push(rel);
    }
    const im = importers.filter((f) => isImhotep(f));
    const other = importers.filter((f) => !isImhotep(f));
    out.push({ dep, dev: !!(pkg.devDependencies || {})[dep], importers: importers.length, imhotep_importers: im.length, other_importers: other.length, other_sample: other.slice(0, 4), imhotep_sample: im.slice(0, 3) });
  }
  return out;
}
const npm = {
  'apps/api/package.json': npmUsage('apps/api/package.json', ['apps/api/']),
  'apps/web/package.json': npmUsage('apps/web/package.json', ['apps/web/']),
  'apps/formation-pro-public/package.json': npmUsage('apps/formation-pro-public/package.json', ['apps/formation-pro-public/']),
};

// ---------------------------------------------------------------- 6. non-source (infra, workflows, scripts, docs)
const nonSourceRe = /formation-pro|formation_pro|formation-public|imhotep|prisma|livekit|twilio|payhubsecure|nextauth/i;
const nonSourceFiles = [
  'package.json', 'pnpm-workspace.yaml', 'infra/compose/docker-compose.yml', 'infra/compose/Dockerfile.api', 'infra/compose/Dockerfile.web',
  'infra/compose/Dockerfile.formation-pro-public', 'infra/nginx/formation-pro.conf', 'infra/nginx/ecoledigitale.conf', 'infra/nginx/ecoledigitale-staging.conf',
  'infra/scripts/deploy.sh', 'infra/scripts/bootstrap-server.md', 'infra/scripts/bootstrap-staging-server.md', 'infra/.env.example', '.github/workflows/deploy.yml',
  'apps/api/ENV_EXAMPLE.md', 'apps/web/ENV_EXAMPLE.md', 'apps/api/package.json', 'apps/web/package.json',
].filter((f) => fs.existsSync(path.join(root, f)));
const nonSource = nonSourceFiles.map((f) => {
  const hits = [];
  read(f).split('\n').forEach((ln, i) => { if (nonSourceRe.test(ln)) hits.push({ line: i + 1, text: ln.trim().slice(0, 140).replace(/:\/\/[^\s:@\/"'\\]+:[^\s@"'\\]+@/g, '://<masqué>@').replace(/(password|secret|token|key)\s*[:=]\s*\S+/gi, '$1=<masqué>') }); });
  return { file: f, hits: hits.slice(0, 14), count: hits.length };
}).filter((x) => x.count);

// ---------------------------------------------------------------- 7. inventaire des graines
const lineCount = (rel) => (fs.existsSync(path.join(root, rel)) ? read(rel).split('\n').length : 0);
const seeds = files.filter((f) => isImhotep(f));
const inboundTo = new Map();
for (const e of inboundImports) {
  if (!inboundTo.has(e.to)) inboundTo.set(e.to, []);
  inboundTo.get(e.to).push(e);
}
const seedReport = seeds.map((rel) => ({
  file: rel,
  kind: dirOf(rel),
  lines: lineCount(rel),
  inbound_imports: (inboundTo.get(rel) || []).map((e) => `${e.from}:${e.line}`),
}));

const sharedReport = files.filter((f) => isShared(f)).map((rel) => {
  const imps = [];
  for (const [from, list] of imports) for (const e of list) if (e.to === rel) imps.push({ from, line: e.line, from_is_imhotep: isImhotep(from) });
  return { file: rel, kind: dirOf(rel), lines: lineCount(rel), importers_imhotep: imps.filter((x) => x.from_is_imhotep).map((x) => `${x.from}:${x.line}`), importers_other: imps.filter((x) => !x.from_is_imhotep).map((x) => `${x.from}:${x.line}`) };
});

// ---------------------------------------------------------------- 8. fermeture : fichiers dont TOUS les importeurs sont dans les graines
// (candidats « A par transitivité » : helpers qui deviennent orphelins après suppression)
const importersOf = new Map();
for (const [from, list] of imports) for (const e of list) {
  if (!importersOf.has(e.to)) importersOf.set(e.to, new Set());
  importersOf.get(e.to).add(from);
}
const inSet = new Set(seeds);
const closure = [];
let grew = true;
while (grew) {
  grew = false;
  for (const [file, imps] of importersOf) {
    if (inSet.has(file) || isShared(file)) continue;
    if (!/^apps\/(api|web)\/|^packages\//.test(file)) continue;
    if (file.endsWith('/index.ts') && file.startsWith('packages/')) continue;
    if ([...imps].every((i) => inSet.has(i))) {
      inSet.add(file);
      closure.push({ file, kind: dirOf(file), lines: lineCount(file), imported_only_by: [...imps].slice(0, 4) });
      grew = true;
    }
  }
}
// fichiers jamais importés (orphelins) parmi ceux référençant Imhotep
const closureOut = closure.sort((a, b) => (a.file < b.file ? -1 : 1));

const byGroup = {};
for (const s of seedReport) byGroup[s.kind.split('/')[0]] = (byGroup[s.kind.split('/')[0]] || 0) + 1;
const out = {
  generated_by: 'scripts/inventory/imhotep-deps.mjs',
  note: 'Fichier généré. Graines et partagés : scripts/inventory/imhotep.config.mjs.',
  seed_files: { total: seedReport.length, by_group: byGroup, lines_total: seedReport.reduce((a, s) => a + s.lines, 0) },
  seeds: seedReport,
  shared_candidates: sharedReport,
  closure_candidates_only_imported_by_imhotep: closureOut,
  inbound_imports: inboundImports,
  imhotep_tables: imTables.map((t) => ({ name: t.name, status: t.status, tenant_id: t.tenant_id, fk_in_from_core: t.fk_in.filter((x) => !imNames.has(x)), core_files_referencing: t.refs.filter(([f]) => !isImhotep(f)).length })),
  inbound_table_references: tableInbound,
  fk_inbound_from_core: fkIn,
  fk_outbound_to_core: fkOut,
  inbound_http_calls: httpInbound,
  inbound_contract_symbols: contractsInbound,
  npm,
  non_source: nonSource,
};
const outPath = path.join(root, 'docs/inventory/imhotep-removal-inventory.json');
const outText = JSON.stringify(out, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, "\n") !== outText) { console.error('DIVERGENCE: imhotep-removal-inventory.json'); process.exit(1); }
  process.exit(0);
}
fs.writeFileSync(outPath, outText);
console.log(`graines: ${seedReport.length} fichiers (${JSON.stringify(byGroup)}), imports entrants: ${inboundImports.length}, refs tables entrantes: ${tableInbound.length}, appels HTTP entrants: ${httpInbound.length}`);
