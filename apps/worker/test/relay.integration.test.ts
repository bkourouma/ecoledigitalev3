import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import type { DomainEvent } from "@ecoledigitale/kernel";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import { Pool } from "pg";
import { createRedis } from "../src/infra/redis";
import { OutboxRelay, RelayInfraError, type RelayConfig } from "../src/events/relay";
import { PgNotificationListener } from "../src/events/notifications";
import {
  BullDeadLetter,
  BullEventPublisher,
  DEAD_LETTER_QUEUE,
  DOMAIN_EVENTS_QUEUE,
  type EventPublisher,
} from "../src/events/publisher";
import { DeadLetterAdmin } from "../src/events/dlq-admin";
import { createLogger } from "../src/logger";
import {
  captureLogger,
  countPublished,
  createTestEnv,
  describeIntegration,
  sleep,
  waitFor,
  writeEvents,
  type TestEnv,
} from "./helpers";
import type { Redis } from "ioredis";

const config: RelayConfig = {
  batchSize: 100,
  sweepIntervalMs: 300,
  pollIntervalMs: 50,
  maxAttempts: 3,
  backoff: { baseMs: 30, maxMs: 100, jitter: 0 },
};

/** Publieur qui enregistre chaque publication (preuve « exactement une fois ») et délègue à BullMQ. */
class RecordingPublisher implements EventPublisher {
  readonly published: string[] = [];
  constructor(protected readonly inner: EventPublisher) {}
  async publish(e: DomainEvent) {
    await this.inner.publish(e);
    this.published.push(e.id);
  }
  async publishMany(es: readonly DomainEvent[]) {
    await this.inner.publishMany(es);
    this.published.push(...es.map((e) => e.id));
  }
  isHealthy() {
    return this.inner.isHealthy();
  }
}

