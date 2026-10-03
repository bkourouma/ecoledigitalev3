#!/usr/bin/env node
/**
 * Genere `docs/qa/demo-sweep-report.md` a partir des JSON bruts de `demo-sweep.mjs` (`.demo/qa/sweep-*.json`).
 * Pour chaque couple tenant/role, seul le resultat le plus recent est retenu. Aucun secret : les JSON ne contiennent que des
 * e-mails de demonstration, des chemins et des extraits de texte d'ecran.
 *
 *   node scripts/qa/report.mjs [--in=.demo/qa] [--out=docs/qa/demo-sweep-report.md] [--fixed=scripts/qa/fixed.json]
 *
 * `fixed.json` (optionnel) : { "<code>|<route>": "commit / note" } pour marquer un constat comme corrige.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { demoDir, repoRoot } from "./lib.mjs";
import { SEVERITY_ORDER } from "./analyze.mjs";
import { listTreeEntries, patternOf, sourceFileOf } from "./tree.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a, true]; }));
const inDir = args.in ?? join(demoDir(), "qa");
const outFile = args.out ?? join(repoRoot, "docs", "qa", "demo-sweep-report.md");
const fixedFile = args.fixed ?? join(repoRoot, "scripts", "qa", "fixed.json");
const fixed = existsSync(fixedFile) ? JSON.parse(readFileSync(fixedFile, "utf8")) : {};

// --- chargement : dernier resultat par tenant/role -----------------------------------------------------------------------------
const latest = new Map();
for (const f of readdirSync(inDir).filter((n) => /^sweep-.*\.json$/.test(n)).sort()) {
  const data = JSON.parse(readFileSync(join(inDir, f), "utf8"));
  for (const r of data.results) latest.set(`${r.account.tenant}/${r.account.role}`, { ...r, file: f, generatedAt: data.generatedAt });
}
const results = [...latest.values()];
if (!results.length) throw new Error(`Aucun resultat dans ${inDir}`);

const norm = (s) => String(s ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\b\d{4,}\b/g, ":n");

// --- agregation des constats -------------------------------------------------------------------------------------------------
const groups = new Map();
let pageCount = 0;
const visitedPatterns = new Set();
const loginFailures = [];
for (const r of results) {
  if (r.loginError) loginFailures.push(r);
  for (const p of r.pages) {
    pageCount += 1;
    const route = p.pattern ?? patternOf(p.url.split("?")[0]) ?? p.url;
    visitedPatterns.add(route);
    for (const f of p.findings ?? []) {
      const key = `${f.code}|${norm(f.message)}|${route}`;
      const g = groups.get(key) ?? { severity: f.severity, code: f.code, message: norm(f.message), route, evidence: f.evidence, urls: new Set(), roles: new Set(), shot: p.screenshot, ms: 0 };
      g.urls.add(p.url);
      g.roles.add(`${r.account.tenant.replace("demo-", "")}/${r.account.role}`);
      if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[g.severity]) g.severity = f.severity;
      groups.set(key, g);
    }
  }
}

const CAUSE = {
  "http-5xx": "Exception serveur dans le rendu de la page (composant serveur / garde) : voir le journal `.demo/logs/web.log`.",
  "http-404": "Route absente de l'arborescence `app/v2` ou lien de menu mal forme (menu `/api/v1/rbac/me/navigation` ou `platform/admin/menu`).",
  "dev-overlay": "Exception de rendu client/serveur : lire le message en preuve ; souvent un champ de contrat absent ou null.",
  "dev-toast": "Erreur capturee par Next (voir la console) : souvent une cle i18n manquante ou une exception de composant.",
  "error-screen": "Etat d'erreur du composant (requete en echec) ou page d'erreur par defaut.",
  "page-error": "Exception JS non interceptee : composant client lisant un champ absent/null de la reponse API.",
  "blank-page": "Rendu vide : composant client qui ne s'affiche pas faute de donnees ou de permission, sans etat vide/erreur.",
  "api-5xx": "Erreur serveur de l'API : voir `.demo/logs/api.log` pour la trace.",
  "api-400": "Requete mal formee : parametre de requete que le contrat de l'API rejette (desalignement web <-> contrat Zod).",
  "api-404": "Le web appelle une route inexistante ou un identifiant inconnu (route renommee cote API ?).",
  "api-403": "Permission manquante au role pour cette page (menu non filtre, ou garde web trop large).",
  "api-401": "Jeton absent ou expire sur l'appel (proxy web -> API, rafraichissement de session).",
  "denied-redirect": "Garde `requirePermission` plus stricte que l'entree de menu (ou menu non filtre par la meme permission).",
  "session-lost": "Garde de session ou rafraichissement du jeton.",
  "i18n-missing": "Cle absente de `apps/web/messages/fr-CI.json` (ou mauvais espace de noms `useTranslations`).",
  "raw-i18n-key": "Cle affichee telle quelle : cle absente de `fr-CI.json` ou valeur non traduite.",
  "suspect-text": "Valeur absente (champ null/undefined) interpolee dans un libelle sans repli.",
  "label-not-enrolled": "Statut d'inscription non propage vers ce portail (voir le mapping des evenements d'inscription).",
  "alert-without-api-failure": "Etat d'erreur affiche alors qu'aucune requete n'a echoue : logique de composant.",
  "empty-state": "A confronter a la graine de demonstration (`scripts/seed-v2`).",
};

const sevs = ["bloquant", "majeur", "mineur"];
const sorted = [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.route.localeCompare(b.route) || a.code.localeCompare(b.code));
const isEmpty = (g) => g.code === "empty-state";
const defects = sorted.filter((g) => !isEmpty(g));
const empties = sorted.filter(isEmpty);

const lines = [];
const L = (s = "") => lines.push(s);
const total = { bloquant: 0, majeur: 0, mineur: 0 };
for (const g of defects) total[g.severity] += 1;
const fixedCount = defects.filter((g) => fixed[`${g.code}|${g.route}`]).length;

L("# Balayage QA de la démonstration locale : rapport");
L();
L(`Généré le ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC par \`scripts/qa/report.mjs\` à partir de \`scripts/qa/demo-sweep.mjs\` (pile \`pnpm demo:up\`, web \`next dev\`, lecture seule).`);
L();
L("## Résumé");
L();
L(`- Comptes balayés : **${results.length - loginFailures.length}** sur ${results.length} (tenants : ${[...new Set(results.map((r) => r.account.tenant))].join(", ")}).`);
L(`- Pages visitées (page x rôle) : **${pageCount}**, dont ${visitedPatterns.size} routes distinctes de l'arborescence sur ${listTreeEntries().length}.`);
L(`- Constats distincts (regroupés par type, route et message) : **${total.bloquant} bloquant(s)**, **${total.majeur} majeur(s)**, **${total.mineur} mineur(s)** ; ${empties.length} états vides à confronter aux données de démo (section dédiée).`);
if (fixedCount) L(`- Corrigés dans la branche : **${fixedCount}** (marqués ✔ ci-dessous).`);
if (loginFailures.length) L(`- Connexions en échec : ${loginFailures.map((r) => `${r.account.tenant}/${r.account.role} (${r.loginError})`).join(" ; ")}.`);
L();
L("Gravités : **bloquant** = page inutilisable (5xx, écran d'erreur ou blanc, exception, lien de menu mort, boucle) ; **majeur** = fonction cassée ou donnée fausse (appel API rejeté, clé i18n brute, `undefined`, menu menant à un refus, libellé incohérent) ; **mineur** = cosmétique, refus 403 attendu hors menu, bruit console.");
L();
L("## Couverture par rôle");
L();
L("| Établissement | Rôle | Atterrissage | Pages | Menu (liens) | Bloquant | Majeur | Mineur | Durée |");
L("|---|---|---|---:|---:|---:|---:|---:|---:|");
for (const r of results) {
  const c = { bloquant: 0, majeur: 0, mineur: 0 };
  for (const p of r.pages) for (const f of p.findings ?? []) if (f.code !== "empty-state") c[f.severity] += 1;
  L(`| ${r.account.tenant} | ${r.account.role} | ${r.loginError ? "CONNEXION EN ÉCHEC" : `\`${r.landing}\``} | ${r.pages.length}${r.queueLeft ? ` (+${r.queueLeft} non visitées)` : ""} | ${r.menuLinks?.length ?? 0} | ${c.bloquant} | ${c.majeur} | ${c.mineur} | ${Math.round((r.ms ?? 0) / 60000)} min |`);
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
  let i = 0;
  for (const g of list) {
    i += 1;
    const fx = fixed[`${g.code}|${g.route}`];
    const roles = [...g.roles];
    const urls = [...g.urls];
    L(`### ${sev.slice(0, 1).toUpperCase()}${i}. ${fx ? "✔ " : ""}${g.message}`);
    L();
    L(`- **Route** : \`${g.route}\`${urls.length > 1 ? ` (${urls.length} URL, ex. \`${urls[0]}\`)` : urls[0] !== g.route ? ` (\`${urls[0]}\`)` : ""}`);
    L(`- **Rôles** : ${roles.length > 6 ? `${roles.slice(0, 6).join(", ")} … (${roles.length})` : roles.join(", ")}`);
    L(`- **Type** : \`${g.code}\``);
    if (g.evidence) L(`- **Preuve** : \`${String(g.evidence).replace(/`/g, "'").replace(/\s+/g, " ").slice(0, 300)}\``);
    if (g.shot) L(`- **Capture** : \`.demo/qa/${g.shot.replace(/\\/g, "/")}\``);
    L(`- **Cause probable** : ${CAUSE[g.code] ?? CAUSE[`api-${g.code.replace("api-", "")}`] ?? "À analyser."}`);
    const src = sourceFileOf(g.route);
    if (src) L(`- **Fichier suspect** : \`${src}\``);
    if (fx) L(`- **Correction** : ${fx}`);
    L();
  }
}

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
L(`${unvisited.length} route(s) sans visite (segment dynamique sans lien découvrable, routes publiques, console plateforme non balayée, ou plafond de pages atteint) :`);
L();
for (const e of unvisited) L(`- \`${e.route}\``);
L();
L("## Méthode et limites");
L();
L("- Connexion par le formulaire de chaque rôle (MFA via le secret TOTP lu à l'exécution dans `.demo/credentials.json`), un compte à la fois, une page à la fois (`next dev`, première visite lente : délai 90 s).");
L("- File d'exploration : page d'atterrissage, liens des menus (DOM rendu), arborescence `page.tsx` (propriétaire et opérateur seulement), puis liens découverts ; au plus 2 URL par route dynamique et par compte.");
L("- Détection : statut HTTP, redirections (`/unauthorized`, `/login`), dialogue d'erreur Next, écran blanc, exceptions JS, erreurs console (clés next-intl manquantes), réponses API >= 400 (403/404 hors menu classés mineurs), textes `undefined`/`null`/`[object Object]`/`NaN`, clés i18n brutes, libellé « Non inscrit » côté parent/élève.");
L("- Aucune soumission de formulaire ni action d'écriture ; la base de démonstration n'est pas modifiée en dehors des connexions (sessions).");
L("- Les constats « mineur / empty-state » sont des heuristiques : à confirmer à l'œil.");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
console.log(`Rapport : ${outFile} (${defects.length} constats, ${empties.length} états vides, ${pageCount} pages)`);
