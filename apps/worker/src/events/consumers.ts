/**
 * Consommation des événements.
 *
 *   domain-events  --(routeur)-->  domain-events-sub-<abonné>  --(handler)-->  module
 *
 * - Le routeur lit la file `domain-events` et dépose, pour chaque abonné dont le motif
 *   correspond, un job dans SA file (jobId = id d'événement : dédoublonnage). Chaque abonné
 *   a ainsi ses propres tentatives, sa propre concurrence et ses propres échecs : un
 *   abonné défaillant ne bloque ni ne rejoue les autres.
 * - Le handler reçoit l'événement et un `TenantDb` lié au tenant DE L'ÉVÉNEMENT (contexte
 *   système, jamais celui d'un autre tenant).
 * - Livraison AU MOINS UNE FOIS : les handlers doivent être idempotents (`idempotent()`).
 * - Après la dernière tentative, l'événement part en DLQ `domain-events-dead`.
 * - Ordre : non garanti entre événements (concurrence, reprises).
 */
import { Queue, UnrecoverableError, Worker, type Job, type WorkerOptions } from "bullmq";
import type { Redis } from "ioredis";
import type { DomainEvent } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import type { Logger } from "../logger";
import { scopeDb } from "../scoped-db";
import type { ScopedTenantDb } from "../sdk";
import { computeBackoff } from "./backoff";
import {
  COMPLETED_RETENTION,
  DOMAIN_EVENTS_QUEUE,
  FAILED_RETENTION,
  type DeadLetter,
} from "./publisher";
import type { ResolvedSubscriber, SubscriberRegistry } from "./registry";

export interface ConsumersDeps {
  prefix: string;
  /** Connexion bloquante (`maxRetriesPerRequest: null`) pour les Workers. */
  blocking: Redis;
  /** Connexion « fail fast » pour les Queues. */
  failfast: Redis;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  registry: SubscriberRegistry;
  dead: DeadLetter;
  logger: Logger;
  routerConcurrency: number;
  routerBackoff: { baseMs: number; maxMs: number };
  shutdownTimeoutMs: number;
}

/** Reprise des jobs d'un process tué : <= lockDuration + stalledInterval (~20 s). */
export const LOCK_DURATION_MS = 15_000;
export const STALLED_INTERVAL_MS = 5_000;
export const MAX_STALLED_COUNT = 5;

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 2000);

