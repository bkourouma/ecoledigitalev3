/**
 * Interface de journalisation minimale, compatible pino
 * (`logger.info({ champs }, "message")`). Le kernel ne dépend d'aucune
 * bibliothèque : l'application injecte pino, les tests injectent `noopLogger`.
 */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const noop = (): void => undefined;

export const noopLogger: Logger = Object.freeze<Logger>({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

/** Logger JSON sur la console (développement, scripts, CLI). */
export const consoleLogger: Logger = Object.freeze<Logger>({
  debug: (obj, msg) => console.debug(JSON.stringify({ level: "debug", msg, ...obj })),
  info: (obj, msg) => console.info(JSON.stringify({ level: "info", msg, ...obj })),
  warn: (obj, msg) => console.warn(JSON.stringify({ level: "warn", msg, ...obj })),
  error: (obj, msg) => console.error(JSON.stringify({ level: "error", msg, ...obj })),
});
