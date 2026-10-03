#!/usr/bin/env node
/**
 * Verification STATIQUE des liens de menu : chaque `href` declare dans les manifestes de modules de l'API
 * (`apps/api/src/modules/<m>/manifest.ts`, entrees `menus`) doit correspondre, apres reecriture `mapToV2Href`
 * (`apps/web/src/platform/admin/menu.ts`), a une page de l'application web (`apps/web/src/app/**\/page.tsx`, v2 ou
 * ancien back-office). Sinon l'entree de menu mene a un 404 (lien mort). Aucun navigateur ni pile demarree.
 *
 *   node scripts/qa/check-menu-hrefs.mjs   (code de sortie 1 s'il y a un lien mort)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { repoRoot } from "./lib.mjs";

const appDir = join(repoRoot, "apps", "web", "src", "app");
const allRoutes = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name === "page.tsx") {
      const rel = relative(appDir, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
      allRoutes.push("/" + rel.join("/"));
    }
  }
})(appDir);
const routeRes = allRoutes.map((r) => new RegExp("^" + r.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "/?$"));
const exists = (href) => routeRes.some((re) => re.test(href.split("?")[0]));

const menuTs = readFileSync(join(repoRoot, "apps", "web", "src", "platform", "admin", "menu.ts"), "utf8");
const legacyToV2 = Object.fromEntries([...menuTs.matchAll(/"(\/[^"]+)":\s*"(\/v2\/[^"]+)"/g)].map((m) => [m[1], m[2]]));

const modulesDir = join(repoRoot, "apps", "api", "src", "modules");
const portalFilter = process.argv.includes("--all-portals") ? null : "admin";
const dead = [];
let checked = 0;
for (const m of readdirSync(modulesDir)) {
  const manifest = join(modulesDir, m, "manifest.ts");
  if (!existsSync(manifest)) continue;
  const text = readFileSync(manifest, "utf8");
  // Une entree par ligne : `{ key: "...", label: "...", href: "...", ..., portal: "admin", ... }`.
  for (const line of text.split(/\r?\n/)) {
    const match = /\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/.exec(line);
    if (!match) continue;
    const [, key, label, href] = match;
    const portal = /portal:\s*"([^"]+)"/.exec(line)?.[1] ?? "?";
    // Seul le portail `admin` alimente un menu v2 (coquille d'administration) ; les portails famille/enseignant ont un menu statique.
    if (portalFilter && portal !== portalFilter) continue;
    const target = legacyToV2[href] ?? href;
    checked += 1;
    if (!exists(target)) dead.push({ module: m, key, label, href, target, portal });
  }
}
console.log(`${checked} entrees de menu des manifestes verifiees (${allRoutes.length} pages dans apps/web/src/app).`);
for (const d of dead) console.log(`LIEN MORT  ${d.module} : ${d.key} (« ${d.label} ») : ${d.href}${d.target !== d.href ? ` -> ${d.target}` : ""} : aucune page ne correspond`);
console.log(dead.length ? `${dead.length} lien(s) mort(s).` : "Aucun lien mort.");
if (dead.length) process.exitCode = 1;
