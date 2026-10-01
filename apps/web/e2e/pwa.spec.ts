import { expect, test } from "@playwright/test";

/**
 * Smoke test PWA — ne nécessite NI l'API NI la base de données : seul le serveur Next est utilisé.
 *
 *   pnpm --filter @ecoledigitale/web exec playwright test -c playwright.pwa.config.ts
 *
 * Le service worker n'est enregistré qu'en production ou avec NEXT_PUBLIC_PWA=1 ; la configuration
 * `playwright.pwa.config.ts` démarre `next dev` avec ce drapeau.
 */

test.describe("PWA — manifeste et fichiers servis", () => {
  test("manifest.webmanifest est servi et valide", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/manifest\+json|application\/json/);

    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: "EcoleDigitale", display: "standalone", start_url: "/", scope: "/" });
    const sizes = (manifest.icons as Array<{ sizes: string }>).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));

    for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
      const res = await request.get(icon.src);
      expect(res.ok(), icon.src).toBe(true);
      expect(res.headers()["content-type"]).toContain(icon.type);
    }
  });

  test("sw.js est servi en JavaScript", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
    expect(await response.text()).toContain("CACHE_VERSION");
  });

  test("la page /offline s'affiche et la page d'accueil référence le manifeste", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();
    await expect(page).toHaveTitle(/EcoleDigitale/);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#2563eb");
  });
});

test.describe("PWA — service worker", () => {
  test("est enregistré, ne met jamais en cache l'API ni les pages privées, et sert /offline hors ligne", async ({ page, context }) => {
    await page.goto("/offline");

    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe("/");

    // Le SW contrôle la page (clients.claim) ; sinon on recharge une fois.
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Trafic d'API (peu importe la réponse) et navigation vers des pages privées.
    await page.evaluate(async () => {
      await Promise.allSettled([
        fetch("/api/v1/students", { headers: { Authorization: "Bearer test", "X-Tenant": "demo" } }),
        fetch("/api/auth/session"),
        fetch("/api/v1/rbac/me/permissions"),
      ]);
    });
    await page.goto("/owner/dashboard").catch(() => undefined);
    await page.goto("/offline");

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
      }
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0); // le pré-cache de l'app shell existe
    expect(cached).toContain("/offline");
    expect(cached.filter((p) => p.startsWith("/api/"))).toEqual([]);
    expect(cached.filter((p) => p.startsWith("/owner") || p.startsWith("/login") || p.startsWith("/tableau-de-bord"))).toEqual([]);

    // Réseau coupé POUR LE SERVICE WORKER (context.setOffline ne l'affecte pas) : les navigations vers les pages
    // privées et vers /offline échouent -> redirection vers /offline servie depuis le pré-cache.
    await context.route(/\/(owner|tableau-de-bord)(\/|$|\?)|\/offline(\?|$)/, (route) => route.abort("internetdisconnected"));
    await page.goto("/owner/dashboard").catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/offline");
    // Le lien « Réessayer » ramène à la page demandée.
    await expect(page.getByRole("link", { name: "Réessayer la connexion" })).toHaveAttribute("href", "/owner/dashboard");
  });
});
