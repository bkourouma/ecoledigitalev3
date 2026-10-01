import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import type { Logger } from "../logger";

/**
 * Câblage de la plateforme dans le worker : branche les PORTS entre modules (adaptateurs de
 * `apps/api/src/platform/adapters`) dans le processus du worker, pour que les abonnés et jobs des modules (recalcul des
 * résultats, capitalisation, confirmation d'inscription sur facture soldée, rendu des bulletins…) ne tombent pas en
 * `*.port_unavailable`.
 */
export interface PlatformWiringInput {
  readonly tenantDb: TenantDb;
  readonly systemDb: SystemDb;
  readonly logger: Logger;
  readonly env?: Readonly<Record<string, string | undefined>>;
}
export type PlatformWiring = (input: PlatformWiringInput) => unknown;

/**
 * `undefined` en développement (`tsx`) : le câblage est alors chargé depuis les sources de l'API.
 *
 * En production (`pnpm build`), `scripts/build.mjs` REMPLACE ce fichier par une version générée qui importe statiquement
 * `apps/api/src/platform/adapters/worker.ts` : le bundle est autonome.
 */
export const bundledPlatformWiring: PlatformWiring | undefined = undefined;

const SOURCE_CANDIDATES = [["..", "..", "..", "api", "src", "platform", "adapters", "worker.ts"]];

/** Câblage embarqué, sinon celui des sources de l'API ; `null` si aucun n'est disponible (worker autonome, tests ciblés). */
export async function loadPlatformWiring(workerRoot: string): Promise<PlatformWiring | null> {
  if (bundledPlatformWiring) return bundledPlatformWiring;
  for (const parts of SOURCE_CANDIDATES) {
    const file = resolve(workerRoot, "src", "discovery", ...parts);
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown; installWorkerAdapters?: unknown };
    let fn: unknown = mod.installWorkerAdapters ?? mod.default;
    if (fn && typeof fn === "object" && "default" in fn) fn = (fn as { default?: unknown }).default;
    if (typeof fn === "function") return fn as PlatformWiring;
  }
  return null;
}
