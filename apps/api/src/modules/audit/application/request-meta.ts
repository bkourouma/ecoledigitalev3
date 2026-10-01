/**
 * Métadonnées de requête HTTP (ip, user-agent) propagées par AsyncLocalStorage.
 *
 * Le `RequestContext` du kernel ne porte pas l'IP ni le User-Agent (ce n'est pas de
 * l'identité). `audit.record` les lit ici « si présents » : le hook Fastify
 * (`http/request-meta-plugin.ts`) ouvre la portée au début de chaque requête.
 * Hors requête HTTP (job, worker) la portée est vide : les champs restent NULL.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { describeDevice } from "../domain/device";
import type { AuditRequestMeta } from "../domain/types";

const storage = new AsyncLocalStorage<AuditRequestMeta>();

export function runWithAuditRequestMeta<T>(meta: AuditRequestMeta, fn: () => T): T {
  const userAgent = meta.userAgent ? meta.userAgent.slice(0, 512) : null;
  return storage.run(
    Object.freeze({
      ip: meta.ip ? meta.ip.slice(0, 64) : null,
      userAgent,
      device: meta.device ?? describeDevice(userAgent),
      requestId: meta.requestId ?? null,
    }),
    fn,
  );
}

export function getAuditRequestMeta(): AuditRequestMeta | undefined {
  return storage.getStore();
}
