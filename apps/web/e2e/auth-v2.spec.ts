import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * E2E de l'authentification V2 (NEXT_PUBLIC_AUTH_V2=1) : connexion -> MFA -> navigation -> rotation du refresh ->
 * déconnexion, contre le FAUX module iam de e2e/auth-v2/mock-iam-api.mjs (aucun Postgres, aucun Redis).
 *
 *   pnpm test:e2e:auth                     (racine)    ou    pnpm --filter @ecoledigitale/web exec playwright test -c playwright.auth-v2.config.ts
 *
 * Ce que le test prouve du WEB : NextAuth appelle bien /api/v1/iam/*, le refresh token ne parvient JAMAIS à la page,
 * la rotation est faite par le serveur avant l'échéance, une session révoquée ramène à la connexion, la déconnexion
 * révoque la session côté API, les messages d'erreur ne distinguent pas compte inconnu / mot de passe faux.
 */
const API = process.env.E2E_API_URL as string;
const PASSWORD = process.env.E2E_PASSWORD as string;
const TOTP = process.env.E2E_TOTP as string;

interface MockState {
  logins: number;
  refreshes: number;
  reuses: number;
  logouts: string[];
  lastForwardedFor: string | null;
  refreshAuthHeaders: boolean[];
  sessions: Array<{ id: string; email: string; revoked: boolean }>;
}
const mockState = async (request: APIRequestContext): Promise<MockState> => (await request.get(`${API}/__mock/state`)).json();

/** Saisit les identifiants sur la page de connexion déjà ouverte (sans valider). */
async function typeCredentials(page: Page, email: string, password: string): Promise<void> {
  // Le serveur de développement compile la page à la demande : une saisie faite AVANT l'hydratation est effacée par React.
  // On resaisit jusqu'à ce que le formulaire (réellement hydraté) accepte les valeurs.
  await expect(async () => {
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 120_000 });
}

async function fillCredentials(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await typeCredentials(page, email, password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Message d'erreur du formulaire (le « route announcer » de Next porte aussi role=alert, hors de `<main>`). */
const formAlert = (page: Page) => page.locator("main").getByRole("alert");

const sessionJson = (page: Page): Promise<Record<string, unknown>> => page.evaluate(async () => (await fetch("/api/auth/session")).json());

test.describe.configure({ mode: "serial" });

// `next dev` compile les pages à la première requête (plus d'une minute à froid, davantage sur une machine chargée) : on
// les réchauffe une fois pour que le coût n'entre dans aucun test.
test.beforeAll(async ({ request }) => {
  test.setTimeout(360_000);
  for (const path of ["/api/auth/providers", "/login", "/v2/account/sessions", "/select-role", "/teacher/dashboard", "/tableau-de-bord"]) {
    await request.get(path, { timeout: 300_000 }).catch(() => undefined);
  }
});

test("la page de connexion V2 est accessible : étiquettes liées, erreur annoncée, pas de défilement horizontal @mobile", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
  await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
  await expect(page.getByLabel("Mot de passe")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.locator("main")).toHaveCount(1);
  // Mobile d'abord : rien ne déborde de la fenêtre.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await typeCredentials(page, "prof@ecole.test", "pas-le-bon-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(formAlert(page)).toContainText("Identifiants invalides");
});

test("anti-énumération : compte inconnu et mot de passe faux affichent le MÊME message", async ({ page }) => {
  await fillCredentials(page, "prof@ecole.test", "mauvais-mot-de-passe-1");
  const known = await formAlert(page).innerText();
  await page.reload();
  await fillCredentials(page, "personne@ecole.test", "mauvais-mot-de-passe-1");
  const unknown = await formAlert(page).innerText();
  expect(known).toBe(unknown);
});

test("connexion sans MFA : le serveur appelle iam, l'adresse du navigateur est relayée, le refresh n'atteint jamais la page", async ({ page, request }) => {
  await fillCredentials(page, "prof@ecole.test");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  const session = await sessionJson(page);
  expect(typeof session.jwtToken).toBe("string");
  expect(session.activeRole).toBe("teacher");
  expect(session.authVersion).toBe(2);
  // `session.user.id` = compte LEGACY (whoami), l'identité IAM globale est exposée à part.
  const ids = { user: (session.user as { id: string }).id, iam: session.iamUserId as string };
  expect(ids.user).toMatch(/-0000000001b1$/);
  expect(ids.iam).toMatch(/-0000000000b1$/);
  // Le refresh token (rt1.…) ne figure ni dans la session exposée, ni dans le stockage du navigateur.
  expect(JSON.stringify(session)).not.toContain("rt1.");
  expect(JSON.stringify(session)).not.toContain("iamRefreshToken");
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + document.cookie);
  expect(stored).not.toContain("rt1.");
  // Le jeton est partagé avec le fetch-interceptor (même clé que le legacy).
  expect(await page.evaluate(() => localStorage.getItem("ecoledigitale_jwt_token"))).toBe(session.jwtToken);
  const state = await mockState(request);
  expect(state.lastForwardedFor).toBeTruthy(); // le serveur Next relaie l'adresse du navigateur
});

