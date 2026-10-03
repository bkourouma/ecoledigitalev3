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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoDir, loadCredentials, loadPlaywright, tenantOrigin, totpAt, WEB_PORT, findUp } from "./lib.mjs";
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
const NAV_TIMEOUT = 90_000;
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

function normalizeLink(href, origin, from) {
  if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/.test(href)) return null;
  let u;
  try {
    u = new URL(href, origin + from);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (!u.pathname.startsWith("/v2")) return null;
  if (/logout|signout|sign-out|deconnexion/i.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, "") || "/v2";
}

// ---------------------------------------------------------------------------------------------------------------------------
// Balayage d'un compte
// ---------------------------------------------------------------------------------------------------------------------------
async function sweepAccount(browser, account) {
  const origin = account.tenant === "platform" ? `http://localhost:${WEB_PORT}` : tenantOrigin(account.tenant);
  const label = `${account.tenant}/${account.role}`;
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR" });
  const page = await ctx.newPage();
  const cur = { rec: null };
  page.on("console", (m) => {
    if (m.type() === "error" && cur.rec) cur.rec.consoleErrors.push({ text: m.text().slice(0, 500), at: m.location()?.url?.slice(0, 160) });
  });
  page.on("pageerror", (e) => cur.rec?.pageErrors.push(String(e?.message ?? e).slice(0, 500)));
  page.on("response", async (r) => {
    if (!cur.rec) return;
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/") && !r.url().includes(":4100")) return;
    if (r.status() < 400) return;
    let body = "";
    try {
      body = (await r.text()).slice(0, 300);
    } catch {
      /* corps indisponible */
    }
    cur.rec.apiFailures.push({ method: r.request().method(), path: u.pathname + (u.search ? u.search.slice(0, 80) : ""), status: r.status(), body });
  });
  page.on("requestfailed", (r) => {
    if (!cur.rec) return;
    const f = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) return;
    cur.rec.requestFailures.push({ url: r.url().slice(0, 200), error: f });
  });

  const result = { account: { tenant: account.tenant, role: account.role, email: account.email, pack: account.pack }, loginError: null, landing: null, pages: [], uncoveredNote: null };
  try {
    await uiLogin(page, origin, account);
  } catch (e) {
    result.loginError = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    await page.screenshot({ path: join(outDir, "shots", `${label.replace(/\W/g, "_")}-login.png`) }).catch(() => {});
    await ctx.close();
    return result;
  }
  result.landing = page.url().replace(origin, "");

  const queue = [];
  const seen = new Set();
  const perPattern = new Map();
  const menuLinks = new Set();
  const enqueue = (path, source, front = false) => {
    if (!path || seen.has(path)) return;
    const pattern = patternOf(path);
    if (pattern && /\[/.test(pattern)) {
      const n = perPattern.get(pattern) ?? 0;
      if (n >= 2) return;
      perPattern.set(pattern, n + 1);
    }
    seen.add(path);
    (front ? queue.unshift : queue.push).call(queue, { path, source });
  };

  const landingPath = result.landing.split("?")[0];
  enqueue(landingPath, "landing", true);
  // Les liens de menu de l'atterrissage sont lus apres sa visite (premiere iteration), puis ajoutes en tete de file.
  const treeSeed = !args["no-tree"] && (args["tree-all"] || account.role === "proprietaire" || account.role === "operateur");
  let menuHarvested = false;
  let visited = 0;
  const maxPages = maxPagesFor(account);
  while (queue.length && visited < maxPages) {
    const { path, source } = queue.shift();
    const rec = await visit(page, cur, origin, path, { source, role: account.role, tenant: account.tenant, isMenuLink: menuLinks.has(path), pattern: patternOf(path) });
    visited += 1;
    const links = new Set();
    for (const h of rec.hrefs ?? []) {
      const n = normalizeLink(h, origin, path);
      if (n) links.add(n);
    }
    if (!menuHarvested && rec.finalUrl) {
      menuHarvested = true;
      for (const h of rec.menuHrefs ?? []) {
        const n = normalizeLink(h, origin, path);
        if (n) menuLinks.add(n);
      }
      result.menuLinks = [...menuLinks].sort();
      for (const m of [...menuLinks].sort().reverse()) enqueue(m, "menu", true);
      rec.isMenuLink = menuLinks.has(path);
      if (treeSeed) for (const r of TREE) if (!/\[/.test(r) && !SKIP_SEED.test(r)) enqueue(r, "tree");
    }
    for (const n of [...links].sort()) enqueue(n, "crawl");
    // Les menus des pages suivantes completent le menu du role (les coquilles different par portail).
    for (const h of rec.menuHrefs ?? []) {
      const n = normalizeLink(h, origin, path);
      if (n && !menuLinks.has(n)) menuLinks.add(n);
    }
    rec.findings = analyzePage(rec, { menuLinks, account });
    if (rec.findings.some((f) => f.severity === "bloquant" || f.severity === "majeur")) {
      rec.screenshot = join("shots", `${label.replace(/\W/g, "_")}-${path.replace(/\W+/g, "_").slice(0, 80)}.png`);
      await page.screenshot({ path: join(outDir, rec.screenshot) }).catch(() => {});
    }
    delete rec.hrefs;
    delete rec.menuHrefs;
    rec.body = rec.body?.slice(0, 1500);
    rec.main = rec.main?.slice(0, 1500);
    result.pages.push(rec);
    const worst = rec.findings.find((f) => f.severity === "bloquant") ? "BLOQ" : rec.findings.find((f) => f.severity === "majeur") ? "MAJ " : rec.findings.length ? "min " : "ok  ";
    console.log(`  ${worst} ${String(rec.navStatus ?? "---").padEnd(3)} ${String(rec.ms).padStart(6)}ms ${path}${rec.finalUrl && rec.finalUrl.split("?")[0] !== path ? ` -> ${rec.finalUrl}` : ""}`);
    if (DELAY) await page.waitForTimeout(DELAY);
  }
  result.queueLeft = queue.length;
  result.menuLinks = [...menuLinks].sort();
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
  const all = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(outDir, `sweep-${args.tenant ?? "all"}-${args.role ?? "all"}-${stamp}.json`);
  try {
    for (const account of accounts) {
      console.log(`\n=== ${account.tenant} / ${account.role} (${account.email})`);
      const t0 = Date.now();
      const r = await sweepAccount(browser, account).catch((e) => ({ account: { tenant: account.tenant, role: account.role, email: account.email, pack: account.pack }, loginError: `Exception du balayage : ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`, pages: [] }));
      r.ms = Date.now() - t0;
      all.push(r);
      writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), tree: TREE, results: all }, null, 1));
      if (r.loginError) console.log(`  ECHEC DE CONNEXION : ${r.loginError}`);
      else console.log(`  ${r.pages.length} pages en ${Math.round(r.ms / 1000)} s`);
    }
  } finally {
    await browser.close();
  }
  console.log(`\nResultat brut : ${file}`);
}

if (process.argv[1]?.endsWith("demo-sweep.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

