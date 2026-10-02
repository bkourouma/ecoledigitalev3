import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrôles statiques (jsdom n'a ni CSS ni mise en page) :
 *  - WCAG 2.3.3 / bonne pratique : `prefers-reduced-motion: reduce` neutralise animations et transitions globalement ;
 *  - WCAG 1.4.10 (reflow 320 px) : aucun composant partagé ne force une largeur fixe/minimale > 320 px hors zone défilante ;
 *  - viewport non verrouillé (1.4.4 : zoom autorisé) et `lang="fr"` sur `<html>` (3.1.1).
 */
const src = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(src, rel), "utf8");

describe("mouvement réduit", () => {
  it("globals.css neutralise animations et transitions sous prefers-reduced-motion", () => {
    const css = read("app/globals.css");
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, start + 400);
    expect(rule).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(rule).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});

describe("reflow à 320 px et zoom", () => {
  const dirs = ["platform/ui", "platform/navigation", "platform/admin/shell"];
  const files = dirs.flatMap((d) => readdirSync(path.join(src, d)).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => `${d}/${f}`));

  it.each(files)("%s : pas de largeur minimale > 320 px (hors tableau défilant)", (file) => {
    const text = read(file);
    for (const m of text.matchAll(/(?<![-\w])min-w-\[([\d.]+)(rem|px)\]/g)) {
      const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
      // Le tableau de données est dans une région défilante focalisable (`role="region" tabIndex=0`) : exception de 1.4.10.
      if (px > 320) expect(file, `min-w ${m[0]}`).toBe("platform/ui/DataTable.tsx");
    }
  });

  it("DataTable : le tableau large est dans une région défilante focalisable et nommée", () => {
    expect(read("platform/ui/DataTable.tsx")).toMatch(/role="region" aria-label=\{caption\} tabIndex=\{0\} className="overflow-x-auto/);
  });

  it("layout racine : lang=fr, zoom non bloqué", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/<html lang="fr"/);
    expect(layout).not.toMatch(/user-scalable\s*[:=]\s*(no|0|false)/i);
    expect(layout).not.toMatch(/maximumScale\s*:\s*1\b/);
  });
});