test("MFA : défi TOTP (mauvais code refusé), puis navigation vers « mes sessions »", async ({ page }) => {
  await fillCredentials(page, "admin@ecole.test");
  await expect(page.getByRole("heading", { level: 1, name: "Vérification en deux étapes" })).toBeVisible();
  // Aucune session partielle tant que le second facteur n'est pas validé.
  expect(Object.keys(await sessionJson(page))).toHaveLength(0);

  await page.getByLabel("Code à 6 chiffres").fill("000000");
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(formAlert(page)).toContainText("Code invalide");
  expect(Object.keys(await sessionJson(page))).toHaveLength(0);

  await page.getByLabel("Code à 6 chiffres").fill(TOTP);
  await page.getByRole("button", { name: "Valider" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  expect((await sessionJson(page)).activeRole).toBe("admin");

  await page.goto("/v2/account/sessions");
  await expect(page.getByRole("heading", { level: 1, name: "Mes sessions actives" })).toBeVisible();
  const rows = page.getByTestId("session-row");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByText("Cet appareil")).toBeVisible();
});

test("rotation : le serveur renouvelle le jeton avant l'échéance sans jamais exposer le refresh ; la session survit", async ({ page, request }) => {
  await fillCredentials(page, "prof@ecole.test");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  const first = (await sessionJson(page)).jwtToken as string;
  const before = (await mockState(request)).refreshes;
  // Jeton de 125 s, marge de 120 s : le renouvellement planifié part ~5 s après la connexion.
  await expect.poll(async () => (await mockState(request)).refreshes, { timeout: 60_000 }).toBeGreaterThan(before);
  await expect.poll(async () => (await sessionJson(page)).jwtToken, { timeout: 30_000 }).not.toBe(first);
  const state = await mockState(request);
  expect(state.reuses).toBe(0); // jamais deux rotations avec le même refresh token
  expect(state.refreshAuthHeaders.every((hasBearer) => hasBearer === false)).toBe(true);
  await page.reload();
  expect(typeof (await sessionJson(page)).jwtToken).toBe("string");
});

test("session révoquée côté API : la rotation échoue, l'interface revient à la connexion", async ({ page, request }) => {
  await fillCredentials(page, "prof@ecole.test");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  await request.post(`${API}/__mock/revoke`);
  // Soit la rotation planifiée échoue (session sans support serveur) -> signOut vers /login?expired=1, soit une requête
  // refusée ramène à /login ; dans les deux cas la session web finit par être effacée et la bannière affichée.
  await page.waitForURL(/\/login/, { timeout: 90_000 });
  await expect.poll(() => page.url(), { timeout: 60_000, message: "retour à /login?expired=1" }).toContain("expired=1");
  await expect(page.getByText("Votre session a pris fin")).toBeVisible();
  expect(Object.keys(await sessionJson(page))).toHaveLength(0);
});

test("enrôlement MFA obligatoire : QR code, codes de secours affichés une fois, puis accès", async ({ page }) => {
  await fillCredentials(page, "neuf@ecole.test");
  await expect(page.getByRole("heading", { level: 1, name: "Activer la vérification en deux étapes" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  expect(Object.keys(await sessionJson(page))).toHaveLength(0);
  await page.getByLabel("Code à 6 chiffres").fill(TOTP);
  await page.getByRole("button", { name: "Activer et continuer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Codes de secours" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Codes de secours" }).getByRole("listitem")).toHaveCount(3);
  const continueButton = page.getByRole("button", { name: "Continuer" });
  await expect(continueButton).toBeDisabled();
  await page.getByRole("checkbox").check();
  await continueButton.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  // Les codes ne sont plus dans la session.
  expect(JSON.stringify(await sessionJson(page))).not.toContain("aaaa-bbbb-cccc");
});

test("déconnexion : la session IAM est révoquée côté API et la session web effacée", async ({ page, request }) => {
  await fillCredentials(page, "prof@ecole.test");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  const current = (await mockState(request)).sessions.filter((s) => s.email === "prof@ecole.test" && !s.revoked);
  expect(current.length).toBeGreaterThan(0);

  await page.goto("/v2/account/sessions");
  await page.getByRole("button", { name: /Me déconnecter/ }).click();
  await page.waitForURL(/\/login/, { timeout: 60_000 });
  await expect.poll(async () => Object.keys(await sessionJson(page)).length, { timeout: 30_000, message: "session web effacée" }).toBe(0);
  const after = await mockState(request);
  expect(after.logouts.length).toBeGreaterThan(0);
  expect(after.sessions.filter((s) => s.email === "prof@ecole.test" && !s.revoked)).toHaveLength(0);
});

test("changement de rôle (/select-role) : nouvelle session côté API, le rôle d'interface suit", async ({ page, request }) => {
  await fillCredentials(page, "multi@ecole.test");
  await page.waitForURL(/\/select-role/, { timeout: 90_000 });
  const before = (await mockState(request)).sessions.filter((s) => s.email === "multi@ecole.test" && !s.revoked).length;
  await page.getByRole("button", { name: /parent/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/select-role"), { timeout: 90_000 });
  expect((await sessionJson(page)).activeRole).toBe("parent");
  const after = (await mockState(request)).sessions.filter((s) => s.email === "multi@ecole.test" && !s.revoked).length;
  expect(after).toBe(before); // l'ancienne session a été révoquée, une nouvelle ouverte
});
