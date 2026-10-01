#!/usr/bin/env node
// Génère docs/inventory/tables-usage-matrix.{json,md} (tâche 0.6 du plan).
//
//   node scripts/inventory/build-tables-matrix.mjs            # écrit dans docs/inventory/
//   node scripts/inventory/build-tables-matrix.mjs --check    # n'écrit rien, échoue si les fichiers divergent
//
// Lecture seule sur le code applicatif ; aucune connexion à une base de données.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from './lib/tables-state.mjs';
import { scanCode, isRuntime } from './lib/code-scan.mjs';
import { parseCreateBody, matchParen } from './lib/sql-parse.mjs';
import { buildImportGraph, readRoutePrefixes, entryPointsFor, buildWebPrefixIndex } from './lib/api-graph.mjs';
import { TABLE_RULES, OVERRIDES, FALLBACK, DOMAINS } from './inventory.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'docs/inventory');
const check = process.argv.includes('--check');

// ------------------------------------------------------------------ 1. schéma
const st = buildState(root);

const rows = new Map(); // name -> row
const ensure = (name) => {
  if (!rows.has(name)) rows.set(name, { name, sources: {} });
  return rows.get(name);
};

for (const [name, t] of st.infra.tables) ensure(name).sources.infra = t;
for (const [name, t] of st.prisma.tables) ensure(name).sources.prismaMig = t;
for (const m of st.prismaModels) ensure(m.table).sources.prismaModel = m;

// Tables citées dans les scripts de rollback sans CREATE dans le dépôt
const rollbackRefs = new Map();
for (const [file, tabs] of Object.entries(st.rollbackDrops)) for (const t of tabs) {
  if (!rollbackRefs.has(t)) rollbackRefs.set(t, []);
  rollbackRefs.get(t).push(file);
}
for (const [t, files] of rollbackRefs) if (!rows.has(t)) ensure(t).sources.rollbackOnly = files;

// ------------------------------------------------------------------ 2. code
const knownNames = new Set(rows.keys());
const scan = scanCode(root, knownNames);

// DDL exécuté depuis le code : annote les tables connues, ajoute les inconnues
const runtimeDdlByTable = new Map();
for (const d of scan.runtimeDdl) {
  const open = d.text.indexOf('(');
  const close = open >= 0 ? matchParen(d.text, open) : -1;
  const parsed = close > open ? parseCreateBody(d.text.slice(open + 1, close)) : { columns: [], fks: [] };
  if (!runtimeDdlByTable.has(d.table)) runtimeDdlByTable.set(d.table, []);
  runtimeDdlByTable.get(d.table).push({ file: d.file, parsed });
}
const newFromDdl = [...runtimeDdlByTable.keys()].filter((t) => !rows.has(t));
for (const [t, list] of runtimeDdlByTable) ensure(t).sources.runtimeDdl = list;
// 2e passe : les tables découvertes via DDL runtime doivent aussi être comptées
let scan2 = scan;
if (newFromDdl.length) scan2 = scanCode(root, new Set(rows.keys()));

// ------------------------------------------------------------------ 3. lignes finales
const classify = (name) => {
  if (OVERRIDES[name]) return OVERRIDES[name];
  for (const [re, domain, mod, slice] of TABLE_RULES) if (re.test(name)) return [domain, mod, slice];
  return FALLBACK;
};