function readEvent(job: Job): DomainEvent {
  const event = (job.data as { event?: DomainEvent } | undefined)?.event;
  if (
    !event ||
    typeof event.id !== "string" ||
    typeof event.type !== "string" ||
    typeof event.tenantId !== "string"
  ) {
    throw new UnrecoverableError(`Job ${job.id} : enveloppe d'événement invalide.`);
  }
  return event;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} : délai de ${ms} ms dépassé`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class EventConsumers {
  private readonly workers: Worker[] = [];
  private readonly queues = new Map<string, Queue>();
  private started = false;

  constructor(private readonly deps: ConsumersDeps) {}

  private queueFor(sub: ResolvedSubscriber): Queue {
    let q = this.queues.get(sub.queueName);
    if (!q) {
      q = new Queue(sub.queueName, { connection: this.deps.failfast, prefix: this.deps.prefix });
      this.queues.set(sub.queueName, q);
    }
    return q;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { registry, logger } = this.deps;

    for (const sub of registry.all()) {
      await this.queueFor(sub).waitUntilReady();
      this.workers.push(this.createSubscriberWorker(sub));
    }
    this.workers.push(this.createRouterWorker());
    await Promise.all(this.workers.map((w) => w.waitUntilReady()));
    logger.info(
      { subscribers: registry.all().map((s) => s.name), routerConcurrency: this.deps.routerConcurrency },
      "consommateurs d'événements démarrés",
    );
  }

  private workerOptions(concurrency: number, backoff: { baseMs: number; maxMs: number }): WorkerOptions {
    return {
      connection: this.deps.blocking,
      prefix: this.deps.prefix,
      concurrency,
      // Reprise après crash : un job « actif » d'un process tué est repris quand son verrou expire
      // (lockDuration) et que le contrôle de jobs bloqués passe (stalledInterval). Le verrou est
      // renouvelé automatiquement tant que le process vit. maxStalledCount > 1 : un process qui
      // tombe plusieurs fois de suite ne doit pas faire échouer définitivement ses jobs.
      lockDuration: LOCK_DURATION_MS,
      stalledInterval: STALLED_INTERVAL_MS,
      maxStalledCount: MAX_STALLED_COUNT,
      settings: {
        backoffStrategy: (attemptsMade: number) => computeBackoff(attemptsMade, { baseMs: backoff.baseMs, maxMs: backoff.maxMs }),
      },
    };
  }

  private attachLogging(worker: Worker, label: string): void {
    const { logger } = this.deps;
    worker.on("error", (err) => logger.error({ worker: label, err: err.message }, "erreur du worker BullMQ"));
    worker.on("failed", (job, err) =>
      logger.warn(
        { worker: label, jobId: job?.id, attemptsMade: job?.attemptsMade, maxAttempts: job?.opts.attempts, err: err.message },
        "job en échec",
      ),
    );
  }

  // --- Routeur -----------------------------------------------------------

  private createRouterWorker(): Worker {
    const { registry, logger, dead } = this.deps;
    const worker = new Worker(
      DOMAIN_EVENTS_QUEUE,
      async (job) => {
        const event = readEvent(job);
        const log = logger.child({ jobId: job.id, tenantId: event.tenantId, eventId: event.id, eventType: event.type });
        try {
          const targets = registry.match(event.type);
          for (const sub of targets) {
            await this.queueFor(sub).add(
              event.type,
              { event },
              {
                jobId: event.id,
                attempts: sub.attempts,
                backoff: { type: "custom" },
                removeOnComplete: COMPLETED_RETENTION,
                removeOnFail: FAILED_RETENTION,
              },
            );
          }
          log.debug({ subscribers: targets.map((s) => s.name) }, "événement routé");
        } catch (err) {
          const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          if (final) {
            await dead.push({
              kind: "router",
              event,
              error: errText(err),
              attempts: job.attemptsMade + 1,
              failedAt: new Date().toISOString(),
            });
          }
          throw err;
        }
      },
      {
        ...this.workerOptions(this.deps.routerConcurrency, this.deps.routerBackoff),
      },
    );
    this.attachLogging(worker, DOMAIN_EVENTS_QUEUE);
    return worker;
  }

  // --- Abonnés -----------------------------------------------------------

  private createSubscriberWorker(sub: ResolvedSubscriber): Worker {
    const { tenantDb, systemDb, logger, dead } = this.deps;
    const worker = new Worker(
      sub.queueName,
      async (job) => {
        const event = readEvent(job);
        const attempt = job.attemptsMade + 1;
        const log = logger.child({
          jobId: job.id,
          tenantId: event.tenantId,
          eventId: event.id,
          eventType: event.type,
          subscriber: sub.name,
          attempt,
          ...(event.requestId ? { requestId: event.requestId } : {}),
        });
        const startedAt = Date.now();
        try {
          let db: ScopedTenantDb;
          try {
            db = scopeDb(tenantDb, event.tenantId, event.requestId ?? event.id);
          } catch (e) {
            throw new UnrecoverableError(`Événement ${event.id} : tenantId invalide (${errText(e)})`);
          }
          await withTimeout(
            Promise.resolve(
              sub.handler(event, { tenantId: event.tenantId, db, systemDb, logger: log, subscriber: sub.name, attempt, jobId: String(job.id) }),
            ),
            sub.timeoutMs,
            `abonné ${sub.name}`,
          );
          log.info({ durationMs: Date.now() - startedAt }, "événement traité");
        } catch (err) {
          const final = err instanceof UnrecoverableError || attempt >= (job.opts.attempts ?? 1);
          log.warn({ err: errText(err), final, durationMs: Date.now() - startedAt }, "handler en échec");
          if (final) {
            // Dépôt AVANT le passage du job en « failed » : un crash ici entraîne un nouvel essai,
            // et le jobId déterministe de la DLQ évite le doublon.
            await dead.push({
              kind: "handler",
              event,
              subscriber: sub.name,
              error: errText(err),
              attempts: attempt,
              failedAt: new Date().toISOString(),
            });
            log.error({}, "événement en échec définitif pour cet abonné (dead-letter)");
          }
          throw err;
        }
      },
      this.workerOptions(sub.concurrency, { baseMs: sub.backoffMs, maxMs: sub.maxBackoffMs }),
    );
    this.attachLogging(worker, sub.name);
    return worker;
  }

  /** Arrêt gracieux : les jobs en cours se terminent (dans la limite du délai), puis fermeture. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const { shutdownTimeoutMs, logger } = this.deps;
    const closing = Promise.all(this.workers.map((w) => w.close()));
    let timedOut = false;
    await Promise.race([
      closing,
      new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, shutdownTimeoutMs).unref(),
      ),
    ]);
    if (timedOut) {
      logger.warn({ timeoutMs: shutdownTimeoutMs }, "jobs encore en cours à l'échéance : fermeture forcée (ils seront repris)");
      await Promise.all(this.workers.map((w) => w.close(true).catch(() => undefined)));
    }
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
    this.workers.length = 0;
    this.queues.clear();
  }
}
