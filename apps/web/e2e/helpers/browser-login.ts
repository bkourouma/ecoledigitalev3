import type { Page } from "@playwright/test";

const DEFAULT_ADMIN_EMAIL = "admin@imhotepacademy.fr";
const DEFAULT_ADMIN_PASSWORD = "Passw0rd!admin";

/**
 * Connexion navigateur (page /login, NextAuth credentials + JWT en localStorage).
 * Identifiants : E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD ou valeurs seed Imhotep Academy.
 */
export async function loginAsAdmin(page: Page) {
  const email = process.env.E2E_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel(/Mot de passe/i).fill(password);

  await Promise.all([
    page.waitForURL(/\//, { timeout: 30_000 }),
    page.getByRole("button", { name: /Se connecter/i }).click(),
  ]);

  await page.waitForLoadState("networkidle").catch(() => {});
}
