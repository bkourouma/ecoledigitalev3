/** Réseau local : ports libres, attente de sondes HTTP. Tout reste sur 127.0.0.1. */
import { createServer } from "node:net";

export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

/** Premier port libre à partir de `preferred` (au plus 100 essais). */
export async function pickPort(preferred) {
  for (let p = preferred; p < preferred + 100; p += 1) if (await isPortFree(p)) return p;
  throw new Error(`Aucun port libre entre ${preferred} et ${preferred + 99}.`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'une URL réponde avec un statut 2xx (ou un statut accepté). */
export async function waitHttp(url, { timeoutMs = 120_000, ok = (s) => s >= 200 && s < 300, label = url, alive } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "aucune réponse";
  while (Date.now() < deadline) {
    if (alive && !alive()) throw new Error(`${label} : le processus s'est arrêté pendant le démarrage (voir les journaux).`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
      if (ok(res.status)) return res.status;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await sleep(500);
  }
  throw new Error(`${label} : pas prêt après ${Math.round(timeoutMs / 1000)} s (${last}).`);
}
