#!/usr/bin/env node
/**
 * Genere `docs/qa/demo-sweep-report.md` a partir des JSON bruts de `demo-sweep.mjs` (`.demo/qa/`) :
 *   - `acct-<tenant>-<role>.json`    : balayage complet d'un compte ;
 *   - `menu-<tenant>-<role>.json`    : passe « menus » (menu rendu, liens de menu visites, permissions et navigation de l'API) ;
 *   - `recheck-<tenant>-<role>.json` : second passage de pages en defaut (pour distinguer reproductible / transitoire).
 * Aucun secret : les JSON ne contiennent que des e-mails de demonstration, des chemins et des extraits de texte d'ecran.
 *
 *   node scripts/qa/report.mjs [--in=.demo/qa] [--out=docs/qa/demo-sweep-report.md] [--fixed=scripts/qa/fixed.json]
 *
 * `fixed.json` (optionnel) : [{ "code": "api-404", "match": "admissions/campaigns", "note": "commit ..." }] pour marquer un
 * constat comme corrige (la sous-chaine `match` est cherchee dans le message, la route et la preuve).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { demoDir, repoRoot } from "./lib.mjs";
import { SEVERITY_ORDER, TECHNICAL_KEY_PAGES } from "./analyze.mjs";
import { listTreeEntries, patternOf, sourceFileOf } from "./tree.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a, true]; }));
const inDir = args.in ?? join(demoDir(), "qa");
const outFile = args.out ?? join(repoRoot, "docs", "qa", "demo-sweep-report.md");
const fixedFile = args.fixed ?? join(repoRoot, "scripts", "qa", "fixed.json");
const fixedList = existsSync(fixedFile) ? JSON.parse(readFileSync(fixedFile, "utf8")) : [];

const load = (prefix) => {
  const out = new Map();
  for (const f of readdirSync(inDir).filter((n) => n.startsWith(`${prefix}-`) && n.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(join(inDir, f), "utf8"));
    out.set(`${data.result.account.tenant}/${data.result.account.role}`, { ...data.result, file: f, generatedAt: data.generatedAt, done: data.done });
  }
  return out;
};
const accts = load("acct");
const menus = load("menu");
const rechecks = load("recheck");
const results = [...accts.values()];
if (!results.length) throw new Error(`Aucun resultat dans ${inDir}`);

/** Table `/admin/...` -> `/v2/...` de la coquille d'administration (lue dans `apps/web/src/platform/admin/menu.ts`). */
const LEGACY_TO_V2 = Object.fromEntries(
  [...readFileSync(join(repoRoot, "apps", "web", "src", "platform", "admin", "menu.ts"), "utf8").matchAll(/"(\/[^"]+)":\s*"(\/v2\/[^"]+)"/g)].map((m) => [m[1], m[2]]),
);

const norm = (s) => String(s ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\b\d{4,}\b/g, ":n");
const short = (t) => t.replace("demo-", "");

// --- recherche du fichier source d'un appel API (hooks web) ---------------------------------------------------------------------
const webFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && !/[\\/]platform[\\/]test[\\/]/.test(full)) webFiles.push({ rel: relative(repoRoot, full).split("\\").join("/"), text: readFileSync(full, "utf8") });
  }
})(join(repoRoot, "apps", "web", "src"));
function sourcesForEndpoint(path) {
  const m = /^\/api\/v1\/([^/?]+)(\/[^?]*)?/.exec(path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|:id/gi, ":id"));
  if (!m) return [];
  const tail = (m[2] ?? "").split("/").filter((s) => s && s !== ":id").join("/");
  if (!tail) return webFiles.filter((f) => f.text.includes(`/api/v1/${m[1]}`)).slice(0, 2).map((f) => f.rel);
  const needles = [`/api/v1/${m[1]}/${tail}`, `/${tail}\``, `/${tail}"`, `"/${tail}`];
  const mod = m[1].replace(/-/g, "[-_]?");
  return webFiles
    .filter((f) => needles.some((n) => f.text.includes(n)) && new RegExp(mod, "i").test(f.text))
    .map((f) => f.rel)
    .sort((a, b) => a.length - b.length)
    .slice(0, 3);
}

