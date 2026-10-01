/**
 * Le squelette généré par `pnpm module:new` doit passer, tel quel, le test d'isolation global
 * (migration réellement appliquée, RLS forcée, test comportemental A/B).
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { assertGlobalIsolation } from "../../src/platform/isolation-check";
import { scaffoldModule } from "../../src/platform/module-scaffold";
import { TEST_DATABASE_URL, describeIntegration } from "../helpers/fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = resolve(here, `.tmp-scaffold-iso-${process.pid}`);
mkdirSync(sandbox, { recursive: true });
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describeIntegration("isolation globale — squelette généré", () => {
  it("passe avec deux modules générés (migrations appliquées dans l'ordre, RLS comportementale vérifiée)", async () => {
    scaffoldModule({ key: "gen_alpha", modulesDir: sandbox });
    scaffoldModule({ key: "gen_beta", modulesDir: sandbox });

    const result = await assertGlobalIsolation({ adminUrl: TEST_DATABASE_URL as string, modulesDir: sandbox });
    expect(result.modules).toEqual(["gen_alpha", "gen_beta"]);
    expect(result.report.behavioural).toEqual(expect.arrayContaining(["gen_alpha.items", "gen_beta.items"]));
    expect(result.violations).toEqual([]);
  });
});
