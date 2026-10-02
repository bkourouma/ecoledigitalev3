import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright DÉDIÉE au test e2e de l'authentification V2 (e2e/auth-v2.spec.ts).
 * Démarre un FAUX module iam (e2e/auth-v2/mock-iam-api.mjs : aucun Postgres, aucun Redis) et Next avec
 * `NEXT_PUBLIC_AUTH_V2=1`, puis déroule : connexion -> MFA -> navigation -> rotation du refresh -> déconnexion.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.auth-v2.config.ts      (depuis la racine : pnpm test:e2e:auth)
 *
 * Variables : AUTH_E2E_PORT (Next, défaut 3187), AUTH_E2E_API_PORT (faux iam, défaut 4187),
 *             PW_CHANNEL=msedge|chrome pour utiliser un navigateur installé au lieu du Chromium de Playwright.
 * Les secrets de test (mot de passe, secret NextAuth) sont ALÉATOIRES à chaque exécution et ne sont écrits nulle part.
 */
const port = Number(process.env.AUTH_E2E_PORT ?? 3187);
const apiPort = Number(process.env.AUTH_E2E_API_PORT ?? 4187);

process.env.E2E_PASSWORD ??= `Zq${randomBytes(12).toString("base64url")}-9a`;
process.env.E2E_NEXTAUTH_SECRET ??= randomBytes(32).toString("hex");
process.env.E2E_TOTP ??= "246810";
// Jeton d'accès de 125 s : le renouvellement planifié (marge de 120 s) a lieu ~5 s après la connexion.
process.env.E2E_ACCESS_TTL_SEC ??= "125";
process.env.E2E_API_URL = `http://127.0.0.1:${apiPort}`;

const channel = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /auth-v2\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...channel } },
    { name: "mobile", use: { ...devices["Pixel 5"], ...channel }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: "node e2e/auth-v2/mock-iam-api.mjs",
      env: { E2E_MOCK_PORT: String(apiPort), E2E_PASSWORD: process.env.E2E_PASSWORD, E2E_TOTP: process.env.E2E_TOTP, E2E_ACCESS_TTL_SEC: process.env.E2E_ACCESS_TTL_SEC },
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next dev -p ${port}`,
      env: {
        NEXT_PUBLIC_AUTH_V2: "1",
        NEXT_PUBLIC_TENANT_SLUG: "ecole",
        NEXTAUTH_URL: `http://localhost:${port}`,
        NEXTAUTH_SECRET: process.env.E2E_NEXTAUTH_SECRET,
        API_INTERNAL_URL: process.env.E2E_API_URL,
        NEXT_PUBLIC_API_URL: process.env.E2E_API_URL,
        NEXT_PUBLIC_PWA: "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      url: `http://localhost:${port}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
