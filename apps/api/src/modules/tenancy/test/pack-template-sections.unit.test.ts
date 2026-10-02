/** Sections de modèle par module : clé facultative, contenu opaque pour le noyau, lecture par `getPackTemplateSection`. */
import { describe, expect, it } from "vitest";
import { buildPackTemplates, defaultPackTemplates, getPackTemplateSection, PackTemplateSchema } from "../templates";

const base = [...defaultPackTemplates().values()];

describe("sections de modèle de pack (rétro-compatibles)", () => {
  it("les modèles livrés ne changent pas : aucune section, lecture = undefined", () => {
    for (const t of base) expect(t.sections).toBeUndefined();
    expect(getPackTemplateSection("PRIMARY", "CI", "academic")).toBeUndefined();
    expect(getPackTemplateSection("PRIMARY", "CI", "primary_school")).toBeUndefined();
  });

  it("une section inconnue du noyau est acceptée et renvoyée telle quelle, par (pack, système éducatif)", () => {
    const primary = { ...base.find((t) => t.pack === "PRIMARY")!, sections: { primary_school: { CI: { section: "primary_school", ratingScales: [] } }, councils: { CI: { x: 1 }, FR: { y: 2 } } } };
    const templates = buildPackTemplates([primary, ...base.filter((t) => t.pack !== "PRIMARY")]);
    expect(getPackTemplateSection("PRIMARY", "CI", "primary_school", templates)).toEqual({ section: "primary_school", ratingScales: [] });
    expect(getPackTemplateSection("PRIMARY", "FR", "councils", templates)).toEqual({ y: 2 });
    // autre système, autre section, autre pack : absent
    expect(getPackTemplateSection("PRIMARY", "BF", "councils", templates)).toBeUndefined();
    expect(getPackTemplateSection("PRIMARY", "CI", "schoollife", templates)).toBeUndefined();
    expect(getPackTemplateSection("SECONDARY", "CI", "councils", templates)).toBeUndefined();
  });

  it("les clés sont validées (section en snake_case, système en majuscules) ; le schéma reste strict", () => {
    const t = base[0]!;
    expect(PackTemplateSchema.safeParse({ ...t, sections: { Primary: { CI: {} } } }).success).toBe(false);
    expect(PackTemplateSchema.safeParse({ ...t, sections: { primary_school: { ci: {} } } }).success).toBe(false);
    expect(PackTemplateSchema.safeParse({ ...t, sections: { primary_school: { CI: {} } } }).success).toBe(true);
    expect(PackTemplateSchema.safeParse({ ...t, extra: 1 }).success).toBe(false);
  });
});
