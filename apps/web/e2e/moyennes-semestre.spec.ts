import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/browser-login";

test.describe("Moyennes semestre (connexion navigateur)", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "Flux admin validé sur Chromium");
  });

  test.beforeEach(async ({ request }) => {
    const health = await request.get("http://localhost:4000/api/v1/health");
    if (!health.ok()) {
      test.skip(true, "API port 4000 requise (démarrée par Playwright ou pnpm dev)");
    }
  });

  test("connexion admin, page moyennes, sélection période + classe, grille ou message métier", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto("/annee-academique/moyennes-semestre");
    await expect(page.getByRole("heading", { name: /Moyennes par semestre/i })).toBeVisible({
      timeout: 30_000,
    });

    const noYear = page.getByText(/Aucune année académique active/i);
    if (await noYear.isVisible().catch(() => false)) {
      test.skip(true, "Aucune année active en base — activer une année puis relancer le test");
    }

    const combos = page.getByRole("combobox");
    await expect(combos.first()).toBeVisible({ timeout: 15_000 });
    const count = await combos.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const matrixResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/semester-averages/matrix") &&
        res.request().method() === "GET" &&
        res.status() === 200,
      { timeout: 30_000 }
    );

    await combos.nth(1).click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 10_000 });
    await options.first().click();

    await matrixResponse;

    const matrixTable = page.getByTestId("moyennes-matrix-table");
    const noStudents = page.getByText(/Aucun élève inscrit dans cette classe/i);
    const noCourses = page.getByText(/Aucune matière affectée à cette classe/i);

    await expect(
      matrixTable.or(noStudents).or(noCourses).first()
    ).toBeVisible({ timeout: 20_000 });

    if (await matrixTable.isVisible()) {
      await expect(matrixTable.locator("th", { hasText: "Code" })).toBeVisible();
      await expect(matrixTable.locator('input[type="text"]').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /Attestation/i }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Bulletin/i }).first()).toBeVisible();
    }
  });
});
