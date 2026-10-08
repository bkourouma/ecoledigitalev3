#!/usr/bin/env node
/**
 * Contrôle du guide de test (docs/guide-test/**.md) :
 *  (a) chaque route `/v2/...` citée existe dans l'App Router (apps/web/src/app/v2, groupes `(x)` retirés, dossiers `_x` privés ignorés) ;
 *  (b) chaque libellé cité entre guillemets français « ... » existe dans apps/web/messages/fr-CI.json
 *      (égalité exacte après normalisation des espaces et apostrophes, ou correspondance d'un gabarit ICU `{x}`) ;
 *  (c) chaque route de l'App Router figure dans 00-inventaire-ecrans.md.
 *
 * Usage : node scripts/check-guide-test.mjs [--verbose] [--no-inventory]
 * Code de sortie : 1 s'il reste un écart bloquant (route inexistante, libellé absent de fr-CI.json, route non inventoriée), sinon 0.
 * Un libellé absent de fr-CI.json mais présent tel quel dans le code source web est signalé « SOURCE » (avertissement, pas un échec).
 * Les fichiers dont le nom commence par `_` (documents de travail) sont ignorés.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE_DIR = join(ROOT, "docs", "guide-test");
const APP_DIR = join(ROOT, "apps", "web", "src", "app", "v2");
const WEB_SRC = join(ROOT, "apps", "web", "src");
const MESSAGES = join(ROOT, "apps", "web", "messages", "fr-CI.json");
const VERBOSE = process.argv.includes("--verbose");
const CHECK_INVENTORY = !process.argv.includes("--no-inventory");

const walk = (dir, accept) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      out.push(...walk(p, accept));
    } else if (accept(name, p)) out.push(p);
  }
  return out;
};

const normalize = (s) =>
  s
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// ---------- Routes de l'App Router ----------
function loadRoutes() {
  const files = walk(APP_DIR, (n) => /^page\.(tsx|ts|jsx|js|mdx)$/.test(n));
  const routes = [];
  for (const f of files) {
    const segs = relative(APP_DIR, dirname(f)).split(sep).filter(Boolean);
    if (segs.some((s) => s.startsWith("_"))) continue; // dossier privé Next : pas une route
    const clean = segs.filter((s) => !/^\(.*\)$/.test(s)); // groupes de routes
    routes.push("/v2" + (clean.length ? "/" + clean.join("/") : ""));
  }
  return [...new Set(routes)].sort();
}

const routeRegexes = (routes) =>
  routes.map((r) => ({
    route: r,
    re: new RegExp("^" + r.split("/").map((s) => (/^\[\[?\.\.\./.test(s) ? ".+" : /^\[.*\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/") + "$"),
  }));

// ---------- Libellés ----------
function loadMessages() {
  const exact = new Set();
  const patterns = [];
  const flat = [];
  const visit = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string") {
        const n = normalize(v);
        exact.add(n);
        flat.push(n);
        if (/\{[^}]+\}/.test(n)) {
          // gabarit ICU simple : {x} => n'importe quel texte (les formes plural/select sont aplaties)
          const re = n
            .split(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/)
            .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".+");
          // Un gabarit sans texte littéral (ex. « {count} ») validerait n'importe quoi : on exige au moins 3 caractères fixes.
          const literal = n.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "").replace(/[\s,.;:!?()'"-]/g, "");
          if (literal.length < 3) continue;
          try {
            patterns.push(new RegExp("^" + re + "$"));
          } catch {
            /* motif ignoré */
          }
        }
      } else if (v && typeof v === "object") visit(v);
    }
  };
  visit(JSON.parse(readFileSync(MESSAGES, "utf8")));
  return { exact, patterns, flat };
}

let sourceBlobCache;
const sourceBlob = () => {
  if (sourceBlobCache === undefined) {
    const files = walk(WEB_SRC, (n) => /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n));
    sourceBlobCache = normalize(files.map((f) => readFileSync(f, "utf8")).join("\n"));
  }
  return sourceBlobCache;
};

// ---------- Lecture du guide ----------
// Dossiers et fichiers de travail préfixés `_` (brouillons, fragments fusionnés ailleurs) : ignorés.
const guideFiles = walk(GUIDE_DIR, (n, p) => n.endsWith(".md") && !relative(GUIDE_DIR, p).split(sep).some((seg) => seg.startsWith("_")));
const routes = loadRoutes();
const matchers = routeRegexes(routes);
const { exact, patterns } = loadMessages();

