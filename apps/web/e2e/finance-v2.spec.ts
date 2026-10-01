import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke test des écrans finance et paie v2 — SANS API ni base : seul Next tourne.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.finance.config.ts
 *
 * Ce que le smoke prouve : chaque route `/v2/finance/*` et `/v2/payroll/*` COMPILE (une erreur de module donnerait une 500
 * en `next dev`), est protégée par la garde SERVEUR (sans session : redirection vers `/login`, jamais de contenu ni d'appel
 * financier) et la page de connexion atteinte tient dans 375 px comme sur le bureau. Les parcours authentifiés (encaisser,
 * clôturer une caisse, calculer, arrêter, verser) exigent NextAuth + l'API réelle : ils sont couverts par les tests
 * Vitest/RTL (`src/app/v2/finance`, `src/app/v2/payroll`), à compléter par un parcours bout en bout avec l'infrastructure complète.
 */

const UUID = "00000000-0000-4000-8000-000000000999";

const ROUTES = [
  "/v2/finance",
  "/v2/finance/fees",
  "/v2/finance/fees/schedules",
  "/v2/finance/fees/plans",
  "/v2/finance/fees/discounts",
  "/v2/finance/funding",
  "/v2/finance/invoices",
  "/v2/finance/invoices/new",
  `/v2/finance/invoices/${UUID}`,
  "/v2/finance/payments",
  "/v2/finance/payments/new",
  "/v2/finance/payments/online",
  `/v2/finance/payments/${UUID}`,
  "/v2/finance/receipts",
  `/v2/finance/receipts/${UUID}`,
  "/v2/finance/refunds",
  "/v2/finance/cash",
  "/v2/finance/reports",
  "/v2/finance/me",
  `/v2/finance/me/${UUID}`,
  `/v2/finance/me/${UUID}/receipts/${UUID}`,
  "/v2/payroll",
  `/v2/payroll/periods/${UUID}`,
  "/v2/payroll/payslips",
  `/v2/payroll/payslips/${UUID}`,
  "/v2/payroll/configuration",
  "/v2/payroll/configuration/rates",
  "/v2/payroll/configuration/settings",
  "/v2/payroll/history",
  "/v2/payroll/reports",
  "/v2/payroll/owner",
  "/v2/payroll/my",
  `/v2/payroll/my/${UUID}`,
];

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// `next dev` compile chaque route à la première visite : on les réchauffe une fois (le délai dépend de la machine).
test.beforeAll(async ({ browser }) => {
  test.setTimeout(1500 * 1000);
  const page = await browser.newPage();
  for (const path of ROUTES) {
    await page.goto(path, { timeout: 200 * 1000, waitUntil: "load" }).catch(() => undefined);
  }
  await page.close();
});

test.describe("gardes serveur et compilation des routes finance et paie", () => {
  for (const path of ROUTES) {
    test(`${path.replace(UUID, ":id")} : sans session, redirection vers la connexion`, async ({ page }) => {
      const apiCalls: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/v1/finance") || new URL(request.url()).pathname.startsWith("/api/v1/payroll")) apiCalls.push(request.url());
      });
      const response = await page.goto(path);
      // Jamais de 500 (module qui ne compile pas) ni de contenu rendu sans session.
      expect(response?.status() ?? 200).toBeLessThan(500);
      await expect(page).toHaveURL(/\/login/);
      await expectNoHorizontalScroll(page);
      expect(apiCalls).toEqual([]);
    });
  }
});