// --- agregation des constats -------------------------------------------------------------------------------------------------
const groups = new Map();
let pageCount = 0;
const visitedPatterns = new Set();
const loginFailures = [];
const recheckPass = new Set(); // "role|url|code" revisites sans le meme constat
for (const rc of rechecks.values()) {
  for (const p of rc.pages) {
    const codes = new Set((p.findings ?? []).map((f) => f.code));
    recheckPass.add(`${rc.account.tenant}/${rc.account.role}|${p.url}|*${[...codes].length ? "" : "ok"}`);
    for (const c of ["http-5xx", "dev-toast", "dev-overlay", "blank-page", "console-js", "page-error"]) if (!codes.has(c)) recheckPass.add(`${rc.account.tenant}/${rc.account.role}|${p.url}|${c}`);
  }
}
function ingest(r, p, f, kind) {
  if (f.code === "raw-i18n-key" && TECHNICAL_KEY_PAGES.test(p.url.split("?")[0])) return;
  const route = p.pattern ?? patternOf(p.url.split("?")[0]) ?? p.url;
  // Defauts d'API systemiques (meme appel en echec sur beaucoup de pages) : un seul constat, avec la liste des pages.
  const apiSystemic = f.code.startsWith("api-");
  const systemic = apiSystemic || ["http-404", "no-shell", "denied-redirect", "dev-toast", "console-js"].includes(f.code);
  const key = apiSystemic
    ? `${f.code}|${norm(f.message).replace(/^.*?(GET|POST|PUT|PATCH|DELETE) /, "$1 ").replace(/\?\S*/, "")}`
    : systemic
      ? `${f.code}|${norm(f.message)}`
      : `${f.code}|${norm(f.message)}|${route}`;
  const g = groups.get(key) ?? { severity: f.severity, code: f.code, message: norm(f.message), route, routes: new Set(), evidence: f.evidence, urls: new Set(), roles: new Set(), shot: p.screenshot, systemic, transient: true, kinds: new Set() };
  g.routes.add(route);
  g.urls.add(p.url);
  g.kinds.add(kind);
  g.roles.add(`${short(r.account.tenant)}/${r.account.role}`);
  if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[g.severity]) g.severity = f.severity;
  if (!recheckPass.has(`${r.account.tenant}/${r.account.role}|${p.url}|${f.code}`)) g.transient = false;
  groups.set(key, g);
}
for (const r of results) {
  if (r.loginError) loginFailures.push(r);
  for (const p of r.pages) {
    pageCount += 1;
    visitedPatterns.add(p.pattern ?? patternOf(p.url.split("?")[0]) ?? p.url);
    for (const f of p.findings ?? []) ingest(r, p, f, "balayage");
  }
}
for (const r of menus.values()) for (const p of r.pages) for (const f of p.findings ?? []) if (f.code !== "empty-state" && (f.severity !== "mineur" || /404|5xx/.test(f.code))) ingest(r, p, f, "menu");

const isFixed = (g) => fixedList.find((x) => x.code === g.code && [g.message, g.route, g.evidence, ...g.routes].some((s) => String(s).includes(x.match)));

const CAUSE = {
  "http-5xx": "Exception serveur dans le rendu de la page (composant serveur / garde) : voir `.demo/logs/web.log` ; souvent transitoire sous `next dev` (recompilation).",
  "http-404": "Route absente de l'arborescence `app/v2` ou lien de menu mal forme (entree historique `/admin/...` non reecrite par `mapToV2Href`).",
  "dev-overlay": "Exception de rendu client/serveur : lire le message en preuve ; souvent un champ de contrat absent ou null.",
  "dev-toast": "Erreur capturee par Next (voir la console) : exception de composant ou erreur d'hydratation.",
  "error-screen": "Etat d'erreur du composant (requete en echec) ou page d'erreur par defaut.",
  "page-error": "Exception JS non interceptee : composant client lisant un champ absent/null de la reponse API.",
  "blank-page": "Rendu vide : composant client qui ne s'affiche pas faute de donnees ou de permission, sans etat vide/erreur.",
  "api-5xx": "Erreur serveur de l'API : voir `.demo/logs/api.log` pour la trace.",
  "api-400": "Requete mal formee : parametre que le contrat de l'API rejette (desalignement web <-> contrat Zod).",
  "api-404": "Le web appelle une route inexistante ou un identifiant inconnu (route renommee ou jamais exposee cote API).",
  "api-403": "Permission ou fonctionnalite de l'offre manquante pour ce role : le web appelle un point d'API que le role ne peut pas lire (menu/ecran non filtre par la meme permission).",
  "api-401": "Jeton absent ou expire sur l'appel (proxy web -> API, rafraichissement de session).",
  "api-401-no-profile": "L'API repond 401 quand le compte n'a pas de profil lie (devrait etre 403/404 ; risque de deconnexion par l'intercepteur).",
  "denied-redirect": "Garde `requirePermission` plus stricte que le lien qui y mene : le lien devrait etre masque sans la permission de la page cible.",
  "session-lost": "Garde de session ou rafraichissement du jeton.",
  "i18n-missing": "Cle absente de `apps/web/messages/fr-CI.json` (ou mauvais espace de noms `useTranslations`).",
  "raw-i18n-key": "Cle affichee telle quelle : cle absente de `fr-CI.json` ou valeur non traduite.",
  "suspect-text": "Valeur absente (champ null/undefined) interpolee dans un libelle sans repli.",
  "label-not-enrolled": "Statut d'inscription non propage vers ce portail (voir le mapping des evenements d'inscription).",
  "alert-without-api-failure": "Etat d'erreur affiche alors qu'aucune requete n'a echoue : logique de composant.",
  "console-js": "Erreur d'hydratation React : rendu serveur different du rendu client (date/heure, `typeof window`, attribut variable).",
  "no-shell": "Le layout de premier niveau du module (`app/v2/<module>/layout.tsx`) ne pose pas `<AppShell>` (`platform/shell/AppShell.tsx` : nom de l'etablissement, menu global, modules, compte, deconnexion) ; le test statique `app/v2/shell-coverage.test.ts` le verifie.",
  "empty-state": "A confronter a la graine de demonstration (`scripts/seed-v2`).",
};

