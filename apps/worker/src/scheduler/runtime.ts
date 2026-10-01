/**
 * Jobs planifiés : planification BullMQ (Job Schedulers = jobs répétables) + verrou d'unicité.
 *
 * - `start()` enregistre chaque job dans Redis (`upsertJobScheduler`, idempotent : N instances
 *   qui démarrent ensemble produisent UNE seule planification) ;
 * - à chaque échéance BullMQ crée UN job, consommé par UNE instance ;
 * - un verrou Redis (`<prefix>:lock:job:<nom>`, TTL renouvelé) empêche deux exécutions du
 *   même job de se chevaucher (échéance suivante arrivant avant la fin, retard, redémarrage).
 */
import { Queue, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { SystemDb, TenantDb, TenantRef } from "@ecoledigitale/database";
import type { Logger } from "../logger";
import type { ScheduledJobDefinition } from "../sdk";
import { scopeDb } from "../scoped-db";
import { acquireLease } from "./lock";

export const SCHEDULED_QUEUE = "scheduled-jobs";
const DEFAULT_LOCK_TTL_MS = 5 * 60_000;

export interface SchedulerDeps {
  prefix: string;
  blocking: Redis;
  failfast: Redis;
  systemDb: SystemDb;
  tenantDb: TenantDb;
  jobs: readonly ScheduledJobDefinition[];
  logger: Logger;
  tz: string;
  prune: boolean;
  shutdownTimeoutMs: number;
}

export type RunOutcome =
  | { status: "completed"; tenants?: { ok: number; failed: number } }
  | { status: "skipped"; reason: "locked" | "unknown-job" };

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 2000);

export class ScheduledJobsRuntime {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly byName: Map<string, ScheduledJobDefinition>;

  constructor(private readonly deps: SchedulerDeps) {
    this.byName = new Map();
    for (const job of deps.jobs) {
      if (this.byName.has(job.name)) throw new Error(`Job planifié "${job.name}" déclaré deux fois.`);
      this.byName.set(job.name, job);
    }
  }

  get jobNames(): string[] {
    return [...this.byName.keys()];
  }

  async start(): Promise<void> {
    const { prefix, failfast, blocking, logger, tz } = this.deps;
    const queue = new Queue(SCHEDULED_QUEUE, { connection: failfast, prefix });
    this.queue = queue;
    await queue.waitUntilReady();

    for (const job of this.byName.values()) {
      await queue.upsertJobScheduler(
        job.name,
        { pattern: job.cron, tz },
        {
          name: job.name,
          data: {},
          opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
        },
      );
      logger.info({ job: job.name, cron: job.cron, tz, perTenant: job.perTenant === true }, "job planifié enregistré");
    }

    if (this.deps.prune) {
      const known = await queue.getJobSchedulers(0, -1, true);
      for (const s of known) {
        const id = s.key ?? s.name;
        if (id && !this.byName.has(id)) {
          await queue.removeJobScheduler(id);
          logger.warn({ job: id }, "planification orpheline retirée (le code du job n'existe plus)");
        }
      }
    }

    this.worker = new Worker(SCHEDULED_QUEUE, (job) => this.process(job), {
      connection: blocking,
      prefix,
      concurrency: Math.max(2, Math.min(8, this.byName.size || 1)),
    });
    this.worker.on("error", (err) => logger.error({ err: err.message }, "scheduler : erreur du worker BullMQ"));
    await this.worker.waitUntilReady();
  }

  private async process(job: Job): Promise<RunOutcome> {
    return this.run(job.name, String(job.id));
  }

  /** Exécute un job maintenant, sous verrou (échéance BullMQ, tests, déclenchement manuel). */
  async run(name: string, runId: string = `manual-${Date.now()}`): Promise<RunOutcome> {
    const { logger, failfast, prefix, systemDb, tenantDb } = this.deps;
    const def = this.byName.get(name);
    const log = logger.child({ job: name, jobId: runId });
    if (!def) {
      log.warn({}, "job planifié inconnu : ignoré");
      return { status: "skipped", reason: "unknown-job" };
    }

    const lease = await acquireLease(failfast, `${prefix}:lock:job:${name}`, def.lockTtlMs ?? DEFAULT_LOCK_TTL_MS, () =>
      log.error({}, "verrou d'unicité perdu pendant l'exécution (Redis lent ou injoignable)"),
    );
    if (!lease) {
      log.info({}, "déjà en cours d'exécution ailleurs : échéance ignorée");
      return { status: "skipped", reason: "locked" };
    }

    const startedAt = Date.now();
    log.info({}, "job planifié : début");
    try {
      if (def.perTenant === true) {
        const tenants = await systemDb.run(`job ${name} :: list-tenants`, (tx) =>
          tx.many<TenantRef>("SELECT id, slug FROM kernel.tenants WHERE status = 'active' ORDER BY created_at, id"),
          { readOnly: true },
        );
        let ok = 0;
        let failed = 0;
        for (const tenant of tenants) {
          const tlog = log.child({ tenantId: tenant.id, tenant: tenant.slug });
          try {
            const db = scopeDb(tenantDb, tenant.id, `job-${name}-${runId}`.slice(0, 200));
            await def.handler({ name, logger: tlog, systemDb, tenantDb, tenant, db });
            ok += 1;
          } catch (err) {
            failed += 1;
            tlog.error({ err: errText(err) }, "job planifié : échec sur un tenant");
          }
        }
        log.info({ durationMs: Date.now() - startedAt, tenantsOk: ok, tenantsFailed: failed }, "job planifié : fin");
        if (failed > 0) throw new Error(`${failed} tenant(s) en échec sur ${tenants.length}`);
        return { status: "completed", tenants: { ok, failed } };
      }

      await def.handler({ name, logger: log, systemDb, tenantDb });
      log.info({ durationMs: Date.now() - startedAt }, "job planifié : fin");
      return { status: "completed" };
    } catch (err) {
      log.error({ err: errText(err), durationMs: Date.now() - startedAt }, "job planifié : échec");
      throw err;
    } finally {
      await lease.release();
    }
  }

  async stop(): Promise<void> {
    const { logger, shutdownTimeoutMs } = this.deps;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      let timedOut = false;
      await Promise.race([
        worker.close(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, shutdownTimeoutMs).unref(),
        ),
      ]);
      if (timedOut) {
        logger.warn({}, "jobs planifiés encore en cours à l'échéance : fermeture forcée");
        await worker.close(true).catch(() => undefined);
      }
    }
    await this.queue?.close().catch(() => undefined);
    this.queue = null;
  }
}
