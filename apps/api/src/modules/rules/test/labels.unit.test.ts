import { describe, expect, it } from "vitest";
import { outputLabelOf, type LabelledRule } from "../domain/labels";

const rules: LabelledRule[] = [
  { key: "mention", labelMap: { GOOD: { fr: "Bien", en: "Good" }, EXCELLENT: { fr: "  Très bien  " } } },
  { key: "appreciation", labelMap: { GOOD: { fr: "Bon travail" }, ENCOURAGE: { en: "Keep going" }, EMPTY: { fr: "   " } } },
];

describe("outputLabelOf (label_map, affichage seulement)", () => {
  it("renvoie le libellé français de la première règle qui définit le code (nettoyé)", () => {
    expect(outputLabelOf(rules, "EXCELLENT")).toBe("Très bien");
    expect(outputLabelOf(rules, "GOOD")).toBe("Bien");
  });
  it("restreint à une règle quand on la nomme ; langue choisie ; jamais de libellé inventé", () => {
    expect(outputLabelOf(rules, "GOOD", { ruleKey: "appreciation" })).toBe("Bon travail");
    expect(outputLabelOf(rules, "GOOD", { locale: "en" })).toBe("Good");
    expect(outputLabelOf(rules, "ENCOURAGE")).toBeNull(); // pas de français
    expect(outputLabelOf(rules, "EMPTY")).toBeNull(); // libellé vide
    expect(outputLabelOf(rules, "UNKNOWN")).toBeNull();
    expect(outputLabelOf([], "GOOD")).toBeNull();
  });
});