const sevs = ["bloquant", "majeur", "mineur"];
const sorted = [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.urls.size - a.urls.size || a.code.localeCompare(b.code));
const isEmpty = (g) => g.code === "empty-state";
const defects = sorted.filter((g) => !isEmpty(g));
const empties = sorted.filter(isEmpty);

const lines = [];
const L = (s = "") => lines.push(s);
const total = { bloquant: 0, majeur: 0, mineur: 0 };
for (const g of defects) total[g.severity] += 1;
const fixedCount = defects.filter((g) => isFixed(g)).length;
const transientCount = defects.filter((g) => g.transient && g.severity !== "mineur" && rechecks.size).length;

L("# Balayage QA de la démonstration locale : rapport");
L();
L(`Généré le ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC par \`scripts/qa/report.mjs\` à partir de \`scripts/qa/demo-sweep.mjs\` (pile \`pnpm demo:up\`, web \`next dev\`, lecture seule). Bruts : \`.demo/qa/\` (non versionné).`);
L();
L("## Résumé");
L();
L(`- Comptes balayés : **${results.length - loginFailures.length}** sur ${results.length} (${[...new Set(results.map((r) => r.account.tenant))].join(", ")}).`);
L(`- Pages visitées (page x rôle) : **${pageCount}**, dont **${visitedPatterns.size}** routes distinctes de l'arborescence \`app/v2\` sur ${listTreeEntries().length}.`);
L(`- Constats distincts (regroupés par type, route et message ; les défauts d'API systémiques sont regroupés par appel) : **${total.bloquant} bloquant(s)**, **${total.majeur} majeur(s)**, **${total.mineur} mineur(s)** ; ${empties.length} états vides à confronter aux données de démo.`);
if (fixedCount) L(`- Corrigés dans la branche : **${fixedCount}** (marqués ✔ ci-dessous).`);
if (transientCount) L(`- Non reproduits au second passage (transitoires, \`next dev\`) : **${transientCount}** (marqués ⟳).`);
if (loginFailures.length) L(`- Connexions en échec : ${loginFailures.map((r) => `${r.account.tenant}/${r.account.role} (${r.loginError})`).join(" ; ")}.`);
L();
L("Gravités : **bloquant** = page inutilisable (5xx, écran d'erreur ou blanc, exception, lien de menu mort, boucle) ; **majeur** = fonction cassée ou donnée fausse (appel API rejeté sur une page atteignable par l'interface, clé i18n brute, `undefined`, lien menant à un refus, libellé incohérent) ; **mineur** = cosmétique, refus 403/404 attendu sur une page hors menu (route de l'arborescence sans lien depuis l'interface), bruit console.");
L();
// Synthèse rédigée à la main (priorités, corrections livrées, décisions à prendre) : `scripts/qa/report-notes.txt`.
const notesFile = join(repoRoot, "scripts", "qa", "report-notes.txt");
if (existsSync(notesFile)) {
  L(readFileSync(notesFile, "utf8").trim());
  L();
}
L("## Couverture par rôle");
L();
L("| Établissement | Rôle | Atterrissage | Pages | Menu (liens) | Bloquant | Majeur | Mineur |");
L("|---|---|---|---:|---:|---:|---:|---:|");
for (const r of results) {
  const c = { bloquant: 0, majeur: 0, mineur: 0 };
  for (const p of r.pages) for (const f of p.findings ?? []) if (f.code !== "empty-state") c[f.severity] += 1;
  L(`| ${short(r.account.tenant)} | ${r.account.role} | ${r.loginError ? "CONNEXION EN ÉCHEC" : `\`${r.landing}\``} | ${r.pages.length}${r.queueLeft ? ` (+${r.queueLeft} non visitées)` : ""} | ${r.landingMenu?.length ?? "?"} | ${c.bloquant} | ${c.majeur} | ${c.mineur} |`);
}
L();

for (const sev of sevs) {
  const list = defects.filter((g) => g.severity === sev);
  L(`## ${sev[0].toUpperCase() + sev.slice(1)} (${list.length})`);
  L();
  if (!list.length) {
    L("Aucun constat.");
    L();
    continue;
  }
  if (sev === "mineur") {
    // Les mineurs sont nombreux (403/404 attendus sur des pages hors menu, bruit console) : tableau compact.
    L("| # | Type | Constat | Pages (ex.) | Rôles |");
    L("|---:|---|---|---|---|");
    list.forEach((g, n) => {
      const fx = isFixed(g);
      const ex = [...new Set([...g.urls].map((u) => u.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")))].slice(0, 3).map((u) => `\`${u}\``).join(", ");
      L(`| m${n + 1} | \`${g.code}\` | ${fx ? "✔ " : ""}${g.message.replace(/\|/g, "/").slice(0, 150)} | ${ex}${g.urls.size > 3 ? ` (+${g.urls.size - 3})` : ""} | ${[...g.roles].slice(0, 3).join(", ")}${g.roles.size > 3 ? " …" : ""} |`);
    });
    L();
    continue;
  }
  let i = 0;
  for (const g of list) {
    i += 1;
    const fx = isFixed(g);
    const roles = [...g.roles];
    const urls = [...g.urls];
    const mark = fx ? "✔ " : g.transient && rechecks.size && sev !== "mineur" ? "⟳ " : "";
    L(`### ${sev.slice(0, 1).toUpperCase()}${i}. ${mark}${g.message}`);
    L();
    if (g.systemic) {
      const shown = (urls.length <= 40 ? urls : [...g.routes]).map((x) => `\`${x.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}\``);
      const uniq = [...new Set(shown)];
      L(`- **Pages concernées** : ${g.routes.size} route(s), ${urls.length} URL : ${uniq.slice(0, 40).join(", ")}${uniq.length > 40 ? " …" : ""}`);
    }
    else L(`- **Route** : \`${g.route}\`${urls.length > 1 ? ` (${urls.length} URL, ex. \`${urls[0]}\`)` : urls[0] !== g.route ? ` (\`${urls[0]}\`)` : ""}`);
    L(`- **Rôles** : ${roles.length > 8 ? `${roles.slice(0, 8).join(", ")} … (${roles.length})` : roles.join(", ")}`);
    L(`- **Type** : \`${g.code}\`${g.kinds.has("menu") ? " (passe menus)" : ""}`);
    if (g.evidence) L(`- **Preuve** : \`${String(g.evidence).replace(/`/g, "'").replace(/\s+/g, " ").slice(0, 300)}\``);
    if (g.shot) L(`- **Capture** : \`.demo/qa/${g.shot.replace(/\\/g, "/")}\``);
    L(`- **Cause probable** : ${CAUSE[g.code] ?? "À analyser."}`);
    const endpoint = /(GET|POST|PUT|PATCH|DELETE) (\/api\/v1\/\S+)/.exec(g.message)?.[2];
    const srcs = endpoint ? sourcesForEndpoint(endpoint) : [];
    const own = sourceFileOf(g.route);
    if (srcs.length) L(`- **Fichier suspect** : ${srcs.map((s) => `\`${s}\``).join(", ")}`);
    else if (own) L(`- **Fichier suspect** : \`${own}\``);
    if (fx) L(`- **Correction** : ${fx.note}`);
    L();
  }
}

