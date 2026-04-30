import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/**
 * T039 — garde-fou léger : les seuls PATCH sous owner restent pilotage / RH / accès,
 * pas de mutation pédagogique (notes, cours, classes, etc.).
 */
describe("surface API /api/v1/owner (T039)", () => {
  const ownerIndexPath = path.join(__dirname, "../routes/owner/index.ts");
  const src = fs.readFileSync(ownerIndexPath, "utf8");

  it("déclare uniquement des PATCH attendus (alertes, paie, rôles)", () => {
    expect(src).toContain("/alerts/:id/acknowledge");
    expect(src).toContain("/payroll/:id/validate");
    expect(src).toContain("/users/:userId/roles");
    const patchCount = (src.match(/fastify\.patch/g) || []).length;
    expect(patchCount).toBe(3);
  });

  it("n’expose pas de PATCH sur chemins académiques explicites", () => {
    expect(src).not.toMatch(/patch[^\n]*\/(grades|notes|courses|classes|assignments|students|academic)/i);
  });
});
