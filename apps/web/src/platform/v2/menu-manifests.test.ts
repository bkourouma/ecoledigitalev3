/**
 * Chaque entrée du portail `admin` déclarée dans les manifestes de modules de l'API doit mener, après `mapToV2Href`, à une
 * page de l'application web (sinon : lien de menu mort, 404 dans la coquille d'administration). Les écarts connus sont
 * listés explicitement : ajouter un manifeste sans écran fait échouer ce test, et livrer l'écran d'un écart connu aussi
 * (pour retirer la ligne de la liste).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapToV2Href } from "@/platform/admin/menu";

const here = fileURLToPath(new URL(".", import.meta.url));
const appDir = join(here, "..", "..", "app");
const modulesDir = join(here, "..", "..", "..", "..", "api", "src", "modules");

function pageRoutes(): RegExp[] {
  const out: RegExp[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const segments = relative(appDir, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        out.push(new RegExp("^/" + segments.join("/").replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "/?$"));
      }
    }
  };
  walk(appDir);
  return out;
}

function adminManifestEntries(): { key: string; href: string }[] {
  const out: { key: string; href: string }[] = [];
  for (const m of readdirSync(modulesDir)) {
    const manifest = join(modulesDir, m, "manifest.ts");
    if (!existsSync(manifest)) continue;
    for (const line of readFileSync(manifest, "utf8").split(/\r?\n/)) {
      const match = /\{\s*key:\s*"([^"]+)",\s*label:\s*"[^"]+",\s*href:\s*"([^"]+)"/.exec(line);
      if (match && /portal:\s*"admin"/.test(line)) out.push({ key: match[1]!, href: match[2]! });
    }
  }
  return out;
}

/** Entrées du portail admin sans écran v2 livré (à retirer de la liste quand l'écran existe). */
const KNOWN_GAPS = ["attendance.settings", "people.settings", "scheduling.calendar", "scheduling.validation"];

describe("menus de manifestes (portail admin) -> pages de l'application", () => {
  const routes = pageRoutes();
  const entries = adminManifestEntries();

  it("lit bien les manifestes (garde-fou du test)", () => {
    expect(entries.length).toBeGreaterThan(60);
    expect(routes.length).toBeGreaterThan(300);
  });

  it("aucun lien mort hors écarts connus", () => {
    const dead = entries.filter((e) => !routes.some((re) => re.test(mapToV2Href(e.href).split("?")[0]!))).map((e) => e.key);
    expect(dead.sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it("réécrit les entrées personnes, académique, évaluations, résultats, bulletins, règles, supérieur et admissions", () => {
    expect(mapToV2Href("/admin/eleves")).toBe("/v2/students");
    expect(mapToV2Href("/admin/academique/inscriptions")).toBe("/v2/enrollments");
    expect(mapToV2Href("/admin/notes/corrections")).toBe("/v2/assessments/revisions");
    expect(mapToV2Href("/admin/deliberations")).toBe("/v2/results/decisions");
    expect(mapToV2Href("/admin/bulletins/emission")).toBe("/v2/reportcards/issue");
    expect(mapToV2Href("/admin/higher/signataires")).toBe("/v2/higher/signatories");
    expect(mapToV2Href("/v2/admissions/workflow")).toBe("/v2/admissions/settings/workflow");
  });
});
