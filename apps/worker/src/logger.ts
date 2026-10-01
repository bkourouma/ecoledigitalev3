/**
 * Journalisation structurée (pino, JSON sur stdout). Chaque ligne d'un job porte
 * `jobId`, `tenantId` (et `eventId`, `subscriber`, `requestId` selon le cas) via
 * `logger.child({...})`.
 */
import pino from "pino";
import type { Logger as KernelLogger } from "@ecoledigitale/kernel";

export type Logger = pino.Logger;

export function createLogger(level: string = "info", destination?: pino.DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: "worker" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: {
        paths: ["*.password", "*.connectionString", "*.url", "password", "connectionString", "url"],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
}

/**
 * `SystemDb` journalise début ET fin de chaque transaction au niveau info : avec
 * une transaction par tenant et par balayage, cela noierait les journaux.
 * Ces deux lignes passent en debug ; les échecs (warn) restent visibles.
 */
export function systemDbLogger(base: Logger): KernelLogger {
  return {
    debug: (obj, msg) => base.debug(obj, msg),
    info: (obj, msg) => (obj.event === "system_db" ? base.debug(obj, msg) : base.info(obj, msg)),
    warn: (obj, msg) => base.warn(obj, msg),
    error: (obj, msg) => base.error(obj, msg),
  };
}
