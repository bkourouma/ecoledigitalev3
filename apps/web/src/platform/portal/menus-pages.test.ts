import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPortalMenu, PORTAL_ENTRIES, type PortalKey } from "./menus";

const APP = path.resolve(__dirname, "../../app");

/** `/v2/x/y` doit correspondre à `src/app/v2/x/y/page.tsx` (groupes de routes `(…)` ignorés). */
function pageExists(href: string): boolean {
  const segments = href.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (!fs.existsSync(dir)) return false;
    if (rest.length === 0) {
      if (fs.existsSync(path.join(dir, "page.tsx"))) return true;
      return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && /^\(.+\)$/.test(e.name) && walk(path.join(dir, e.name), []));
    }
    const [head, ...tail] = rest;
    if (fs.existsSync(path.join(dir, head!)) && walk(path.join(dir, head!), tail)) return true;
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && /^\(.+\)$/.test(e.name) && walk(path.join(dir, e.name), rest));
  };
  return walk(APP, segments);
}

describe("menus des portails : cohérence avec les pages", () => {
  it.each(Object.entries(PORTAL_ENTRIES) as [PortalKey, (typeof PORTAL_ENTRIES)[PortalKey]][])("portail %s : chaque href existe comme page", (_portal, entries) => {
    const missing = entries.filter((e) => !pageExists(e.href)).map((e) => `${e.key} -> ${e.href}`);
    expect(missing).toEqual([]);
  });

  it("clés d'entrée uniques et href propres (pas de segment dynamique non résolu)", () => {
    const keys = Object.values(PORTAL_ENTRIES).flatMap((es) => es.map((e) => e.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of Object.values(PORTAL_ENTRIES).flat()) expect(e.href).toMatch(/^\/v2(\/[a-z-]+)*$/);
  });
});

describe("menus des portails : nouveaux modules", () => {
  const label = (k: string) => k;
  // Les entrées sans permission propre (« Mes enfants », « Compte ») sont toujours là : on ne compare que les modules.
  const ALWAYS = new Set(["parent.children", "parent.account"]);
  const keys = (portal: PortalKey, permissions: string[] | null, features: string[] | null) => buildPortalMenu({ portal, permissions, features, labelOf: label }).map((i) => i.key).filter((k) => !ALWAYS.has(k));

  it("parent : chaque module exige sa permission « child » ET sa fonctionnalité", () => {
    const perms = ["primary.bilan.child.read", "schoollife.child.read", "council.child.read", "stateassign.child.read", "exam.document.child.read"];
    expect(keys("parent", perms, [])).toEqual([]);
    const all = keys("parent", perms, ["primary.annual-review", "schoollife.core", "councils.core", "stateassign.core", "examinations.core"]);
    expect(all).toEqual(["parent.primary", "parent.schoollife", "parent.councils", "parent.stateassign", "parent.examinations"]);
    // Sans la fonctionnalité de l'offre : masqué, même avec la permission.
    expect(keys("parent", perms, ["councils.core"])).toEqual(["parent.councils"]);
    // Les permissions « self » ou personnel n'ouvrent jamais les entrées famille.
    expect(keys("parent", ["primary.bilan.self.read", "schoollife.self.read", "council.self.read", "exam.document.self.read", "council.read"], ["primary.annual-review", "schoollife.core", "councils.core", "examinations.core"])).toEqual([]);
    // Permissions inconnues : fermé par défaut.
    expect(keys("parent", null, null)).toEqual([]);
  });

  it("élève : entrées « self » seulement, jamais celles de la famille (affectation de l'État comprise)", () => {
    const perms = ["primary.bilan.self.read", "schoollife.self.read", "council.self.read", "exam.document.self.read", "stateassign.child.read"];
    const f = ["primary.annual-review", "schoollife.core", "councils.core", "examinations.core", "stateassign.core"];
    expect(keys("student", perms, f)).toEqual(["student.primary", "student.schoollife", "student.councils", "student.examinations"]);
    expect(keys("student", ["primary.bilan.child.read", "schoollife.child.read", "council.child.read"], f)).toEqual([]);
  });

  it("enseignant : primaire, saisie de vie scolaire et conseils selon permissions et fonctionnalités", () => {
    const perms = ["primary.competency.record", "primary.council.prepare", "schoollife.read", "council.read"];
    expect(keys("teacher", perms, ["primary.competencies", "primary.council", "schoollife.core", "councils.core"])).toEqual(["teacher.primaryClass", "teacher.primaryCouncil", "teacher.schoollife", "teacher.councils"]);
    expect(keys("teacher", perms, [])).toEqual([]);
  });
});
