/**
 * Instruments Prometheus du worker (ADR-009). Étiquettes à cardinalité FINIE : `module`, `subscriber`, `job`, `queue`,
 * `state`, `outcome`, `kind` (voir core/metrics.ts : `tenant_id` n'est jamais une étiquette).
 */
import {
  Counter,
  Gauge,
  Histogram,
  JOB_BUCKETS,
  LAG_BUCKETS,
  type MetricsKit,
} from "../../../api/src/platform/observability/core/metrics";

export type SubscriberOutcome = "success" | "retry" | "dead";
export type ScheduledOutcome = "success" | "failure" | "skipped";

/** Plus ancien événement d'outbox non publié connu, par tenant (alimenté par le relais). */
export interface PendingEntry {
  count: number;
  /** Instant d'occurrence (ms epoch) du plus ancien événement encore en attente de ce tenant. */
  oldestOccurredAtMs: number;
}

export interface QueueSnapshot {
  queue: string;
  counts: Record<string, number>;
  /** Âge (s) du plus ancien job en attente, `0` si la file d'attente est vide. */
  oldestWaitingSeconds: number;
}

export interface PaymentsPending {
  count: number;
  stale: number;
  oldestSeconds: number;
}

export interface WorkerMetricSources {
  pending(): ReadonlyMap<string, PendingEntry>;
  queues(): Promise<readonly QueueSnapshot[]>;
  jobLastSuccess(): Promise<Readonly<Record<string, number>>>;
  paymentsPending(): PaymentsPending | null;
}

export interface WorkerMetrics {
  outboxPublished: Counter;
  outboxPublishFailures: Counter;
  outboxDead: Counter;
  outboxInfraFailures: Counter;
  outboxLag: Histogram;
  outboxLastSweep: Gauge;
  outboxLastPublish: Gauge;
  routerJobs: Counter<"outcome">;
  subscriberJobs: Counter<"module" | "subscriber" | "outcome">;
  subscriberDuration: Histogram<"module" | "subscriber">;
  scheduledRuns: Counter<"job" | "outcome">;
  scheduledDuration: Histogram<"job">;
  pdfDuration: Histogram<"kind">;
  pdfFailures: Counter<"kind">;
  heartbeat: Gauge;
}

