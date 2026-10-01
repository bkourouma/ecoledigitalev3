#!/usr/bin/env node
// Génère docs/inventory/legacy-dependents-by-slice.md : pour chaque tranche 2.1 à 2.8 du plan
// (Phase 2), les fichiers API / web / tests qui devront changer, une taille S/M/L et les points
// de couplage dangereux (notes curatées dans slice-notes.mjs).
//
//   node scripts/inventory/build-tables-matrix.mjs     # prérequis
//   node scripts/inventory/build-slice-dependents.mjs
//   node scripts/inventory/build-slice-dependents.mjs --check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLICES, SIZE_RULES, STRUCTURANT } from './slice-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'docs/inventory/tables-usage-matrix.json'), 'utf8'));
const check = process.argv.includes('--check');

const locCache = new Map();
const loc = (rel) => {
  if (!locCache.has(rel)) {
    try { locCache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length); } catch { locCache.set(rel, 0); }
  }
  return locCache.get(rel);
};
const isTest = (rel) => /(^|\/)(__tests__|tests?|e2e)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
const isScript = (rel) => /^(scripts|infra\/scripts|apps\/api\/scripts|apps\/web\/scripts)\//.test(rel);
const short = (rel) => rel.replace(/^apps\/api\/src\//, 'api/').replace(/^apps\/web\/src\//, 'web/').replace(/^apps\/api\//, 'api:').replace(/^apps\/web\//, 'web:');

// ---- tables par tranche, fichiers -> (table -> occurrences)
const tablesBySlice = new Map();
const fileSlices = new Map(); // file -> Set(slice)
for (const t of matrix.tables) {
  if (t.domain === 'imhotep' || t.target_module === 'LEGACY-ARCHIVE') continue;
  const sl = new Set([...String(t.target_slice).matchAll(/2\.\d/g)].map((m) => m[0]));
  for (const s of sl) {
    if (!tablesBySlice.has(s)) tablesBySlice.set(s, []);
    tablesBySlice.get(s).push(t);
    for (const [f] of t.refs) {
      if (!fileSlices.has(f)) fileSlices.set(f, new Set());
      fileSlices.get(f).add(s);
    }
  }
}

// fichiers rattachés à la main (formules, PDF, routes-agrégats) : ils comptent aussi pour « tranches touchées »
for (const sl of SLICES) {
  const extra = new Set(sl.extraFiles || []);
  for (const g of sl.extraGlobs || []) {
    const re = new RegExp(g);
    for (const f of matrix.files_scanned) if (re.test(f)) extra.add(f);
  }
  for (const f of extra) {
    if (!fileSlices.has(f)) fileSlices.set(f, new Set());
    fileSlices.get(f).add(sl.id);
  }
}

// ---- web : index des fichiers contenant /api/v1/<préfixe>
const webFiles = matrix.files_scanned.filter((f) => f.startsWith('apps/web/') && !isTest(f) && !isScript(f) && f !== 'apps/web/next.config.js');
const webText = new Map();
for (const f of webFiles) {
  try {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    if (t.includes('/api/v1/')) webText.set(f, t);
  } catch { /* ignore */ }
}
const webCalling = (prefixes) => {
  const hit = new Set();
  const res = [...prefixes].map((p) => new RegExp(`/api/v1${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`));
  for (const [f, t] of webText) if (res.some((re) => re.test(t))) hit.add(f);
  return hit;
};

const sizeLabel = (m) => {
  const r = SIZE_RULES;
  if (m.struct <= r.S.struct && m.loc <= r.S.loc && m.webDirect <= r.S.webDirect) return 'S';
  if (m.struct <= r.M.struct && m.loc <= r.M.loc && m.webDirect <= r.M.webDirect) return 'M';
  return 'L';
};

const summaryRows = [];
let sections = '';

for (const sl of SLICES) {
  const key = sl.id;
  const tables = (tablesBySlice.get(key) || []).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
  const files = new Map(); // rel -> Map(table -> occ)
  const add = (f, t, n) => {
    if (!files.has(f)) files.set(f, new Map());
    files.get(f).set(t, (files.get(f).get(t) || 0) + n);
  };
  for (const t of tables) for (const [f, c] of t.refs) add(f, t.name, c);
  for (const f of sl.extraFiles || []) add(f, '(ajout manuel)', STRUCTURANT.minOcc);
  for (const g of sl.extraGlobs || []) {
    const re = new RegExp(g);
    for (const f of matrix.files_scanned) if (re.test(f)) add(f, '(ajout manuel)', STRUCTURANT.minOcc);
  }
  const weight = (f) => [...files.get(f).values()].reduce((a, b) => a + b, 0);
  const isStruct = (f) => weight(f) >= STRUCTURANT.minOcc || files.get(f).size >= STRUCTURANT.minTables;

  const all = [...files.keys()];
  const api = all.filter((f) => f.startsWith('apps/api/src/') && !isTest(f)).sort();
  const apiStruct = api.filter(isStruct);
  const apiLight = api.filter((f) => !isStruct(f));
  const apiTests = all.filter((f) => f.startsWith('apps/api/') && isTest(f)).sort();
  const webDirect = all.filter((f) => f.startsWith('apps/web/') && !isTest(f) && !isScript(f)).sort();
  const webTests = all.filter((f) => (f.startsWith('apps/web/') || f.startsWith('tests/')) && isTest(f)).sort();
  const scripts = all.filter((f) => isScript(f)).sort();
  const pkgs = all.filter((f) => f.startsWith('packages/')).sort();

  const routes = new Set();
  const prefixes = new Set();
  for (const t of tables) {
    for (const r of t.usage.via_api.entry_routes) routes.add(r);
    for (const p of t.usage.via_api.prefixes) prefixes.add(p);
  }
  for (const f of apiStruct) if (f.startsWith('apps/api/src/routes/')) routes.add(f);
  const calling = webCalling(prefixes);
  const apiLocStruct = apiStruct.reduce((a, f) => a + loc(f), 0);
  const computed = sizeLabel({ struct: apiStruct.length, loc: apiLocStruct, webDirect: webDirect.length });
  const size = sl.size || computed;
  summaryRows.push({ id: key, title: sl.title, tables: tables.length, struct: apiStruct.length, light: apiLight.length, loc: apiLocStruct, routes: routes.size, webDirect: webDirect.length, calling: calling.size, tests: apiTests.length + webTests.length, scripts: scripts.length, computed, size });

  sections += `## Tranche ${key} — ${sl.title}\n\n`;
  sections += `**Remplace** : ${sl.replaces}\n\n`;
  sections += `**Taille** : **${size}**${sl.size && sl.size !== computed ? ` (calculée ${computed} ; ajustée à la main : ${sl.sizeWhy})` : ' (calculée)'} — ${apiStruct.length} fichiers API structurants (${apiLocStruct} lignes) + ${apiLight.length} jointures légères, ${routes.size} routes HTTP d'entrée, ${webDirect.length} fichiers web directs, ~${calling.size} fichiers web appelants (borne haute), ${apiTests.length + webTests.length} tests existants, ${scripts.length} scripts/seeds.\n\n`;
  sections += `**Tables** (${tables.length}) : ${tables.map((t) => `\`${t.name}\``).join(', ') || '(aucune : tranche de calcul)'}\n\n`;

  if (sl.notes && sl.notes.length) {
    sections += '### Points de couplage dangereux\n\n';
    for (const n of sl.notes) sections += `- ${n}\n`;
    sections += '\n';
  }

  const tblList = (m) => [...m.entries()].filter(([t]) => t !== '(ajout manuel)').sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, c]) => `${t}(${c})`).join(', ') + (m.size > 4 ? `, +${m.size - 4}` : '');
  const fmtFiles = (list, limit) => {
    const rows = list.map((f) => ({ f, l: loc(f), w: weight(f), m: files.get(f), n: (fileSlices.get(f) || new Set([key])).size }));
    rows.sort((a, b) => b.w - a.w || b.l - a.l);
    let out = '| Fichier | Lignes | Occ. | Tables citées | Tranches |\n|---|--:|--:|---|--:|\n';
    for (const r of rows.slice(0, limit)) {
      const manualOnly = [...r.m.keys()].every((t) => t === '(ajout manuel)');
      out += `| \`${short(r.f)}\` | ${r.l} | ${manualOnly ? '—' : r.w} | ${manualOnly ? '(rattaché à la main : formule / écran / PDF)' : tblList(r.m)} | ${r.n} |\n`;
    }
    if (rows.length > limit) out += `| … ${rows.length - limit} autres (liste complète : \`tables-usage-matrix.json\`, champ \`refs\`) | | | | |\n`;
    return out + '\n';
  };
  sections += `### Fichiers API structurants (${apiStruct.length})\n\n` + (apiStruct.length ? fmtFiles(apiStruct, 45) : '_aucun_\n\n');
  if (apiLight.length) sections += `### Jointures légères (${apiLight.length} fichiers, < ${STRUCTURANT.minOcc} occurrences et < ${STRUCTURANT.minTables} tables de la tranche)\n\n${apiLight.map((f) => `\`${short(f)}\``).join(', ')}\n\n`;
  sections += `### Routes HTTP d'entrée (${routes.size})\n\n` + ([...routes].sort().map((r) => `\`${short(r)}\``).join(', ') || '_aucune_') + '\n\n';
  sections += `### Web : fichiers directs (${webDirect.length}) et appelants (~${calling.size})\n\n`;
  if (webDirect.length) sections += fmtFiles(webDirect, 40);
  const grp = {};
  for (const f of calling) {
    const m = /^apps\/web\/src\/(app\/[^/]+(?:\/[^/]+)?|components\/[^/]+|lib\/[^/]+)/.exec(f);
    const g = m ? m[1] : 'autre';
    grp[g] = (grp[g] || 0) + 1;
  }
  const top = Object.entries(grp).sort((a, b) => b[1] - a[1]).slice(0, 14);
  sections += `Appelants par dossier (borne haute) : ${top.map(([g, n]) => `\`${g}\` ${n}`).join(', ') || '—'}\n\n`;
  sections += `### Tests existants (${apiTests.length + webTests.length})\n\n` + ([...apiTests, ...webTests].map((f) => `- \`${short(f)}\``).join('\n') || '_aucun test existant ne cite ces tables : filet à écrire en 2.0_') + '\n\n';
  sections += `### Scripts, seeds et packages (${scripts.length + pkgs.length})\n\n`;
  const scr = [...scripts, ...pkgs];
  sections += (scr.length ? scr.slice(0, 25).map((f) => `\`${short(f)}\``).join(', ') + (scr.length > 25 ? `, … +${scr.length - 25}` : '') : '_aucun_') + '\n\n';
  if (sl.exit) sections += `### Test de sortie de tranche\n\n${sl.exit}\n\n`;
}