// --- menus --------------------------------------------------------------------------------------------------------------------
L("## Menus de navigation par rôle");
L();
if (!menus.size) L("Passe « menus » non exécutée.");
else {
  L("Menu rendu à l'atterrissage, liens de menu visités (un lien mort est un constat bloquant ci-dessus), et comparaison avec la navigation de l'API (`/api/v1/rbac/me/navigation`, tous portails) : entrées de l'API absentes du menu rendu = entrées filtrées côté web ou mal réécrites.");
  L();
  L("| Établissement | Rôle | Liens du menu rendu | Entrées API (tous portails) | Entrées API absentes du menu rendu | Droits / abonnement (`entitlements/me`) |");
  L("|---|---|---:|---:|---|---|");
  for (const r of menus.values()) {
    const rendered = new Set([...(r.landingMenu ?? []), ...(r.adminMenu ?? [])]);
    const apiItems = Object.values(r.api?.navigation ?? {}).flat();
    // Seul le portail `admin` de l'API alimente le menu rendu par la coquille d'administration (`buildV2Menu`, avec `mapToV2Href`).
    const adminItems = (r.api?.navigation?.admin ?? []).filter((it) => it?.href);
    const missing = adminItems.filter((it) => !rendered.has(it.href) && !rendered.has(LEGACY_TO_V2[it.href] ?? it.href)).map((it) => `${it.label} (\`${it.href}\`)`);
    L(`| ${short(r.account.tenant)} | ${r.account.role} | ${rendered.size} | ${apiItems.length} | ${missing.length ? missing.slice(0, 3).join(", ") + (missing.length > 3 ? ` … (+${missing.length - 3})` : "") : "—"} | ${r.api ? (r.api.entitlementsStatus === 200 ? "lisible" : `HTTP ${r.api.entitlementsStatus}`) : "?"} |`);
  }
}
L();

