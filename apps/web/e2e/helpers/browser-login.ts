import type { Page } from "@playwright/test";

const DEFAULT_ADMIN_EMAIL = "admin@imhotepacademy.fr";

/**
 * Connexion navigateur (page /login, NextAuth credentials + JWT en localStorage).
 * Identifiants : E2E_ADMIN_PASSWORD (obligatoire) et E2E_ADMIN_EMAIL (optionnel).
 */
export async function loginAsAdmin(page: Page) {
  const email = process.env.E2E_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("E2E_ADMIN_PASSWORD est requis (aucun mot de passe par défaut).");
  }

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
