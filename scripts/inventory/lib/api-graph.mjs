// Graphe d'imports de l'API + table des préfixes de routes, pour relier
//   table -> fichiers API qui la lisent -> routes (points d'entrée HTTP) -> préfixe /api/v1/... -> fichiers web qui l'appellent.
// Approximation volontaire (sur-estimation possible) : sert à dimensionner, pas à prouver.
import fs from 'node:fs';
import path from 'node:path';

const EXTS = ['.ts', '.tsx', '.js', '.mjs'];

function resolveImport(root, fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  const cands = [base, ...EXTS.map((e) => stripped + e), ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
  for (const c of cands) {
    const abs = path.join(root, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
  }
  return null;
}

/** imports[file] = Set<file> pour les fichiers apps/api/src (hors tests). */
export function buildImportGraph(root, apiFiles) {
  const importsOf = new Map();
  const importedBy = new Map();
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  for (const rel of apiFiles) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const set = new Set();
    for (const m of text.matchAll(re)) {
      const r = resolveImport(root, rel, m[1]);
      if (r) set.add(r);
    }
    importsOf.set(rel, set);
    for (const t of set) {
      if (!importedBy.has(t)) importedBy.set(t, new Set());
      importedBy.get(t).add(rel);
    }
  }
  return { importsOf, importedBy };
}

/** Lit apps/api/src/index.ts : variable de route -> fichier, et prefix(s). */
export function readRoutePrefixes(root) {
  const idx = 'apps/api/src/index.ts';
  // lignes commentées retirées (ex. `// await fastify.register(studentDashboardRoutes...)`)
  const text = fs.readFileSync(path.join(root, idx), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const varToFile = new Map();
  for (const m of text.matchAll(/import\s+(?:\{\s*)?(?:default\s+as\s+)?(\w+)(?:\s*\})?\s+from\s+['"](\.\/(?:routes|webhooks)[^'"]*)['"]/g)) {
    const f = resolveImport(root, idx, m[2]);
    if (f) varToFile.set(m[1], f);
  }
  // import { x as y } ou import { x }
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.\/routes[^'"]*)['"]/g)) {
    const f = resolveImport(root, idx, m[2]);
    if (!f) continue;
    for (const part of m[1].split(',')) {
      const mm = /(?:(\w+)\s+as\s+)?(\w+)/.exec(part.trim());
      if (mm) varToFile.set(mm[2], f);
    }
  }
  const prefixes = new Map(); // file -> Set<prefix>
  for (const m of text.matchAll(/register\(\s*(\w+)\s*(?:,\s*\{([^}]*)\})?\s*\)/g)) {
    const f = varToFile.get(m[1]);
    if (!f) continue;
    const pm = m[2] ? /prefix:\s*["'`]([^"'`]+)["'`]/.exec(m[2]) : null;
    if (!prefixes.has(f)) prefixes.set(f, new Set());
    prefixes.get(f).add(pm ? pm[1] : '');
  }
  return prefixes;
}

/** Fichiers (routes enregistrées) qui atteignent, par imports, un des fichiers `direct`. */
export function entryPointsFor(direct, graph, routePrefixes, jobFiles) {
  const seen = new Set(direct);
  const queue = [...direct];
  while (queue.length) {
    const f = queue.pop();
    for (const imp of graph.importedBy.get(f) || []) {
      if (imp === 'apps/api/src/index.ts') continue;
      if (seen.has(imp)) continue;
      seen.add(imp);
      queue.push(imp);
    }
  }
  const routes = [...seen].filter((f) => routePrefixes.has(f)).sort();
  const jobs = [...seen].filter((f) => jobFiles.has(f)).sort();
  return { routes, jobs, reached: seen.size };
}

/** Fichiers web qui contiennent '/api/v1/<prefix>' (borné par un segment). */
export function buildWebPrefixIndex(root, webFiles) {
  const idx = new Map(); // prefix(après /api/v1) -> Set<file>
  const re = /\/api\/v1((?:\/[A-Za-z0-9_-]+)*)/g;
  for (const rel of webFiles) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const seen = new Set();
    for (const m of text.matchAll(re)) {
      const segs = m[1].split('/').filter(Boolean);
      // on indexe tous les préfixes de segments : /a, /a/b, /a/b/c
      for (let i = 1; i <= segs.length; i++) seen.add('/' + segs.slice(0, i).join('/'));
    }
    for (const p of seen) {
      if (!idx.has(p)) idx.set(p, new Set());
      idx.get(p).add(rel);
    }
  }
  return idx;
}