L("## États vides à confronter aux données de démo");
L();
L("Information, pas un défaut avéré : pages dont le contenu se réduit à un état vide. À rapprocher de ce que le rôle devrait voir avec la graine de démonstration.");
L();
if (!empties.length) L("Aucun.");
else {
  L("| Route | Rôles | Texte affiché |");
  L("|---|---|---|");
  for (const g of empties) L(`| \`${g.route}\` | ${[...g.roles].slice(0, 4).join(", ")}${g.roles.size > 4 ? " …" : ""} | ${String(g.evidence).replace(/\|/g, "/").slice(0, 100)} |`);
}
L();
const unvisited = listTreeEntries().filter((e) => !visitedPatterns.has(e.route) && !/^\/v2\/(login|forgot-password|reset-password)$/.test(e.route));
L("## Routes de l'arborescence non couvertes");
L();
L(`${unvisited.length} route(s) sans visite (segment dynamique sans lien découvrable, routes publiques, ou plafond de pages atteint) :`);
L();
for (const e of unvisited) L(`- \`${e.route}\``);
L();
L("## Méthode et limites");
L();
L("- Connexion par le formulaire de chaque rôle (MFA via le secret TOTP lu à l'exécution dans `.demo/credentials.json`), un compte à la fois, une page à la fois (`next dev`, première visite lente : délai de navigation 150 s).");
L("- File d'exploration : page d'atterrissage, liens du menu rendu (y compris hors `/v2`), puis liens découverts depuis les pages atteignables ; au plus 2 URL par route dynamique et par compte. Le propriétaire et l'opérateur parcourent en plus toute l'arborescence statique (pages marquées « hors menu » : un 403/404 y est attendu et classé mineur).");
L("- Détection : statut HTTP, redirections (`/unauthorized`, `/login`), dialogue d'erreur Next, écran blanc, exceptions JS, erreurs console (clés next-intl manquantes, hydratation), réponses API >= 400, textes `undefined`/`null`/`[object Object]`/`NaN`, clés i18n brutes, libellé « Non inscrit » côté parent/élève.");
L("- Lecture seule : aucune soumission de formulaire, aucun clic hors formulaire de connexion. Les écrans d'appel (`/attendance/call/<type>/<id>`) ne sont pas visités : ils ouvrent une séance (POST) au chargement. Seul effet sur la base : les sessions de connexion.");
L("- Les constats « mineur » et « états vides » sont des heuristiques à confirmer à l'œil. Pile en `next dev` sous charge : les 5xx isolés et les expirations de navigation sont à confirmer par un second passage (⟳).");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
console.log(`Rapport : ${outFile} (${defects.length} constats, ${empties.length} états vides, ${pageCount} pages)`);