const problems = { route: [], label: [], inventory: [] };
const warnings = { source: [] };
let routeRefs = 0;
let labelRefs = 0;

const ROUTE_RE = /\/v2(?:\/[A-Za-z0-9_\-.\[\](){}<>:~%@$*]+)*\/?/g;

for (const file of guideFiles) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // (a) routes
    for (const m of line.matchAll(ROUTE_RE)) {
      const prev = line[m.index - 1];
      if (prev && /[A-Za-z0-9_\-.]/.test(prev)) continue; // fait partie d'une autre adresse (ex. http://x/v2)
      let r = m[0].replace(/[.,;:)\]]+$/, "").replace(/\/$/, "") || "/v2";
      if (r === "/v2") continue;
      routeRefs += 1;
      const segs = r.split("/");
      const isDynamic = (s) => /^[\[<{:]/.test(s);
      const candidate = segs.map((s, idx) => (idx > 0 && isDynamic(s) ? "[x]" : s)).join("/");
      const ok = matchers.some(({ re }) => re.test(candidate));
      if (!ok) problems.route.push(`${rel}:${i + 1}  ${r}`);
    }
    // (b) libellés « ... »
    for (const m of line.matchAll(/«\s*([^»]{1,200}?)\s*»/g)) {
      labelRefs += 1;
      const raw = m[1];
      const label = normalize(raw).replace(/\s*(\.\.\.|…)$/, "");
      if (!label) continue;
      const withEllipsis = normalize(raw);
      const found =
        exact.has(label) ||
        exact.has(withEllipsis) ||
        exact.has(label + "…") ||
        exact.has(label + "...") ||
        exact.has(label.replace(/\s*:$/, "")) ||
        exact.has(label + " :") ||
        patterns.some((re) => re.test(label) || re.test(withEllipsis));
      if (found) continue;
      if (sourceBlob().includes(label)) warnings.source.push(`${rel}:${i + 1}  « ${label} »`);
      else problems.label.push(`${rel}:${i + 1}  « ${label} »`);
    }
  });
}

// (c) inventaire
if (CHECK_INVENTORY) {
  const inv = join(GUIDE_DIR, "00-inventaire-ecrans.md");
  if (!existsSync(inv)) problems.inventory.push("00-inventaire-ecrans.md est absent");
  else {
    const text = readFileSync(inv, "utf8");
    const cited = new Set();
    for (const m of text.matchAll(ROUTE_RE)) cited.add(m[0].replace(/[.,;:)\]]+$/, "").replace(/\/$/, ""));
    const norm = (r) => r.split("/").map((s, idx) => (idx > 0 && /^[\[<{:]/.test(s) ? "[x]" : s)).join("/");
    const citedNorm = new Set([...cited].map(norm));
    for (const r of routes) {
      if (!citedNorm.has(norm(r))) problems.inventory.push(r);
    }
  }
}

// ---------- Rapport ----------
const section = (title, list) => {
  console.log(`\n${title} : ${list.length}`);
  for (const l of list.slice(0, VERBOSE ? list.length : 40)) console.log("  - " + l);
  if (!VERBOSE && list.length > 40) console.log(`  … ${list.length - 40} autres (--verbose pour tout voir)`);
};

console.log(`Guide de test : ${guideFiles.length} fichier(s) contrôlé(s), ${routes.length} routes dans l'App Router.`);
console.log(`Références lues : ${routeRefs} routes /v2/..., ${labelRefs} libellés « ... ».`);
section("Routes citées introuvables dans l'App Router", problems.route);
section("Libellés « ... » absents de fr-CI.json (et du code source)", problems.label);
section("Libellés absents de fr-CI.json mais présents dans le code source web (avertissement)", warnings.source);
if (CHECK_INVENTORY) section("Routes de l'App Router absentes de 00-inventaire-ecrans.md", problems.inventory);

const failures = problems.route.length + problems.label.length + problems.inventory.length;
console.log(failures === 0 ? "\nOK : aucun écart bloquant." : `\nÉCHEC : ${failures} écart(s) bloquant(s).`);
process.exit(failures === 0 ? 0 : 1);