const topN = (m, pred, n = 5) =>
  [...m.entries()]
    .filter(([rel]) => pred(scan2.fileMap.get(rel)))
    .map(([file, v]) => ({ file, count: v.strong }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || (a.file < b.file ? -1 : 1))
    .slice(0, n);

scan2.fileMap = new Map(scan2.files.map((f) => [f.rel, f]));

// --- graphe API (imports) et index web des préfixes /api/v1/...
const apiSrcRuntime = scan2.files.filter((f) => f.group === 'api' && isRuntime(f) && f.rel.startsWith('apps/api/src/')).map((f) => f.rel);
const graph = buildImportGraph(root, apiSrcRuntime);
const routePrefixes = readRoutePrefixes(root);
const jobFiles = new Set(apiSrcRuntime.filter((f) => f.startsWith('apps/api/src/jobs/')));
const webRuntimeFiles = scan2.files.filter((f) => f.group === 'web' && isRuntime(f) && f.rel !== 'apps/web/next.config.js').map((f) => f.rel); // next.config.js : réécritures génériques, pas un appelant
const publicFiles = scan2.files.filter((f) => f.group === 'public').map((f) => f.rel);
const webPrefixIdx = buildWebPrefixIndex(root, webRuntimeFiles);
const pubPrefixIdx = buildWebPrefixIndex(root, publicFiles);

function viaApi(name) {
  const refs = scan2.refs.get(name) || new Map();
  const direct = [...refs.entries()]
    .filter(([rel, v]) => v.strong > 0 && apiSrcRuntime.includes(rel))
    .map(([rel]) => rel);
  const ep = entryPointsFor(direct, graph, routePrefixes, jobFiles);
  const keys = new Set();
  for (const r of ep.routes) for (const p of routePrefixes.get(r)) {
    const k = p.replace(/^\/api\/v1/, '');
    if (k) keys.add(k);
  }
  const collect = (idx) => {
    const hit = new Map();
    for (const k of keys) for (const f of idx.get(k) || []) hit.set(f, (hit.get(f) || 0) + 1);
    return hit;
  };
  const webHit = collect(webPrefixIdx);
  const pubHit = collect(pubPrefixIdx);
  const sum = (hit, getKind) => {
    const byKind = {};
    for (const f of hit.keys()) { const k = getKind(f); byKind[k] = (byKind[k] || 0) + 1; }
    return byKind;
  };
  const top = (hit) => [...hit.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([file, count]) => ({ file, count }));
  return {
    entry_routes: ep.routes,
    entry_jobs: ep.jobs,
    prefixes: [...keys].sort(),
    web: { files: webHit.size, by_kind: sum(webHit, (f) => scan2.fileMap.get(f).kind), top5: top(webHit) },
    public_portal: { files: pubHit.size, top5: top(pubHit) },
  };
}

function usageFor(name) {
  const refs = scan2.refs.get(name) || new Map();
  const bucket = (pred) => {
    const list = [...refs.entries()].filter(([rel, v]) => v.strong > 0 && pred(scan2.fileMap.get(rel)));
    const byKind = {};
    let occ = 0;
    for (const [rel, v] of list) {
      const k = scan2.fileMap.get(rel).kind;
      byKind[k] = (byKind[k] || 0) + 1;
      occ += v.strong;
    }
    return { files: list.length, occurrences: occ, by_kind: byKind, top5: topN(refs, pred) };
  };
  const weakFiles = [...refs.values()].filter((v) => v.weak > 0).length;
  const weakOcc = [...refs.values()].reduce((a, v) => a + v.weak, 0);
  return {
    api_runtime: bucket((f) => f.group === 'api' && isRuntime(f)),
    api_tests: bucket((f) => f.group === 'api' && f.kind === 'test'),
    api_scripts: bucket((f) => f.group === 'api' && f.kind === 'script'),
    web_runtime: bucket((f) => f.group === 'web' && isRuntime(f)),
    web_tests: bucket((f) => f.group === 'web' && f.kind === 'test'),
    public_portal: bucket((f) => f.group === 'public'),
    packages: bucket((f) => f.group === 'packages'),
    repo_scripts: bucket((f) => f.group === 'repo-scripts' || f.group === 'tests-root'),
    weak: { files: weakFiles, occurrences: weakOcc },
    via_api: viaApi(name),
  };
}

// FK entrantes (état final, noms résolus par renommage)
const fkIn = new Map();
const renameMap = new Map();
for (const r of rows.values()) {
  const t = r.sources.infra || r.sources.prismaMig;
  if (t) for (const rf of t.renamedFrom) renameMap.set(rf.from, r.name);
}
for (const r of rows.values()) {
  const t = r.sources.infra || r.sources.prismaMig;
  if (!t) continue;
  for (const target0 of t.fks) {
    const target = renameMap.get(target0) || target0;
    if (target === r.name) continue;
    if (!fkIn.has(target)) fkIn.set(target, new Set());
    fkIn.get(target).add(r.name);
  }
}

const tableRows = [];
for (const r of [...rows.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
  const s = r.sources;
  const t = s.infra || s.prismaMig;
  const rd = s.runtimeDdl && s.runtimeDdl[0];
  const usage = usageFor(r.name);

  let status;
  if (s.infra) status = 'active';
  else if (s.prismaMig) status = 'prisma-only';
  else if (s.runtimeDdl) status = 'runtime-ddl';
  else status = 'rollback-only';

  // tenant_id
  let tenantState, tenantAddedIn = null, columns = null, rls = false, rlsIn = null;
  if (t) {
    tenantState = t.tenantIdCol ? (t.tenantIdNotNull ? 'required' : 'nullable') : 'absent';
    tenantAddedIn = t.tenantIdAddedIn;
    columns = t.columns.size;
    rls = !!t.rls; rlsIn = t.rlsIn;
    // la chaîne Prisma peut ajouter tenant_id à une table SQL (OR des deux sources)
    const p = s.prismaMig;
    if (s.infra && p && !t.tenantIdCol && p.tenantIdCol) { tenantState = p.tenantIdNotNull ? 'required' : 'nullable'; tenantAddedIn = p.tenantIdAddedIn + ' (chaîne Prisma)'; }
  } else if (rd) {
    const cols = rd.parsed.columns;
    const tc = cols.find((c) => c.name === 'tenant_id');
    tenantState = tc ? (tc.notNull ? 'required' : 'nullable') : 'absent';
    columns = cols.length;
    tenantAddedIn = tc ? `${rd.file} (DDL runtime)` : null;
  } else {
    tenantState = 'inconnu';
  }
  if (s.prismaModel && s.prismaModel.hasTenant && tenantState === 'absent') tenantState = 'required';
  if (s.prismaMig && s.prismaMig.rls) rls = true;

  const origin = s.infra ? s.infra.createdIn
    : s.prismaMig ? s.prismaMig.createdIn.replace(/^prisma:/, 'prisma/migrations/')
    : s.runtimeDdl ? `DDL runtime : ${s.runtimeDdl[0].file}`
    : `(aucun CREATE dans le dépôt ; cité par ${s.rollbackOnly.join(', ')})`;

  const [domain, module_, slice] = classify(r.name);
  const fk_out = t ? [...t.fks].map((x) => renameMap.get(x) || x).sort() : [];
  const sourcesList = [];
  if (s.infra) sourcesList.push('infra/scripts/migrations');
  if (s.prismaMig) sourcesList.push('prisma/migrations');
  if (s.prismaModel) sourcesList.push('prisma/schema.prisma');
  if (s.runtimeDdl) sourcesList.push('DDL runtime');
  if (s.rollbackOnly) sourcesList.push('rollback seulement');

  const strongRuntimeFiles = usage.api_runtime.files + usage.web_runtime.files + usage.public_portal.files + usage.packages.files;
  const strongRuntimeOcc = usage.api_runtime.occurrences + usage.web_runtime.occurrences + usage.public_portal.occurrences + usage.packages.occurrences;
  tableRows.push({
    name: r.name,
    status,
    zombie: status !== 'active' && strongRuntimeFiles === 0,
    origin_migration: origin,
    sources: sourcesList,
    renamed_from: t ? t.renamedFrom : [],
    dropped_and_recreated: st.infra.dropped.some((d) => d.name === r.name && d.recreated),
    tenant_id: tenantState,
    tenant_id_added_in: tenantAddedIn,
    rls,
    rls_in: rlsIn,
    columns,
    domain,
    target_module: module_,
    target_slice: slice,
    fk_out,
    fk_in: [...(fkIn.get(r.name) || [])].sort(),
    usage,
    // toutes les références fortes : [fichier, occurrences], triées par fichier
    refs: [...(scan2.refs.get(r.name) || new Map()).entries()]
      .filter(([, v]) => v.strong > 0)
      .map(([file, v]) => [file, v.strong])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    coupling: {
      runtime_files: strongRuntimeFiles,
      runtime_occurrences: strongRuntimeOcc,
      web_via_api_files: usage.via_api.web.files,
      score: usage.api_runtime.files + usage.web_runtime.files + usage.via_api.web.files,
    },
  });
}

// tables créées puis supprimées (état final : absentes de l'infra)
const finalInfra = new Set(st.infra.tables.keys());
const droppedFinal = st.infra.dropped
  .filter((d) => !finalInfra.has(d.name))
  .map((d) => ({ ...d, in_prisma_chain: st.prisma.tables.has(d.name) }));

// références SQL à des noms non définis (candidats : tables manquantes du dépôt, CTE, fonctions SQL...)
const undefinedRefs = [...scan2.undefinedSql.entries()]
  .map(([name, m]) => ({ name, files: m.size, occurrences: [...m.values()].reduce((a, b) => a + b, 0), sample: [...m.keys()].slice(0, 3) }))
  .filter((x) => x.name.length > 2)
  .sort((a, b) => b.files - a.files || b.occurrences - a.occurrences);

// ------------------------------------------------------------------ 4. synthèse
const byDomain = {};
for (const d of DOMAINS) byDomain[d] = 0;
for (const t of tableRows) byDomain[t.domain] = (byDomain[t.domain] || 0) + 1;
const byStatus = {};
for (const t of tableRows) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
const noTenant = tableRows.filter((t) => t.tenant_id === 'absent' || t.tenant_id === 'nullable' || t.tenant_id === 'inconnu');
const byModule = {};
for (const t of tableRows) byModule[t.target_module] = (byModule[t.target_module] || 0) + 1;
const top10 = [...tableRows]
  .sort((a, b) => b.coupling.score - a.coupling.score || b.coupling.runtime_occurrences - a.coupling.runtime_occurrences)
  .slice(0, 10)
  .map((t) => ({ name: t.name, domain: t.domain, score: t.coupling.score, api: t.usage.api_runtime.files, web_direct: t.usage.web_runtime.files, web_via_api: t.usage.via_api.web.files, occurrences: t.coupling.runtime_occurrences }));

const unregisteredRoutes = scan2.files
  .filter((f) => f.group === 'api' && f.kind === 'route' && f.rel.startsWith('apps/api/src/routes/') && !routePrefixes.has(f.rel))
  .map((f) => f.rel);

const summary = {
  tables_total: tableRows.length,
  api_route_files_registered: routePrefixes.size,
  api_route_files_unregistered_dead_code: unregisteredRoutes,
  by_status: byStatus,
  by_domain: byDomain,
  by_target_module: byModule,
  tables_without_required_tenant_id: noTenant.map((t) => ({ name: t.name, tenant_id: t.tenant_id, status: t.status, domain: t.domain })),
  tables_without_rls: tableRows.filter((t) => !t.rls && t.status === 'active').map((t) => t.name),
  zombie_tables: tableRows.filter((t) => t.zombie).map((t) => t.name),
  dropped_tables: droppedFinal.length,
  top10_coupled: top10,
  files_scanned: scan2.files.length,
  files_scanned_by_group: scan2.files.reduce((a, f) => ((a[f.group] = (a[f.group] || 0) + 1), a), {}),
  infra_migrations_replayed: st.infraFiles.length,
  infra_migrations_skipped: st.infraSkipped,
  prisma_migrations: st.prismaMigrations.length,
  schema_prisma_models: st.prismaModels.length,
};

const json = {
  generated_by: 'scripts/inventory/build-tables-matrix.mjs',
  note: 'Fichier généré. Ne pas éditer à la main : relancer le script.',
  summary,
  tables: tableRows,
  dropped_tables: droppedFinal,
  views: [...st.infra.views.values()],
  parser_unresolved: st.infra.unresolved,
  undefined_sql_references: undefinedRefs.slice(0, 150),
  files_scanned: scan2.files.map((f) => f.rel),
};

// ------------------------------------------------------------------ 5. markdown
const short = (rel) => rel
  .replace(/^apps\/api\/src\//, '')
  .replace(/^apps\/web\/src\//, 'web:')
  .replace(/^apps\/formation-pro-public\//, 'pub:')
  .replace(/^apps\/web\//, 'web:')
  .replace(/^apps\/api\//, 'api:');
const fmtTop = (list) => (list.length ? list.map((x) => `${short(x.file)} (${x.count})`).join('<br>') : '—');
const kindsStr = (bk, order) => order.map((k) => `${bk[k] || 0}`).join('/');

let md = '';
md += '# Matrice d\'usage des tables\n\n';
md += '> Fichier généré par `scripts/inventory/build-tables-matrix.mjs` (tâche 0.6 du plan). Ne pas éditer à la main.\n';
md += '> Source : `infra/scripts/migrations/*.sql` rejoués dans l\'ordre (état final après RENAME/DROP), chaîne `apps/api/prisma/migrations`, `schema.prisma`, DDL exécuté depuis le code.\n\n';
md += `Tables dans la matrice : **${summary.tables_total}** (${Object.entries(byStatus).map(([k, v]) => `${k} : ${v}`).join(', ')}). Tables créées puis supprimées : ${droppedFinal.length} (section en fin de document). Fichiers de code analysés : ${summary.files_scanned}.\n\n`;
md += '## Lecture\n\n';
md += '- **Origine** : migration où la table est créée (état final ; voir `renamed_from` dans le JSON). `prisma/migrations/...` = table connue uniquement de la chaîne Prisma.\n';
md += '- **tenant_id** : `req` = colonne NOT NULL ; `null` = colonne nullable (table globale à portée mixte) ; `ABSENT` = table globale. `RLS` : policy posée par les migrations (ne prouve pas l\'isolation : l\'API se connecte en super-utilisateur, cf. plan §2).\n';
md += '- **API rt** = fichiers d\'exécution (routes/services/jobs/autres) ; la colonne « r/s/j » détaille routes / services / jobs. **Web** : pages / hooks / lib (+ composants et autres dans le JSON). Tests, scripts de seed et scripts racine sont comptés à part (`T` = tests API, `S` = scripts).\n';
md += '- Règle de comptage : un nom de table avec `_` compte pour toute occurrence en mot entier ; un nom d\'un seul mot (`users`, `classes`, `documents`…) ne compte qu\'en contexte SQL (`FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES…`). Les occurrences « faibles » sont listées dans le JSON.\n\n';

md += '## Synthèse par domaine\n\n| Domaine | Tables |\n|---|---:|\n';
for (const [d, n] of Object.entries(byDomain)) if (n) md += `| ${d} | ${n} |\n`;
md += `\n## Top 10 des tables les plus couplées\n\nScore = fichiers API d'exécution qui la citent + fichiers web qui la citent + fichiers web qui appellent une route atteignant ces fichiers API (approximé par préfixe \`/api/v1/...\`).\n\n| # | Table | Domaine | Score | API direct | Web direct | Web via API | Occurrences API+web |\n|--:|---|---|--:|--:|--:|--:|--:|\n`;
top10.forEach((t, i) => (md += `| ${i + 1} | \`${t.name}\` | ${t.domain} | ${t.score} | ${t.api} | ${t.web_direct} | ${t.web_via_api} | ${t.occurrences} |\n`));
md += '\n';

const tenantLabel = (t) => ({ required: 'req', nullable: 'null', absent: 'ABSENT', inconnu: '?' }[t]);
for (const d of DOMAINS) {
  const list = tableRows.filter((t) => t.domain === d);
  if (!list.length) continue;
  md += `## Domaine : ${d} (${list.length})\n\n`;
  md += '| Table | Statut | Origine | tenant_id | RLS | Module cible (tranche) | API rt (r/s/j) | T | S | Web direct (p/h/l) | Web via API (p/h/l) | Top 5 API | Top 5 web (via API) |\n';
  md += '|---|---|---|---|---|---|---|--:|--:|---|---|---|---|\n';
  for (const t of list) {
    const u = t.usage;
    const apiCnt = `${u.api_runtime.files} (${kindsStr(u.api_runtime.by_kind, ['route', 'service', 'job'])})`;
    const webCnt = `${u.web_runtime.files} (${kindsStr(u.web_runtime.by_kind, ['page', 'hook', 'lib'])})`;
    const viaCnt = `${u.via_api.web.files} (${kindsStr(u.via_api.web.by_kind, ['page', 'hook', 'lib'])})`;
    const webTop = u.web_runtime.top5.length ? u.web_runtime.top5 : u.via_api.web.top5;
    const pub = u.public_portal.files || u.via_api.public_portal.files ? `<br>+ pub: ${u.public_portal.files} direct / ${u.via_api.public_portal.files} via API` : '';
    const flags = (t.zombie ? ' zombie' : '') + (t.dropped_and_recreated ? ' (recréée)' : '') + (t.renamed_from.length ? ` (ex-${t.renamed_from.map((r) => r.from).join(',')})` : '');
    md += `| \`${t.name}\` | ${t.status}${flags} | ${t.origin_migration} | ${tenantLabel(t.tenant_id)} | ${t.rls ? 'oui' : 'non'} | ${t.target_module} (${t.target_slice}) | ${apiCnt} | ${u.api_tests.files} | ${u.api_scripts.files + u.repo_scripts.files} | ${webCnt} | ${viaCnt}${pub} | ${fmtTop(u.api_runtime.top5)} | ${fmtTop(webTop)} |\n`;
  }
  md += '\n';
}

md += `## Tables créées puis supprimées (${droppedFinal.length})\n\n| Table | Créée | Supprimée | Encore dans la chaîne Prisma |\n|---|---|---|---|\n`;
for (const d of droppedFinal) md += `| \`${d.name}\` | ${d.createdIn} | ${d.droppedIn}${d.conditional ? ' (conditionnel)' : ''} | ${d.in_prisma_chain ? 'oui (zombie possible)' : 'non'} |\n`;

md += '\n## Tables sans `tenant_id` requis\n\n';
md += '| Table | tenant_id | Statut | Domaine |\n|---|---|---|---|\n';
for (const t of noTenant) md += `| \`${t.name}\` | ${tenantLabel(t.tenant_id)} | ${t.status} | ${t.domain} |\n`;

md += `\n## Références SQL à des noms inconnus du schéma (${Math.min(undefinedRefs.length, 60)} premiers)\n\n`;
md += 'Noms rencontrés après `FROM|JOIN|INTO|UPDATE` dans le code mais absents de toutes les sources de schéma. Beaucoup sont des CTE, des fonctions SQL ou du texte ; les tables réelles manquantes du dépôt (ex. `rso_*` dont le CREATE n\'est pas versionné) y apparaissent.\n\n| Nom | Fichiers | Occurrences | Exemples |\n|---|--:|--:|---|\n';
for (const u of undefinedRefs.slice(0, 60)) md += `| \`${u.name}\` | ${u.files} | ${u.occurrences} | ${u.sample.map(short).join(', ')} |\n`;

md += `\n## Limites connues\n\n- Les migrations sont rejouées dans l'ordre « préfixe numérique, puis nom » ; les fichiers \`*_rollback.sql\` et \`validate_*\` ne sont pas rejoués. L'ordre réel d'application en production n'est pas versionné (migrations appliquées à la main par \`psql\`, scripts \`scripts/apply-migration-*.js\`), et le déploiement exécute \`prisma migrate deploy\`.\n- Les boucles \`DO $$ ... EXECUTE format(...)\` ne sont pas rejouables : seule celle de \`0055_unified_multitenancy.sql\` (ajout de \`tenant_id\` + RLS à toutes les tables existantes, sauf exclusions) est modélisée explicitement.\n- Les occurrences en commentaire comptent comme références. Les noms de tables construits dynamiquement (\`\${table}\`) ne sont pas détectés ; \`getTableName(tenant, 'x')\` l'est.\n- \`parser_unresolved\` (JSON) liste ce que le parseur n'a pas su résoudre (${st.infra.unresolved.length} entrées : \`DROP TABLE\` de tables jamais créées dans le dépôt, par exemple \`attendance_records\` ou les tables Imhotep déjà supprimées par \`0051\` que \`0055\` supprime à nouveau).\n- Aucun \`ALTER TABLE … RENAME\` n'existe dans les ${st.infraFiles.length} migrations rejouées ni dans la chaîne Prisma ; le parseur le gère (\`renamed_from\`), la liste est vide aujourd'hui.\n- Les **vues** (\`views\` dans le JSON) ne sont pas des lignes de la matrice : \`calendar_sessions\` (0024, supprimée par 0027) et \`v_payment_hour_details_enriched\` (0103, lue par \`routes/teacher-payments.ts:325\`) sont les seules citées par le code.\n- Les \`CREATE TABLE\` situés dans du code TS/JS (routes qui créent leurs tables au premier appel, scripts de migration) sont relevés : statut \`runtime-ddl\` quand la table n'existe nulle part ailleurs (\`establishment_inbound_messages\`, \`student_replies\`), sinon mention « DDL runtime » dans le champ \`sources\` du JSON (18 tables concernées, dont \`teacher_attendance_sessions\` et \`notifications\`).\n`;

// ------------------------------------------------------------------ 6. écriture
const jsonText = JSON.stringify(json, null, 2) + '\n';
const files = { 'tables-usage-matrix.json': jsonText, 'tables-usage-matrix.md': md };
if (check) {
  let bad = 0;
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(outDir, f);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8').replace(/\r\n/g, "\n") !== content) { console.error(`DIVERGENCE: ${f}`); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
fs.mkdirSync(outDir, { recursive: true });
for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(outDir, f), content);
console.log(`OK : ${tableRows.length} tables, ${droppedFinal.length} supprimées, ${scan2.files.length} fichiers analysés.`);
console.log(JSON.stringify({ by_status: byStatus, by_domain: byDomain, no_tenant: noTenant.length }, null, 0));
