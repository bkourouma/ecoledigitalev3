// Recherche des références aux noms de tables dans le code (SQL brut compris).
//
// Règle de comptage (voir README) :
//  - nom de table contenant "_"  : toute occurrence en mot entier compte ("forte").
//  - nom d'un seul mot (users, classes, documents...) : seules comptent les occurrences
//    en contexte SQL (FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|... <nom>) ou via
//    getTableName(<tenant>, '<nom>'). Les autres occurrences sont "faibles" (comptées à part).
import fs from 'node:fs';
import path from 'node:path';
import { SCAN } from '../inventory.config.mjs';

export function walk(root, dir = '', out = []) {
  const abs = path.join(root, dir);
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (SCAN.ignoreDirs.has(ent.name)) continue;
      if (SCAN.ignorePrefixes.some((p) => (rel + '/').startsWith(p))) continue;
      walk(root, rel, out);
    } else if (ent.isFile()) {
      if (!SCAN.extensions.includes(path.extname(ent.name))) continue;
      if (ent.name.endsWith('.d.ts')) continue;
      if (SCAN.ignorePrefixes.some((p) => rel.startsWith(p))) continue;
      out.push(rel);
    }
  }
  return out;
}

/** Classe un fichier : groupe (api|web|public|packages|repo-scripts|tests-root|other) et nature. */
export function classifyFile(rel) {
  const isTest = /(^|\/)(__tests__|tests?|e2e)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
  if (rel.startsWith('apps/api/')) {
    if (rel.startsWith('apps/api/scripts/')) return { group: 'api', kind: 'script' };
    if (isTest || rel.startsWith('apps/api/tests/')) return { group: 'api', kind: 'test' };
    const m = /^apps\/api\/src\/([^/]+)/.exec(rel);
    const d = m ? m[1] : 'root';
    const kind = { routes: 'route', services: 'service', jobs: 'job', plugins: 'middleware', middleware: 'middleware', middlewares: 'middleware', utils: 'util', schemas: 'schema', types: 'type' }[d] || 'bootstrap';
    return { group: 'api', kind };
  }
  if (rel.startsWith('apps/web/')) {
    if (rel.startsWith('apps/web/scripts/')) return { group: 'web', kind: 'script' };
    if (isTest) return { group: 'web', kind: 'test' };
    const m = /^apps\/web\/src\/([^/]+)/.exec(rel);
    const d = m ? m[1] : 'root';
    if (d === 'app') return { group: 'web', kind: /\/(page|layout|loading|error|not-found)\.[tj]sx?$/.test(rel) ? 'page' : /\/route\.[tj]s$/.test(rel) ? 'route-handler' : 'app-other' };
    const kind = { hooks: 'hook', lib: 'lib', components: 'component', contexts: 'context', data: 'data', teacher: 'teacher', styles: 'style' }[d] || (rel === 'apps/web/middleware.ts' ? 'middleware' : 'other');
    return { group: 'web', kind };
  }
  if (rel.startsWith('apps/formation-pro-public/')) return { group: 'public', kind: isTest ? 'test' : 'source' };
  if (rel.startsWith('packages/')) return { group: 'packages', kind: isTest ? 'test' : 'source' };
  if (rel.startsWith('scripts/') || rel.startsWith('infra/scripts/')) return { group: 'repo-scripts', kind: 'script' };
  if (rel.startsWith('tests/')) return { group: 'tests-root', kind: 'test' };
  return { group: 'other', kind: 'other' };
}

/** Un fichier "runtime" = ni test ni script. */
export const isRuntime = (c) => c.kind !== 'test' && c.kind !== 'script';

// Mots-clés SQL en MAJUSCULES uniquement (le SQL du dépôt est en majuscules ; en minuscules
// on ramasserait des phrases anglaises : "extract content from documents").
const SQL_CTX = (name) =>
  new RegExp(String.raw`\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|ONLY|TRUNCATE|USING|EXISTS|LATERAL)\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?${name}"?(?![\w])`, 'g');
const GETTABLE = (name) => new RegExp(String.raw`getTableName\(\s*[^,()]+,\s*['"\`]${name}['"\`]`, 'g');

/**
 * @param root racine du dépôt
 * @param tableNames Set de noms de tables
 * @returns { files: [{rel, group, kind}], refs: Map<table, Map<rel, {strong, weak}>> , undefinedSql: Map<name, Map<rel,count>>, runtimeDdl: [] }
 */
export function scanCode(root, tableNames) {
  const files = walk(root).sort();
  const multi = [];
  const single = [];
  for (const t of tableNames) (t.includes('_') ? multi : single).push(t);
  const multiSet = new Set(multi);
  const singleRe = new Map(single.map((t) => [t, { sql: SQL_CTX(t), gt: GETTABLE(t) }]));
  const singleSet = new Set(single);

  const refs = new Map();
  const add = (t, rel, strong, weak) => {
    if (!refs.has(t)) refs.set(t, new Map());
    const m = refs.get(t);
    const cur = m.get(rel) || { strong: 0, weak: 0 };
    cur.strong += strong;
    cur.weak += weak;
    m.set(rel, cur);
  };

  const undefinedSql = new Map();
  const cteNames = new Set(); // noms définis par WITH ... AS ( : ne sont pas des tables
  const runtimeDdl = [];
  const reAnySql = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:"?public"?\s*\.\s*)?"?([a-z][a-z0-9_]*)"?(?=[\s,;)`'"]|$)/g;
  const reDdl = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\s*\.\s*)?"?([a-z][a-z0-9_]*)"?\s*\(/gi;

  const scanned = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > SCAN.maxFileBytes) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const cls = classifyFile(rel);
    scanned.push({ rel, ...cls });

    // identifiants
    const counts = new Map();
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const w = m[0];
      if (w.length < 3) continue;
      const lw = w === w.toLowerCase() ? w : null;
      if (lw && (multiSet.has(lw) || singleSet.has(lw))) counts.set(lw, (counts.get(lw) || 0) + 1);
    }
    for (const [w, c] of counts) {
      if (multiSet.has(w)) add(w, rel, c, 0);
      else {
        const re = singleRe.get(w);
        re.sql.lastIndex = 0; re.gt.lastIndex = 0;
        const strong = (text.match(re.sql) || []).length + (text.match(re.gt) || []).length;
        add(w, rel, strong, Math.max(0, c - strong));
      }
    }
    for (const m of text.matchAll(/\b([a-z_][a-z0-9_]*)\s+AS\s*(?:MATERIALIZED\s*)?\(/g)) cteNames.add(m[1]);
    // noms non définis référencés en SQL (hors tests/scripts pour limiter le bruit)
    if (cls.kind !== 'test') {
      for (const m of text.matchAll(reAnySql)) {
        const n = m[1];
        if (tableNames.has(n)) continue;
        if (!undefinedSql.has(n)) undefinedSql.set(n, new Map());
        const mm = undefinedSql.get(n);
        mm.set(rel, (mm.get(rel) || 0) + 1);
      }
    }
    // DDL exécuté depuis le code
    if (cls.kind !== 'test' && /CREATE\s+TABLE/i.test(text)) {
      for (const m of text.matchAll(reDdl)) {
        runtimeDdl.push({ table: m[1].toLowerCase(), file: rel, index: m.index, text: text.slice(m.index, m.index + 6000) });
      }
    }
  }
  for (const n of [...undefinedSql.keys()]) if (cteNames.has(n) || n.startsWith('pg_')) undefinedSql.delete(n);
  return { files: scanned, refs, undefinedSql, runtimeDdl };
}