describeIntegration("relais d'outbox (Postgres + Redis réels)", () => {
  let env: TestEnv;
  let failfast: Redis;
  let eventsQueue: Queue;
  let deadQueue: Queue;
  const pools: Pool[] = [];
  const closers: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    env = await createTestEnv(3);
    failfast = createRedis(env.redisUrl, "failfast");
    eventsQueue = new Queue(DOMAIN_EVENTS_QUEUE, { connection: failfast, prefix: env.prefix });
    deadQueue = new Queue(DEAD_LETTER_QUEUE, { connection: failfast, prefix: env.prefix });
  });

  afterAll(async () => {
    for (const close of closers) await close().catch(() => undefined);
    await eventsQueue.close();
    await deadQueue.close();
    failfast.disconnect();
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    await env.drop();
  });

  /** Une « instance » de relais, avec son propre pool PG (comme un processus distinct). */
  function makeRelay(opts: { publisher?: (inner: EventPublisher) => EventPublisher; config?: Partial<RelayConfig>; listen?: boolean } = {}) {
    const pool = new Pool({ connectionString: env.appUrl, max: 5 });
    pools.push(pool);
    const systemDb = new SystemDb(new TenantDb(pool), { logger: captureLogger().logger });
    const inner = new BullEventPublisher(eventsQueue);
    const publisher = opts.publisher ? opts.publisher(inner) : new RecordingPublisher(inner);
    const logger = createLogger("silent");
    const relay = new OutboxRelay({
      systemDb,
      publisher,
      dead: new BullDeadLetter(deadQueue),
      notifications: opts.listen ? new PgNotificationListener(env.appUrl, logger) : undefined,
      logger,
      config: { ...config, ...opts.config },
      rng: () => 0,
    });
    closers.push(() => relay.stop());
    return { relay, publisher, pool };
  }

  async function resetOutbox(): Promise<void> {
    await env.admin.query("TRUNCATE kernel.domain_events");
    await eventsQueue.obliterate({ force: true });
    await deadQueue.obliterate({ force: true });
  }

  async function queuedEventIds(): Promise<string[]> {
    const jobs = await eventsQueue.getJobs(["waiting", "active", "delayed", "completed", "failed", "paused", "prioritized"], 0, -1);
    return jobs.map((j) => String(j.id));
  }

  it("1 000 événements sur 3 tenants : publiés EXACTEMENT UNE FOIS par 3 instances de relais concurrentes", async () => {
    await resetOutbox();
    const [t1, t2, t3] = env.tenants as [(typeof env.tenants)[0], (typeof env.tenants)[0], (typeof env.tenants)[0]];
    const written = [
      ...(await writeEvents(env, t1, 333, "school.student.enrolled")),
      ...(await writeEvents(env, t2, 333, "finance.payment.completed")),
      ...(await writeEvents(env, t3, 334, "academic.grade.published")),
    ];
    expect(written).toHaveLength(1000);

    const instances = [makeRelay({ config: { batchSize: 50 } }), makeRelay({ config: { batchSize: 50 } }), makeRelay({ config: { batchSize: 50 } })];
    await Promise.all(instances.map((i) => i.relay.start()));

    await waitFor(async () => (await countPublished(env)) === 1000, { label: "1000 événements publiés", timeoutMs: 60_000 });
    await Promise.all(instances.map((i) => i.relay.stop()));

    // 1. Chaque événement a été remis à BullMQ par UNE seule instance, UNE seule fois.
    const all = instances.flatMap((i) => (i.publisher as RecordingPublisher).published);
    expect(all).toHaveLength(1000);
    expect(new Set(all).size).toBe(1000);
    expect(new Set(all)).toEqual(new Set(written.map((e) => e.id)));

    // 2. La file contient exactement ces 1000 jobs (jobId = id d'événement).
    const ids = await queuedEventIds();
    expect(ids).toHaveLength(1000);
    expect(new Set(ids)).toEqual(new Set(written.map((e) => e.id)));

    // 3. L'état en base est propre : tout publié, aucun échec comptabilisé.
    const state = await env.admin.query(
      "SELECT count(*)::int AS n, max(attempts)::int AS max_attempts, count(*) FILTER (WHERE last_error IS NOT NULL)::int AS errors FROM kernel.domain_events WHERE published_at IS NOT NULL",
    );
    expect(state.rows[0]).toEqual({ n: 1000, max_attempts: 0, errors: 0 });

    // 4. Le travail a bien été réparti (au moins 2 instances ont publié).
    const active = instances.filter((i) => (i.publisher as RecordingPublisher).published.length > 0).length;
    expect(active).toBeGreaterThanOrEqual(2);
  });

  it("latence < 1 s à faible charge grâce à LISTEN/NOTIFY (balayage espacé de 30 s)", async () => {
    await resetOutbox();
    const { relay } = makeRelay({ listen: true, config: { sweepIntervalMs: 30_000 } });
    await relay.start();
    expect(relay.listening).toBe(true);
    await sleep(300); // laisse le premier balayage se terminer

    const latencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const tenant = env.tenants[i % env.tenants.length] as (typeof env.tenants)[0];
      const [event] = await writeEvents(env, tenant, 1, "school.student.enrolled");
      const t0 = Date.now();
      await waitFor(
        async () => (await env.admin.query("SELECT 1 FROM kernel.domain_events WHERE id = $1 AND published_at IS NOT NULL", [event?.id])).rowCount === 1,
        { intervalMs: 5, timeoutMs: 5_000, label: `événement ${i} publié` },
      );
      latencies.push(Date.now() - t0);
      await sleep(30);
    }
    await relay.stop();
    latencies.sort((a, b) => a - b);
    console.log(`[latence relais] min=${latencies[0]} ms, médiane=${latencies[5]} ms, max=${latencies[9]} ms (mesure incluant le sondage de test à 5 ms)`);
    expect(latencies[9]).toBeLessThan(1000);
  });

  it("sans LISTEN, le polling adaptatif reste sous la seconde", async () => {
    await resetOutbox();
    const { relay } = makeRelay({ listen: false, config: { pollIntervalMs: 100 } });
    await relay.start();
    await sleep(200);
    const [event] = await writeEvents(env, env.tenants[0] as (typeof env.tenants)[0], 1);
    const t0 = Date.now();
    await waitFor(async () => (await env.admin.query("SELECT 1 FROM kernel.domain_events WHERE id = $1 AND published_at IS NOT NULL", [event?.id])).rowCount === 1, {
      intervalMs: 5,
      label: "publié par polling",
    });
    await relay.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("crash ENTRE la mise en file et le COMMIT : rien n'est perdu, rien n'est dupliqué dans la file", async () => {
    await resetOutbox();
    const written = (await Promise.all(env.tenants.map((t) => writeEvents(env, t, 120)))).flat();
    expect(written).toHaveLength(360);

    // Instance A : ajoute RÉELLEMENT à BullMQ puis « meurt » avant le COMMIT (Redis vu comme injoignable).
    class CrashAfterAdd extends RecordingPublisher {
      async publishMany(es: readonly DomainEvent[]) {
        await this.inner.publishMany(es);
        throw new Error("SIMULATION : processus tué entre l'add Redis et le commit");
      }
      async isHealthy() {
        return false;
      }
    }
    const a = makeRelay({ publisher: (inner) => new CrashAfterAdd(inner), config: { batchSize: 50 } });
    await a.relay.start();
    await waitFor(() => a.relay.stats.infraFailures >= 1, { label: "l'instance A a « crashé »" });
    await a.relay.stop();

    // Rien n'a été marqué publié (transaction annulée) alors que des jobs sont déjà dans Redis.
    expect(await countPublished(env)).toBe(0);
    expect((await queuedEventIds()).length).toBeGreaterThan(0);

    // Instance B (redémarrage) : republie tout ; BullMQ ignore les jobIds déjà présents.
    const b = makeRelay();
    await b.relay.start();
    await waitFor(async () => (await countPublished(env)) === 360, { label: "360 publiés après reprise", timeoutMs: 60_000 });
    await b.relay.stop();

    const ids = await queuedEventIds();
    expect(ids).toHaveLength(360);
    expect(new Set(ids)).toEqual(new Set(written.map((e) => e.id)));
  });

  it("arrêt/redémarrage au milieu du traitement : aucune perte, aucun doublon", async () => {
    await resetOutbox();
    const written = (await Promise.all(env.tenants.map((t) => writeEvents(env, t, 400)))).flat(); // 1 200

    const a = makeRelay({ config: { batchSize: 25 } });
    await a.relay.start();
    await waitFor(async () => (await countPublished(env)) >= 150, { label: "au moins 150 publiés", intervalMs: 5 });
    await a.relay.stop(); // arrêt gracieux EN COURS de route (lot terminé, pas de nouveau lot)
    const afterStop = await countPublished(env);
    expect(afterStop).toBeGreaterThanOrEqual(150);
    expect(afterStop).toBeLessThan(1200);
    await sleep(200);
    expect(await countPublished(env)).toBe(afterStop); // il s'est bien arrêté

    const b = makeRelay({ config: { batchSize: 25 } });
    await b.relay.start();
    await waitFor(async () => (await countPublished(env)) === 1200, { label: "reprise complète", timeoutMs: 60_000 });
    await b.relay.stop();

    const publishedByA = (a.publisher as RecordingPublisher).published;
    const publishedByB = (b.publisher as RecordingPublisher).published;
    expect(publishedByA.length + publishedByB.length).toBe(1200);
    expect(new Set([...publishedByA, ...publishedByB]).size).toBe(1200);
    const ids = await queuedEventIds();
    expect(new Set(ids)).toEqual(new Set(written.map((e) => e.id)));
    expect(ids).toHaveLength(1200);
  });

  it("événement empoisonné : backoff exponentiel, puis échec DÉFINITIF + dead-letter ; les autres passent", async () => {
    await resetOutbox();
    const tenant = env.tenants[0] as (typeof env.tenants)[0];
    const [poison, ...healthy] = await writeEvents(env, tenant, 6, "school.student.enrolled");

    class PoisonPublisher extends RecordingPublisher {
      readonly attemptsSeen: number[] = [];
      private async guard(es: readonly DomainEvent[]) {
        if (es.some((e) => e.id === poison?.id)) {
          this.attemptsSeen.push(Date.now());
          throw new Error("payload refusé (simulation)");
        }
      }
      async publishMany(es: readonly DomainEvent[]) {
        await this.guard(es);
        await super.publishMany(es);
      }
      async publish(e: DomainEvent) {
        await this.guard([e]);
        await super.publish(e);
      }
    }
    const { relay, publisher } = makeRelay({ publisher: (inner) => new PoisonPublisher(inner), config: { maxAttempts: 3, backoff: { baseMs: 80, maxMs: 1000, jitter: 0 } } });
    await relay.start();

    await waitFor(
      async () => (await env.admin.query("SELECT 1 FROM kernel.domain_events WHERE id = $1 AND available_at = 'infinity'", [poison?.id])).rowCount === 1,
      { label: "échec définitif", timeoutMs: 20_000 },
    );
    await sleep(500); // l'événement ne doit plus jamais être retenté
    await relay.stop();

    // Les 5 événements sains sont publiés, le poison ne l'est pas.
    expect(await countPublished(env)).toBe(5);
    const row = (await env.admin.query("SELECT attempts, published_at, last_error, available_at = 'infinity' AS dead FROM kernel.domain_events WHERE id = $1", [poison?.id])).rows[0];
    expect(row).toMatchObject({ attempts: 3, published_at: null, dead: true });
    expect(row.last_error).toContain("payload refusé");
    expect(relay.stats.dead).toBe(1);

    // Backoff exponentiel : les écarts entre tentatives grandissent (80 ms puis 160 ms, +marge d'ordonnancement).
    const seen = (publisher as PoisonPublisher).attemptsSeen;
    // Chaque tentative = publishMany (échec) + publish isolé (échec) : on prend une mesure par lot.
    const batches = seen.filter((t, i) => i === 0 || t - (seen[i - 1] as number) > 40);
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect((batches[1] as number) - (batches[0] as number)).toBeGreaterThanOrEqual(70);
    expect((batches[2] as number) - (batches[1] as number)).toBeGreaterThanOrEqual(150);

    // Dead-letter : une entrée « relay » pour cet événement.
    const dead = await deadQueue.getJobs(["waiting"], 0, -1);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.data).toMatchObject({ kind: "relay", attempts: 3, event: { id: poison?.id, tenantId: tenant.id } });
    expect(await queuedEventIds()).not.toContain(poison?.id);
    void healthy;

    // Rejouer depuis la DLQ : l'événement redevient éligible, un relais sain le publie.
    const admin = new DeadLetterAdmin(failfast, env.prefix, env.systemDb);
    closers.push(() => admin.close());
    const entries = await admin.list();
    expect(entries).toHaveLength(1);
    expect(await admin.replay((entries[0] as { id: string }).id)).toBe(true);
    const healthyRelay = makeRelay();
    await healthyRelay.relay.start();
    await waitFor(async () => (await countPublished(env)) === 6, { label: "poison rejoué et publié" });
    await healthyRelay.relay.stop();
    expect(await queuedEventIds()).toContain(poison?.id);
    expect(await admin.count()).toBe(0);
  });

  it("panne de Redis : AUCUNE tentative comptabilisée, reprise automatique au retour de Redis", async () => {
    await resetOutbox();
    const tenant = env.tenants[1] as (typeof env.tenants)[0];
    const written = await writeEvents(env, tenant, 40);

    let redisDown = true;
    class FlakyRedisPublisher extends RecordingPublisher {
      async publishMany(es: readonly DomainEvent[]) {
        if (redisDown) throw new Error("ECONNREFUSED (simulation)");
        await super.publishMany(es);
      }
      async publish(e: DomainEvent) {
        if (redisDown) throw new Error("ECONNREFUSED (simulation)");
        await super.publish(e);
      }
      async isHealthy() {
        return !redisDown;
      }
    }
    const { relay } = makeRelay({ publisher: (inner) => new FlakyRedisPublisher(inner) });
    await relay.start();
    await waitFor(() => relay.stats.infraFailures >= 2, { label: "pannes détectées" });
    expect(await countPublished(env)).toBe(0);
    const during = await env.admin.query("SELECT max(attempts)::int AS a, count(*) FILTER (WHERE available_at = 'infinity')::int AS dead FROM kernel.domain_events");
    expect(during.rows[0]).toEqual({ a: 0, dead: 0 }); // l'événement n'y est pour rien : aucun compteur touché

    redisDown = false;
    await waitFor(async () => (await countPublished(env)) === 40, { label: "reprise après panne", timeoutMs: 30_000 });
    await relay.stop();
    expect(new Set(await queuedEventIds())).toEqual(new Set(written.map((e) => e.id)));
  });

  it("RelayInfraError est exposée pour les intégrateurs", () => {
    expect(new RelayInfraError("x").name).toBe("RelayInfraError");
  });
});
