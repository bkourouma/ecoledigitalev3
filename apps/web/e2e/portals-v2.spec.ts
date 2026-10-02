import { expect, test } from "@playwright/test";

/**
 * Smoke des portails `/v2/parent/*`, `/v2/student/*` et `/v2/teacher/*` SANS API ni base : seul Next tourne.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.portals.config.ts
 *
 * Ce qui est vérifié ici : la garde SERVEUR (session obligatoire, fail-closed) protège chaque route des trois portails, à 375 px
 * comme sur bureau, et AUCUN appel de données n'est émis sans session. Les parcours authentifiés (matrice d'accès : un parent ne voit
 * pas un enfant non lié, un enseignant pas une classe étrangère ; paiement en ligne ; contestation d'un bulletin de paie) sont couverts par
 * Vitest/RTL avec un faux client API (`src/app/v2/{parent,student,teacher}/_components/*.test.tsx`) : ils exigent NextAuth, le RBAC et
 * l'API v2 (Postgres + Redis) pour tourner de bout en bout.
 */

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";

const PARENT = [
  "/v2/parent",
  "/v2/parent/account",
  `/v2/parent/children/${U1}`,
  `/v2/parent/children/${U1}/results`,
  `/v2/parent/children/${U1}/reportcards`,
  `/v2/parent/children/${U1}/attendance`,
  `/v2/parent/children/${U1}/schedule`,
  `/v2/parent/children/${U1}/upcoming`,
  `/v2/parent/children/${U1}/finance`,
  `/v2/parent/children/${U1}/finance/receipts/${U2}`,
  `/v2/parent/children/${U1}/documents`,
  `/v2/parent/children/${U1}/emergency`,
];

const STUDENT = [
  "/v2/student",
  "/v2/student/results",
  "/v2/student/reportcards",
  "/v2/student/schedule",
  "/v2/student/upcoming",
  "/v2/student/attendance",
  "/v2/student/finance",
  `/v2/student/finance/receipts/${U2}`,
  "/v2/student/documents",
  "/v2/student/profile",
];

const TEACHER = [
  "/v2/teacher",
  "/v2/teacher/classes",
  `/v2/teacher/classes/${U1}`,
  "/v2/teacher/assessments",
  "/v2/teacher/assessments/new",
  `/v2/teacher/assessments/${U1}`,
  `/v2/teacher/assessments/${U1}/grades`,
  "/v2/teacher/attendance",
  `/v2/teacher/attendance/call/occurrence/${U1}`,
  `/v2/teacher/attendance/call/daily/${U1}?date=2026-10-01`,
  "/v2/teacher/schedule",
  "/v2/teacher/schedule/export",
  "/v2/teacher/payslips",
  `/v2/teacher/payslips/${U1}`,
  "/v2/teacher/leaves",
  "/v2/teacher/profile",
];

// `next dev` compile chaque route à la première visite : une seule passe de réchauffage évite les délais d'attente.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(600 * 1000);
  const page = await browser.newPage();
  for (const path of ["/v2/parent", "/v2/student", "/v2/teacher"]) {
    await page.goto(path, { timeout: 200 * 1000, waitUntil: "load" }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page.close();
});

for (const [portal, routes] of [
  ["parent", PARENT],
  ["élève", STUDENT],
  ["enseignant", TEACHER],
] as const) {
  test.describe(`portail ${portal} : garde serveur`, () => {
    for (const path of routes) {
      test(`${path.split("?")[0]} : sans session, renvoi vers /login et aucun appel de données`, async ({ page }) => {
        const dataCalls: string[] = [];
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (url.pathname.startsWith("/api/v1/") && !url.pathname.startsWith("/api/v1/rbac/me/permissions")) dataCalls.push(url.pathname);
        });
        await page.goto(path);
        await expect(page).toHaveURL(/\/login/);
        expect(dataCalls).toEqual([]);
        // Pas de défilement horizontal sur la page de connexion, à 375 px comme sur bureau.
        const overflow = await page.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          return el.scrollWidth - el.clientWidth;
        });
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  });
}
