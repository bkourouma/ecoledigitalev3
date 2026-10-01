import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright DÉDIÉE au smoke test PWA (e2e/pwa.spec.ts).
 * Démarre uniquement Next (pas d'API, pas de base) avec le service worker activé.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.pwa.config.ts
 *
 * Variables : PWA_PORT (défaut 3100) ; PW_CHANNEL=msedge|chrome pour utiliser un navigateur installé
 * au lieu du Chromium de Playwright (`playwright install chromium`).
 */
const port = Number(process.env.PWA_PORT ?? 3100);

// Permet à context.route() d'intercepter aussi les requêtes émises par le service worker (simule le réseau coupé).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /pwa\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "pwa-chromium",
      use: { ...devices["Desktop Chrome"], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    env: { NEXT_PUBLIC_PWA: "1", NEXT_TELEMETRY_DISABLED: "1" },
    url: `http://localhost:${port}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
