#!/usr/bin/env node
// Génère docs/inventory/imhotep-removal-inventory.md à partir de :
//   - docs/inventory/imhotep-removal-inventory.json   (imhotep-deps.mjs : graines, dépendances entrantes, npm)
//   - docs/inventory/tables-usage-matrix.json         (build-tables-matrix.mjs : tables et usages)
//   - scripts/inventory/imhotep-notes.mjs             (classification B/C, vérifications, ordre de suppression)
//
//   node scripts/inventory/build-tables-matrix.mjs && node scripts/inventory/imhotep-deps.mjs
//   node scripts/inventory/build-imhotep-doc.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFICATIONS, B_ITEMS, C_ITEMS, STEPS, INCERTAIN } from './imhotep-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dep = JSON.parse(fs.readFileSync(path.join(root, 'docs/inventory/imhotep-removal-inventory.json'), 'utf8'));
const mx = JSON.parse(fs.readFileSync(path.join(root, 'docs/inventory/tables-usage-matrix.json'), 'utf8'));
const check = process.argv.includes('--check');

const seeds = dep.seeds;
const sum = (list) => list.reduce((a, s) => a + s.lines, 0);
const byPrefix = (re) => seeds.filter((s) => re.test(s.file));
const api = byPrefix(/^apps\/api\//);
const web = byPrefix(/^apps\/web\//);
const pub = byPrefix(/^apps\/formation-pro-public\//);
const pkgs = byPrefix(/^packages\//);
const scr = byPrefix(/^(scripts|infra\/scripts)\//);
const isTestOrScript = (f) => /__tests__|\/tests\/|^scripts\/|^apps\/api\/scripts\//.test(f);
const SCODE = (f) => '`' + f.replace(/^apps\/api\/src\//, 'api/src/').replace(/^apps\/web\/src\//, 'web/src/') + '`';

let md = '# Imhotep — inventaire de suppression (D7)\n\n';
md += '> Document généré par `scripts/inventory/build-imhotep-doc.mjs` (tâche 0.6 du plan) à partir de `imhotep-removal-inventory.json` (script `imhotep-deps.mjs`), de `tables-usage-matrix.json` et des notes de `scripts/inventory/imhotep-notes.mjs`. Les listes « A » et les preuves chiffrées sont recalculées à chaque exécution ; les sections B, C et l\'ordre de suppression sont rédigés à la main (références fichier:ligne à la date de l\'inventaire). **Aucune suppression n\'a été faite.**\n\n';

const tables = mx.tables.filter((t) => t.domain === 'imhotep');
const tablesA = tables.filter((t) => !/^live_session/.test(t.name) && t.name !== 'live_sessions');
const live = tables.filter((t) => /^live_session/.test(t.name) || t.name === 'live_sessions');
const aspci = tablesA.filter((t) => t.name.endsWith('_aspci'));
const tablesMain = tablesA.filter((t) => !t.name.endsWith('_aspci'));

md += '## 1. Verdict\n\n';
md += '| Catégorie | Contenu | Volume |\n|---|---|---|\n';
md += `| **A — supprimer sans risque** | fichiers sans dépendance entrante depuis le cœur scolaire / Professional / owner / rémunération | ${seeds.length} fichiers dont ${api.length} API (${sum(api)} lignes), ${web.length} web (${sum(web)} lignes), ${pub.length} dans \`apps/formation-pro-public\` (${sum(pub)} lignes), ${pkgs.length} contrats Zod, ${scr.length} scripts ; ${tablesMain.length} tables + ${aspci.length} tables \`_aspci\` zombies |\n`;
md += `| **B — à découpler d'abord** | le cœur en dépend, ou le fichier est partagé | ${B_ITEMS.length} chantiers (B1–B${B_ITEMS.length}) ; ${dep.inbound_imports.filter((e) => !['apps/api/src/index.ts', 'packages/contracts/src/index.ts'].includes(e.from)).length} importations et ${dep.inbound_table_references.filter((r) => !isTestOrScript(r.file)).length} références de tables entrantes hors accroches mécaniques |\n`;
md += `| **C — à conserver (rangé à tort sous Imhotep)** | | ${C_ITEMS.length} ensembles : prospection/commissions, LiveKit, infrastructure de notifications, e-mail, rendu PDF, abstraction de paiement, auto-inscription, Professional, RSO |\n\n`;
md += 'Trois constats pèsent sur la suite :\n\n';
md += '1. **Le couplage entrant est faible** : hors points d\'accroche mécaniques (`index.ts`, barrel de contrats), seuls `owner-formations`, `owner-staff`, `user-auth` et les chaînes LiveKit/notifications touchent des objets Imhotep (§3). Aucune clé étrangère d\'une table du cœur ne pointe vers une table Imhotep.\n';
md += '2. **Prisma n\'est pas « de l\'Imhotep »** : il porte 9 tables du cœur et c\'est lui que `deploy.sh` exécute (B11). Le supprimer avec Imhotep (plan §5.1) casserait le déploiement.\n';
md += '3. **Plusieurs fonctionnalités du cœur sont Imhotep-adjacentes sans l\'être** : visio (3 parents dont 1 seul Imhotep), notifications, prospection, e-mail, rendu PDF. Un `grep` sur « formation » ou « formateur » supprimerait du Professional et du RSO.\n\n';

// ----------------------------------------------------------------- A
md += '## 2. A — À SUPPRIMER SANS RISQUE\n\n';
md += 'Critère : le script `imhotep-deps.mjs` ne trouve **aucune** importation, aucune référence SQL, aucun appel HTTP, aucun symbole de contrat, depuis un fichier hors de cette liste — sauf les points d\'accroche mécaniques de B10 (`index.ts`, barrel de contrats). Les fichiers dont la suppression exige une édition préalable ailleurs sont en B.\n\n';

const roleOf = (f) => ({
  'routes/formations-pro.ts': 'catalogue public des formations',
  'routes/sessions-pro.ts': 'sessions (public + admin), calendrier, formateurs de session',
  'routes/inscriptions-pro.ts': 'inscriptions (individuel/entreprise), panier, factures',
  'routes/paiements-pro.ts': 'paiement mobile money / carte, webhooks',
  'routes/formateur.ts': 'espace formateur (planning, supports, présences, messagerie)',
  'routes/codes-promo.ts': 'codes promotionnels',
  'routes/entreprises.ts': 'entreprises clientes',
  'routes/documents.ts': 'conventions, devis, attestations Imhotep',
  'routes/exports.ts': 'exports inscriptions/paiements/présences/CA',
  'routes/reporting.ts': 'tableaux de bord Imhotep',
  'services/session-pro.service.ts': 'sessions de formation, formateurs, capacité',
  'services/inscription-pro.service.ts': 'inscriptions, panier, codes promo, réservations',
  'services/formation-pro.service.ts': 'catalogue, supports, programme',
  'services/formateur.service.ts': 'espace formateur (profil, sessions, supports)',
  'services/document-generation.service.ts': 'conventions, devis, attestations, factures (pdfkit)',
  'services/supports-cours.service.ts': 'supports de cours (vidéos, fichiers)',
  'services/export.service.ts': 'exports Excel/CSV',
  'services/entreprise-cliente.service.ts': 'entreprises clientes',
  'services/paiement-pro.service.ts': 'orchestration des paiements (appelle les 5 adaptateurs, SMS, factures)',
  'services/reporting.service.ts': 'indicateurs Imhotep',
  'services/formateur-attendance.service.ts': 'présences des apprenants (formateur)',
  'services/formateur-availability.service.ts': 'disponibilités des formateurs',
  'services/formateur-messaging.service.ts': 'messages formateur → apprenants (e-mail + SMS)',
  'services/invoice.service.ts': 'factures PDF',
  'services/code-promo.service.ts': 'codes promotionnels',
  'services/carte-bancaire.service.ts': 'adaptateur carte (CinetPay) — voir C',
  'services/orange-money.service.ts': 'adaptateur Orange Money (mock) — voir C',
  'services/mtn-money.service.ts': 'adaptateur MTN MoMo — voir C',
  'services/wave.service.ts': 'adaptateur Wave (mock) — voir C',
  'services/tresorpay.service.ts': 'adaptateur TresorPay (Imhotep) — voir C',
  'services/payment-provider.interface.ts': 'interface commune des adaptateurs — voir C (réutilisable, plan §3.12)',
  'services/sms.service.ts': 'Twilio (seul importeur de `twilio`)',
  'services/vimeo.service.ts': 'hébergement vidéo des supports',
  'utils/table-names.ts': 'indirection `_aspci` (constantes)',
  'utils/sessionAccess.ts': 'contrôle d\'accès formateur ↔ session',
  'utils/audit-log.ts': 'journal d\'audit formateur (corps commenté)',
  'utils/transaction-number.util.ts': 'numéro de transaction (paiement-pro)',
  'utils/enrollment-number.util.ts': 'aucun importeur (orphelin)',
  'jobs/document-automation.job.ts': 'génération automatique de documents (cron)',
  'jobs/reservation-cleanup.job.ts': 'libération des réservations temporaires (toutes les 5 min)',
  'middleware/formateurAuth.ts': 'garde « formateur actif »',
}[f.replace('apps/api/src/', '')] || '');
// statut : « A » si seuls index.ts / barrel de contrats importent ; sinon « A après Bx »
const BARREL = new Set(['apps/api/src/index.ts', 'packages/contracts/src/index.ts']);
const statusOf = (s) => {
  const ext = s.inbound_imports.map((x) => x.split(':')[0]).filter((f) => !BARREL.has(f));
  if (!ext.length) return 'A';
  return 'A après B2 (' + [...new Set(ext)].map((f) => f.replace('apps/api/src/services/', '')).join(', ') + ')';
};
const aApi = api.filter((s) => statusOf(s) === 'A');
md += `### 2.1 API (${api.length} fichiers, ${sum(api)} lignes ; ${aApi.length} sans aucune dépendance entrante, ${api.length - aApi.length} à débloquer par B2)\n\n| Fichier | Lignes | Statut | Rôle |\n|---|--:|---|---|\n`;
for (const s of api.sort((a, b) => b.lines - a.lines)) md += `| ${SCODE(s.file)} | ${s.lines} | ${statusOf(s)} | ${roleOf(s.file)} |\n`;

md += `\n### 2.2 Web \`apps/web\` (${web.length} fichiers, ${sum(web)} lignes)\n\n| Dossier / fichier | Fichiers | Lignes |\n|---|--:|--:|\n`;
const grp = new Map();
for (const s of web) {
  const m = /^apps\/web\/src\/(app\/[^/]+(?:\/[^/]+)?|components\/[^/]+(?:\/[^/]+)?|lib\/[^/]+(?:\/[^/]+)?|__tests__)\//.exec(s.file);
  let key = m ? `apps/web/src/${m[1]}/` : s.file;
  if (/^apps\/web\/src\/lib\/hooks\/use-/.test(s.file)) key = 'apps/web/src/lib/hooks/use-* (hooks Imhotep)';
  if (!grp.has(key)) grp.set(key, { n: 0, l: 0 });
  grp.get(key).n++; grp.get(key).l += s.lines;
}
for (const [k, v] of [...grp.entries()].sort((a, b) => b[1].l - a[1].l)) md += `| \`${k}\` | ${v.n} | ${v.l} |\n`;
md += '\nFichiers orphelins après suppression (tous leurs importeurs sont dans la liste) : ' + (dep.closure_candidates_only_imported_by_imhotep.map((c) => `\`${c.file.replace('apps/web/src/', 'web/src/')}\``).join(', ') || 'aucun') + '.\n';

md += `\n### 2.3 Portail public \`apps/formation-pro-public\` (${pub.length} fichiers, ${sum(pub)} lignes)\n\nApplication Next.js autonome (next-auth, Prisma, Resend, PayHubSecure) : ${pub.filter((s) => /\/page\.tsx$/.test(s.file)).length} pages, ${pub.filter((s) => /\/route\.ts$/.test(s.file)).length} routes API, ${pub.filter((s) => /\/components\//.test(s.file)).length} composants, accès **direct** à la base par Prisma (\`public_users\`, \`accounts\`, \`inscriptions_public\`, \`verification_tokens\`, \`supports_cours\`, \`formations_professionnelles\`, \`formateurs\`, \`sessions_professionnelles\`). Elle n'importe rien d'autre du monorepo que \`@ecoledigitale/ui\` (cloche de notification, \`LiveSessionRoom\`). Suppression du répertoire entier.\n\n`;
const pubGrp = new Map();
for (const s of pub) {
  const m = /^apps\/formation-pro-public\/(src\/[^/]+|[^/]+)/.exec(s.file);
  const k = m ? m[1] : s.file;
  if (!pubGrp.has(k)) pubGrp.set(k, { n: 0, l: 0 });
  pubGrp.get(k).n++; pubGrp.get(k).l += s.lines;
}
md += '| Sous-dossier | Fichiers | Lignes |\n|---|--:|--:|\n';
for (const [k, v] of [...pubGrp.entries()].sort((a, b) => b[1].l - a[1].l)) md += `| \`${k}\` | ${v.n} | ${v.l} |\n`;

md += `\n### 2.4 Contrats Zod \`packages/contracts\` (${pkgs.length} fichiers, ${sum(pkgs)} lignes)\n\n`;
md += pkgs.map((s) => '`' + s.file.replace('packages/contracts/src/', '') + '`').join(', ') + '.\n\n';
md += 'Ré-exportés par `packages/contracts/src/index.ts:24,27,30,33,36-77,80-83` (édition B10). Aucun symbole de ces dossiers n\'est importé par le cœur, sauf `FormationDetail` (B7) et la collision `PaymentInitiationResponse` (B8).\n';

md += `\n### 2.5 Scripts racine (${scr.length} fichiers)\n\n` + scr.map((s) => `- \`${s.file}\` (${s.lines} lignes)`).join('\n') + '\n\n';
md += 'Entrées de `package.json` à retirer : `dev:formation-public`, `db:formation-public:apply`, `db:formation-public:generate` (l. 13-15), `migrate:imhotep-data` (l. 22), `test:imhotep-data`, `test:imhotep-data-insert`, `validate:imhotep-data` (l. 29-31 — les deux scripts de test pointent vers des fichiers **absents** du dépôt) ; dans `apps/api/package.json` : `test:formations-pro` (l. 27, fichier absent). Ces entrées contiennent par ailleurs un mot de passe de base en clair (à retirer en tâche 0.4, indépendamment d\'Imhotep).\n\n';

md += '### 2.6 Infrastructure et CI\n\n| Élément | Référence | Remarque |\n|---|---|---|\n';
md += '| Service compose `ecoledigitale-formation-pro` | `infra/compose/docker-compose.yml:29-57` | port hôte 3012, `NEXTAUTH_URL` propre |\n';
md += '| Construction de l\'image | `infra/scripts/deploy.sh:29` | **à retirer en même temps** que le service, sinon `dc build` échoue |\n';
md += '| Dockerfile | `infra/compose/Dockerfile.formation-pro-public` (68 l.) | génère le client Prisma |\n';
md += '| Vhost nginx | `infra/nginx/formation-pro.conf` (79 l.) | installé à la main sur le serveur (`infra/scripts/bootstrap-server.md:83-115`) |\n';
md += '| Variables d\'environnement | `infra/.env.example:32-53`, `apps/formation-pro-public/.env.example` | `NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_*`, `PAYHUBSECURE_*`, `RESEND_*` ; côté API : `TWILIO_*`, `VIMEO_*`, `ORANGE_MONEY_*`, `MTN_MONEY_*`, `WAVE_*`, `TRESORPAY_*`, `CINETPAY_*` |\n';
md += '| Documentation d\'exploitation | `infra/scripts/bootstrap-server.md:31,83-115,204-233` | ports, vhost, OAuth Google |\n';
md += '| CI | `.github/workflows/deploy.yml` | **aucune modification** : il appelle `deploy.sh` |\n\n';

md += '### 2.7 Dépendances npm exclusives à Imhotep\n\n| Package | Dépendance | Importée seulement par | Remarque |\n|---|---|---|---|\n';
const exclusive = (pk) => dep.npm[pk].filter((d) => d.imhotep_importers > 0 && d.other_importers === 0 && pk.startsWith('apps/formation-pro-public') === false);
for (const d of exclusive('apps/api/package.json')) md += `| \`apps/api\` | \`${d.dep}\` | ${d.imhotep_sample.map((f) => '`' + f.replace('apps/api/src/', '') + '`').join(', ')} | retirable après étape 4${d.dep === 'exceljs' ? ' ; **redeviendra utile** (imports/exports Excel, plan §3.13)' : d.dep === 'axios' ? ' ; utile aux futurs adaptateurs de paiement (C)' : d.dep === 'twilio' ? ' ; le fournisseur SMS CI reste à choisir (plan §8)' : ''} |\n`;
for (const d of exclusive('apps/web/package.json')) md += `| \`apps/web\` | \`${d.dep}\` | ${d.imhotep_sample.map((f) => '`' + f.replace('apps/web/src/', '') + '`').join(', ')} | |\n`;
md += `| \`apps/formation-pro-public\` | ${dep.npm['apps/formation-pro-public/package.json'].length} dépendances (next, next-auth, @prisma/client, resend, nodemailer, bcryptjs, zustand…) | tout le package | disparaît avec le répertoire ; \`pnpm-lock.yaml\` à régénérer |\n\n`;
md += 'Toute modification de `package.json` impose de régénérer `pnpm-lock.yaml` dans le même commit : les `Dockerfile.api` / `Dockerfile.web` installent avec `--frozen-lockfile`.\n\n';

md += '### 2.8 Base de données\n\n';
md += `**Tables Imhotep** (${tablesMain.length}, statut dans \`tables-usage-matrix.md\`) :\n\n| Table | Origine | Statut | Fichiers du cœur qui la citent |\n|---|---|---|--:|\n`;
const isImSeed = (f) => seeds.some((s) => s.file === f);
for (const t of tablesMain.sort((a, b) => (a.name < b.name ? -1 : 1))) {
  const coreRefs = t.refs.filter(([f]) => !isImSeed(f) && !/^(scripts|apps\/api\/scripts)\//.test(f)).length;
  md += `| \`${t.name}\` | ${t.origin_migration.replace(/\(aucun.*$/, '')} | ${t.status}${t.zombie ? ', sans aucune référence' : ''} | ${coreRefs} |\n`;
}
md += `\n**Zombies Prisma \`*_aspci\`** (${aspci.length}) : ${aspci.map((t) => '`' + t.name + '`').join(', ')} — présentes dans le baseline Prisma \`20260403110000\`, supprimées par \`0055_unified_multitenancy.sql\` côté SQL, citées nulle part dans le code. Elles existent encore sur toute base initialisée par \`prisma migrate deploy\`.\n\n`;
md += `**Tables partagées (C, à NE PAS supprimer)** : ${live.map((t) => '`' + t.name + '`').join(', ')} — voir B5.\n\n`;
md += '**Aucune clé étrangère d\'une table du cœur ne référence une table Imhotep** (`fk_inbound_from_core` vide) ; les seules FK sortantes d\'Imhotep vers le cœur visent `users` et `tenants`. Colonnes « souples » à retirer : `live_sessions.session_professionnelle_id` (B5).\n\n';
md += '**Objets SQL Imhotep** : fonctions `generate_session_code`, `set_session_code`, `generate_enrollment_number`, `set_enrollment_number`, `generate_invoice_number`, `update_session_capacity_on_enrollment_change` (+ triggers `trigger_update_session_capacity_*`, `set_session_code_trigger`, `set_enrollment_number_trigger`) ; enums `session_professional_status`, `enrollment_type`, `enrollment_professional_status`, `promo_code_reduction_type`, `payment_method`, `payment_professional_status`, `document_type`, `export_type`, `job_status`. Exclusions : voir B14.\n\n';
md += '**Migrations d\'origine** (archivées avec `legacy-final`, jamais rejouées) : `0037_imhotep_data_professional_training`, `0038_add_formations_pro_fts_index`, `0039_reservations_temporaires`, `0040_formateur_space_tables`, `0041_documents_export_jobs`, `0044_add_carriere_to_formations_professionnelles`, `0045_aspci_professional_training_setup`, `0046_create_aspci_professional_training_tables`, `0047_increase_price_precision`, `0051_imhotep_remove_sessions_formateurs`, `0056_restore_pro_sessions_formateurs`, `9999_update_session_capacity_trigger` ; mixtes : `0055_unified_multitenancy` (fusion `_aspci`), `0056_live_sessions` et `0057_notifications` (C), `0069_pedagogie_ue_ecue` (colonne `live_sessions`). Chaîne Prisma : `20260403110000_baseline`, `20260420120000_add_public_portal_tables` (`public_users`, `accounts`, `user_sessions`, `verification_tokens`, `inscriptions_public`).\n\n';

md += '### 2.9 Données et services externes (hors dépôt — à traiter avec l\'exploitant)\n\n';
md += '- Données des tables de §2.8 sur chaque tenant (`imhotepacademy`, `imhotepdata`, `aspci`…) : **comptage et export à décider** (D8 est une hypothèse, plan §1).\n- DNS et certificat `formation-pro.allianceconsultants.net` ; vhost nginx installé à la main.\n- Clients et comptes tiers : Google OAuth (portail), PayHubSecure, Resend, Twilio, Vimeo, Orange Money / MTN MoMo / Wave / CinetPay / TresorPay.\n- Stockage objet des supports de cours et enregistrements (`supports_cours`, `LIVEKIT_RECORDINGS_*` — ces derniers à conserver tant que la visio existe).\n\n';

// ----------------------------------------------------------------- B
md += '## 3. B — À DÉCOUPLER D\'ABORD\n\n';
md += 'Pour chaque chantier : qui dépend de quoi (fichier:ligne), l\'action de découplage, le test de fin de chantier.\n\n';
for (const b of B_ITEMS) {
  md += `### ${b.id} — ${b.titre}\n\n**Dépendance** : ${b.dep}\n\n`;
  md += b.refs.map((r) => `- ${r}`).join('\n') + '\n\n';
  md += `**Action** : ${b.action}\n\n**Test** : ${b.test}\n\n`;
}

md += '### Preuves automatiques (imhotep-deps.mjs)\n\n';
md += `Importations entrantes vers les graines depuis des fichiers hors graines (${dep.inbound_imports.length}) :\n\n| Depuis | Ligne | Vers |\n|---|--:|---|\n`;
for (const e of dep.inbound_imports) md += `| \`${e.from.replace('apps/', '')}\` | ${e.line} | \`${e.to.replace('apps/', '')}\` |\n`;
md += `\nRéférences SQL entrantes vers des tables Imhotep depuis des fichiers hors graines, hors tests (${dep.inbound_table_references.filter((r) => !/__tests__|\/tests\//.test(r.file)).length}) :\n\n| Table | Fichier | Lignes |\n|---|---|---|\n`;
for (const r of dep.inbound_table_references.filter((x) => !/__tests__|\/tests\//.test(x.file))) md += `| \`${r.table}\` | \`${r.file.replace('apps/api/src/', 'api/src/')}\`${r.shared_candidate ? ' (partagé)' : ''} | ${r.lines.join(', ')} |\n`;
md += `\nAppels HTTP entrants (web → préfixes Imhotep ou partagés) :\n\n| Fichier | Lignes : préfixe |\n|---|---|\n`;
for (const h of dep.inbound_http_calls) md += `| \`${h.file.replace('apps/', '')}\` | ${h.hits.map((x) => `${x.line}: ${x.prefix}`).join(', ')} |\n`;
md += `\nClés étrangères entrantes depuis le cœur : **${dep.fk_inbound_from_core.length}**. Symboles de contrats Imhotep importés par le cœur : ${dep.inbound_contract_symbols.map((c) => '`' + c.file.replace('apps/api/src/', 'api/src/') + '` (' + c.symbols.join(', ') + ')').join(', ') || 'aucun'}.\n\n`;

// ----------------------------------------------------------------- C
md += '## 4. C — À CONSERVER (rangé à tort sous Imhotep)\n\n| Ensemble | Pourquoi | Preuves |\n|---|---|---|\n';
for (const c of C_ITEMS) md += `| ${c.item} | ${c.pourquoi} | ${c.preuves.join(' ; ')} |\n`;
md += '\n';

// ----------------------------------------------------------------- vérifications
md += '## 5. Vérifications demandées par le plan (§5.2)\n\n';
for (const v of VERIFICATIONS) md += `### ${v.q}\n\n${v.a}\n\n`;

// ----------------------------------------------------------------- étapes
md += '## 6. Ordre de suppression en étapes sûres\n\n';
md += 'Chaque étape est livrable et réversible seule (`main` reste déployable). **L\'étape 3 hors dépôt et l\'étape 7 sont destructives et soumises à votre confirmation explicite.** Le test de fin d\'étape se compose toujours de (a) la suite de tests nommée, (b) `node scripts/inventory/imhotep-residue.mjs` (le groupe concerné doit tomber à 0), (c) un parcours manuel court.\n\n';
md += 'Commandes disponibles : `node scripts/inventory/imhotep-residue.mjs --list`, `--group <nom> --expect 0` (code retour 1 sinon), et `node scripts/inventory/imhotep-deps.mjs` pour revoir les dépendances entrantes tant que les fichiers existent.\n\n';
for (const s of STEPS) {
  md += `### Étape ${s.n} — ${s.titre}\n\n**À faire**\n\n` + s.actions.map((a) => `- ${a}`).join('\n') + '\n\n**Test de fin d\'étape**\n\n' + s.test.map((a) => `- ${a}`).join('\n') + '\n\n';
}

md += '## 7. Ce qui reste incertain\n\n' + INCERTAIN.map((x) => `- ${x}`).join('\n') + '\n\n';
md += '## 8. Compteurs de résidus au moment de l\'inventaire\n\nÀ relancer : `node scripts/inventory/imhotep-residue.mjs` (le portail `apps/formation-pro-public` est exclu du balayage ; les fichiers Imhotep eux-mêmes comptent tant qu\'ils existent).\n';

const out = path.join(root, 'docs/inventory/imhotep-removal-inventory.md');
if (check) {
  const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8').replace(/\r\n/g, "\n") === md;
  if (!same) { console.error('DIVERGENCE: imhotep-removal-inventory.md'); process.exit(1); }
  process.exit(0);
}
fs.writeFileSync(out, md);
console.log(`OK : ${seeds.length} fichiers A (${api.length} api, ${web.length} web, ${pub.length} public, ${pkgs.length} contrats, ${scr.length} scripts), ${tablesMain.length}+${aspci.length} tables, ${B_ITEMS.length} chantiers B, ${C_ITEMS.length} ensembles C.`);
