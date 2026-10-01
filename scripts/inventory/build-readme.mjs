#!/usr/bin/env node
// Génère docs/inventory/README.md (mode d'emploi + résumé chiffré), à partir des JSON produits
// par les autres scripts. Lancé par run-all.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAINS } from './inventory.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const mx = JSON.parse(fs.readFileSync(path.join(root, 'docs/inventory/tables-usage-matrix.json'), 'utf8'));
const im = JSON.parse(fs.readFileSync(path.join(root, 'docs/inventory/imhotep-removal-inventory.json'), 'utf8'));
const S = mx.summary;
const T = mx.tables;

const byDomain = Object.fromEntries(DOMAINS.map((d) => [d, T.filter((t) => t.domain === d)]));
const st = (list, s) => list.filter((t) => t.status === s).length;
const noTenant = {
  absent: T.filter((t) => t.tenant_id === 'absent'),
  nullable: T.filter((t) => t.tenant_id === 'nullable'),
  inconnu: T.filter((t) => t.tenant_id === 'inconnu'),
};
const noRlsActive = T.filter((t) => t.status === 'active' && !t.rls);
const fmt = (l) => l.map((t) => '`' + t.name + '`').join(', ');

let md = '# Inventaire d\'impact (tâche 0.6 du plan)\n\n';
md += '> Dossier généré. Source : `scripts/inventory/` (Node ≥ 18, aucune dépendance, **lecture seule**, aucune connexion à une base). Plan : `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §4 (Phase 2), §5, tâche 0.6.\n\n';

md += '## Contenu\n\n| Fichier | Sert à | Produit par |\n|---|---|---|\n';
md += '| `tables-usage-matrix.md` / `.json` | pour chaque table : migration d\'origine, `tenant_id`, domaine, module cible, fichiers API/web qui la citent (JSON : liste complète dans `refs`) | `build-tables-matrix.mjs` |\n';
md += '| `imhotep-removal-inventory.md` / `.json` | suppression d\'Imhotep : A (sans risque) / B (à découpler) / C (à conserver), ordre de suppression | `imhotep-deps.mjs` + `build-imhotep-doc.mjs` (+ `imhotep-notes.mjs`, écrit à la main) |\n';
md += '| `legacy-dependents-by-slice.md` | tranches 2.1 à 2.8 : fichiers qui changent, taille S/M/L, couplages dangereux | `build-slice-dependents.mjs` (+ `slice-notes.mjs`, écrit à la main) |\n';
md += '| `README.md` | ce fichier | `build-readme.mjs` |\n\n';

md += '## Relancer\n\n```bash\n';
md += 'node scripts/inventory/run-all.mjs            # régénère les 4 documents et les 2 JSON\n';
md += 'node scripts/inventory/run-all.mjs --check    # n\'écrit rien ; code retour 1 si un fichier du dossier est périmé\n\n';
md += '# étape par étape\n';
md += 'node scripts/inventory/build-tables-matrix.mjs     # 1. matrice des tables (prérequis des autres)\n';
md += 'node scripts/inventory/imhotep-deps.mjs            # 2. dépendances entrantes vers Imhotep (JSON)\n';
md += 'node scripts/inventory/build-imhotep-doc.mjs       # 3. imhotep-removal-inventory.md\n';
md += 'node scripts/inventory/build-slice-dependents.mjs  # 4. legacy-dependents-by-slice.md\n';
md += 'node scripts/inventory/build-readme.mjs            # 5. ce README\n\n';
md += '# suivi de la suppression d\'Imhotep (après chaque étape de l\'ordre de suppression)\n';
md += 'node scripts/inventory/imhotep-residue.mjs --list\n';
md += 'node scripts/inventory/imhotep-residue.mjs --group tables --expect 0   # code retour 1 si des résidus subsistent\n```\n\n';
md += 'Reclasser une table (domaine, module cible, tranche) : éditer `scripts/inventory/inventory.config.mjs` (`TABLE_RULES` ou `OVERRIDES`). Déplacer un fichier entre « A » et « B » : éditer `imhotep.config.mjs` (graines / partagés) ou `imhotep-notes.mjs`. Les sorties changent à chaque commit du dépôt : relancer avant de s\'y fier.\n\n';

