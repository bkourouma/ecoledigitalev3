import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/**
 * T039 — garde-fou léger : les seuls PATCH sous owner restent pilotage / RH /
 * accès / finances, **pas de mutation pédagogique** (notes, cours, classes…).
 *
 * L'espace propriétaire lit des états ; il n'écrit que là où la donnée n'existe
 * nulle part ailleurs. Ce test empêche qu'une mutation de notes ou de classes
 * s'y glisse, ce qui ferait du propriétaire un administrateur par la porte de
 * derrière.
 *
 * MIS À JOUR LE 23/09/2026, et le test échouait nécessairement avant :
 *   - `/alerts/:id/acknowledge` a été **supprimée** avec les alertes de
 *     pilotage (migration 0119) ; l'attendre garantissait un échec.
 *   - `/charges/:id` l'a remplacée, avec la saisie des charges — la première
 *     écriture métier de cet espace. C'est une mutation FINANCIÈRE, pas
 *     pédagogique : le garde-fou garde donc exactement le même sens.
 *
 * Le compte reste à 3, mais sa composition a changé : c'est la liste nommée qui
 * protège, pas le nombre.
 */
describe("surface API /api/v1/owner (T039)", () => {
  const ownerIndexPath = path.join(__dirname, "../routes/owner/index.ts");
  const src = fs.readFileSync(ownerIndexPath, "utf8");

  it("déclare uniquement des PATCH attendus (charges, paie, rôles)", () => {
    expect(src).toContain("/charges/:id");
    expect(src).toContain("/payroll/:id/validate");
    expect(src).toContain("/users/:userId/roles");
    const patchCount = (src.match(/fastify\.patch/g) || []).length;
    expect(patchCount).toBe(3);
  });

  it("n’expose pas de PATCH sur chemins académiques explicites", () => {
    expect(src).not.toMatch(/patch[^\n]*\/(grades|notes|courses|classes|assignments|students|academic)/i);
  });
});
