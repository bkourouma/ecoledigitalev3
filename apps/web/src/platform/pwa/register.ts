/**
 * Enregistrement conditionnel du service worker (fonctions pures + effet isolé).
 *
 * `NEXT_PUBLIC_PWA` :
 *   "0" / "false" -> interrupteur d'arrêt : aucun enregistrement ET désinscription des service workers existants ;
 *   "1" / "true"  -> actif même hors production (tests e2e, essais en développement) ;
 *   absent        -> actif seulement en production.
 */

export type PwaMode = "enabled" | "disabled";

export function resolvePwaMode(flag: string | null | undefined, nodeEnv: string | null | undefined): PwaMode {
  const value = (flag ?? "").trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off") return "disabled";
  if (value === "1" || value === "true" || value === "on") return "enabled";
  return nodeEnv === "production" ? "enabled" : "disabled";
}

export const SERVICE_WORKER_URL = "/sw.js";

interface ServiceWorkerHost {
  serviceWorker?: {
    register(url: string, options?: { scope?: string }): Promise<unknown>;
    getRegistrations(): Promise<ReadonlyArray<{ unregister(): Promise<boolean> }>>;
  };
}

/** Enregistre le service worker si le mode le permet ; en mode « interrupteur d'arrêt », désinscrit. */
export async function syncServiceWorker(
  nav: ServiceWorkerHost,
  options: { flag: string | null | undefined; nodeEnv: string | null | undefined },
): Promise<"registered" | "unregistered" | "skipped" | "unsupported"> {
  if (!nav.serviceWorker) return "unsupported";
  const mode = resolvePwaMode(options.flag, options.nodeEnv);
  const killSwitch = ["0", "false", "off"].includes((options.flag ?? "").trim().toLowerCase());
  if (mode === "enabled") {
    await nav.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    return "registered";
  }
  if (killSwitch) {
    const registrations = await nav.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    return "unregistered";
  }
  return "skipped";
}
