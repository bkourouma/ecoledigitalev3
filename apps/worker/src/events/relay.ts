/**
 * Relais de l'outbox : `kernel.domain_events` (non publiés) -> file BullMQ `domain-events`.
 *
 * Principe, pour UN tenant (une transaction, RLS du tenant) :
 *   1. `SELECT ... FOR UPDATE SKIP LOCKED` d'un lot d'événements prêts ;
 *   2. publication dans BullMQ (jobId = id d'événement => dédoublonnage) ;
 *   3. `published_at = now()` ; COMMIT.
 * Plusieurs instances se partagent le travail sans doublon : une ligne verrouillée par
 * une instance est sautée par les autres. Un crash entre 2 et 3 relâche les verrous ;
 * l'événement est republié, mais BullMQ l'ignore (même jobId) : au moins une fois côté
 * outbox, une fois côté file.
 *
 * Échecs :
 *  - Redis injoignable (panne d'infrastructure) : AUCUN compteur de tentatives n'est
 *    touché (ce n'est pas la faute de l'événement) ; transaction annulée, le relais
 *    se met en pause avec un backoff exponentiel (500 ms -> 30 s) ;
 *  - Redis répond mais refuse CET événement : `attempts + 1`, `available_at` repoussé
 *    d'un backoff exponentiel plafonné ; à `maxAttempts` : statut d'échec DÉFINITIF
 *    (`available_at = 'infinity'`, `last_error` conservé) et copie dans la DLQ
 *    `domain-events-dead`. Rejouer : voir le README (CLI `dlq`).
 *
 * Latence : LISTEN/NOTIFY signale le tenant concerné (quelques ms) ; sinon polling
 * (`pollIntervalMs`). Un balayage de tous les tenants toutes les `sweepIntervalMs`
 * rattrape les signaux perdus et les retries échus.
 */
import type { DomainEvent } from "@ecoledigitale/kernel";
import {
  fetchPendingEvents,
  markEventFailed,
  markEventsPublished,
  type PendingEvent,
  type SystemDb,
  type Tx,
} from "@ecoledigitale/database";
import type { Logger } from "../logger";
import type { RelayObserver } from "../observability";
import { computeBackoff, type BackoffOptions } from "./backoff";
import type { NotificationSource } from "./notifications";
import type { DeadLetter, EventPublisher } from "./publisher";

export interface RelayConfig {
  batchSize: number;
  sweepIntervalMs: number;
  pollIntervalMs: number;
  maxAttempts: number;
  backoff: BackoffOptions;
  /** Lit la colonne `traceparent` de l'outbox (migration 0604) pour propager le contexte de trace (ADR-009). */
  withTraceparent?: boolean;
}

export interface RelayDeps {
  systemDb: SystemDb;
  publisher: EventPublisher;
  dead: DeadLetter;
  notifications?: NotificationSource;
  logger: Logger;
  config: RelayConfig;
  rng?: () => number;
  /** Métriques d'exploitation du relais (retard de publication, échecs, plus ancien événement en attente). */
  observer?: RelayObserver;
}

export interface RelayStats {
  published: number;
  failed: number;
  dead: number;
  sweeps: number;
  infraFailures: number;
  lastPublishedAt: number | null;
}

/** Redis est injoignable : l'événement n'y est pour rien. */
export class RelayInfraError extends Error {
  constructor(message: string, readonly causeError?: unknown) {
    super(message);
    this.name = "RelayInfraError";
  }
}

const REASON = "outbox-relay";
const INFRA_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 30_000, jitter: 0.2 };

export function toDomainEvent(row: PendingEvent): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    tenantId: row.tenant_id,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    payload: row.payload,
    ...(row.aggregate_type ? { aggregateType: row.aggregate_type } : {}),
    ...(row.aggregate_id ? { aggregateId: row.aggregate_id } : {}),
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.traceparent ? { traceparent: row.traceparent } : {}),
  };
}

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 1000);

export class OutboxRelay {
  readonly stats: RelayStats = { published: 0, failed: 0, dead: 0, sweeps: 0, infraFailures: 0, lastPublishedAt: null };

  private running = false;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private readonly dirty = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private wakeResolve: (() => void) | null = null;
  private sweepRequested = true;
  private lastSweepAt = 0;
  private infraFailures = 0;
  private infraPausedUntil = 0;

  constructor(private readonly deps: RelayDeps) {}

  /** Interrompt l'attente de la boucle. */
  private wake(): void {
    const resolve = this.wakeResolve;
    this.wakeResolve = null;
    resolve?.();
  }

