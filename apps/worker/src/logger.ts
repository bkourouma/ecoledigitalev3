/**
 * Journalisation structurée du worker (pino, JSON sur stdout) : MÊME schéma que l'API (ADR-009).
 *
 * Chaque ligne porte `service: "worker"` et, via le `mixin` de corrélation, `request_id` (celui de la requête HTTP qui a émis
 * l'événement), `tenant_id`, `module`, `job_id`, `event_id`, `trace_id`, `span_id`. Les clés camelCase des loggers enfants
 * (`logger.child({ jobId, tenantId })`) sont normalisées en snake_case. La redaction (mots de passe, jetons, secrets, e-mails,
 * numéros, contenu de messages…) est appliquée à l'objet ET au message de chaque appel.
 */
import pino from "pino";
import { buildPinoOptions, normalizeChildBindings, type Logger as KernelLogger } from "@ecoledigitale/kernel";
import { correlationMixin } from "../../api/src/platform/observability/core/correlation";

export type Logger = pino.Logger;

export function createLogger(level: string = "info", destination?: pino.DestinationStream): Logger {
  const options = buildPinoOptions({ service: "worker", level, mixin: correlationMixin });
  return normalizeChildBindings(pino(options as unknown as pino.LoggerOptions, destination));
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
