/*
 * Service worker EcoleDigitale — minimal et SÛR.
 *
 * Ce qu'il met en cache (et RIEN d'autre) :
 *   - l'« app shell » hors ligne : /offline, le manifeste et les icônes (pré-cache à l'installation) ;
 *   - les fichiers statiques VERSIONNÉS de Next (/_next/static/... dont le nom contient un hash de contenu),
 *     en cache-first : leur contenu ne change jamais pour une URL donnée.
 *
 * Ce qu'il ne met JAMAIS en cache :
 *   - toute requête /api/ (authentifiée ou non), toute requête avec en-tête Authorization,
 *     toute requête non-GET, tout appel cross-origin ;
 *   - les pages (navigations) : elles sont servies par le réseau ; hors ligne seulement, /offline s'affiche.
 *     Aucune page privée n'est donc jamais écrite dans le cache ;
 *   - les flux RSC / données Next (_rsc, /_next/data, /_next/image) et toute réponse `no-store`/`private`.
 *
 * Changer CACHE_VERSION invalide les anciens caches `ed-*` à l'activation.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = "ed-shell-" + CACHE_VERSION;
const STATIC_CACHE = "ed-static-" + CACHE_VERSION;
const MAX_STATIC_ENTRIES = 200;

const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Fichier statique Next dont le nom porte un hash de contenu (>= 8 caractères hexadécimaux).
const HASHED_STATIC_RE = /^\/_next\/static\/(?:chunks|css|media)\/(?:.*[-.\/])?[0-9a-f]{8,}[^\/]*\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif|ico)$/;

const FALLBACK_HTML =
  '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Hors ligne - EcoleDigitale</title></head>" +
  '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:1rem">' +
  "<main><h1>Vous &ecirc;tes hors ligne</h1><p>Reconnectez-vous puis r&eacute;essayez.</p></main></body></html>";

/** Vrai si la requête ne doit jamais être touchée par le service worker. */
function isNeverCache(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/_next/data/") || url.pathname.startsWith("/_next/image")) return true;
  if (url.searchParams.has("_rsc")) return true;
  const headers = request.headers;
  if (headers && typeof headers.get === "function") {
    if (headers.get("authorization")) return true;
    if (headers.get("rsc") || headers.get("next-router-state-tree") || headers.get("next-router-prefetch")) return true;
  }
  return false;
}

function isVersionedStaticAsset(url) {
  return HASHED_STATIC_RE.test(url.pathname);
}

function isCacheableResponse(response) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  return !/(no-store|private)/.test(cacheControl);
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  // Entrée par entrée : l'échec d'une ressource n'empêche pas l'installation.
  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { credentials: "omit", cache: "reload" });
        // Liste blanche publique : seul le statut compte (le serveur de développement renvoie no-store).
        if (response.status !== 200 || response.type !== "basic") return;
        await cache.put(url, response.clone());
        // La page hors ligne a besoin de ses fichiers versionnés pour s'afficher sans réseau.
        if (url === OFFLINE_URL) {
          const html = await response.text();
          const assets = Array.from(new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) || []));
          const staticCache = await caches.open(STATIC_CACHE);
          await Promise.all(
            assets
              .filter((asset) => isVersionedStaticAsset(new URL(asset, self.location.origin)))
              .map(async (asset) => {
                try {
                  const res = await fetch(asset, { credentials: "omit" });
                  if (isCacheableResponse(res)) await staticCache.put(asset, res);
                } catch (_) {
                  /* ignoré */
                }
              }),
          );
        }
      } catch (_) {
        /* ignoré : /offline retombera sur FALLBACK_HTML */
      }
    }),
  );
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_STATIC_ENTRIES);
  }
  return response;
}

/**
 * Navigation : réseau uniquement. Hors ligne, redirection vers /offline (pré-cachée) en gardant la page
 * demandée dans ?from= ; jamais une page privée servie depuis le cache. La redirection (plutôt que de servir
 * le HTML hors ligne à l'URL d'origine) évite que l'application hydratée sur une route privée attende une
 * session qu'elle ne peut pas charger sans réseau.
 */
async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch (_) {
    const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE, ignoreSearch: true });
    if (!cached) {
      return new Response(FALLBACK_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const url = new URL(request.url);
    if (url.pathname === OFFLINE_URL) return cached;
    const target = new URL(OFFLINE_URL, self.location.origin);
    target.searchParams.set("from", (url.pathname + url.search).slice(0, 512));
    return Response.redirect(target.href, 302);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, STATIC_CACHE];
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("ed-") && !keep.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isNeverCache(request, url)) return; // le navigateur gère : le SW n'intervient pas

  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(request));
    return;
  }
  if (isVersionedStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(caches.match(request, { cacheName: SHELL_CACHE }).then((hit) => hit || fetch(request)));
  }
  // Tout le reste : aucune interception.
});

// Déconnexion : l'application peut demander la purge de tous les caches `ed-*`.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith("ed-")).map((n) => caches.delete(n)))));
  }
});

// Export pour les tests unitaires (inexistant dans le navigateur).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { isNeverCache, isVersionedStaticAsset, isCacheableResponse, SHELL_CACHE, STATIC_CACHE, OFFLINE_URL, PRECACHE_URLS };
}
