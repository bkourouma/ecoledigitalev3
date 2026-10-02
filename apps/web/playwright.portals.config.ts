import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright DÉDIÉE au smoke des portails parent / élève / enseignant (e2e/portals-v2.spec.ts).
 * Démarre uniquement Next (ni API, ni base).
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.portals.config.ts
 *
 * Variables : PORTALS_PORT (défaut 3130) ; PW_CHANNEL=msedge|chrome pour utiliser un navigateur installé.
 * Deux projets : mobile (375 x 812, cible de conception) et bureau.
 */
const port = Number(process.env.PORTALS_PORT ?? 3130);
const channel = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /portals-v2\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 150 * 1000,
  expect: { timeout: 30 * 1000 },
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [
    { name: "mobile-375", use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 }, ...channel } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...channel } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    env: { NEXT_PUBLIC_PWA: "1", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_TENANT_SLUG: "demo" },
    url: `http://localhost:${port}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 240 * 1000,
  },
});
