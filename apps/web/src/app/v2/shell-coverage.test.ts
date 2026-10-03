/**
 * Couverture de la coque de navigation (test STATIQUE, sans rendu) : chaque écran de `app/v2` est sous une coque (`AppShell`),
 * sauf les écrans publics ou à coque propre ; jamais deux coques imbriquées ; le menu de gestion ne mène à aucune page absente.
 *
 * Ajouter un module (dossier `app/v2/<module>`) sans coque fait échouer ce test : poser `<AppShell>` dans son `layout.tsx` de
 * premier niveau (voir `platform/shell/AppShell.tsx`), ou, pour un écran public, l'ajouter à `PUBLIC_ROUTES` avec la raison.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapToV2Href } from "@/platform/admin/menu";
import type { MenuItem } from "@/platform/navigation/types";
import { buildManagementEntries } from "@/platform/shell/modules";

const here = fileURLToPath(new URL(".", import.meta.url));
const v2Dir = here;
const srcDir = join(here, "..", "..");
const modulesDir = join(srcDir, "..", "..", "api", "src", "modules");

/** Écrans SANS coque de gestion/portail, avec la raison (préfixes de chemin relatifs à `app/v2`, groupes de routes inclus). */
const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  "(auth)/login": "authentification : avant toute session",
  "(auth)/forgot-password": "authentification : avant toute session",
  "(auth)/reset-password": "authentification : lien reçu par courriel",
  apply: "formulaire de candidature public d'un établissement",
  verify: "vérification publique d'un document par QR code",
  "notifications/unsubscribe": "désinscription publique par lien signé",
  platform: "console des opérateurs de la plateforme : coque propre (OperatorShell), authentification séparée",
};

const norm = (p: string) => p.split(sep).join("/");

function walk(dir: string, visit: (full: string, name: string) => void) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full, name);
  }
}

function pages(): string[] {
  const out: string[] = [];
  walk(v2Dir, (full, name) => {
    if (name === "page.tsx") out.push(norm(relative(v2Dir, full)));
  });
  // `/v2` lui-même est une simple redirection vers l'atterrissage du rôle (aucun contenu à habiller) ; les dossiers `_x` ne sont pas des routes.
  return out.filter((p) => p !== "page.tsx" && !p.split("/").some((s) => s.startsWith("_")));
}

const layoutOf = (dir: string) => join(v2Dir, dir, "layout.tsx");
const hasAppShell = (dir: string) => existsSync(layoutOf(dir)) && /<AppShell>/.test(readFileSync(layoutOf(dir), "utf8"));
const isPublic = (page: string) => Object.keys(PUBLIC_ROUTES).some((p) => page === `${p}/page.tsx` || page.startsWith(`${p}/`));

/** Répertoires de la page, du premier niveau à son dossier (`finance/invoices/[id]` -> `finance`, `finance/invoices`, ...). */
function chain(page: string): string[] {
  const segments = page.split("/").slice(0, -1);
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

describe("coque de navigation : tous les écrans /v2 de gestion et de portail", () => {
  const all = pages();

  it("garde-fou : l'arborescence est bien lue", () => {
    expect(all.length).toBeGreaterThan(250);
    expect(all).toContain("finance/page.tsx");
  });

  it("chaque écran est sous une coque (AppShell), sauf les écrans publics listés avec leur raison", () => {
    const uncovered = all.filter((page) => !isPublic(page) && !chain(page).some(hasAppShell));
    expect(uncovered).toEqual([]);
  });

  it("les écrans publics n'ont PAS la coque de gestion", () => {
    const wrongly = all.filter((page) => isPublic(page) && chain(page).some(hasAppShell));
    expect(wrongly).toEqual([]);
  });

  it("une seule coque par chemin : jamais deux AppShell imbriqués", () => {
    const nested = all.filter((page) => chain(page).filter(hasAppShell).length > 1);
    expect(nested).toEqual([]);
  });

  it("PortalShell et TenantAdminShell ne sont posés que par AppShell (le choix suit la session, jamais un layout figé)", () => {
    const offenders: string[] = [];
    walk(join(srcDir, "app"), (full, name) => {
      if (!/\.(tsx|ts)$/.test(name) || /\.test\./.test(name)) return;
      const text = readFileSync(full, "utf8");
      if (/<(PortalShell|TenantAdminShell)[\s>]/.test(text)) offenders.push(norm(relative(srcDir, full)));
    });
    expect(offenders).toEqual([]);
  });

  it("les écrans publics listés existent encore (sinon retirer l'exception)", () => {
    for (const p of Object.keys(PUBLIC_ROUTES)) expect(all.some((page) => page.startsWith(`${p}/`) || page === `${p}/page.tsx`), p).toBe(true);
  });
});

describe("menu de gestion : aucun lien mort, entrées sans écran masquées", () => {
  const routes = pages()
    .filter((p) => !isPublic(p))
    .map((page) => {
      const segments = page.split("/").slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
      return new RegExp("^/v2" + (segments.length ? "/" : "") + segments.join("/").replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "/?$");
    });

  function manifestEntries(): MenuItem[] {
    const out: MenuItem[] = [];
    for (const m of readdirSync(modulesDir)) {
      const manifest = join(modulesDir, m, "manifest.ts");
      if (!existsSync(manifest)) continue;
      for (const line of readFileSync(manifest, "utf8").split(/\r?\n/)) {
        const match = /\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/.exec(line);
        const portal = /portal:\s*"([a-z-]+)"/.exec(line)?.[1];
        if (match && portal) out.push({ key: match[1]!, label: match[2]!, href: match[3]!, permission: "x", portal: portal as MenuItem["portal"] });
      }
    }
    return out;
  }

  it("avec TOUTES les entrées des manifestes, le menu de gestion ne contient aucune destination sans page", () => {
    const entries = manifestEntries();
    expect(entries.length).toBeGreaterThan(100);
    const menu = buildManagementEntries({ apiItems: entries });
    expect(menu.length).toBeGreaterThan(60);
    const dead = menu.filter((e) => !routes.some((re) => re.test(mapToV2Href(e.href).split("?")[0]!))).map((e) => `${e.key} -> ${e.href}`);
    expect(dead).toEqual([]);
  });

  it("les quatre entrées sans écran v2 sont absentes du menu (à retirer d'ici quand l'écran existe)", () => {
    const menu = buildManagementEntries({ apiItems: manifestEntries() });
    const keys = new Set(menu.map((e) => e.key));
    for (const key of ["attendance.settings", "people.settings", "scheduling.calendar", "scheduling.validation"]) expect(keys.has(key), key).toBe(false);
  });
});