const multi = [...fileSlices.entries()]
  .filter(([f, s]) => s.size >= 3 && f.startsWith('apps/') && !isTest(f) && !isScript(f))
  .map(([f, s]) => ({ f, n: s.size, l: loc(f), slices: [...s].sort() }))
  .sort((a, b) => b.n - a.n || b.l - a.l);

let md = '# Dépendants de l\'existant par tranche (Phase 2, tranches 2.1 à 2.8)\n\n';
md += '> Généré par `scripts/inventory/build-slice-dependents.mjs` à partir de `tables-usage-matrix.json` et de `scripts/inventory/slice-notes.mjs` (notes de couplage rédigées à la main, avec fichier:ligne). Ne pas éditer ce fichier : éditer les notes puis relancer.\n\n';
md += '## Méthode et lecture\n\n';
md += '- **Tables de la tranche** : colonne « tranche » des règles de `inventory.config.mjs`, qui suit le tableau « Remplace » du plan §4. Une table citée par plusieurs tranches (`2.5/3`) compte pour chacune.\n';
md += `- **API structurants** : fichiers \`apps/api/src\` (routes, services, jobs) qui citent les tables de la tranche au moins ${STRUCTURANT.minOcc} fois ou qui en citent au moins ${STRUCTURANT.minTables} différentes. Les autres sont des **jointures légères** (une table de la tranche jointe pour un libellé) : ils changeront, mais mécaniquement.\n`;
md += '- **Routes d\'entrée** : routes HTTP enregistrées dans `index.ts` dont l\'arbre d\'imports atteint ces fichiers ; c\'est le contrat HTTP à préserver ou à réécrire. **Web direct** : fichiers web qui citent la table (rare : le web ne fait pas de SQL). **Web appelant** : fichiers web contenant `/api/v1/<préfixe>` d\'une route d\'entrée, borne haute (sur-estimation par préfixe, ex. `/teacher`, `/courses`).\n';
md += `- **Taille** (structurants seulement) : S = ≤ ${SIZE_RULES.S.struct} fichiers, ≤ ${SIZE_RULES.S.loc} lignes, ≤ ${SIZE_RULES.S.webDirect} web direct ; M = ≤ ${SIZE_RULES.M.struct} / ${SIZE_RULES.M.loc} / ${SIZE_RULES.M.webDirect} ; L au-delà. L'ajustement manuel, s'il existe, est justifié dans la section de la tranche. Ce n'est pas une estimation d'effort calendaire (le plan §4 dit : S ≈ 1–2 sem., M ≈ 3–5, L ≈ 6–10, XL > 10 pour un développeur) : c'est une mesure de surface de code touchée.\n\n`;
md += '## Synthèse\n\n| Tranche | Intitulé | Tables | API structurants / lignes | + légers | Routes d\'entrée | Web direct | Web appelant (≤) | Tests | Scripts | Taille |\n|---|---|--:|---|--:|--:|--:|--:|--:|--:|:-:|\n';
for (const r of summaryRows) md += `| ${r.id} | ${r.title} | ${r.tables} | ${r.struct} / ${r.loc} | ${r.light} | ${r.routes} | ${r.webDirect} | ${r.calling} | ${r.tests} | ${r.scripts} | **${r.size}** |\n`;
md += '\n## Fichiers transverses (touchent ≥ 3 tranches)\n\nCes fichiers seront modifiés dans plusieurs tranches : ordonnancer les tranches pour qu\'un même fichier ne soit pas réécrit en parallèle, ou le découper avant la Phase 2 (étape « 2.0 bis »).\n\n| Fichier | Lignes | Nb tranches | Tranches |\n|---|--:|--:|---|\n';
for (const m of multi.slice(0, 40)) md += `| \`${short(m.f)}\` | ${m.l} | ${m.n} | ${m.slices.join(', ')} |\n`;
md += '\n' + sections;

const out = path.join(root, 'docs/inventory/legacy-dependents-by-slice.md');
if (check) {
  const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8').replace(/\r\n/g, "\n") === md;
  if (!same) { console.error('DIVERGENCE: legacy-dependents-by-slice.md'); process.exit(1); }
  process.exit(0);
}
fs.writeFileSync(out, md);
console.log('OK : ' + summaryRows.map((r) => `${r.id}=${r.size}(${r.struct}+${r.light} api, ${r.webDirect} web, ~${r.calling} via)`).join(' | '));
