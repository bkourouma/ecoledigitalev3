import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright DÉDIÉE au smoke test des écrans finance et paie v2 (e2e/finance-v2.spec.ts).
 * Démarre uniquement Next (ni API, ni base).
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.finance.config.ts
 *
 * Variables : FINANCE_PORT (défaut 3120) ; PW_CHANNEL=msedge|chrome pour utiliser un navigateur installé au lieu du
 * Chromium de Playwright (`playwright install chromium`).
 *
 * Deux projets : mobile (375 x 812, cible de conception) et bureau.
 */
const port = Number(process.env.FINANCE_PORT ?? 3120);
const channel = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /finance-v2\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 150 * 1000,
  expect: { timeout: 30 * 1000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile-375", use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 }, ...channel } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...channel } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    env: { NEXT_PUBLIC_PWA: "0", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_TENANT_SLUG: "demo" },
    url: `http://localhost:${port}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 240 * 1000,
  },
});