md += '## Méthode en bref\n\n';
md += `- **Tables** : les ${S.infra_migrations_replayed} migrations de \`infra/scripts/migrations\` sont rejouées dans l'ordre « préfixe numérique puis nom » (les ${S.infra_migrations_skipped.length} fichiers \`*_rollback.sql\` / \`validate_*\` ne sont pas rejoués) en suivant \`CREATE TABLE\`, \`ALTER TABLE … RENAME\`, \`DROP TABLE\`, \`ADD/DROP COLUMN tenant_id\`, RLS ; l'**état final** compte (plusieurs tables sont supprimées par \`0051\`/\`0055\` puis recréées par \`0056\`). La boucle \`DO $$\` de \`0055_unified_multitenancy.sql\` (ajout de \`tenant_id\` + RLS à toutes les tables existantes) est modélisée explicitement. Sont ajoutés : la chaîne \`apps/api/prisma/migrations\` (celle que \`deploy.sh\` exécute), \`schema.prisma\`, le DDL exécuté depuis le code (\`CREATE TABLE IF NOT EXISTS\` dans des routes) et les tables citées seulement par des scripts de rollback.\n`;
md += '- **Références** : tous les `.ts/.tsx/.js/.mjs/.cjs/.sql` du dépôt (hors `node_modules`, builds, migrations, `docs/`, `specs/`). Un nom de table avec `_` compte pour toute occurrence en mot entier ; un nom d\'un seul mot (`users`, `classes`…) ne compte qu\'en contexte SQL en MAJUSCULES (`FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES…`) ou via `getTableName(tenant, \'x\')`.\n';
md += '- **Web** : le web ne fait pas de SQL. La colonne « web via API » relie table → fichiers API → routes HTTP d\'entrée (graphe d\'imports + préfixes de `index.ts`) → fichiers web qui contiennent `/api/v1/<préfixe>`. C\'est une **borne haute**.\n\n';

md += '## Résumé chiffré\n\n';
md += `- **${S.tables_total} tables** dans la matrice : ${Object.entries(S.by_status).map(([k, v]) => `${v} \`${k}\``).join(', ')}. \`active\` = présente dans l'état final des migrations SQL ; \`prisma-only\` = connue de la seule chaîne Prisma (${T.filter((t) => t.status === 'prisma-only' && t.zombie).length} sans aucune référence dans le code) ; \`runtime-ddl\` = créée par du code ; \`rollback-only\` = citée par un script de rollback sans \`CREATE\` versionné (tables \`rso_*\`). ${S.dropped_tables} autres tables ont été créées puis supprimées.\n`;
md += `- **Fichiers analysés** : ${S.files_scanned} (${Object.entries(S.files_scanned_by_group).map(([k, v]) => `${k} ${v}`).join(', ')}). Routes API enregistrées : ${S.api_route_files_registered} ; fichiers de routes **non enregistrés** (code mort) : ${S.api_route_files_unregistered_dead_code.map((f) => '`' + f.replace('apps/api/src/routes/', '') + '`').join(', ')}.\n\n`;

md += '### Tables par domaine\n\n| Domaine | Tables | dont `prisma-only` / `rollback-only` / `runtime-ddl` | Sans `tenant_id` requis |\n|---|--:|---|--:|\n';
for (const d of DOMAINS) {
  const l = byDomain[d];
  if (!l.length) continue;
  md += `| ${d} | ${l.length} | ${st(l, 'prisma-only')} / ${st(l, 'rollback-only')} / ${st(l, 'runtime-ddl')} | ${l.filter((t) => t.tenant_id !== 'required').length} |\n`;
}
md += `| **Total** | **${T.length}** | ${st(T, 'prisma-only')} / ${st(T, 'rollback-only')} / ${st(T, 'runtime-ddl')} | **${T.filter((t) => t.tenant_id !== 'required').length}** |\n\n`;
md += 'Les domaines ajoutés par rapport à la liste demandée : `remuneration` (paie des enseignants, spec 031, tranche 2.7). `owner` ne contient que les 3 tables de prospection/commissions (l\'espace owner n\'a pas de table propre : il lit celles des autres domaines).\n\n';

