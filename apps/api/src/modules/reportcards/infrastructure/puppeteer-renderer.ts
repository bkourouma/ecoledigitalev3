/**
 * Rendu PDF par Puppeteer / Chromium, DANS LE WORKER (spec 013 plan T-RENDER, risque R1).
 *
 * Isolation du rendu (le HTML provient du moteur de gabarit, mais on ne lui fait PAS confiance) :
 *  - JavaScript DÉSACTIVÉ (`page.setJavaScriptEnabled(false)`) ;
 *  - réseau COUPÉ : `page.setOfflineMode(true)`, interception de TOUTE requête (seules `data:` et `about:blank` passent) ;
 *    au niveau du processus, `--host-resolver-rules` fait échouer toute résolution DNS, `--proxy-server` pointe dans le vide ;
 *  - `Content-Security-Policy` du document : `default-src 'none'; img-src data:` (voir `domain/document-html.ts`) ;
 *  - une page neuve par rendu (contexte éphémère), fermée en `finally` ; navigateur recyclé après N rendus ou s'il se déconnecte ;
 *  - concurrence BORNÉE (sémaphore) : la mémoire d'un worker est limitée, la file BullMQ absorbe le reste ;
 *  - métadonnées normalisées après coup (`pdf-lib`) : titre, producteur, dates = date d'émission du document.
 *
 * `puppeteer` est chargé à la demande (import dynamique par nom variable) : le bundle du worker ne l'embarque pas ; l'image du
 * worker doit l'installer avec Chromium (voir `apps/worker/README.md` et le README du module).
 *
 * Variables : `REPORTCARDS_CHROME_PATH` (binaire Chromium/Chrome), `REPORTCARDS_CHROME_NO_SANDBOX=1` (conteneur sans
 * privilèges ; le conteneur du worker n'a de toute façon aucune route sortante), `REPORTCARDS_RENDER_CONCURRENCY` (défaut 2).
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PdfRenderInput, PdfRenderResult, PdfRenderer } from "../application/ports";
import { stampPdfMetadata } from "./pdf-merger";

interface PageLike {
  setJavaScriptEnabled(enabled: boolean): Promise<void>;
  setOfflineMode(offline: boolean): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: "request", handler: (req: RequestLike) => void): void;
  setContent(html: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  pdf(options: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface RequestLike {
  url(): string;
  continue(): Promise<void> | void;
  abort(reason?: string): Promise<void> | void;
}
interface BrowserLike {
  newPage(): Promise<PageLike>;
  version(): Promise<string>;
  close(): Promise<void>;
  on(event: "disconnected", handler: () => void): void;
  isConnected(): boolean;
}

export interface PuppeteerRendererOptions {
  executablePath?: string;
  noSandbox?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  /** Recycle le navigateur après ce nombre de rendus (fuites mémoire). */
  recycleAfter?: number;
  /** Lanceur injectable (tests) ; défaut : `puppeteer.launch`. */
  launch?: (options: { executablePath?: string; args: string[] }) => Promise<BrowserLike>;
  /** Observateur des requêtes bloquées (tests d'injection). */
  onBlockedRequest?: (url: string) => void;
}

/** Cherche un Chromium/Chrome local (cache Puppeteer, variables d'environnement). */
export function findChromeExecutable(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const candidates = [env.REPORTCARDS_CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH, env.CHROME_PATH].filter((p): p is string => Boolean(p));
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

/** Chrome du cache Puppeteer (`~/.cache/puppeteer/chrome/<plateforme>-<version>/…`), ou `null`. */
export function findPuppeteerCachedChrome(): string | null {
  try {
    const base = join(homedir(), ".cache", "puppeteer", "chrome");
    if (!existsSync(base)) return null;
    for (const dir of readdirSync(base).sort().reverse()) {
      for (const rel of [join("chrome-win64", "chrome.exe"), join("chrome-win32", "chrome.exe"), join("chrome-linux64", "chrome"), join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"), join("chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")]) {
        const candidate = join(base, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    /* pas de cache */
  }
  return null;
}

const HARDENING_ARGS = [
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=Translate,MediaRouter,OptimizationHints",
  // Défense en profondeur : toute résolution de nom échoue ; aucun proxy joignable.
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--proxy-server=socks5://127.0.0.1:9",
  "--proxy-bypass-list=<-loopback>",
];

class Semaphore {
  private waiters: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

export class PuppeteerPdfRenderer implements PdfRenderer {
  private browser: BrowserLike | null = null;
  private launching: Promise<BrowserLike> | null = null;
  private rendersOnBrowser = 0;
  private readonly semaphore: Semaphore;
  readonly blockedRequests: string[] = [];

  constructor(private readonly options: PuppeteerRendererOptions = {}) {
    this.semaphore = new Semaphore(Math.max(1, options.concurrency ?? 2));
  }

  private async launch(): Promise<BrowserLike> {
    const args = [...HARDENING_ARGS, ...(this.options.noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : [])];
    const executablePath = this.options.executablePath ?? findChromeExecutable() ?? findPuppeteerCachedChrome() ?? undefined;
    if (this.options.launch) return this.options.launch({ ...(executablePath ? { executablePath } : {}), args });
    const moduleName = "puppeteer"; // variable : le bundle du worker n'embarque pas Puppeteer
    const puppeteer: any = await import(moduleName);
    const launcher = puppeteer.default ?? puppeteer;
    return launcher.launch({ headless: "new", ...(executablePath ? { executablePath } : {}), args, timeout: this.options.timeoutMs ?? 30_000 }) as Promise<BrowserLike>;
  }

  private async ensureBrowser(): Promise<BrowserLike> {
    if (this.browser && this.browser.isConnected() && this.rendersOnBrowser < (this.options.recycleAfter ?? 200)) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      if (this.browser) await this.browser.close().catch(() => undefined);
      const browser = await this.launch();
      browser.on("disconnected", () => {
        if (this.browser === browser) this.browser = null;
      });
      this.browser = browser;
      this.rendersOnBrowser = 0;
      return browser;
    })().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    const release = await this.semaphore.acquire();
    let page: PageLike | null = null;
    try {
      const browser = await this.ensureBrowser();
      this.rendersOnBrowser += 1;
      page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setOfflineMode(true);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith("data:") || url === "about:blank") void req.continue();
        else {
          this.blockedRequests.push(url);
          this.options.onBlockedRequest?.(url);
          void req.abort("blockedbyclient");
        }
      });
      await page.setContent(input.html, { waitUntil: "load", timeout: this.options.timeoutMs ?? 30_000 });
      const raw = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, margin: { top: 0, right: 0, bottom: 0, left: 0 }, timeout: this.options.timeoutMs ?? 30_000 });
      const version = await browser.version();
      const stamped = await stampPdfMetadata(raw, { title: input.title, issuedAt: input.issuedAt });
      return { pdf: stamped.pdf, pages: stamped.pages, rendererVersion: version };
    } finally {
      await page?.close().catch(() => undefined);
      release();
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }
}

/** Moteur de rendu configuré depuis l'environnement du worker. */
export function puppeteerRendererFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PuppeteerPdfRenderer {
  const concurrency = Number(env.REPORTCARDS_RENDER_CONCURRENCY);
  const exe = findChromeExecutable(env) ?? undefined;
  return new PuppeteerPdfRenderer({
    ...(exe ? { executablePath: exe } : {}),
    noSandbox: env.REPORTCARDS_CHROME_NO_SANDBOX === "1" || env.REPORTCARDS_CHROME_NO_SANDBOX === "true",
    ...(Number.isInteger(concurrency) && concurrency > 0 ? { concurrency } : {}),
  });
}
