import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke test des écrans v2 « notes, résultats, règles, bulletins, supérieur » — SANS API ni base : seul Next tourne,
 * les appels `/api/v1/*` sont simulés.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.grades.config.ts
 *
 * Parcours couverts :
 *   - la page PUBLIQUE de vérification `/v2/verify` (sans session) : saisie d'un code, verdicts, lien du QR, 375 px et bureau ;
 *   - les gardes SERVEUR : chaque section renvoie vers /login sans session.
 * Les parcours authentifiés (grille de notes, circuit de validation, clôture, bulletins…) sont couverts par Vitest/RTL
 * (`src/app/v2/**`) ; ils exigent NextAuth et l'API réels pour un test de bout en bout.
 */

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NOW = "2026-10-01T10:00:00.000Z";

function jsonBody(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function verification(over: Record<string, unknown> = {}) {
  return {
    status: "AUTHENTIC",
    documentKind: "REPORT_CARD",
    institutionName: "Établissement de démonstration",
    title: "Bulletin du semestre 1",
    issuedAt: NOW,
    mention: null,
    supersededByIssuedAt: null,
    revokedAt: null,
    keyId: "ed-0123456789abcdef",
    keyFingerprint: "e".repeat(64),
    snapshotHash: "a".repeat(64),
    signature: "c2lnbmF0dXJl",
    message: "Ce document a bien été émis par l'établissement.",
    ...over,
  };
}

async function mockVerify(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/public/verify/"),
    (route) => {
      const code = new URL(route.request().url()).pathname.split("/").pop();
      if (code === CODE) return route.fulfill(jsonBody(verification()));
      if (code === "REVOKEDREVOKEDREVOKEDREVO") return route.fulfill(jsonBody(verification({ status: "REVOKED", revokedAt: NOW })));
      return route.fulfill(jsonBody(verification({ status: "UNKNOWN", documentKind: null, institutionName: null, title: null, issuedAt: null, keyId: null, keyFingerprint: null, snapshotHash: null, signature: null, message: "Document inconnu." }), 404));
    },
  );
}

/** Aucune barre de défilement horizontale : le contenu tient dans la largeur de l'écran. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// `next dev` compile chaque route à la première visite : on les réchauffe une fois.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(420 * 1000);
  const page = await browser.newPage();
  for (const path of ["/v2/verify", `/v2/verify/${CODE}`, "/v2/assessments", "/v2/results", "/v2/rules", "/v2/reportcards", "/v2/higher"]) {
    await page.goto(path, { timeout: 200 * 1000, waitUntil: "load" }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await page.close();
});

test.describe("vérification publique d'un document", () => {
  test("saisie d'un code : verdict, sans menu ni connexion, sans débordement horizontal", async ({ page }) => {
    await mockVerify(page);
    await page.goto("/v2/verify");
    await expect(page.getByRole("heading", { name: "Vérification d'un document" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // page publique : aucune navigation d'administration
    await expect(page.getByRole("navigation")).toHaveCount(0);

    // saisie avec espaces et minuscules : normalisée avant l'appel
    await page.getByLabel(/Code de vérification/).fill("abcdefghij klmnopqrs tuvwxyz");
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByRole("heading", { name: "Document authentique" })).toBeVisible();
    await expect(page.getByText("Établissement de démonstration")).toBeVisible();
    await expectNoHorizontalScroll(page);
    // aucune donnée personnelle (ni note, ni nom d'élève) n'est affichée
    await expect(page.getByText(/Aka|ELV-/)).toHaveCount(0);

    await page.getByLabel(/Code de vérification/).fill("REVOKEDREVOKEDREVOKEDREVO");
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByRole("heading", { name: "Document révoqué" })).toBeVisible();

    await page.getByLabel(/Code de vérification/).fill("ZZZZ");
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByText(/Aucun document ne correspond à ce code/)).toBeVisible();
  });

  test("cible du QR code : le code de l'adresse est vérifié dès l'ouverture", async ({ page }) => {
    await mockVerify(page);
    await page.goto(`/v2/verify/${CODE}`);
    await expect(page.getByRole("heading", { name: "Document authentique" })).toBeVisible();
    await page.goto(`/v2/verify/v/${CODE}`);
    await expect(page.getByRole("heading", { name: "Document authentique" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("la page n'est pas indexable", async ({ page }) => {
    await mockVerify(page);
    await page.goto("/v2/verify");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("comparaison d'un fichier : un fichier non PDF est refusé avant tout envoi", async ({ page }) => {
    await mockVerify(page);
    let uploads = 0;
    await page.route((url) => url.pathname === "/api/v1/public/verify/upload", (route) => {
      uploads += 1;
      return route.fulfill(jsonBody({ match: false, status: null, institutionName: null, title: null, issuedAt: null, message: "Aucun document émis ne correspond à ce fichier." }));
    });
    await page.goto("/v2/verify");
    await page.getByLabel(/Fichier PDF/).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByText("Le fichier doit être au format PDF.")).toBeVisible();
    expect(uploads).toBe(0);
    await page.getByLabel(/Fichier PDF/).setInputFiles({ name: "bulletin.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
    await expect(page.getByText("Fichier non reconnu")).toBeVisible();
    expect(uploads).toBe(1);
  });
});

test.describe("gardes serveur des sections", () => {
  for (const path of ["/v2/assessments", "/v2/assessments/new", "/v2/results", "/v2/results/matrix", "/v2/rules", "/v2/reportcards", "/v2/reportcards/issue", "/v2/higher/diplomas", "/v2/higher/credits"]) {
    test(`${path} renvoie vers la connexion sans session`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
