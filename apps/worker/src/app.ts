/**
 * Assemblage du worker : PostgreSQL (rôle app_user), Redis, relais d'outbox, consommateurs
 * d'événements, jobs planifiés, serveur de santé. `start()` échoue vite et nettoie ;
 * `stop()` est un arrêt gracieux idempotent.
 */
import { resolve } from "node:path";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { Queue } from "bullmq";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import type { WorkerConfig } from "./config";
import { redactUrl } from "./config";
import { bundledModules } from "./discovery/bundled";
import { defaultModuleDirs, discoverModuleExtensions, type BundledModule } from "./discovery/discover";
import { loadPlatformWiring, type PlatformWiring } from "./discovery/platform-wiring";
import { EventConsumers } from "./events/consumers";
import { PgNotificationListener } from "./events/notifications";
import {
  BullDeadLetter,
  BullEventPublisher,
  createDeadLetterQueue,
  createDomainEventsQueue,
} from "./events/publisher";
import { OutboxRelay } from "./events/relay";
import { SubscriberRegistry } from "./events/registry";
import { HealthServer } from "./infra/health";
import { assertRequiredTables, assertSafeRole, createPool, pingPg } from "./infra/db";
import { createRedis, pingRedis } from "./infra/redis";
import { builtinJobs } from "./jobs";
import { createLogger, systemDbLogger, type Logger } from "./logger";
import { ScheduledJobsRuntime } from "./scheduler/runtime";
import type { ScheduledJobDefinition, SubscriberDefinition } from "./sdk";

export interface WorkerAppOptions {
  logger?: Logger;
  /** Abonnés ajoutés par le code (tests, abonnés du socle) en plus de ceux des modules. */
  subscribers?: SubscriberDefinition[];
  jobs?: ScheduledJobDefinition[];
  /** Remplace les dossiers de modules (sinon `WORKER_MODULES_DIRS` puis les défauts). */
  moduleDirs?: string[];
  /** Remplace la découverte du disque (le bundle de production fournit les modules embarqués). */
  bundled?: BundledModule[] | undefined;
  /** N'enregistre pas les jobs du socle (tests ciblés). */
  skipBuiltinJobs?: boolean;
  /**
   * Câblage des PORTS entre modules (adaptateurs de la plateforme). Défaut : chargé depuis l'API (sources en développement,
   * bundle en production) SAUF quand les dossiers de modules sont remplacés (`moduleDirs`) — les tests du socle n'embarquent
   * alors aucun module. `null` : aucun câblage.
   */
  platformWiring?: PlatformWiring | null;
}

export class WorkerApp {
  readonly logger: Logger;
  readonly registry = new SubscriberRegistry();

  pool!: Pool;
  tenantDb!: TenantDb;
  systemDb!: SystemDb;
  relay: OutboxRelay | null = null;
  consumers: EventConsumers | null = null;
  scheduler: ScheduledJobsRuntime | null = null;
  health: HealthServer | null = null;

  private blocking: Redis | null = null;
  private failfast: Redis | null = null;
  private eventsQueue: Queue | null = null;
  private deadQueue: Queue | null = null;
  private ready = false;
  private stopped = false;
  private stopPromise: Promise<void> | null = null;

  constructor(
    readonly config: WorkerConfig,
    private readonly options: WorkerAppOptions = {},
  ) {
    this.logger = options.logger ?? createLogger(config.LOG_LEVEL);
  }

  get isReady(): boolean {
    return this.ready && !this.stopped;
  }

  get failfastRedis(): Redis {
    if (!this.failfast) throw new Error("worker non démarré");
    return this.failfast;
  }

