import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../messages/fr-CI.json";
import { CHILD_SECTIONS, PORTAL_ENTRIES } from "@/platform/portal/menus";

/**
 * Filet de sécurité i18n des portails parent / élève / enseignant : toute clé statique passée à `t("…")` existe dans
 * `messages/fr-CI.json`, et les libellés des menus et des onglets (clés calculées) sont tous traduits.
 */
const ROOT = path.resolve(__dirname, "../..");
const SOURCES = [
  path.join(ROOT, "app/v2/parent"),
  path.join(ROOT, "app/v2/student"),
  path.join(ROOT, "app/v2/teacher"),
  path.join(ROOT, "app/v2/_family"),
  path.join(ROOT, "platform/portal"),
  path.join(ROOT, "platform/ui/PdfButton.tsx"),
  path.join(ROOT, "platform/ui/QrCode.tsx"),
];

function walk(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(target, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI des portails", () => {
  it("toutes les clés statiques existent", () => {
    const missing: string[] = [];
    for (const file of SOURCES.flatMap(walk)) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it("menus et onglets : chaque entrée a son libellé", () => {
    const missing: string[] = [];
    for (const [portal, entries] of Object.entries(PORTAL_ENTRIES)) {
      for (const e of entries) if (typeof lookup(`v2Portal.menu.${portal}`, e.labelKey) !== "string") missing.push(`menu.${portal}.${e.labelKey}`);
    }
    for (const s of CHILD_SECTIONS) if (typeof lookup("v2Portal.child.sections", s.labelKey) !== "string") missing.push(`child.sections.${s.labelKey}`);
    expect(missing).toEqual([]);
  });

  it("aucun libellé de portail n'est vide", () => {
    const empty: string[] = [];
    const walkObj = (o: unknown, trail: string) => {
      if (typeof o === "string") return void (o.trim() === "" && empty.push(trail));
      if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walkObj(v, `${trail}.${k}`);
    };
    walkObj((catalog as Record<string, unknown>).v2Portal, "v2Portal");
    expect(empty).toEqual([]);
  });
});
