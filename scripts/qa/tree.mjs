/** Arborescence des pages `apps/web/src/app/v2/**\/page.tsx` : routes, fichiers sources et rapprochement d'une URL reelle. */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { repoRoot } from "./lib.mjs";

const BASE = join(repoRoot, "apps", "web", "src", "app", "v2");

/** @returns {{route:string,file:string}[]} routes `/v2/...` (groupes `(x)` retires) et chemin du fichier relatif au depot. */
export function listTreeEntries() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const rel = relative(BASE, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        out.push({ route: "/v2" + (rel.length ? "/" + rel.join("/") : ""), file: relative(repoRoot, full).split(sep).join("/") });
      }
    }
  };
  walk(BASE);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

export function listTreeRoutes() {
  return [...new Set(listTreeEntries().map((e) => e.route))];
}

const ENTRIES = listTreeEntries();
const PATTERNS = ENTRIES.map((e) => ({ ...e, regex: new RegExp("^" + e.route.replace(/\[[^\]]+\]/g, "[^/]+") + "/?$"), dynamic: /\[/.test(e.route) }));

/** Route de l'arborescence couvrant `pathname` (la plus specifique : statique avant dynamique), ou null. */
export function patternOf(pathname) {
  const hits = PATTERNS.filter((p) => p.regex.test(pathname));
  hits.sort((a, b) => Number(a.dynamic) - Number(b.dynamic) || b.route.length - a.route.length);
  return hits[0]?.route ?? null;
}

export function sourceFileOf(route) {
  return ENTRIES.find((e) => e.route === route)?.file ?? null;
}
