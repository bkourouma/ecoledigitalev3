/**
 * Point d'entrée du worker.
 *   dev  : pnpm --filter @ecoledigitale/worker dev        (tsx watch)
 *   prod : pnpm --filter @ecoledigitale/worker build && node apps/worker/dist/index.cjs
 *
 * SIGTERM / SIGINT : arrêt gracieux (fin des jobs en cours, fermeture des pools).
 * Un second signal, ou l'échéance WORKER_SHUTDOWN_TIMEOUT_MS (+ marge), force la sortie.
 */
import { WorkerApp } from "./app";
import { ConfigError, loadConfig } from "./config";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Le logger dépend de la config : sortie brute, sans valeur de variable.
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(78); // EX_CONFIG
  }

  const app = new WorkerApp(config);
  let signalled = false;

  const shutdown = (signal: string): void => {
    if (signalled) {
      app.logger.warn({ signal }, "second signal : sortie immédiate");
      process.exit(1);
    }
    signalled = true;
    const guard = setTimeout(() => {
      app.logger.error({}, "arrêt gracieux trop long : sortie forcée");
      process.exit(1);
    }, config.WORKER_SHUTDOWN_TIMEOUT_MS + 10_000);
    guard.unref();
    app.stop(signal).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    app.logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "promesse rejetée non gérée");
  });
  process.on("uncaughtException", (err) => {
    app.logger.fatal({ err: err.message }, "exception non interceptée : arrêt");
    shutdown("uncaughtException");
  });

  try {
    await app.start();
  } catch {
    process.exit(1); // start() a déjà journalisé et nettoyé
  }
}

void main();
