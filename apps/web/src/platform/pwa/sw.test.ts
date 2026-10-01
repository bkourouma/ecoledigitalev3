import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Non-régression du service worker (public/sw.js) : il ne doit JAMAIS mettre en cache de réponse d'API
 * authentifiée ni de page privée. Le fichier est exécuté dans un contexte `vm` avec des doubles de
 * `caches`, `fetch` et `self`.
 */

const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8");
const ORIGIN = "https://app.ecoledigitale.test";

type Listener = (event: Record<string, unknown>) => void;

function makeHeaders(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

function okResponse(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    type: "basic",
    headers: makeHeaders(headers),
    clone() {
      return this;
    },
    text: async () => "",
    ...extra,
  };
}

function loadWorker(fetchImpl: (input: unknown, init?: unknown) => Promise<unknown>) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, unknown>>();
  const puts: Array<{ cache: string; url: string }> = [];

  const openCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    const keyOf = (req: unknown) => (typeof req === "string" ? req : (req as { url: string }).url).replace(ORIGIN, "");
    return {
      put: vi.fn(async (req: unknown, res: unknown) => {
        store.set(keyOf(req), res);
        puts.push({ cache: name, url: keyOf(req) });
      }),
      match: async (req: unknown) => store.get(keyOf(req)),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (req: unknown) => store.delete(typeof req === "string" ? req : (req as { url: string }).url),
    };
  };

  const caches = {
    open: vi.fn(async (name: string) => openCache(name)),
    match: vi.fn(async (req: unknown, opts?: { cacheName?: string; ignoreSearch?: boolean }) => {
      let key = (typeof req === "string" ? req : (req as { url: string }).url).replace(ORIGIN, "");
      if (opts?.ignoreSearch) key = key.split("?")[0];
      for (const [name, store] of stores) {
        if (opts?.cacheName && opts.cacheName !== name) continue;
        if (store.has(key)) return store.get(key);
      }
      return undefined;
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };

  class FakeResponse {
    constructor(
      public body: string,
      public init: { status?: number } = {},
    ) {}
    get status() {
      return this.init.status ?? 200;
    }
    static redirect(location: string, status = 302) {
      return { redirected: true, location, status };
    }
  }

  const module = { exports: {} as Record<string, unknown> };
  const sandbox = { self, caches, fetch: fetchImpl, URL, Response: FakeResponse, Promise, module, Array, Set };
  vm.runInNewContext(SW_SOURCE, sandbox);

  /** Simule un événement `fetch` ; renvoie la promesse passée à respondWith, ou null si le SW n'est pas intervenu. */
  function dispatchFetch(request: { url: string; method?: string; mode?: string; headers?: Record<string, string> }) {
    let responded: Promise<unknown> | null = null;
    listeners.get("fetch")!({
      request: { method: "GET", mode: "no-cors", ...request, headers: makeHeaders(request.headers) },
      respondWith: (p: Promise<unknown>) => {
        responded = Promise.resolve(p);
      },
    });
    return responded as Promise<unknown> | null;
  }

  return { listeners, caches, stores, puts, self, module, dispatchFetch, FakeResponse };
}

const HASHED_CHUNK = `${ORIGIN}/_next/static/chunks/app/page-3f9a1c2b7d8e4f60.js`;

describe("sw.js — ne met jamais en cache l'API ni les pages privées", () => {
  it.each([
    ["API authentifiée (en-tête Authorization)", { url: `${ORIGIN}/api/v1/students`, headers: { Authorization: "Bearer x" } }],
    ["API sans en-tête explicite", { url: `${ORIGIN}/api/v1/students` }],
    ["route NextAuth", { url: `${ORIGIN}/api/auth/session` }],
    ["requête non-GET", { url: `${ORIGIN}/api/v1/grades`, method: "POST" }],
    ["requête cross-origin", { url: "https://api.autre.example/v1/students" }],
    ["flux RSC", { url: `${ORIGIN}/owner/dashboard?_rsc=abc` }],
    ["RSC par en-tête", { url: `${ORIGIN}/owner/dashboard`, headers: { RSC: "1" } }],
    ["données Next", { url: `${ORIGIN}/_next/data/build/owner.json` }],
    ["GET avec Authorization sur un asset", { url: HASHED_CHUNK, headers: { Authorization: "Bearer x" } }],
  ])("n'intervient pas : %s", async (_label, request) => {
    const fetchSpy = vi.fn();
    const sw = loadWorker(fetchSpy);
    expect(sw.dispatchFetch(request)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sw.caches.open).not.toHaveBeenCalled();
    expect(sw.puts).toHaveLength(0);
  });

  it("navigation vers une page privée : réseau seul, rien n'est écrit dans le cache", async () => {
    const page = okResponse({}, { marker: "page-privee" });
    const fetchSpy = vi.fn(async () => page);
    const sw = loadWorker(fetchSpy);
    const result = await sw.dispatchFetch({ url: `${ORIGIN}/owner/dashboard`, mode: "navigate" });
    expect(result).toBe(page);
    expect(sw.puts).toHaveLength(0);
    expect(sw.caches.open).not.toHaveBeenCalled();
  });

  it("navigation hors ligne : redirige vers /offline pré-cachée (page demandée dans ?from=), sans servir la page privée", async () => {
    const offline = okResponse({}, { marker: "offline" });
    const fetchSpy = vi.fn(async (input: unknown) => {
      if (String(input).endsWith("/offline")) return offline;
      throw new TypeError("Failed to fetch");
    });
    const sw = loadWorker(fetchSpy);
    await (sw.listeners.get("install")!({ waitUntil: (p: Promise<unknown>) => p }) as unknown);
    // l'installation est asynchrone : on attend le pré-cache
    await vi.waitFor(() => expect(sw.puts.some((p) => p.url === "/offline")).toBe(true));
    const result = await sw.dispatchFetch({ url: `${ORIGIN}/owner/dashboard?vue=1`, mode: "navigate" });
    expect(result).toEqual({ redirected: true, status: 302, location: `${ORIGIN}/offline?from=%2Fowner%2Fdashboard%3Fvue%3D1` });
    expect(sw.puts.every((p) => !p.url.includes("/owner"))).toBe(true);

    // La navigation vers /offline elle-même (hors ligne) sert la page pré-cachée, sans boucle de redirection.
    const direct = await sw.dispatchFetch({ url: `${ORIGIN}/offline?from=%2Fowner`, mode: "navigate" });
    expect(direct).toBe(offline);
  });

  it("navigation hors ligne sans pré-cache : page de secours intégrée (503)", async () => {
    const sw = loadWorker(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = (await sw.dispatchFetch({ url: `${ORIGIN}/parent/children`, mode: "navigate" })) as { status: number; body: string };
    expect(result.status).toBe(503);
    expect(result.body).toContain("hors ligne");
  });
});

describe("sw.js — fichiers statiques versionnés", () => {
  it("cache-first : met en cache un fichier Next dont le nom est haché, puis le relit sans réseau", async () => {
    const asset = okResponse({ "cache-control": "public, max-age=31536000, immutable" });
    const fetchSpy = vi.fn(async () => asset);
    const sw = loadWorker(fetchSpy);

    await sw.dispatchFetch({ url: HASHED_CHUNK });
    expect(sw.puts).toEqual([{ cache: "ed-static-v1", url: "/_next/static/chunks/app/page-3f9a1c2b7d8e4f60.js" }]);

    await sw.dispatchFetch({ url: HASHED_CHUNK });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ne met pas en cache une réponse no-store / private / en erreur", async () => {
    for (const response of [okResponse({ "cache-control": "no-store" }), okResponse({ "cache-control": "private, max-age=0" }), okResponse({}, { status: 500 })]) {
      const sw = loadWorker(async () => response);
      await sw.dispatchFetch({ url: HASHED_CHUNK });
      expect(sw.puts).toHaveLength(0);
    }
  });

  it("ignore les fichiers non versionnés (développement) : pas d'intervention", () => {
    const sw = loadWorker(vi.fn());
    expect(sw.dispatchFetch({ url: `${ORIGIN}/_next/static/chunks/main-app.js` })).toBeNull();
    expect(sw.dispatchFetch({ url: `${ORIGIN}/_next/static/chunks/webpack.js` })).toBeNull();
  });
});

describe("sw.js — cycle de vie", () => {
  it("l'activation supprime les anciens caches ed-* mais pas ceux des autres applications", async () => {
    const sw = loadWorker(vi.fn());
    sw.stores.set("ed-shell-v0", new Map());
    sw.stores.set("ed-static-v0", new Map());
    sw.stores.set("autre-app-cache", new Map());
    sw.stores.set("ed-shell-v1", new Map());
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.get("activate")!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...sw.stores.keys()].sort()).toEqual(["autre-app-cache", "ed-shell-v1"]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("CLEAR_CACHES purge les caches ed-* (déconnexion)", async () => {
    const sw = loadWorker(vi.fn());
    sw.stores.set("ed-static-v1", new Map());
    sw.stores.set("autre", new Map());
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.get("message")!({ data: { type: "CLEAR_CACHES" }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...sw.stores.keys()]).toEqual(["autre"]);
  });

  it("l'installation réussit même si le pré-cache échoue", async () => {
    const sw = loadWorker(async () => {
      throw new TypeError("offline");
    });
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.get("install")!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await expect(done).resolves.toBeUndefined();
  });
});

describe("sw.js — prédicats exportés", () => {
  const { module } = loadWorker(vi.fn());
  const api = module.exports as {
    isVersionedStaticAsset(url: URL): boolean;
    PRECACHE_URLS: string[];
  };

  it("reconnaît les noms hachés de production, pas ceux de développement", () => {
    const u = (p: string) => new URL(p, ORIGIN);
    expect(api.isVersionedStaticAsset(u("/_next/static/css/1f2e3d4c5b6a7988.css"))).toBe(true);
    expect(api.isVersionedStaticAsset(u("/_next/static/media/5a7b2c9d1e-s.p.woff2"))).toBe(true);
    expect(api.isVersionedStaticAsset(u("/_next/static/chunks/main-app.js"))).toBe(false);
    expect(api.isVersionedStaticAsset(u("/api/v1/x-0123456789abcdef.js"))).toBe(false);
  });

  it("le pré-cache ne contient aucune route d'API ni page privée", () => {
    expect(api.PRECACHE_URLS.every((u) => !u.startsWith("/api/"))).toBe(true);
    expect(api.PRECACHE_URLS).toContain("/offline");
  });
});
