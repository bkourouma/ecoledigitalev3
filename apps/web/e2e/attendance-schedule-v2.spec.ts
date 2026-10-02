import { expect, test } from "@playwright/test";

/**
 * Smoke des écrans `/v2/attendance/*` et `/v2/schedule/*` SANS API ni base : seul Next tourne.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.attendance.config.ts
 *
 * Ce qui est vérifié ici : la garde SERVEUR (session obligatoire) protège toutes les routes de ces deux sections,
 * à 375 px comme sur bureau. Les parcours authentifiés (appel en deux gestes, file hors ligne, reconnexion, conflits,
 * justificatifs, éditeur de patrons…) sont couverts par les tests Vitest/RTL avec un faux IndexedDB et un faux client API
 * (`src/app/v2/attendance/_components/*.test.tsx`, `src/platform/offline/offline.test.ts`) : ils exigent NextAuth, le RBAC et
 * l'API v2 (Postgres + Redis) pour tourner de bout en bout.
 *
 * À écrire avec l'infrastructure complète (parcours Playwright mobile de la spec 010) : appel hors ligne (réseau coupé via
 * `context.setOffline(true)`), reconnexion puis synchronisation ; un parent justifie, la direction accepte.
 */

const ROUTES = [
  "/v2/attendance",
  "/v2/attendance/call",
  "/v2/attendance/call/occurrence/00000000-0000-4000-8000-000000000001",
  "/v2/attendance/call/daily/00000000-0000-4000-8000-000000000001?date=2026-10-01",
  "/v2/attendance/sessions",
  "/v2/attendance/absences",
  "/v2/attendance/justifications",
  "/v2/attendance/compliance",
  "/v2/attendance/alerts",
  "/v2/attendance/conflicts",
  "/v2/attendance/staff",
  "/v2/attendance/staff/me",
  "/v2/attendance/children",
  "/v2/attendance/me",
  "/v2/attendance/student/00000000-0000-4000-8000-000000000002",
  "/v2/schedule",
  "/v2/schedule/today",
  "/v2/schedule/occurrences",
  "/v2/schedule/timetables",
  "/v2/schedule/timetables/00000000-0000-4000-8000-000000000003",
  "/v2/schedule/replacements",
  "/v2/schedule/rooms",
  "/v2/schedule/export",
];

// `next dev` compile chaque route à la première visite : une seule passe de réchauffage évite les délais d'attente.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(600 * 1000);
  const page = await browser.newPage();
  for (const path of ["/v2/attendance/call", "/v2/schedule"]) {
    await page.goto(path, { timeout: 200 * 1000, waitUntil: "load" }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page.close();
});

test.describe("présences et emploi du temps : garde serveur", () => {
  for (const path of ROUTES) {
    test(`${path.split("?")[0]} : sans session, renvoi vers /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      // Pas de défilement horizontal sur la page de connexion, à 375 px comme sur bureau.
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test("les ressources de l'application hors ligne ne mettent pas de réponse authentifiée en cache", async ({ page }) => {
  await page.goto("/offline");
  const cached = await page.evaluate(async () => {
    if (!("caches" in window)) return [];
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
  // Rien de `/api/` ni de `/v2/` n'a jamais sa place dans un cache du service worker.
  expect(cached.filter((p) => p.startsWith("/api/") || p.startsWith("/v2/"))).toEqual([]);
});
