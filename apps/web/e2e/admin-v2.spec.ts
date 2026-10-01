import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke test des écrans d'administration v2 — SANS API ni base : seul Next tourne, les appels `/api/v1/*` sont simulés.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.admin.config.ts
 *
 * Parcours couverts :
 *   - console plateforme : garde de connexion, connexion de l'opérateur, liste des organisations, tiroir mobile ;
 *   - administration d'un tenant : la garde SERVEUR renvoie vers /login sans session (les parcours authentifiés
 *     — rôles, établissement, audit — sont couverts par les tests Vitest/RTL ; ils exigent NextAuth + API réels).
 */

const NOW = "2026-10-01T10:00:00.000Z";
const TENANT_ID = "00000000-0000-4000-8000-000000000100";

function jsonBody(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function mockOperatorApi(page: Page) {
  // Prédicats sur le chemin (plus fiables que les globs avec requête et sous-chemins).
  await page.route(
    (url) => url.pathname === "/api/v1/super-admin/auth/login",
    (route) => route.fulfill(jsonBody({ token: "e2e-operator-token", superAdmin: { email: "ops@ecoledigitale.net" } })),
  );
  await page.route((url) => url.pathname.startsWith("/api/v1/platform/tenants"), (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/tenants/${TENANT_ID}`)) return route.fulfill(jsonBody({ code: "NOT_FOUND", message: "Organisation introuvable." }, 404));
    return route.fulfill(
      jsonBody({
        items: [
          { id: TENANT_ID, slug: "ecole-soleil", name: "École Soleil", status: "active", createdAt: NOW },
          { id: "00000000-0000-4000-8000-000000000101", slug: "lycee-nord", name: "Lycée Nord", status: "suspended", createdAt: NOW },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      }),
    );
  });
}

/** Aucune barre de défilement horizontale : le contenu tient dans la largeur de l'écran. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// `next dev` compile chaque route à la première visite (jusqu'à plusieurs minutes à froid) : on les réchauffe une fois.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(420 * 1000);
  const page = await browser.newPage();
  for (const path of ["/v2/platform/login", "/v2/platform/tenants", "/v2/audit"]) {
    await page.goto(path, { timeout: 200 * 1000, waitUntil: "load" }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page.close();
});

test.describe("console plateforme", () => {
  test("sans jeton, la console renvoie vers la connexion de l'opérateur", async ({ page }) => {
    await page.goto("/v2/platform/tenants");
    await expect(page).toHaveURL(/\/v2\/platform\/login/);
    await expect(page.getByRole("heading", { name: "Console plateforme" })).toBeVisible();
  });

  test("connexion, liste des organisations, navigation clavier du menu", async ({ page, isMobile }) => {
    await mockOperatorApi(page);
    await page.goto("/v2/platform/login");
    await expectNoHorizontalScroll(page);

    // Validation locale : aucun appel tant que les champs sont vides.
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Ce champ est obligatoire.").first()).toBeVisible();

    await page.getByLabel(/Adresse e-mail/).fill("ops@ecoledigitale.net");
    await page.getByLabel(/Mot de passe/).fill("motdepasse");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(/\/v2\/platform\/tenants/);
    const table = page.getByRole("table", { name: "Organisations" });
    await expect(table.getByRole("link", { name: "Ouvrir l'organisation École Soleil" })).toBeVisible();
    await expect(table.getByText("Suspendue")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Le jeton d'opérateur est stocké à part de toute session de tenant.
    expect(await page.evaluate(() => localStorage.getItem("superAdminToken"))).toBe("e2e-operator-token");

    // Lien d'évitement : premier élément focalisable.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();

    if (isMobile) {
      const toggle = page.getByRole("button", { name: "Ouvrir le menu" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("navigation", { name: "Navigation de la console plateforme" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();
    } else {
      await expect(page.getByRole("navigation", { name: "Navigation de la console plateforme" })).toBeVisible();
    }
  });

  test("déconnexion : le jeton est effacé et la console redevient inaccessible", async ({ page }) => {
    await mockOperatorApi(page);
    await page.addInitScript(() => {
      localStorage.setItem("superAdminToken", "e2e-operator-token");
      localStorage.setItem("superAdminEmail", "ops@ecoledigitale.net");
    });
    await page.goto("/v2/platform/tenants");
    await expect(page.getByRole("table", { name: "Organisations" })).toBeVisible();
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/v2\/platform\/login/);
    expect(await page.evaluate(() => localStorage.getItem("superAdminToken"))).toBeNull();
  });

  test("une organisation introuvable est expliquée (404 de l'API)", async ({ page }) => {
    await mockOperatorApi(page);
    await page.addInitScript(() => localStorage.setItem("superAdminToken", "e2e-operator-token"));
    await page.goto(`/v2/platform/tenants/${TENANT_ID}`);
    await expect(page.getByText("Cette organisation n'existe pas.")).toBeVisible();
  });
});

test.describe("administration d'un tenant", () => {
  for (const path of ["/v2/audit", "/v2/access/roles", "/v2/settings"]) {
    test(`${path} : sans session, la garde serveur renvoie vers /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
