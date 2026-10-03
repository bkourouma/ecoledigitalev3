#!/usr/bin/env node
/**
 * Balayage QA exploratoire des ecrans `/v2` sur la demonstration locale (`pnpm demo:up`).
 *
 * LECTURE SEULE sur la pile : connexions, navigation, GET. Aucun formulaire n'est soumis, aucun bouton clique en dehors du
 * formulaire de connexion. Les identifiants sont lus a l'execution depuis `.demo/credentials.json` (et `credentials.md` pour
 * l'operateur de la plateforme) : rien n'est ecrit dans ce depot, les resultats bruts vont dans `.demo/qa/` (non versionne).
 *
 * Usage :
 *   node scripts/qa/demo-sweep.mjs [--tenant=demo-secondaire] [--role=proprietaire] [--max-pages=120] [--tree-all] [--no-tree]
 *                                  [--headed] [--operator] [--out=.demo/qa] [--delay=150]
 *
 * Methode, par compte : connexion par le formulaire (MFA comprise), puis file d'exploration alimentee par
 *   1. la page d'atterrissage du role et les liens des menus de navigation (DOM rendu) ;
 *   2. l'arborescence `apps/web/src/app/v2/**\/page.tsx` (routes statiques ; `--tree-all` pour tous les roles, sinon proprietaire seul) ;
 *   3. les liens `/v2/...` decouverts sur chaque page (les segments dynamiques prennent ainsi de vrais identifiants de la demo).
 * Chaque page est analysee : statut, redirections, erreurs console, requetes API en echec, ecran d'erreur, ecran blanc, textes
 * suspects (undefined, null, [object Object], NaN, cles i18n brutes), libelles incoherents.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiCall, demoDir, loadCredentials, loadPlaywright, tenantOrigin, totpAt, WEB_PORT, findUp } from "./lib.mjs";
import { analyzePage } from "./analyze.mjs";
import { listTreeRoutes, patternOf } from "./tree.mjs";

const TREE = listTreeRoutes();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const MAX_PAGES_ARG = args["max-pages"] ? Number(args["max-pages"]) : null;
/** Plafond de pages par compte : le proprietaire (et l'operateur) parcourent toute l'arborescence, les autres roles leur menu et ses liens. */
const maxPagesFor = (account) => MAX_PAGES_ARG ?? (account.role === "proprietaire" || account.role === "operateur" ? 260 : 45);
const DELAY = Number(args.delay ?? 150);
const NAV_TIMEOUT = Number(process.env.ED_QA_NAV_TIMEOUT ?? 150_000);
const outDir = args.out ? String(args.out) : join(demoDir(), "qa");
mkdirSync(join(outDir, "shots"), { recursive: true });

const SKIP_SEED = /^\/v2\/(login|forgot-password|reset-password|platform|verify|apply|notifications\/unsubscribe)(\/|$)/;