md += '### Tables sans `tenant_id`\n\n';
md += `**${noTenant.absent.length + noTenant.nullable.length + noTenant.inconnu.length} tables sans \`tenant_id\` NOT NULL** (sur ${T.length}) :\n\n`;
md += `- **Colonne absente (${noTenant.absent.length})** : ${fmt(noTenant.absent)}. Légitimes : \`tenants\`, \`super_admin_*\` ; à justifier : \`live_session_webhook_events\` ; les cinq tables du portail public Imhotep (\`accounts\`, \`user_sessions\`, \`verification_tokens\`, \`public_users\`, \`inscriptions_public\`) sont globales par construction (disparaissent avec D7).\n`;
md += `- **Colonne nullable (${noTenant.nullable.length})** : ${fmt(noTenant.nullable)} — tables globales à portée mixte (\`0055\` : rôles globaux, blacklist de jetons super-admin).\n`;
md += `- **Inconnu (${noTenant.inconnu.length})** : ${fmt(noTenant.inconnu)} — aucun \`CREATE TABLE\` dans le dépôt (les fichiers \`0021_rso_phase1.sql\`… ne sont pas versionnés) ; impossible de dire si elles portent \`tenant_id\`.\n`;
md += `- **\`tenant_id\` présent mais aucune RLS posée par les migrations (${noRlsActive.filter((t) => t.tenant_id === 'required').length} tables actives)** : ${fmt(noRlsActive.filter((t) => t.tenant_id === 'required'))} — sept d'entre elles sont les tables Imhotep recréées par \`0056_restore\` APRÈS la boucle RLS de \`0055\`. À relativiser : l'API se connecte en propriétaire/super-utilisateur, donc la RLS n'isole rien (plan §2 ; en-tête de \`0130_rls_professional_bulletins.sql\`).\n\n`;

md += '### Les 10 tables les plus couplées\n\n';
md += 'Score = fichiers API d\'exécution qui la citent + fichiers web qui la citent + fichiers web appelant les routes qui l\'atteignent (borne haute).\n\n| # | Table | Domaine | Module cible | Score | API direct | Web via API | Occurrences API+web |\n|--:|---|---|---|--:|--:|--:|--:|\n';
S.top10_coupled.forEach((t, i) => {
  const row = T.find((x) => x.name === t.name);
  md += `| ${i + 1} | \`${t.name}\` | ${t.domain} | ${row.target_module} | ${t.score} | ${t.api} | ${t.web_via_api} | ${t.occurrences} |\n`;
});
md += '\nLes dix sont des tables « racines » (utilisateurs, élèves, enseignants, classes, programmes, cours, inscriptions, années) : elles sont citées par des dizaines de fichiers de routes et de services de tous les domaines, ce qui chiffre le coût de l\'unification (D2) : toute modification de leur forme touche de ~25 à ~100 fichiers API.\n\n';

md += '### Imhotep, en chiffres\n\n';
md += `- ${im.seed_files.total} fichiers « A » (${Object.entries(im.seed_files.by_group).map(([k, v]) => `${k} ${v}`).join(', ')} ; ${im.seed_files.lines_total} lignes) ; ${im.inbound_imports.length} importations entrantes (dont ${im.inbound_imports.filter((e) => ['apps/api/src/index.ts', 'packages/contracts/src/index.ts'].includes(e.from)).length} dans deux fichiers d'accroche) ; 0 clé étrangère entrante depuis le cœur ; ${mx.tables.filter((t) => t.domain === 'imhotep' && !t.name.endsWith('_aspci')).length} tables + ${mx.tables.filter((t) => t.name.endsWith('_aspci')).length} zombies \`_aspci\`.\n`;
md += '- Voir `imhotep-removal-inventory.md` pour la classification complète et l\'ordre de suppression.\n\n';

md += '## Lire avec précaution\n\n';
md += '- **Le schéma réel de production n\'est pas reconstructible depuis les migrations seules** : la chaîne Prisma crée des tables du cœur absentes de `infra/scripts/migrations` (9 tables utilisées par le code : `bilan_types`, `course_assignments`, `teaching_hours`, `admin_*_messages`, `teacher_student_messages`, `parent_school_conversation*`, `student_period_attendance_summaries`) et le déploiement n\'exécute que Prisma. Pour D8 (reset) et la tranche 2.0, partir d\'un `pg_dump --schema-only` de la base réelle, pas de ces fichiers.\n';
md += '- Le matching des noms est textuel : les mentions en commentaire comptent, les noms construits dynamiquement échappent (sauf `getTableName`). Les domaines et modules cibles viennent de règles (`inventory.config.mjs`), pas d\'une lecture fichier par fichier : vérifier les cas limites dans `tables-usage-matrix.md`.\n';
md += '- `imhotep-removal-inventory.md` §5 répond point par point aux vérifications demandées par le plan §5.2 ; `legacy-dependents-by-slice.md` donne par tranche les couplages dangereux avec `fichier:ligne`.\n';

const out = path.join(root, 'docs/inventory/README.md');
if (check) {
  const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8').replace(/\r\n/g, "\n") === md;
  if (!same) { console.error('DIVERGENCE: README.md'); process.exit(1); }
  process.exit(0);
}
fs.writeFileSync(out, md);
console.log('OK : README.md');