  async start(): Promise<void> {
    const { config, logger } = this;
    try {
      this.health = new HealthServer({
        host: config.WORKER_HTTP_HOST,
        port: config.WORKER_HTTP_PORT,
        logger,
        isReady: () => this.isReady,
        probes: [
          { name: "redis", check: () => pingRedis(this.failfast as Redis) },
          { name: "postgres", check: () => pingPg(this.pool) },
        ],
        info: () => ({
          ready: this.isReady,
          subscribers: this.registry.size,
          relay: this.relay ? { ...this.relay.stats, listening: this.relay.listening } : null,
        }),
      });
      await this.health.start();

      // 1. PostgreSQL : rôle sûr, tables présentes.
      this.pool = createPool({ url: config.WORKER_DATABASE_URL, max: config.WORKER_PG_POOL_MAX });
      const { role } = await assertSafeRole(this.pool);
      await assertRequiredTables(this.pool);
      this.tenantDb = new TenantDb(this.pool, { statementTimeoutMs: config.WORKER_PG_STATEMENT_TIMEOUT_MS });
      this.systemDb = new SystemDb(this.tenantDb, { logger: systemDbLogger(logger) });
      logger.info({ role, db: redactUrl(config.WORKER_DATABASE_URL) }, "PostgreSQL : rôle applicatif vérifié (ni superuser, ni BYPASSRLS)");

      // 1b. Ports entre modules : sans eux les abonnés (recalcul des résultats, capitalisation, confirmation d'inscription…)
      //     échouent fermé. Branchés AVANT de démarrer les consommateurs et le planificateur.
      const wiring =
        this.options.platformWiring !== undefined
          ? this.options.platformWiring
          : this.options.moduleDirs !== undefined
            ? null
            : await loadPlatformWiring(resolve(__dirname, ".."));
      if (wiring) {
        await wiring({ tenantDb: this.tenantDb, systemDb: this.systemDb, logger, env: process.env });
        logger.info({}, "ports entre modules branchés (adaptateurs de plateforme)");
      } else {
        logger.warn({}, "aucun adaptateur de ports entre modules chargé : les abonnés qui en dépendent échoueront fermé");
      }

      // 2. Redis.
      this.blocking = createRedis(config.REDIS_URL, "blocking", logger);
      this.failfast = createRedis(config.REDIS_URL, "failfast", logger);
      await pingRedis(this.blocking);
      await pingRedis(this.failfast);

      // 3. Découverte des extensions des modules + registre.
      const jobs: ScheduledJobDefinition[] = [];
      const moduleDirs =
        this.options.moduleDirs ??
        (config.WORKER_MODULES_DIRS
          ? config.WORKER_MODULES_DIRS.split(",").map((d) => resolve(d.trim()))
          : defaultModuleDirs(resolve(__dirname, "..")));
      const bundled = "bundled" in this.options ? this.options.bundled : bundledModules;
      const found = await discoverModuleExtensions({ dirs: moduleDirs, bundled });
      for (const s of found.subscribers) this.registry.add(s.definition, `module ${s.module}`);
      for (const s of this.options.subscribers ?? []) this.registry.add(s, "options");
      if (!this.options.skipBuiltinJobs) jobs.push(...builtinJobs(config));
      jobs.push(...found.jobs.map((j) => j.definition), ...(this.options.jobs ?? []));
      logger.info(
        { modules: found.modules, subscribers: this.registry.all().map((s) => s.name), jobs: jobs.map((j) => j.name), source: bundled ? "bundle" : "disque" },
        "extensions des modules chargées",
      );

      const dlq = new BullDeadLetter((this.deadQueue = createDeadLetterQueue(this.failfast, config.WORKER_QUEUE_PREFIX)));
      this.eventsQueue = createDomainEventsQueue(this.failfast, config.WORKER_QUEUE_PREFIX);

      // 4. Consommateurs d'abord (ils drainent), puis planificateur, puis relais (qui alimente).
      if (config.WORKER_SUBSCRIBERS_ENABLED) {
        this.consumers = new EventConsumers({
          prefix: config.WORKER_QUEUE_PREFIX,
          blocking: this.blocking,
          failfast: this.failfast,
          tenantDb: this.tenantDb,
          systemDb: this.systemDb,
          registry: this.registry,
          dead: dlq,
          logger,
          routerConcurrency: config.WORKER_ROUTER_CONCURRENCY,
          routerBackoff: { baseMs: config.WORKER_RELAY_BACKOFF_BASE_MS, maxMs: config.WORKER_RELAY_BACKOFF_MAX_MS },
          shutdownTimeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS,
        });
        await this.consumers.start();
      }

      if (config.WORKER_SCHEDULER_ENABLED) {
        this.scheduler = new ScheduledJobsRuntime({
          prefix: config.WORKER_QUEUE_PREFIX,
          blocking: this.blocking,
          failfast: this.failfast,
          systemDb: this.systemDb,
          tenantDb: this.tenantDb,
          jobs,
          logger,
          tz: config.WORKER_TZ,
          prune: config.WORKER_PRUNE_SCHEDULERS,
          shutdownTimeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS,
        });
        await this.scheduler.start();
      }

      if (config.WORKER_RELAY_ENABLED) {
        this.relay = new OutboxRelay({
          systemDb: this.systemDb,
          publisher: new BullEventPublisher(this.eventsQueue),
          dead: dlq,
          notifications: new PgNotificationListener(config.WORKER_DATABASE_URL, logger),
          logger,
          config: {
            batchSize: config.WORKER_RELAY_BATCH_SIZE,
            sweepIntervalMs: config.WORKER_RELAY_SWEEP_INTERVAL_MS,
            pollIntervalMs: config.WORKER_RELAY_POLL_INTERVAL_MS,
            maxAttempts: config.WORKER_RELAY_MAX_ATTEMPTS,
            backoff: { baseMs: config.WORKER_RELAY_BACKOFF_BASE_MS, maxMs: config.WORKER_RELAY_BACKOFF_MAX_MS },
          },
        });
        await this.relay.start();
      }

      this.ready = true;
      logger.info({ relay: !!this.relay, subscribers: this.registry.size, scheduler: !!this.scheduler }, "worker prêt");
    } catch (err) {
      logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "démarrage du worker impossible");
      await this.stop("startup-failure").catch(() => undefined);
      throw err;
    }
  }

  /** Arrêt gracieux (idempotent) : relais -> consommateurs -> planificateur -> files -> connexions. */
  stop(reason = "shutdown"): Promise<void> {
    this.stopPromise ??= this.doStop(reason);
    return this.stopPromise;
  }

  private async doStop(reason: string): Promise<void> {
    const { logger } = this;
    this.stopped = true; // /ready passe en 503 : l'orchestrateur cesse de router vers nous
    logger.info({ reason }, "arrêt gracieux du worker");
    const step = async (name: string, fn: () => Promise<unknown> | undefined): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        logger.warn({ step: name, err: err instanceof Error ? err.message : String(err) }, "erreur pendant l'arrêt");
      }
    };
    await step("relay", () => this.relay?.stop());
    await step("consumers", () => this.consumers?.stop());
    await step("scheduler", () => this.scheduler?.stop());
    await step("events-queue", () => this.eventsQueue?.close());
    await step("dead-queue", () => this.deadQueue?.close());
    await step("redis-failfast", async () => {
      if (this.failfast && this.failfast.status !== "end") await this.failfast.quit().catch(() => this.failfast?.disconnect());
    });
    await step("redis-blocking", async () => {
      if (this.blocking && this.blocking.status !== "end") await this.blocking.quit().catch(() => this.blocking?.disconnect());
    });
    await step("postgres", () => (this.pool ? this.pool.end() : undefined));
    await step("health", () => this.health?.stop());
    logger.info({}, "worker arrêté");
  }
}