export function createWorkerMetrics(kit: MetricsKit, sources: WorkerMetricSources): WorkerMetrics {
  const registers = [kit.registry];

  const outboxPublished = new Counter({ name: "ed_outbox_events_published_total", help: "Événements d'outbox publiés dans BullMQ par le relais.", registers });
  const outboxPublishFailures = new Counter({ name: "ed_outbox_publish_failures_total", help: "Échecs de publication d'un événement (reprise planifiée).", registers });
  const outboxDead = new Counter({ name: "ed_outbox_events_dead_total", help: "Événements d'outbox en échec définitif (dead-letter).", registers });
  const outboxInfraFailures = new Counter({ name: "ed_outbox_relay_infra_failures_total", help: "Pannes d'infrastructure (Redis injoignable) rencontrées par le relais.", registers });
  const outboxLag = new Histogram({
    name: "ed_outbox_publish_lag_seconds",
    help: "Délai entre l'occurrence d'un événement et sa publication dans BullMQ (retard du relais).",
    buckets: LAG_BUCKETS,
    registers,
  });
  const outboxLastSweep = new Gauge({ name: "ed_outbox_relay_last_sweep_timestamp_seconds", help: "Dernier balayage de l'outbox terminé par le relais (epoch, s).", registers });
  const outboxLastPublish = new Gauge({ name: "ed_outbox_relay_last_publish_timestamp_seconds", help: "Dernière publication réussie d'un événement (epoch, s).", registers });

  new Gauge({
    name: "ed_outbox_pending_events",
    help: "Événements d'outbox connus comme non publiés (estimation du relais au dernier passage, tous tenants).",
    registers,
    collect() {
      let n = 0;
      for (const e of sources.pending().values()) n += e.count;
      this.set(n);
    },
  });
  new Gauge({
    name: "ed_outbox_oldest_pending_age_seconds",
    help: "Âge du plus ancien événement d'outbox non publié connu du relais (0 si aucun).",
    registers,
    collect() {
      let oldest = Number.POSITIVE_INFINITY;
      for (const e of sources.pending().values()) oldest = Math.min(oldest, e.oldestOccurredAtMs);
      this.set(Number.isFinite(oldest) ? Math.max(0, (Date.now() - oldest) / 1000) : 0);
    },
  });

  new Gauge({
    name: "ed_queue_jobs",
    help: "Jobs BullMQ par file et par état (waiting, active, delayed, failed, paused). La DLQ est la file `domain-events-dead`.",
    labelNames: ["queue", "state"],
    registers,
    async collect() {
      this.reset();
      for (const q of await sources.queues()) for (const [state, n] of Object.entries(q.counts)) this.set({ queue: q.queue, state }, n);
    },
  });
  new Gauge({
    name: "ed_queue_oldest_waiting_age_seconds",
    help: "Âge du plus ancien job en attente dans la file (0 si aucun).",
    labelNames: ["queue"],
    registers,
    async collect() {
      this.reset();
      for (const q of await sources.queues()) this.set({ queue: q.queue }, q.oldestWaitingSeconds);
    },
  });

  const routerJobs = new Counter({ name: "ed_event_router_jobs_total", help: "Jobs du routeur d'événements (domain-events -> files des abonnés).", labelNames: ["outcome"], registers });
  const subscriberJobs = new Counter({
    name: "ed_subscriber_jobs_total",
    help: "Traitements d'événements par abonné : success, retry (échec avec reprise) ou dead (échec définitif, dead-letter).",
    labelNames: ["module", "subscriber", "outcome"],
    registers,
  });
  const subscriberDuration = new Histogram({
    name: "ed_subscriber_job_duration_seconds",
    help: "Durée d'une tentative de traitement par abonné.",
    labelNames: ["module", "subscriber"],
    buckets: JOB_BUCKETS,
    registers,
  });

  const scheduledRuns = new Counter({ name: "ed_scheduled_job_runs_total", help: "Exécutions de jobs planifiés : success, failure ou skipped (déjà en cours ailleurs).", labelNames: ["job", "outcome"], registers });
  const scheduledDuration = new Histogram({ name: "ed_scheduled_job_duration_seconds", help: "Durée d'exécution d'un job planifié.", labelNames: ["job"], buckets: JOB_BUCKETS, registers });
  new Gauge({
    name: "ed_scheduled_job_last_success_timestamp_seconds",
    help: "Dernière réussite d'un job planifié (epoch, s) ; persistée dans Redis : elle survit au redémarrage du worker.",
    labelNames: ["job"],
    registers,
    async collect() {
      this.reset();
      for (const [job, ts] of Object.entries(await sources.jobLastSuccess())) this.set({ job }, ts);
    },
  });

  const pdfDuration = new Histogram({ name: "ed_pdf_render_duration_seconds", help: "Durée d'un traitement de rendu PDF, par abonné de rendu.", labelNames: ["kind"], buckets: JOB_BUCKETS, registers });
  const pdfFailures = new Counter({ name: "ed_pdf_render_failures_total", help: "Échecs d'un traitement de rendu PDF, par abonné de rendu.", labelNames: ["kind"], registers });

  new Gauge({
    name: "ed_finance_payments_pending",
    help: "Paiements au statut PENDING, tous tenants (lecture seule, sans donnée personnelle).",
    registers,
    collect() {
      const v = sources.paymentsPending();
      if (v) this.set(v.count);
    },
  });
  new Gauge({
    name: "ed_finance_payments_pending_stale",
    help: "Paiements PENDING depuis plus de OBS_PAYMENTS_STALE_MINUTES minutes (défaut 30).",
    registers,
    collect() {
      const v = sources.paymentsPending();
      if (v) this.set(v.stale);
    },
  });
  new Gauge({
    name: "ed_finance_payments_pending_oldest_age_seconds",
    help: "Âge du plus ancien paiement PENDING, tous tenants.",
    registers,
    collect() {
      const v = sources.paymentsPending();
      if (v) this.set(v.oldestSeconds);
    },
  });

  const heartbeat = new Gauge({ name: "ed_worker_heartbeat_timestamp_seconds", help: "Dernier battement de cœur de ce worker (epoch, s).", registers });

  return {
    outboxPublished,
    outboxPublishFailures,
    outboxDead,
    outboxInfraFailures,
    outboxLag,
    outboxLastSweep,
    outboxLastPublish,
    routerJobs,
    subscriberJobs,
    subscriberDuration,
    scheduledRuns,
    scheduledDuration,
    pdfDuration,
    pdfFailures,
    heartbeat,
  };
}