// ---------------------------------------------------------------------------------------------------------------------------
// Identifiants
// ---------------------------------------------------------------------------------------------------------------------------
function loadOperator() {
  const md = findUp(join(".demo", "credentials.md"));
  if (!md) return null;
  const text = readFileSync(md, "utf8");
  const section = /## Op[eé]rateur de la plateforme[\s\S]*?(?=\n## |$)/.exec(text)?.[0];
  if (!section) return null;
  const email = /E-mail : `([^`]+)`/.exec(section)?.[1];
  const password = /Mot de passe : `([^`]+)`/.exec(section)?.[1];
  return email && password ? { tenant: "platform", pack: "PLATFORM", role: "operateur", email, password } : null;
}

const lastStep = new Map();
/** Code TOTP jamais reutilise : un pas strictement superieur au dernier utilise (anti-rejeu), attend le pas suivant au besoin. */
async function freshTotp(secret) {
  const cur = Math.floor(Date.now() / 30_000);
  const step = Math.max(cur, (lastStep.get(secret) ?? 0) + 1);
  if (step > cur + 1) await new Promise((r) => setTimeout(r, (step * 30_000 - Date.now()) + 500));
  lastStep.set(secret, step);
  return totpAt(secret, step * 30_000 + 1_000);
}

/** Instantane API du role (lecture seule) : permissions et navigation, pour comparer au menu rendu. Connexion API distincte de l'UI. */
async function apiSnapshot(account) {
  if (account.tenant === "platform") return null;
  try {
    const first = await apiCall("POST", "/api/v1/iam/login", undefined, { email: account.email, password: account.password, tenantSlug: account.tenant, client: "mobile" });
    let token = first.body?.status === "authenticated" ? first.body.accessToken : null;
    if (!token && first.body?.status === "mfa_required" && account.totpSecret) {
      const r = await apiCall("POST", "/api/v1/iam/mfa/challenge", undefined, { challengeToken: first.body.challengeToken, code: await freshTotp(account.totpSecret), client: "mobile" });
      token = r.body?.accessToken ?? null;
    }
    if (!token) return null;
    const perms = await apiCall("GET", "/api/v1/rbac/me/permissions", token);
    const nav = await apiCall("GET", "/api/v1/rbac/me/navigation", token);
    const ent = await apiCall("GET", "/api/v1/entitlements/me", token);
    return {
      permissions: perms.body?.permissions ?? null,
      navigation: nav.body?.portals ?? null,
      entitlementsStatus: ent.status,
    };
  } catch {
    return null;
  }
}

async function uiLogin(page, origin, account) {
  const loginPath = account.tenant === "platform" ? "/v2/platform/login" : "/v2/login";
  await page.goto(origin + loginPath, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  // `next dev` : l'hydratation tardive efface une saisie faite trop tot ; on remplit puis on verifie, quitte a recommencer.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByLabel(/Adresse e-mail/i).fill(account.email, { timeout: NAV_TIMEOUT });
    await page.getByLabel(/Mot de passe/i).first().fill(account.password);
    await page.waitForTimeout(600);
    const ok = (await page.getByLabel(/Adresse e-mail/i).inputValue()) === account.email && (await page.getByLabel(/Mot de passe/i).first().inputValue()) === account.password;
    if (ok) break;
  }
  await page.locator('button[type="submit"]').first().click({ timeout: 30_000 });
  if (account.totpSecret) {
    const code = page.getByLabel(/Code à 6 chiffres/i);
    await code.waitFor({ timeout: 30_000 });
    await code.fill(await freshTotp(account.totpSecret));
    await page.locator('button[type="submit"]').first().click();
  }
  await page.waitForURL((u) => !/\/(v2\/)?(platform\/)?login(\?|$)/.test(u.pathname + u.search), { timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------------------------
// Visite d'une page
// ---------------------------------------------------------------------------------------------------------------------------
async function extract(page) {
  return page.evaluate(() => {
    const text = (el) => (el?.innerText ?? "").replace(/ /g, " ").trim();
    const body = text(document.body);
    const main = text(document.querySelector("main, [role=main], #v2-main")) || body;
    const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    const menuHrefs = [...document.querySelectorAll("nav a[href], aside a[href], [role=navigation] a[href], header a[href]")].map((a) => a.getAttribute("href"));
    return {
      title: document.title,
      h1: text(document.querySelector("h1")).slice(0, 200),
      body: body.slice(0, 80_000),
      main: main.slice(0, 80_000),
      alerts: [...document.querySelectorAll('[role="alert"], [data-testid*="error"]')].map((e) => text(e).slice(0, 300)).filter(Boolean).slice(0, 10),
      // `nextjs-portal` existe toujours en `next dev` (indicateur « N ») : seule une boite de dialogue d'erreur ouverte compte.
      overlay: (() => {
        const root = document.querySelector("nextjs-portal")?.shadowRoot;
        const dlg = root?.querySelector("[data-nextjs-dialog-overlay], [data-nextjs-dialog], [role=dialog]");
        return dlg ? (dlg.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || "dialogue d'erreur Next.js" : null;
      })(),
      devToast: (() => {
        const root = document.querySelector("nextjs-portal")?.shadowRoot;
        if (!root) return null;
        // Texte de l'indicateur « N » (compteur d'erreurs) ; les balises <style> du shadow DOM sont ignorees.
        for (const el of root.querySelectorAll("*")) {
          if (el.tagName === "STYLE") continue;
          const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          if (t.length < 60 && /\b\d+\s*(issues?|errors?)\b/i.test(t)) return t;
        }
        return null;
      })(),
      hrefs,
      menuHrefs,
      skeletons: document.querySelectorAll('[aria-busy="true"], .animate-pulse, [data-loading="true"]').length,
      hasLogout: [...document.querySelectorAll("button, a")].some((e) => /d[ée]connect|log ?out|sign ?out/i.test(e.textContent ?? "")),
      // Navigation globale de la coque (`AppShell`) : un `nav` nomme « Navigation de ... » (menu lateral).
      hasNav: [...document.querySelectorAll("nav[aria-label]")].some((e) => /^Navigation de/i.test(e.getAttribute("aria-label") ?? "")),
    };
  });
}

async function visit(page, cur, origin, url, meta) {
  const rec = { url, ...meta, startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], apiFailures: [], requestFailures: [], navStatus: null, finalUrl: null, redirects: 0, error: null };
  cur.rec = rec;
  const t0 = Date.now();
  try {
    const resp = await page.goto(origin + url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    rec.navStatus = resp?.status() ?? null;
    let hops = 0;
    for (let r = resp?.request().redirectedFrom(); r; r = r.redirectedFrom()) hops += 1;
    rec.redirects = hops;
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    // Laisse les requetes tardives (react-query) et les squelettes se resorber.
    for (let i = 0; i < 6; i += 1) {
      const busy = await page.evaluate(() => document.querySelectorAll('[aria-busy="true"], .animate-pulse').length).catch(() => 0);
      if (!busy) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(250);
    rec.finalUrl = page.url().replace(origin, "");
    Object.assign(rec, await extract(page));
  } catch (e) {
    rec.error = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    rec.finalUrl = page.url().replace(origin, "");
    try {
      Object.assign(rec, await extract(page));
    } catch {
      /* page indisponible */
    }
  }
  rec.ms = Date.now() - t0;
  cur.rec = null;
  return rec;
}

/** `anyPath` : liens de MENU, visites meme hors `/v2` (entree historique `/admin/...` : un lien de menu mort doit etre detecte). */
function normalizeLink(href, origin, from, anyPath = false) {
  if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/.test(href)) return null;
  let u;
  try {
    u = new URL(href, origin + from);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (!u.pathname.startsWith("/v2") && !(anyPath && !/^\/(api|_next)(\/|$)/.test(u.pathname) && u.pathname !== "/")) return null;
  if (/logout|signout|sign-out|deconnexion/i.test(u.pathname)) return null;
  // Les ecrans d'appel ouvrent une seance (POST) au chargement : on ne les visite pas, le balayage reste en lecture seule.
  if (/\/attendance\/call\/[^/]+\/[^/]+$/.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, "") || "/v2";
}

// ---------------------------------------------------------------------------------------------------------------------------
// Balayage d'un compte
// ---------------------------------------------------------------------------------------------------------------------------
async function sweepAccount(browser, account, persist = () => {}) {
  const origin = account.tenant === "platform" ? `http://localhost:${WEB_PORT}` : tenantOrigin(account.tenant);
  const label = `${account.tenant}/${account.role}`;
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  const cur = { rec: null };
  page.on("console", (m) => {
    if (m.type() === "error" && cur.rec) cur.rec.consoleErrors.push({ text: m.text().slice(0, 1800), at: m.location()?.url?.slice(0, 160) });
  });
  page.on("pageerror", (e) => cur.rec?.pageErrors.push(String(e?.message ?? e).slice(0, 500)));
  page.on("response", async (r) => {
    const rec = cur.rec;
    if (!rec) return;
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/") && !r.url().includes(":4100")) return;
    if (r.status() < 400) return;
    let body = "";
    try {
      body = (await r.text()).slice(0, 300);
    } catch {
      /* corps indisponible */
    }
    rec.apiFailures.push({ method: r.request().method(), path: u.pathname + (u.search ? u.search.slice(0, 80) : ""), status: r.status(), body });
  });
  page.on("requestfailed", (r) => {
    if (!cur.rec) return;
    const f = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) return;
    cur.rec.requestFailures.push({ url: r.url().slice(0, 200), error: f });
  });

  const result = { account: { tenant: account.tenant, role: account.role, email: account.email, pack: account.pack }, loginError: null, landing: null, pages: [], uncoveredNote: null };
  if (args["menu-only"]) result.api = await apiSnapshot(account);
  try {
    await uiLogin(page, origin, account);
  } catch (e) {
    result.loginError = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    await page.screenshot({ path: join(outDir, "shots", `${label.replace(/\W/g, "_")}-login.png`) }).catch(() => {});
    await ctx.close();
    return result;
  }
  result.landing = page.url().replace(origin, "");

  const queue = []; // pages atteignables par l'interface (atterrissage, menu, liens decouverts depuis une page atteignable)
  const treeQueue = []; // routes de l'arborescence sans lien depuis l'interface : visitees apres, 'atteignable' = faux
  const seen = new Set();
  const perPattern = new Map();
  const menuLinks = new Set(); // menu de la page d'atterrissage uniquement : c'est le menu que voit le role
  const enqueue = (path, source, reachable, front = false) => {
    if (!path || seen.has(path)) return;
    const pattern = patternOf(path);
    if (pattern && /\[/.test(pattern)) {
      const n = perPattern.get(pattern) ?? 0;
      if (n >= 2) return;
      perPattern.set(pattern, n + 1);
    }
    seen.add(path);
    const target = reachable ? queue : treeQueue;
    (front ? target.unshift : target.push).call(target, { path, source, reachable });
  };

  const landingPath = result.landing.split("?")[0];
  enqueue(landingPath, "landing", true, true);
  const only = args.only ? String(args.only).split(",").filter(Boolean) : null;
  const menuOnly = Boolean(args["menu-only"]);
  if (menuOnly) enqueue("/v2/settings", "adminshell", true);
  const treeSeed = !only && !menuOnly && !args["no-tree"] && (args["tree-all"] || account.role === "proprietaire" || account.role === "operateur");
  let menuHarvested = false;
  let visited = 0;
  const maxPages = maxPagesFor(account);
  while ((queue.length || treeQueue.length) && visited < maxPages) {
    const { path, source, reachable } = queue.length ? queue.shift() : treeQueue.shift();
    const rec = await visit(page, cur, origin, path, { source, role: account.role, tenant: account.tenant, isMenuLink: reachable, pattern: patternOf(path) });
    visited += 1;
    const links = new Set();
    for (const h of rec.hrefs ?? []) {
      const n = normalizeLink(h, origin, path);
      if (n) links.add(n);
    }
    if (!menuHarvested && rec.finalUrl) {
      menuHarvested = true;
      for (const h of rec.menuHrefs ?? []) {
        const n = normalizeLink(h, origin, path, true);
        if (n) menuLinks.add(n);
      }
      result.landingMenu = [...menuLinks].sort();
      if (only) for (const p of only) enqueue(p, "only", true);
      else for (const m of [...menuLinks].sort().reverse()) enqueue(m, "menu", true, true);
      // L'operateur n'a que la console `/v2/platform` ; les autres routes le renvoient a la connexion (balayage inutile).
      if (treeSeed) for (const r of TREE) if (!/\[/.test(r) && (account.role === "operateur" ? /^\/v2\/platform(\/|$)/.test(r) && !/\/login$/.test(r) : !SKIP_SEED.test(r))) enqueue(r, "tree", false);
    }
    if (!only && !menuOnly && reachable) for (const n of [...links].sort()) enqueue(n, "crawl", true);
    // Passe menus : la coquille d'administration (`/v2/settings`) affiche les entrees de `/api/v1/rbac/me/navigation` (hrefs historiques `/admin/...`).
    if (menuOnly && path === "/v2/settings" && (rec.finalUrl ?? "").split("?")[0] === path) {
      const admin = new Set();
      for (const h of rec.menuHrefs ?? []) {
        const n = normalizeLink(h, origin, path, true);
        if (n) admin.add(n);
      }
      result.adminMenu = [...admin].sort();
      for (const m of result.adminMenu) enqueue(m, "adminmenu", true);
    }
    rec.findings = analyzePage(rec, { menuLinks, account });
    if (rec.findings.some((f) => f.severity === "bloquant" || f.severity === "majeur")) {
      rec.screenshot = join("shots", `${label.replace(/\W/g, "_")}-${path.replace(/\W+/g, "_").slice(0, 80)}.png`);
      await page.screenshot({ path: join(outDir, rec.screenshot) }).catch(() => {});
    }
    delete rec.hrefs;
    delete rec.menuHrefs;
    delete rec.body;
    rec.main = rec.main?.slice(0, 4000);
    result.pages.push(rec);
    persist(result);
    const worst = rec.findings.find((f) => f.severity === "bloquant") ? "BLOQ" : rec.findings.find((f) => f.severity === "majeur") ? "MAJ " : rec.findings.length ? "min " : "ok  ";
    console.log(`  ${worst} ${String(rec.navStatus ?? "---").padEnd(3)} ${String(rec.ms).padStart(6)}ms ${path}${rec.finalUrl && rec.finalUrl.split("?")[0] !== path ? ` -> ${rec.finalUrl}` : ""}${reachable ? "" : "  (hors menu)"}`);
    if (DELAY) await page.waitForTimeout(DELAY);
  }
  result.queueLeft = queue.length + treeQueue.length;
  await ctx.close();
  return result;
}

async function main() {
  const creds = loadCredentials();
  let accounts = creds.accounts;
  if (args.tenant) accounts = accounts.filter((a) => a.tenant === args.tenant);
  if (args.role) accounts = accounts.filter((a) => a.role === args.role);
  if (args.operator || (!args.tenant && !args.role)) {
    const op = loadOperator();
    if (op) accounts = [...accounts, op];
  }
  console.log(`Balayage : ${accounts.length} compte(s), ${TREE.length} routes dans l'arborescence, plafond par compte : ${MAX_PAGES_ARG ?? "260 (proprietaire/operateur), 45 (autres)"}`);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: !args.headed });
  const prefix = args["menu-only"] ? "menu" : args.only ? "recheck" : "acct";
  try {
    for (const account of accounts) {
      const file = join(outDir, `${prefix}-${account.tenant}-${account.role}.json`);
      if (args.resume && existsSync(file) && JSON.parse(readFileSync(file, "utf8")).done) {
        console.log(`
=== ${account.tenant} / ${account.role} : deja balaye (--resume)`);
        continue;
      }
      console.log(`
=== ${account.tenant} / ${account.role} (${account.email})`);
      const t0 = Date.now();
      const save = (res, done = false) => writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), done, result: { ...res, ms: Date.now() - t0 } }, null, 1));
      let r;
      try {
        r = await sweepAccount(browser, account, (res) => save(res));
      } catch (e) {
        r = { account: { tenant: account.tenant, role: account.role, email: account.email, pack: account.pack }, loginError: `Exception du balayage : ${String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 200)}`, pages: [] };
      }
      r.ms = Date.now() - t0;
      save(r, true);
      if (r.loginError) console.log(`  ECHEC DE CONNEXION : ${r.loginError}`);
      else console.log(`  ${r.pages.length} pages en ${Math.round(r.ms / 1000)} s`);
    }
  } finally {
    await browser.close();
  }
  console.log(`\nResultats bruts : ${outDir}`);
}

if (process.argv[1]?.endsWith("demo-sweep.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