  private waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, Math.max(1, ms));
      const self = this;
      function done(): void {
        clearTimeout(timer);
        if (self.wakeResolve === done) self.wakeResolve = null;
        resolve();
      }
      this.wakeResolve = done;
    });
  }

  /** Signale qu'un tenant a (peut-être) des événements à publier. */
  notifyTenant(tenantId: string): void {
    this.dirty.add(tenantId);
    this.wake();
  }

  get listening(): boolean {
    return this.deps.notifications?.connected === true;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.sweepRequested = true;
    await this.deps.notifications?.start(
      (tenantId) => this.notifyTenant(tenantId),
      () => {
        this.sweepRequested = true;
        this.wake();
      },
    );
    this.loopPromise = this.loop();
    this.deps.logger.info({ listen: this.listening, batchSize: this.deps.config.batchSize }, "relais d'outbox démarré");
  }

  /** Arrêt gracieux : termine le lot en cours (transaction), n'en démarre pas d'autre. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopping = true;
    this.wake();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.deps.notifications?.stop();
    await this.loopPromise;
    this.running = false;
    this.deps.logger.info({ ...this.stats }, "relais d'outbox arrêté");
  }

  /** Un passage complet sur tous les tenants (tests, outils). Renvoie le nombre d'événements publiés. */
  async sweepOnce(): Promise<number> {
    return this.sweep();
  }

  private async loop(): Promise<void> {
    const { config } = this.deps;
    while (!this.stopping) {
      let worked = 0;
      try {
        const now = Date.now();
        if (now < this.infraPausedUntil) {
          await this.waitFor(this.infraPausedUntil - now);
          continue;
        }
        if (this.sweepRequested || now - this.lastSweepAt >= (this.listening ? config.sweepIntervalMs : config.pollIntervalMs)) {
          worked += await this.sweep();
        }
        worked += await this.drainDirty();
        if (this.infraFailures > 0) {
          this.infraFailures = 0;
          this.deps.logger.info({}, "Redis de nouveau joignable : relais repris");
        }
      } catch (err) {
        if (err instanceof RelayInfraError) this.onInfraFailure(err);
        else this.deps.logger.error({ err: errText(err) }, "relais : erreur inattendue");
        await this.waitFor(250);
        continue;
      }
      if (this.stopping) break;
      if (worked > 0 || this.dirty.size > 0 || this.sweepRequested) continue; // charge : on enchaîne sans attendre
      const interval = this.listening ? config.sweepIntervalMs : config.pollIntervalMs;
      await this.waitFor(Math.max(1, this.lastSweepAt + interval - Date.now()));
    }
  }

  private onInfraFailure(err: RelayInfraError): void {
    this.infraFailures += 1;
    this.stats.infraFailures += 1;
    const pause = computeBackoff(this.infraFailures, INFRA_BACKOFF, this.deps.rng);
    this.infraPausedUntil = Date.now() + pause;
    this.sweepRequested = true;
    this.deps.observer?.infraFailure();
    this.deps.logger.error({ err: err.message, pauseMs: pause, consecutive: this.infraFailures }, "relais en pause : Redis injoignable");
  }

  /** Balayage de tous les tenants actifs. */
  private async sweep(): Promise<number> {
    this.sweepRequested = false;
    this.lastSweepAt = Date.now();
    this.stats.sweeps += 1;
    // Tout ce qui est déjà signalé sera vu par ce balayage ; les signaux ultérieurs resteront en file.
    this.dirty.clear();
    let published = 0;
    const report = await this.deps.systemDb.forEachTenant(REASON, async (tx, tenant) => {
      if (this.stopping) return 0;
      const n = await this.processTenant(tx, tenant.id);
      if (n >= this.deps.config.batchSize) this.dirty.add(tenant.id); // il en reste probablement
      return n;
    });
    for (const ok of report.succeeded) published += ok.result;
    this.deps.observer?.sweepDone(Date.now());
    const infra = report.failed.find((f) => f.error instanceof RelayInfraError);
    for (const f of report.failed) {
      if (f.error instanceof RelayInfraError) continue;
      this.deps.logger.error({ tenantId: f.tenantId, slug: f.slug, err: errText(f.error) }, "relais : échec sur un tenant");
    }
    if (infra) throw infra.error;
    return published;
  }

  /** Traite les tenants signalés (NOTIFY, lots pleins, retries échus). */
  private async drainDirty(): Promise<number> {
    if (this.dirty.size === 0) return 0;
    const tenants = [...this.dirty];
    this.dirty.clear();
    let published = 0;
    for (const tenantId of tenants) {
      if (this.stopping) {
        this.dirty.add(tenantId);
        continue;
      }
      try {
        const n = await this.deps.systemDb.runForTenant(REASON, tenantId, (tx) => this.processTenant(tx, tenantId));
        published += n;
        if (n >= this.deps.config.batchSize) this.dirty.add(tenantId);
      } catch (err) {
        if (err instanceof RelayInfraError) {
          this.dirty.add(tenantId);
          throw err;
        }
        this.deps.logger.error({ tenantId, err: errText(err) }, "relais : échec sur un tenant");
      }
    }
    return published;
  }

  /**
   * Un lot pour le tenant de `tx`. Exposé pour les tests ; à appeler dans une transaction
   * `SystemDb` du tenant. Renvoie le nombre d'événements MIS EN FILE (publiés).
   */
  async processTenant(tx: Tx, tenantId: string): Promise<number> {
    const { publisher, dead, config, logger, observer } = this.deps;
    const rows = await fetchPendingEvents(tx, config.batchSize, config.withTraceparent ? { withTraceparent: true } : {});
    if (rows.length === 0) {
      observer?.tenantPending(tenantId, null);
      return 0;
    }
    // Panne d'infrastructure : rien n'a été publié, tout ce lot reste en attente (signal « outbox bloquée »).
    const stuck = (): void =>
      observer?.tenantPending(tenantId, { count: rows.length, oldestOccurredAtMs: new Date(rows[0]?.occurred_at ?? Date.now()).getTime() });

    const events = rows.map(toDomainEvent);
    const failures = new Map<string, unknown>();

    try {
      await publisher.publishMany(events);
    } catch (bulkError) {
      if (!(await publisher.isHealthy())) {
        stuck();
        throw new RelayInfraError("publication impossible : Redis ne répond pas", bulkError);
      }
      // Redis répond : on isole le(s) événement(s) fautif(s). Les doublons sont absorbés par le jobId.
      for (const event of events) {
        try {
          await publisher.publish(event);
        } catch (error) {
          if (!(await publisher.isHealthy())) {
            stuck();
            throw new RelayInfraError("publication impossible : Redis ne répond pas", error);
          }
          failures.set(event.id, error);
        }
      }
    }

    const okIds = events.filter((e) => !failures.has(e.id)).map((e) => e.id);
    await markEventsPublished(tx, okIds);

    // Reste en attente après ce passage : les événements dont la publication a échoué et sera reprise.
    const retained: Array<{ occurredAtMs: number }> = [];
    for (const row of rows) {
      const error = failures.get(row.id);
      if (error === undefined) continue;
      const attempts = row.attempts + 1;
      const message = errText(error);
      if (attempts >= config.maxAttempts) {
        // Échec DÉFINITIF. Dépôt en DLQ d'abord : si Redis lâche ici, la transaction est annulée et rejouée.
        try {
          await dead.push({
            kind: "relay",
            event: events.find((e) => e.id === row.id) as DomainEvent,
            error: message,
            attempts,
            failedAt: new Date().toISOString(),
          });
        } catch (dlqError) {
          throw new RelayInfraError("dépôt en dead-letter impossible", dlqError);
        }
        await tx.query(
          `UPDATE kernel.domain_events
              SET attempts = attempts + 1, last_error = left($2, 2000), available_at = 'infinity'
            WHERE id = $1`,
          [row.id, message],
        );
        this.stats.dead += 1;
        observer?.dead();
        logger.error({ tenantId, eventId: row.id, eventType: row.type, requestId: row.request_id ?? undefined, attempts, err: message }, "événement en échec définitif (dead-letter)");
      } else {
        const retryInMs = computeBackoff(attempts, config.backoff, this.deps.rng);
        await markEventFailed(tx, row.id, message, retryInMs);
        this.stats.failed += 1;
        observer?.publishFailed();
        retained.push({ occurredAtMs: new Date(row.occurred_at).getTime() });
        this.scheduleRetry(tenantId, retryInMs);
        logger.warn({ tenantId, eventId: row.id, eventType: row.type, requestId: row.request_id ?? undefined, attempts, retryInMs, err: message }, "publication échouée : nouvelle tentative planifiée");
      }
    }

    this.stats.published += okIds.length;
    if (okIds.length > 0) this.stats.lastPublishedAt = Date.now();
    if (observer) {
      observer.published(events.filter((e) => !failures.has(e.id)), Date.now());
      observer.tenantPending(
        tenantId,
        retained.length > 0 ? { count: retained.length, oldestOccurredAtMs: Math.min(...retained.map((r) => r.occurredAtMs)) } : null,
      );
    }
    logger.debug({ tenantId, published: okIds.length, failed: failures.size }, "lot d'outbox traité");
    return okIds.length + failures.size;
  }

  /** Réveille le relais sur ce tenant quand le retry est dû (le balayage sert de filet). */
  private scheduleRetry(tenantId: string, delayMs: number): void {
    if (this.stopping) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.notifyTenant(tenantId);
    }, delayMs + 25);
    timer.unref();
    this.timers.add(timer);
  }
}
